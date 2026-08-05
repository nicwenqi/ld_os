/*
 * E1 / 202608040001 — transaction-local actor context readers
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
 * Execute after 202608040000_e1_role_bootstrap.sql. The child bootstrap role
 * opens this transaction, then SET LOCAL ROLE creates every new E1 function
 * as the constrained, NOBYPASSRLS migration owner. No business table, policy,
 * or business row is changed by this migration.
 */

begin;

do $e1_actor_preflight$
declare
  v_role_count integer;
begin
  if current_database() <> 'neondb'
     or current_user <> 'neondb_owner'
     or session_user <> 'neondb_owner' then
    raise exception using
      errcode = '42501',
      message = 'E1_ACTOR_BOOTSTRAP_IDENTITY_MISMATCH';
  end if;

  select count(*)
    into v_role_count
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
    and not rolreplication;

  if v_role_count <> 4 then
    raise exception using
      errcode = '42501',
      message = 'E1_ACTOR_ROLE_BASELINE_MISMATCH';
  end if;

  if not pg_catalog.pg_has_role(
    current_user,
    'hotel_ld_migration_owner',
    'SET'
  ) then
    raise exception using
      errcode = '42501',
      message = 'E1_MIGRATION_OWNER_SET_ROLE_REQUIRED';
  end if;

  if pg_catalog.to_regprocedure(
    'app_private.actor_uuid_setting_or_null(text)'
  ) is not null or pg_catalog.to_regprocedure(
    'app_private.current_actor_auth_user_id()'
  ) is not null or pg_catalog.to_regprocedure(
    'app_private.current_actor_property_id()'
  ) is not null or pg_catalog.to_regprocedure(
    'app_private.current_actor_request_id()'
  ) is not null or pg_catalog.to_regprocedure(
    'app_private.assert_actor_context()'
  ) is not null then
    raise exception using
      errcode = '42710',
      message = 'E1_ACTOR_FUNCTION_ALREADY_EXISTS';
  end if;

end
$e1_actor_preflight$;

set local role hotel_ld_migration_owner;

/*
 * Function EXECUTE has a global PUBLIC default. A schema-scoped revoke cannot
 * subtract that global default, so this hardening is deliberately global.
 */
alter default privileges for role hotel_ld_migration_owner
  revoke execute on routines from public;

create function app_private.actor_uuid_setting_or_null(p_name text)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_raw text;
begin
  if p_name is null or p_name not in (
    'app.actor_auth_user_id',
    'app.actor_property_id',
    'app.actor_request_id'
  ) then
    raise exception using
      errcode = '42501',
      message = 'ACTOR_CONTEXT_INVALID';
  end if;

  v_raw := pg_catalog.current_setting(p_name, true);

  if v_raw is null or pg_catalog.btrim(v_raw) = '' then
    return null;
  end if;

  begin
    return v_raw::uuid;
  exception
    when invalid_text_representation then
      raise exception using
        errcode = '42501',
        message = 'ACTOR_CONTEXT_INVALID';
  end;
end
$function$;

create function app_private.current_actor_auth_user_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_value uuid;
begin
  v_value := app_private.actor_uuid_setting_or_null(
    'app.actor_auth_user_id'
  );

  if v_value is null then
    raise exception using
      errcode = '42501',
      message = 'ACTOR_CONTEXT_REQUIRED';
  end if;

  return v_value;
end
$function$;

create function app_private.current_actor_property_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_value uuid;
begin
  v_value := app_private.actor_uuid_setting_or_null(
    'app.actor_property_id'
  );

  if v_value is null then
    raise exception using
      errcode = '42501',
      message = 'ACTOR_CONTEXT_REQUIRED';
  end if;

  return v_value;
end
$function$;

create function app_private.current_actor_request_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_value uuid;
begin
  v_value := app_private.actor_uuid_setting_or_null(
    'app.actor_request_id'
  );

  if v_value is null then
    raise exception using
      errcode = '42501',
      message = 'ACTOR_CONTEXT_REQUIRED';
  end if;

  return v_value;
end
$function$;

create function app_private.assert_actor_context()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  perform app_private.current_actor_auth_user_id();
  perform app_private.current_actor_property_id();
  perform app_private.current_actor_request_id();
end
$function$;

comment on function app_private.actor_uuid_setting_or_null(text) is
  'Fail-closed optional UUID reader for the three approved transaction-local actor GUCs';
comment on function app_private.current_actor_auth_user_id() is
  'Required Supabase-auth user UUID from transaction-local Neon actor context';
comment on function app_private.current_actor_property_id() is
  'Required server-resolved property UUID from transaction-local Neon actor context';
comment on function app_private.current_actor_request_id() is
  'Required audit request UUID from transaction-local Neon actor context';
comment on function app_private.assert_actor_context() is
  'Validate actor UUID presence/format; transaction locality and authorization are enforced by the server wrapper and RLS';

revoke all on function app_private.actor_uuid_setting_or_null(text)
  from public, authenticated, hotel_ld_people_read,
       hotel_ld_application, hotel_ld_readonly;
revoke all on function app_private.current_actor_auth_user_id()
  from public, authenticated, hotel_ld_people_read,
       hotel_ld_application, hotel_ld_readonly;
revoke all on function app_private.current_actor_property_id()
  from public, authenticated, hotel_ld_people_read,
       hotel_ld_application, hotel_ld_readonly;
revoke all on function app_private.current_actor_request_id()
  from public, authenticated, hotel_ld_people_read,
       hotel_ld_application, hotel_ld_readonly;
revoke all on function app_private.assert_actor_context()
  from public, authenticated, hotel_ld_people_read,
       hotel_ld_application, hotel_ld_readonly;

reset role;

do $e1_actor_catalog_assertions$
declare
  v_actor_function_count integer;
  v_rls_count integer;
begin
  select count(*)
    into v_actor_function_count
  from pg_catalog.pg_proc as routine
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = routine.pronamespace
  join pg_catalog.pg_roles as owner_role
    on owner_role.oid = routine.proowner
  where (
    namespace.nspname = 'app_private'
    and routine.proname in (
      'actor_uuid_setting_or_null',
      'current_actor_auth_user_id',
      'current_actor_property_id',
      'current_actor_request_id',
      'assert_actor_context'
    )
  )
    and owner_role.rolname = 'hotel_ld_migration_owner'
    and not routine.prosecdef
    and routine.proconfig = array['search_path=""']::text[];

  if v_actor_function_count <> 5 then
    raise exception using
      errcode = '42501',
      message = 'E1_ACTOR_FUNCTION_CATALOG_ASSERTION_FAILED';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_default_acl as default_acl
    cross join lateral pg_catalog.aclexplode(default_acl.defaclacl) as acl
    join pg_catalog.pg_roles as owner_role
      on owner_role.oid = default_acl.defaclrole
    where owner_role.rolname = 'hotel_ld_migration_owner'
      and default_acl.defaclobjtype = 'f'
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'E1_DEFAULT_ROUTINE_ACL_ASSERTION_FAILED';
  end if;

  if pg_catalog.has_function_privilege(
    'hotel_ld_application',
    'app_private.assert_actor_context()',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'app_private.current_actor_auth_user_id()',
    'EXECUTE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'E1_FUNCTION_ACL_ASSERTION_FAILED';
  end if;

  if pg_catalog.has_schema_privilege(
    'hotel_ld_application',
    'app_private',
    'USAGE'
  ) or pg_catalog.has_schema_privilege(
    'hotel_ld_people_read',
    'app_private',
    'USAGE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'E1_PRIVATE_SCHEMA_ASSERTION_FAILED';
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
      message = 'E1_FORCE_RLS_POST_ASSERTION_FAILED';
  end if;
end
$e1_actor_catalog_assertions$;

set local role hotel_ld_migration_owner;

do $e1_actor_behavior_assertions$
declare
  v_auth_user_id constant uuid :=
    '00000000-0000-4000-8000-000000000001'::uuid;
  v_property_id constant uuid :=
    '00000000-0000-4000-8000-000000000002'::uuid;
  v_request_id constant uuid :=
    '00000000-0000-4000-8000-000000000003'::uuid;
begin
  begin
    perform app_private.assert_actor_context();
    raise exception using
      errcode = '42501',
      message = 'E1_MISSING_CONTEXT_NOT_REJECTED';
  exception
    when sqlstate '42501' then
      if sqlerrm <> 'ACTOR_CONTEXT_REQUIRED' then
        raise;
      end if;
  end;

  perform pg_catalog.set_config(
    'app.actor_auth_user_id',
    v_auth_user_id::text,
    true
  );
  perform pg_catalog.set_config(
    'app.actor_property_id',
    v_property_id::text,
    true
  );
  perform pg_catalog.set_config(
    'app.actor_request_id',
    v_request_id::text,
    true
  );

  perform app_private.assert_actor_context();

  if app_private.current_actor_auth_user_id() <> v_auth_user_id
     or app_private.current_actor_property_id() <> v_property_id
     or app_private.current_actor_request_id() <> v_request_id then
    raise exception using
      errcode = '42501',
      message = 'E1_CONTEXT_VALUE_ASSERTION_FAILED';
  end if;

  perform pg_catalog.set_config(
    'app.actor_request_id',
    'not-a-uuid',
    true
  );

  begin
    perform app_private.current_actor_request_id();
    raise exception using
      errcode = '42501',
      message = 'E1_MALFORMED_CONTEXT_NOT_REJECTED';
  exception
    when sqlstate '42501' then
      if sqlerrm <> 'ACTOR_CONTEXT_INVALID' then
        raise;
      end if;
  end;
end
$e1_actor_behavior_assertions$;

reset role;

commit;

/*
 * Post-commit validation is intentionally a separate read-only catalog and
 * behavior run. It must prove NULL/blank actor settings after both COMMIT and
 * ROLLBACK, plus a disposable rolled-back RLS probe under
 * hotel_ld_application. See docs/neon/2026-08-04-e1-a-migration-review-package.md.
 *
 * Semantic E1 actor rollback must also run, as hotel_ld_migration_owner:
 *
 *   DROP FUNCTION app_private.assert_actor_context();
 *   DROP FUNCTION app_private.current_actor_request_id();
 *   DROP FUNCTION app_private.current_actor_property_id();
 *   DROP FUNCTION app_private.current_actor_auth_user_id();
 *   DROP FUNCTION app_private.actor_uuid_setting_or_null(text);
 *   ALTER DEFAULT PRIVILEGES FOR ROLE hotel_ld_migration_owner
 *     GRANT EXECUTE ON ROUTINES TO PUBLIC;
 *
 * The default-ACL reversal is necessary before dropping the owner role. It is
 * not part of ordinary forward operation.
 */
