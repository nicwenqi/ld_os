/*
 * E1 / 202608040002 — guarded Neon auth.uid() compatibility
 *
 * This is deliberately separate from role and actor-context creation because
 * auth.uid() has five policy and thirty-six column-default reverse
 * dependencies in the inherited child schema. It changes no policy/default
 * definition and performs no business-table read or write.
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
 * Baseline preserved for rollback:
 *   owner       neondb_owner
 *   invoker     true
 *   volatility  stable
 *   proconfig   NULL
 *   proacl      NULL
 *   body        SELECT NULL::uuid;
 */

begin;

do $e1_auth_uid_preflight$
declare
  v_function_definition text;
  v_policy_dependencies text[];
  v_default_dependencies text[];
begin
  if current_database() <> 'neondb'
     or current_user <> 'neondb_owner'
     or session_user <> 'neondb_owner' then
    raise exception using
      errcode = '42501',
      message = 'E1_AUTH_UID_BOOTSTRAP_IDENTITY_MISMATCH';
  end if;

  if not pg_catalog.pg_has_role(
    current_user,
    'hotel_ld_migration_owner',
    'SET'
  ) then
    raise exception using
      errcode = '42501',
      message = 'E1_AUTH_UID_OWNER_SET_ROLE_REQUIRED';
  end if;

  select pg_catalog.pg_get_functiondef(routine.oid)
    into v_function_definition
  from pg_catalog.pg_proc as routine
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = routine.pronamespace
  join pg_catalog.pg_roles as owner_role
    on owner_role.oid = routine.proowner
  where namespace.nspname = 'auth'
    and routine.proname = 'uid'
    and routine.pronargs = 0
    and routine.prorettype = 'uuid'::pg_catalog.regtype
    and routine.provolatile = 's'
    and not routine.prosecdef
    and routine.proconfig is null
    and routine.proacl is null
    and owner_role.rolname = 'neondb_owner';

  if v_function_definition is null
     or pg_catalog.regexp_replace(
       v_function_definition,
       '[[:space:]]+',
       ' ',
       'g'
     ) not like '%SELECT NULL::uuid;%' then
    raise exception using
      errcode = '42501',
      message = 'E1_AUTH_UID_BASELINE_DRIFT';
  end if;

  select pg_catalog.array_agg(dependency_name order by dependency_name)
    into v_policy_dependencies
  from (
    select distinct pg_catalog.format(
      '%s.%s.%s',
      namespace.nspname,
      relation.relname,
      policy.polname
    ) as dependency_name
    from pg_catalog.pg_depend as dependency
    join pg_catalog.pg_policy as policy
      on policy.oid = dependency.objid
    join pg_catalog.pg_class as relation
      on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where dependency.refobjid = 'auth.uid()'::pg_catalog.regprocedure
      and dependency.classid = 'pg_policy'::pg_catalog.regclass
  ) as policy_dependencies;

  if v_policy_dependencies is distinct from array[
    'public.platform_memberships.platform_memberships_select',
    'public.profiles.profiles_update',
    'public.property_memberships.property_memberships_select',
    'public.tenant_memberships.tenant_memberships_select',
    'public.user_accounts.user_accounts_select_own_active'
  ]::text[] then
    raise exception using
      errcode = '42501',
      message = 'E1_AUTH_UID_POLICY_DEPENDENCY_DRIFT';
  end if;

  select pg_catalog.array_agg(dependency_name order by dependency_name)
    into v_default_dependencies
  from (
    select distinct pg_catalog.format(
      '%s.%s.%s',
      namespace.nspname,
      relation.relname,
      attribute.attname
    ) as dependency_name
    from pg_catalog.pg_depend as dependency
    join pg_catalog.pg_attrdef as column_default
      on column_default.oid = dependency.objid
    join pg_catalog.pg_class as relation
      on relation.oid = column_default.adrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = column_default.adrelid
     and attribute.attnum = column_default.adnum
    where dependency.refobjid = 'auth.uid()'::pg_catalog.regprocedure
      and dependency.classid = 'pg_attrdef'::pg_catalog.regclass
  ) as default_dependencies;

  if v_default_dependencies is distinct from array[
    'public.course_versions.created_by',
    'public.course_versions.updated_by',
    'public.courses.created_by',
    'public.courses.updated_by',
    'public.departments.created_by',
    'public.departments.updated_by',
    'public.employees.created_by',
    'public.employees.updated_by',
    'public.import_batches.created_by',
    'public.operational_units.created_by',
    'public.operational_units.updated_by',
    'public.position_families.created_by',
    'public.position_families.updated_by',
    'public.property_brand_assets.uploaded_by',
    'public.trainer_course_approvals.approved_by',
    'public.trainer_profiles.created_by',
    'public.trainer_profiles.updated_by',
    'public.training_operation_audit_events.actor_user_id',
    'public.training_plan_versions.created_by',
    'public.training_plan_versions.updated_by',
    'public.training_plans.created_by',
    'public.training_plans.updated_by',
    'public.training_requirement_versions.created_by',
    'public.training_requirement_versions.updated_by',
    'public.training_requirements.created_by',
    'public.training_requirements.updated_by',
    'public.training_session_cancellation_events.cancelled_by',
    'public.training_session_resource_confirmations.confirmed_by',
    'public.training_session_revisions.created_by',
    'public.training_session_revisions.updated_by',
    'public.training_sessions.created_by',
    'public.training_sessions.updated_by',
    'public.training_venues.created_by',
    'public.training_venues.updated_by',
    'public.user_accounts.created_by',
    'public.user_accounts.updated_by'
  ]::text[] then
    raise exception using
      errcode = '42501',
      message = 'E1_AUTH_UID_DEFAULT_DEPENDENCY_DRIFT';
  end if;
end
$e1_auth_uid_preflight$;

/*
 * ALTER OWNER requires the target owner to have CREATE on the containing
 * schema. CREATE is granted only inside this transaction and revoked again
 * before commit.
 */
grant usage on schema auth
  to authenticated, hotel_ld_migration_owner;
grant create on schema auth
  to hotel_ld_migration_owner;

create or replace function auth.uid()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_raw text;
begin
  /*
   * Preserve fail-closed behavior for legacy BYPASS-owner SECURITY DEFINER
   * helpers. Only the constrained migration owner and the legacy
   * authenticated policy role may resolve a Neon actor UUID.
   */
  if current_user not in (
    'hotel_ld_migration_owner',
    'authenticated'
  ) then
    return null;
  end if;

  v_raw := pg_catalog.current_setting(
    'app.actor_auth_user_id',
    true
  );

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

alter function auth.uid() owner to hotel_ld_migration_owner;

set local role hotel_ld_migration_owner;

revoke all on function auth.uid()
  from public, authenticated, neondb_owner,
       hotel_ld_people_read, hotel_ld_application, hotel_ld_readonly;

/*
 * neondb_owner receives EXECUTE only so inherited legacy definer helpers keep
 * returning NULL instead of raising permission errors. The function's
 * current_user guard prevents that bypass owner from resolving an actor.
 */
grant execute on function auth.uid()
  to authenticated, neondb_owner;

comment on function auth.uid() is
  'Guarded Neon bridge to transaction-local app.actor_auth_user_id; no JWT-claim simulation';

reset role;

revoke create on schema auth from hotel_ld_migration_owner;

do $e1_auth_uid_catalog_assertions$
begin
  if not exists (
    select 1
    from pg_catalog.pg_proc as routine
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = routine.pronamespace
    join pg_catalog.pg_roles as owner_role
      on owner_role.oid = routine.proowner
    where namespace.nspname = 'auth'
      and routine.proname = 'uid'
      and routine.pronargs = 0
      and routine.prorettype = 'uuid'::pg_catalog.regtype
      and routine.provolatile = 's'
      and not routine.prosecdef
      and owner_role.rolname = 'hotel_ld_migration_owner'
      and routine.proconfig = array['search_path=""']::text[]
  ) then
    raise exception using
      errcode = '42501',
      message = 'E1_AUTH_UID_CATALOG_ASSERTION_FAILED';
  end if;

  if pg_catalog.has_function_privilege(
    'hotel_ld_application',
    'auth.uid()',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'hotel_ld_people_read',
    'auth.uid()',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'hotel_ld_readonly',
    'auth.uid()',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'authenticated',
    'auth.uid()',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'neondb_owner',
    'auth.uid()',
    'EXECUTE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'E1_AUTH_UID_ACL_ASSERTION_FAILED';
  end if;

  if pg_catalog.pg_has_role(
    'hotel_ld_application',
    'authenticated',
    'MEMBER'
  ) then
    raise exception using
      errcode = '42501',
      message = 'E1_APPLICATION_AUTHENTICATED_MEMBERSHIP_FORBIDDEN';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'authenticated'
      and not rolcanlogin
      and not rolsuper
      and not rolbypassrls
  ) or exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role
      on granted_role.oid = membership.roleid
    where granted_role.rolname = 'authenticated'
      and membership.set_option
  ) then
    raise exception using
      errcode = '42501',
      message = 'E1_AUTHENTICATED_ROLE_NOT_FAIL_CLOSED';
  end if;
end
$e1_auth_uid_catalog_assertions$;

/* The owner path resolves the local actor; the legacy bypass owner stays NULL. */
set local role hotel_ld_migration_owner;

do $e1_auth_uid_owner_behavior$
declare
  v_actor_id constant uuid :=
    '00000000-0000-4000-8000-000000000011'::uuid;
begin
  if auth.uid() is not null then
    raise exception using
      errcode = '42501',
      message = 'E1_AUTH_UID_MISSING_CONTEXT_NOT_NULL';
  end if;

  perform pg_catalog.set_config(
    'app.actor_auth_user_id',
    v_actor_id::text,
    true
  );

  if auth.uid() <> v_actor_id then
    raise exception using
      errcode = '42501',
      message = 'E1_AUTH_UID_OWNER_CONTEXT_MISMATCH';
  end if;
end
$e1_auth_uid_owner_behavior$;

reset role;

do $e1_auth_uid_legacy_behavior$
begin
  if auth.uid() is not null then
    raise exception using
      errcode = '42501',
      message = 'E1_AUTH_UID_LEGACY_OWNER_NOT_FAIL_CLOSED';
  end if;
end
$e1_auth_uid_legacy_behavior$;

commit;

/*
 * Semantic rollback is a child-bootstrap procedure. First grant temporary
 * auth-schema CREATE to hotel_ld_migration_owner, SET LOCAL ROLE to that owner
 * for the CREATE OR REPLACE/ACL statements below, RESET ROLE, then revoke the
 * temporary schema CREATE before COMMIT:
 *
 *   GRANT CREATE ON SCHEMA auth TO hotel_ld_migration_owner;
 *   SET LOCAL ROLE hotel_ld_migration_owner;
 *   CREATE OR REPLACE FUNCTION auth.uid()
 *   RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER
 *   AS $rollback$ SELECT NULL::uuid; $rollback$;
 *   ALTER FUNCTION auth.uid() RESET ALL;
 *   COMMENT ON FUNCTION auth.uid() IS NULL;
 *   REVOKE ALL ON FUNCTION auth.uid() FROM authenticated, neondb_owner;
 *   GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
 *   RESET ROLE;
 *   REVOKE CREATE ON SCHEMA auth FROM hotel_ld_migration_owner;
 *
 * Never DROP auth.uid(): five policies and thirty-six defaults depend on its
 * OID. This is a semantic rollback; catalog-exact proacl=NULL and ownership
 * restoration are separate bootstrap operations after dependency and
 * role-membership checks.
 */
