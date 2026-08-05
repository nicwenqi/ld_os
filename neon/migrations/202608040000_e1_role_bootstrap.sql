/*
 * E1 / 202608040000 — child-only Neon role bootstrap
 *
 * Approved target (prove again in the Neon control plane before execution):
 *   project        flat-brook-43278549
 *   child branch   br-aged-river-az1gke14
 *   child endpoint ep-sparkling-shape-az9gxtuh
 *
 * Production deny-list (never connect or execute there):
 *   branch         br-twilight-leaf-azmowo1k
 *   endpoint       ep-wild-wave-azjmgdif
 *
 * Execute once as the child bootstrap identity, neondb_owner. Passwords are
 * deliberately NULL; credential provisioning is external to SQL and Git.
 * This migration does not alter a business table, policy, or business row.
 */

begin;

do $e1_preflight$
declare
  v_role_count integer;
  v_rls_count integer;
begin
  if current_database() <> 'neondb'
     or current_user <> 'neondb_owner'
     or session_user <> 'neondb_owner' then
    raise exception using
      errcode = '42501',
      message = 'E1_BOOTSTRAP_IDENTITY_MISMATCH';
  end if;

  select count(*)
    into v_role_count
  from pg_catalog.pg_roles
  where rolname in (
    'hotel_ld_migration_owner',
    'hotel_ld_people_read',
    'hotel_ld_application',
    'hotel_ld_readonly'
  );

  if v_role_count <> 0 then
    raise exception using
      errcode = '42710',
      message = 'E1_ROLE_ALREADY_EXISTS';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'neondb_owner'
      and rolcanlogin
      and not rolsuper
      and rolbypassrls
      and rolcreaterole
  ) then
    raise exception using
      errcode = '42501',
      message = 'E1_BOOTSTRAP_ROLE_DRIFT';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_namespace
    where nspname = 'app_private'
  ) or not exists (
    select 1
    from pg_catalog.pg_namespace
    where nspname = 'auth'
  ) then
    raise exception using
      errcode = '3F000',
      message = 'E1_REQUIRED_SCHEMA_MISSING';
  end if;

  select count(*)
    into v_rls_count
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind = 'r'
    and relation.relname = any (array[
      'profiles',
      'tenants',
      'properties',
      'property_domains',
      'tenant_memberships',
      'property_memberships',
      'roles',
      'role_assignments',
      'trainer_scopes',
      'user_accounts',
      'departments',
      'department_closure',
      'operational_units',
      'position_families',
      'positions',
      'employees',
      'employee_external_identifiers'
    ])
    and relation.relrowsecurity
    and relation.relforcerowsecurity;

  if v_rls_count <> 17 then
    raise exception using
      errcode = '42501',
      message = 'E1_FORCE_RLS_BASELINE_DRIFT';
  end if;
end
$e1_preflight$;

create role hotel_ld_migration_owner
  login noinherit nosuperuser nobypassrls nocreatedb nocreaterole
  noreplication connection limit 2 password null;

create role hotel_ld_people_read
  nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole
  noreplication;

create role hotel_ld_application
  login noinherit nosuperuser nobypassrls nocreatedb nocreaterole
  noreplication connection limit 30 password null;

create role hotel_ld_readonly
  nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole
  noreplication;

/*
 * PostgreSQL 18 membership options are explicit. Runtime inherits only the
 * permission group's grants and cannot SET ROLE into the group.
 */
grant hotel_ld_people_read to hotel_ld_application
  with inherit true, set false, admin false;

/*
 * A CREATEROLE principal receives ADMIN/SET FALSE on roles it creates.
 * Bootstrap temporarily needs SET TRUE only to create E1 objects as the
 * constrained owner. It remains a bootstrap relationship, never a runtime
 * membership path.
 */
grant hotel_ld_migration_owner to neondb_owner
  with set true;

grant usage, create on schema app_private to hotel_ld_migration_owner;
grant usage, create on schema public to hotel_ld_migration_owner;
grant usage on schema auth to hotel_ld_migration_owner;

grant usage on schema public to hotel_ld_people_read;

revoke create on schema app_private, public, auth from public;
revoke create on schema app_private, public, auth
  from hotel_ld_people_read, hotel_ld_application, hotel_ld_readonly;

comment on role hotel_ld_migration_owner is
  'Hotel L&D OS child migration owner; never a runtime credential; NOBYPASSRLS';
comment on role hotel_ld_people_read is
  'NOLOGIN permission group for exact People read entry points';
comment on role hotel_ld_application is
  'Hotel L&D OS server runtime login; non-owner; NOBYPASSRLS';
comment on role hotel_ld_readonly is
  'Dormant NOLOGIN readonly permission group; no E1 data grants';

do $e1_post_bootstrap$
declare
  v_valid_roles integer;
  v_runtime_owned_objects integer;
  v_runtime_memberships integer;
  v_relation oid;
  v_role name;
begin
  select count(*)
    into v_valid_roles
  from pg_catalog.pg_roles
  where rolname in (
    'hotel_ld_migration_owner',
    'hotel_ld_people_read',
    'hotel_ld_application',
    'hotel_ld_readonly'
  )
    and not rolsuper
    and not rolbypassrls
    and not rolcreatedb
    and not rolcreaterole
    and not rolreplication
    and not rolinherit
    and rolcanlogin = (rolname in (
      'hotel_ld_migration_owner',
      'hotel_ld_application'
    ));

  if v_valid_roles <> 4 then
    raise exception using
      errcode = '42501',
      message = 'E1_ROLE_ATTRIBUTE_ASSERTION_FAILED';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role
      on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role
      on member_role.oid = membership.member
    where granted_role.rolname = 'hotel_ld_people_read'
      and member_role.rolname = 'hotel_ld_application'
      and membership.inherit_option
      and not membership.set_option
      and not membership.admin_option
  ) then
    raise exception using
      errcode = '42501',
      message = 'E1_RUNTIME_MEMBERSHIP_ASSERTION_FAILED';
  end if;

  select count(*)
    into v_runtime_memberships
  from pg_catalog.pg_auth_members as membership
  join pg_catalog.pg_roles as member_role
    on member_role.oid = membership.member
  where member_role.rolname = 'hotel_ld_application';

  if v_runtime_memberships <> 1 then
    raise exception using
      errcode = '42501',
      message = 'E1_RUNTIME_MEMBERSHIP_DRIFT';
  end if;

  if pg_catalog.to_regrole('neon_superuser') is null then
    raise exception using
      errcode = '42501',
      message = 'E1_NEON_SUPERUSER_BASELINE_MISSING';
  end if;

  if pg_catalog.pg_has_role(
    'hotel_ld_application',
    'neon_superuser',
    'MEMBER'
  ) or pg_catalog.pg_has_role(
    'hotel_ld_application',
    'hotel_ld_migration_owner',
    'MEMBER'
  ) or pg_catalog.pg_has_role(
    'hotel_ld_application',
    'neondb_owner',
    'MEMBER'
  ) or pg_catalog.pg_has_role(
    'hotel_ld_application',
    'authenticated',
    'MEMBER'
  ) then
    raise exception using
      errcode = '42501',
      message = 'E1_RUNTIME_PRIVILEGED_PATH_ASSERTION_FAILED';
  end if;

  select count(*)
    into v_runtime_owned_objects
  from (
    select relation.relowner as owner_oid
    from pg_catalog.pg_class as relation
    union all
    select routine.proowner
    from pg_catalog.pg_proc as routine
    union all
    select namespace.nspowner
    from pg_catalog.pg_namespace as namespace
    union all
    select data_type.typowner
    from pg_catalog.pg_type as data_type
  ) as owned
  join pg_catalog.pg_roles as owner_role
    on owner_role.oid = owned.owner_oid
  where owner_role.rolname in (
    'hotel_ld_application',
    'hotel_ld_people_read',
    'hotel_ld_readonly'
  );

  if v_runtime_owned_objects <> 0 then
    raise exception using
      errcode = '42501',
      message = 'E1_RUNTIME_OWNERSHIP_ASSERTION_FAILED';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles as candidate_role
    where rolname in (
      'hotel_ld_migration_owner',
      'hotel_ld_people_read',
      'hotel_ld_application',
      'hotel_ld_readonly'
    )
      and exists (
        select 1
        from pg_catalog.unnest(
          coalesce(candidate_role.rolconfig, '{}'::text[])
        ) as config(setting)
        where config.setting ~ '^app\\.actor_(auth_user_id|property_id|request_id)='
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'E1_PERSISTENT_ACTOR_ROLE_SETTING_FORBIDDEN';
  end if;

  for v_role in
    select pg_catalog.unnest(array[
      'hotel_ld_migration_owner',
      'hotel_ld_people_read',
      'hotel_ld_application',
      'hotel_ld_readonly'
    ]::name[])
  loop
    for v_relation in
      select relation.oid
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relkind = 'r'
        and relation.relname = any (array[
          'profiles',
          'tenants',
          'properties',
          'property_domains',
          'tenant_memberships',
          'property_memberships',
          'roles',
          'role_assignments',
          'trainer_scopes',
          'user_accounts',
          'departments',
          'department_closure',
          'operational_units',
          'position_families',
          'positions',
          'employees',
          'employee_external_identifiers'
        ])
    loop
      if pg_catalog.has_table_privilege(v_role, v_relation, 'SELECT')
         or pg_catalog.has_table_privilege(v_role, v_relation, 'INSERT')
         or pg_catalog.has_table_privilege(v_role, v_relation, 'UPDATE')
         or pg_catalog.has_table_privilege(v_role, v_relation, 'DELETE')
         or pg_catalog.has_table_privilege(v_role, v_relation, 'TRUNCATE')
         or pg_catalog.has_table_privilege(v_role, v_relation, 'REFERENCES')
         or pg_catalog.has_table_privilege(v_role, v_relation, 'TRIGGER')
         or pg_catalog.has_table_privilege(v_role, v_relation, 'MAINTAIN') then
        raise exception using
          errcode = '42501',
          message = 'E1_RAW_TABLE_PRIVILEGE_ASSERTION_FAILED';
      end if;
    end loop;
  end loop;

  if not pg_catalog.has_schema_privilege(
    'hotel_ld_migration_owner',
    'app_private',
    'USAGE'
  ) or not pg_catalog.has_schema_privilege(
    'hotel_ld_migration_owner',
    'app_private',
    'CREATE'
  ) or not pg_catalog.has_schema_privilege(
    'hotel_ld_migration_owner',
    'public',
    'CREATE'
  ) or pg_catalog.has_schema_privilege(
    'hotel_ld_application',
    'public',
    'CREATE'
  ) or pg_catalog.has_schema_privilege(
    'hotel_ld_application',
    'app_private',
    'USAGE'
  ) or pg_catalog.has_schema_privilege(
    'hotel_ld_people_read',
    'app_private',
    'USAGE'
  ) or pg_catalog.has_schema_privilege(
    'hotel_ld_readonly',
    'app_private',
    'USAGE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'E1_SCHEMA_PRIVILEGE_ASSERTION_FAILED';
  end if;
end
$e1_post_bootstrap$;

commit;
