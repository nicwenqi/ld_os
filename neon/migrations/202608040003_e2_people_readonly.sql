/*
 * E2 / 202608040003 — People read-only authorization and repository boundary
 *
 * Approved child-only target (prove again in Neon control plane before run):
 *   project        flat-brook-43278549
 *   child branch   br-aged-river-az1gke14
 *   child endpoint ep-sparkling-shape-az9gxtuh
 *
 * Production deny-list (never connect or execute there):
 *   branch         br-twilight-leaf-azmowo1k
 *   endpoint       ep-wild-wave-azjmgdif
 *
 * Apply as child neondb_owner after the three reviewed E1 migrations. Runtime
 * application access remains function-only; no employee write path is added.
 */

begin;

do $e2_preflight$
declare
  v_rls_tables integer;
  v_owned_tables integer;
  v_e1_functions integer;
  v_runtime_memberships integer;
  v_runtime_owned_objects integer;
begin
  if current_database() <> 'neondb'
     or current_user <> 'neondb_owner'
     or session_user <> 'neondb_owner' then
    raise exception using
      errcode = '42501',
      message = 'E2_BOOTSTRAP_IDENTITY_MISMATCH';
  end if;

  if not pg_catalog.pg_has_role(
    current_user,
    'hotel_ld_migration_owner',
    'SET'
  ) then
    raise exception using
      errcode = '42501',
      message = 'E2_MIGRATION_OWNER_SET_ROLE_REQUIRED';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'hotel_ld_application'
      and rolcanlogin
      and not rolsuper
      and not rolbypassrls
      and not rolcreatedb
      and not rolcreaterole
      and not rolreplication
      and not rolinherit
  ) or not exists (
    select 1
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles granted_role
      on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles member_role
      on member_role.oid = membership.member
    where granted_role.rolname = 'hotel_ld_people_read'
      and member_role.rolname = 'hotel_ld_application'
      and membership.inherit_option
      and not membership.set_option
      and not membership.admin_option
  ) then
    raise exception using
      errcode = '42501',
      message = 'E2_RUNTIME_ROLE_BASELINE_MISMATCH';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles migration_role
    where migration_role.rolname = 'hotel_ld_migration_owner'
      and migration_role.rolcanlogin
      and not migration_role.rolsuper
      and not migration_role.rolbypassrls
      and not migration_role.rolcreatedb
      and not migration_role.rolcreaterole
      and not migration_role.rolreplication
      and not migration_role.rolinherit
  ) then
    raise exception using
      errcode = '42501',
      message = 'E2_DEFINER_ROLE_BASELINE_MISMATCH';
  end if;

  select count(*)
    into v_runtime_memberships
  from pg_catalog.pg_auth_members membership
  join pg_catalog.pg_roles member_role
    on member_role.oid = membership.member
  where member_role.rolname = 'hotel_ld_application';

  if v_runtime_memberships <> 1
     or pg_catalog.pg_has_role(
       'hotel_ld_application', 'neon_superuser', 'MEMBER'
     )
     or pg_catalog.pg_has_role(
       'hotel_ld_application', 'neondb_owner', 'MEMBER'
     )
     or pg_catalog.pg_has_role(
       'hotel_ld_application', 'hotel_ld_migration_owner', 'MEMBER'
     )
     or pg_catalog.pg_has_role(
       'hotel_ld_application', 'authenticated', 'MEMBER'
     ) then
    raise exception using
      errcode = '42501',
      message = 'E2_RUNTIME_MEMBERSHIP_BASELINE_MISMATCH';
  end if;

  select count(*)
    into v_runtime_owned_objects
  from (
    select relation.relowner as owner_oid
    from pg_catalog.pg_class relation
    union all
    select routine.proowner
    from pg_catalog.pg_proc routine
    union all
    select namespace.nspowner
    from pg_catalog.pg_namespace namespace
    union all
    select data_type.typowner
    from pg_catalog.pg_type data_type
    union all
    select database_record.datdba
    from pg_catalog.pg_database database_record
  ) owned
  join pg_catalog.pg_roles owner_role
    on owner_role.oid = owned.owner_oid
  where owner_role.rolname in (
    'hotel_ld_application',
    'hotel_ld_people_read',
    'hotel_ld_readonly'
  );

  if v_runtime_owned_objects <> 0 then
    raise exception using
      errcode = '42501',
      message = 'E2_RUNTIME_OWNERSHIP_BASELINE_MISMATCH';
  end if;

  select count(*)
    into v_e1_functions
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace namespace
    on namespace.oid = routine.pronamespace
  join pg_catalog.pg_roles owner_role
    on owner_role.oid = routine.proowner
  where routine.oid = any (array[
      pg_catalog.to_regprocedure(
        'app_private.current_actor_auth_user_id()'
      ),
      pg_catalog.to_regprocedure(
        'app_private.current_actor_property_id()'
      ),
      pg_catalog.to_regprocedure(
        'app_private.current_actor_request_id()'
      ),
      pg_catalog.to_regprocedure('app_private.assert_actor_context()')
    ]::oid[])
    and namespace.nspname = 'app_private'
    and owner_role.rolname = 'hotel_ld_migration_owner'
    and not routine.prosecdef
    and routine.provolatile = 's'
    and routine.proconfig = array['search_path=""']::text[];

  if v_e1_functions <> 4 then
    raise exception using
      errcode = '42501',
      message = 'E2_ACTOR_FOUNDATION_MISSING';
  end if;

  select count(*)
    into v_rls_tables
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
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

  if v_rls_tables <> 17 then
    raise exception using
      errcode = '42501',
      message = 'E2_FORCE_RLS_BASELINE_DRIFT';
  end if;

  select count(*)
    into v_owned_tables
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_roles owner_role
    on owner_role.oid = relation.relowner
  where namespace.nspname = 'public'
    and relation.relname = any (array[
      'profiles', 'tenants', 'properties', 'property_domains',
      'tenant_memberships', 'property_memberships', 'roles',
      'role_assignments', 'trainer_scopes', 'user_accounts',
      'departments', 'department_closure', 'operational_units',
      'position_families', 'positions', 'employees',
      'employee_external_identifiers'
    ])
    and owner_role.rolname = 'neondb_owner';

  if v_owned_tables <> 17 then
    raise exception using
      errcode = '42501',
      message = 'E2_TABLE_OWNER_BASELINE_DRIFT';
  end if;

  if pg_catalog.to_regclass(
    'app_private.people_read_audit_events'
  ) is not null or pg_catalog.to_regprocedure(
    'app_private.neon_people_hostname_matches(text)'
  ) is not null or pg_catalog.to_regprocedure(
    'public.resolve_neon_people_property(text)'
  ) is not null or pg_catalog.to_regprocedure(
    'public.read_neon_people_manager_directory(text,text,uuid,uuid,uuid,text,boolean,integer,integer)'
  ) is not null or pg_catalog.to_regprocedure(
    'public.read_neon_people_manager_employee(text,uuid)'
  ) is not null or pg_catalog.to_regprocedure(
    'public.read_neon_people_manager_facets(text)'
  ) is not null or pg_catalog.to_regprocedure(
    'public.read_neon_people_department_directory(text,text,integer,integer)'
  ) is not null then
    raise exception using
      errcode = '42710',
      message = 'E2_OBJECT_ALREADY_EXISTS';
  end if;
end
$e2_preflight$;

set local role hotel_ld_migration_owner;

create table app_private.people_read_audit_events (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  auth_user_id uuid not null,
  property_id uuid not null,
  operation text not null,
  result_row_count integer not null,
  occurred_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint people_read_audit_operation_check check (
    operation in (
      'manager_directory',
      'manager_employee',
      'manager_facets',
      'department_directory'
    )
  ),
  constraint people_read_audit_count_check check (result_row_count >= 0)
);

create index people_read_audit_request_idx
  on app_private.people_read_audit_events(request_id, occurred_at);

create function app_private.reject_people_read_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '42501',
    message = 'PEOPLE_READ_AUDIT_APPEND_ONLY';
end
$function$;

create trigger people_read_audit_append_only
before update or delete on app_private.people_read_audit_events
for each row execute function app_private.reject_people_read_audit_mutation();

create function app_private.assert_neon_people_runtime_session()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if session_user <> 'hotel_ld_application'
     or current_user <> 'hotel_ld_migration_owner'
     or not exists (
       select 1
       from pg_catalog.pg_roles runtime_role
       where runtime_role.rolname = session_user
         and runtime_role.rolcanlogin
         and not runtime_role.rolsuper
         and not runtime_role.rolbypassrls
         and not runtime_role.rolcreatedb
         and not runtime_role.rolcreaterole
         and not runtime_role.rolreplication
     )
     or not pg_catalog.pg_has_role(
       session_user,
       'hotel_ld_people_read',
       'MEMBER'
     ) then
    raise exception using
      errcode = '42501',
      message = 'NEON_PEOPLE_RUNTIME_FORBIDDEN';
  end if;
end
$function$;

create function app_private.neon_people_actor_is_active()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select exists (
    select 1
    from public.user_accounts account
    join public.profiles profile
      on profile.id = account.user_id
     and profile.is_active
    join public.tenants tenant
      on tenant.id = account.tenant_id
     and tenant.status::text = 'active'
    join public.properties property
      on property.id = account.property_id
     and property.tenant_id = account.tenant_id
     and property.status::text = 'active'
    join public.tenant_memberships tenant_membership
      on tenant_membership.tenant_id = account.tenant_id
     and tenant_membership.user_id = account.user_id
     and tenant_membership.status::text = 'active'
    join public.property_memberships property_membership
      on property_membership.tenant_id = account.tenant_id
     and property_membership.property_id = account.property_id
     and property_membership.user_id = account.user_id
     and property_membership.status::text = 'active'
    where account.auth_user_id = app_private.current_actor_auth_user_id()
      and account.property_id = app_private.current_actor_property_id()
      and account.account_status::text = 'active'
      and not account.must_change_password
      and (
        account.locked_until is null
        or account.locked_until <= pg_catalog.now()
      )
  );
$function$;

create function app_private.neon_people_actor_has_role(p_role_code text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select app_private.neon_people_actor_is_active()
    and p_role_code in (
      'property_ld_manager',
      'department_training_admin'
    )
    and exists (
      select 1
      from public.user_accounts account
      join public.role_assignments assignment
        on assignment.user_id = account.user_id
       and assignment.tenant_id = account.tenant_id
       and assignment.property_id = account.property_id
       and assignment.status::text = 'active'
      join public.roles role
        on role.id = assignment.role_id
       and role.code = p_role_code
       and role.is_active
      where account.auth_user_id = app_private.current_actor_auth_user_id()
        and account.property_id = app_private.current_actor_property_id()
        and account.account_status::text = 'active'
        and role.scope_level::text = case p_role_code
          when 'property_ld_manager' then 'property'
          else 'department'
        end
    );
$function$;

create function app_private.neon_people_actor_has_department_scope(
  p_department_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select p_department_id is not null
    and app_private.neon_people_actor_has_role(
      'department_training_admin'
    )
    and exists (
      select 1
      from public.user_accounts account
      join public.role_assignments assignment
        on assignment.user_id = account.user_id
       and assignment.tenant_id = account.tenant_id
       and assignment.property_id = account.property_id
       and assignment.status::text = 'active'
      join public.roles role
        on role.id = assignment.role_id
       and role.code = 'department_training_admin'
       and role.scope_level::text = 'department'
       and role.is_active
      join public.trainer_scopes scope
        on scope.role_assignment_id = assignment.id
       and scope.tenant_id = assignment.tenant_id
       and scope.property_id = assignment.property_id
       and scope.is_active
      join public.departments scope_department
        on scope_department.id = scope.department_id
       and scope_department.tenant_id = scope.tenant_id
       and scope_department.property_id = scope.property_id
       and scope_department.is_active
      join public.departments target_department
        on target_department.id = p_department_id
       and target_department.tenant_id = scope.tenant_id
       and target_department.property_id = scope.property_id
       and target_department.is_active
      where account.auth_user_id = app_private.current_actor_auth_user_id()
        and account.property_id = app_private.current_actor_property_id()
        and (
          scope.department_id = p_department_id
          or (
            scope.include_descendants
            and exists (
              select 1
              from public.department_closure closure
              where closure.tenant_id = scope.tenant_id
                and closure.property_id = scope.property_id
                and closure.ancestor_department_id = scope.department_id
                and closure.descendant_department_id = p_department_id
            )
          )
        )
    );
$function$;

create function app_private.neon_people_can_read_employee(
  p_property_id uuid,
  p_department_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select p_property_id = app_private.current_actor_property_id()
    and app_private.neon_people_actor_is_active()
    and (
      app_private.neon_people_actor_has_role('property_ld_manager')
      or app_private.neon_people_actor_has_department_scope(p_department_id)
    );
$function$;

create function app_private.neon_people_hostname_matches(
  p_hostname text
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.btrim(coalesce(p_hostname, '')) <> ''
    and exists (
      select 1
      from public.property_domains domain
      join public.properties property
        on property.id = domain.property_id
       and property.tenant_id = domain.tenant_id
       and property.status::text = 'active'
      join public.tenants tenant
        on tenant.id = domain.tenant_id
       and tenant.status::text = 'active'
      where domain.hostname = pg_catalog.lower(
        pg_catalog.split_part(pg_catalog.btrim(p_hostname), ':', 1)
      )
        and domain.property_id = app_private.current_actor_property_id()
        and domain.is_active
        and domain.verification_status::text = 'verified'
    );
$function$;

create function app_private.assert_neon_people_hostname(
  p_hostname text
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_hostname text := pg_catalog.lower(
    pg_catalog.split_part(pg_catalog.btrim(coalesce(p_hostname, '')), ':', 1)
  );
begin
  perform app_private.assert_actor_context();

  if v_hostname = ''
     or not app_private.neon_people_hostname_matches(v_hostname) then
    raise exception using
      errcode = '42501',
      message = 'NEON_PEOPLE_PROPERTY_CONTEXT_CHANGED';
  end if;
end
$function$;

create function app_private.assert_neon_people_manager()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  perform app_private.assert_actor_context();
  if not app_private.neon_people_actor_has_role('property_ld_manager') then
    raise exception using
      errcode = '42501',
      message = 'NEON_PEOPLE_MANAGER_FORBIDDEN';
  end if;
end
$function$;

create function app_private.assert_neon_people_department()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  perform app_private.assert_actor_context();
  if not app_private.neon_people_actor_has_role(
    'department_training_admin'
  ) or not exists (
    select 1
    from public.user_accounts account
    join public.role_assignments assignment
      on assignment.user_id = account.user_id
     and assignment.tenant_id = account.tenant_id
     and assignment.property_id = account.property_id
     and assignment.status::text = 'active'
    join public.roles role
      on role.id = assignment.role_id
     and role.code = 'department_training_admin'
     and role.scope_level::text = 'department'
     and role.is_active
    join public.trainer_scopes scope
      on scope.role_assignment_id = assignment.id
     and scope.tenant_id = assignment.tenant_id
     and scope.property_id = assignment.property_id
     and scope.is_active
    join public.departments department
      on department.id = scope.department_id
     and department.tenant_id = scope.tenant_id
     and department.property_id = scope.property_id
     and department.is_active
    where account.auth_user_id = app_private.current_actor_auth_user_id()
      and account.property_id = app_private.current_actor_property_id()
  ) then
    raise exception using
      errcode = '42501',
      message = 'NEON_PEOPLE_DEPARTMENT_FORBIDDEN';
  end if;
end
$function$;

create function app_private.append_neon_people_read_audit(
  p_operation text,
  p_result_row_count integer
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  perform app_private.assert_actor_context();
  insert into app_private.people_read_audit_events (
    request_id,
    auth_user_id,
    property_id,
    operation,
    result_row_count
  ) values (
    app_private.current_actor_request_id(),
    app_private.current_actor_auth_user_id(),
    app_private.current_actor_property_id(),
    p_operation,
    greatest(coalesce(p_result_row_count, 0), 0)
  );
end
$function$;

create function public.resolve_neon_people_property(p_hostname text)
returns table (tenant_id uuid, property_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_hostname text := pg_catalog.lower(
    pg_catalog.split_part(pg_catalog.btrim(coalesce(p_hostname, '')), ':', 1)
  );
begin
  perform app_private.assert_neon_people_runtime_session();
  if v_hostname = '' then
    return;
  end if;

  return query
  select domain.tenant_id, domain.property_id
  from public.property_domains domain
  join public.properties property
    on property.id = domain.property_id
   and property.tenant_id = domain.tenant_id
   and property.status::text = 'active'
  join public.tenants tenant
    on tenant.id = domain.tenant_id
   and tenant.status::text = 'active'
  where domain.hostname = v_hostname
    and domain.is_active
    and domain.verification_status::text = 'verified'
  limit 1;
end
$function$;

create function public.read_neon_people_manager_directory(
  p_hostname text,
  p_query text,
  p_department_id uuid,
  p_position_id uuid,
  p_position_family_id uuid,
  p_employment_status text,
  p_active boolean,
  p_limit integer,
  p_offset integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_offset integer := least(
    greatest(coalesce(p_offset, 0), 0),
    1000000
  );
  v_search text;
  v_payload jsonb;
begin
  perform app_private.assert_neon_people_runtime_session();
  perform app_private.assert_neon_people_hostname(p_hostname);
  perform app_private.assert_neon_people_manager();

  if p_query is not null and char_length(pg_catalog.btrim(p_query)) > 160 then
    raise exception using errcode = '22023', message = 'PEOPLE_QUERY_INVALID';
  end if;
  if p_employment_status is not null and p_employment_status not in (
    'active', 'inactive', 'leave', 'terminated', 'unknown'
  ) then
    raise exception using errcode = '22023', message = 'PEOPLE_STATUS_INVALID';
  end if;

  v_search := pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(pg_catalog.btrim(coalesce(p_query, '')), '\', '\\'),
      '%', '\%'
    ),
    '_', '\_'
  );

  with filtered as materialized (
    select
      employee.id,
      employee.tenant_id,
      employee.property_id,
      employee.employee_number,
      employee.name_zh,
      employee.name_en,
      employee.department_id,
      department.name_zh as department_name,
      employee.operational_unit_id,
      unit.name_zh as operational_unit_name,
      employee.position_id,
      position.name_zh as position_name,
      employee.position_family_id,
      family.name_zh as position_family_name,
      employee.grade_or_band,
      employee.hire_date,
      employee.probation_or_confirmation_date,
      employee.employment_status::text as employment_status,
      employee.is_new_employee,
      employee.is_active,
      employee.version,
      coalesce((
        select pg_catalog.jsonb_agg(
          identifier.identifier_type::text
          order by identifier.identifier_type::text
        )
        from public.employee_external_identifiers identifier
        where identifier.employee_id = employee.id
          and identifier.tenant_id = employee.tenant_id
          and identifier.property_id = employee.property_id
          and identifier.is_active
      ), '[]'::jsonb) as external_identifier_types
    from public.employees employee
    left join public.departments department
      on department.id = employee.department_id
     and department.tenant_id = employee.tenant_id
     and department.property_id = employee.property_id
    left join public.operational_units unit
      on unit.id = employee.operational_unit_id
     and unit.tenant_id = employee.tenant_id
     and unit.property_id = employee.property_id
    left join public.positions position
      on position.id = employee.position_id
     and position.tenant_id = employee.tenant_id
     and position.property_id = employee.property_id
    left join public.position_families family
      on family.id = employee.position_family_id
     and family.tenant_id = employee.tenant_id
     and family.property_id = employee.property_id
    where employee.property_id = app_private.current_actor_property_id()
      and (p_department_id is null or employee.department_id = p_department_id)
      and (p_position_id is null or employee.position_id = p_position_id)
      and (
        p_position_family_id is null
        or employee.position_family_id = p_position_family_id
      )
      and (
        p_employment_status is null
        or employee.employment_status::text = p_employment_status
      )
      and (p_active is null or employee.is_active = p_active)
      and (
        v_search = ''
        or employee.employee_number ilike '%' || v_search || '%' escape '\'
        or coalesce(employee.name_zh, '') ilike '%' || v_search || '%' escape '\'
        or coalesce(employee.name_en, '') ilike '%' || v_search || '%' escape '\'
      )
  ),
  page as (
    select *
    from filtered
    order by employee_number
    limit v_limit
    offset v_offset
  )
  select pg_catalog.jsonb_build_object(
    'rows', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', row.id,
          'tenant_id', row.tenant_id,
          'property_id', row.property_id,
          'employee_number', row.employee_number,
          'name_zh', row.name_zh,
          'name_en', row.name_en,
          'department_id', row.department_id,
          'department_name', row.department_name,
          'operational_unit_id', row.operational_unit_id,
          'operational_unit_name', row.operational_unit_name,
          'position_id', row.position_id,
          'position_name', row.position_name,
          'position_family_id', row.position_family_id,
          'position_family_name', row.position_family_name,
          'grade_or_band', row.grade_or_band,
          'hire_date', row.hire_date,
          'probation_or_confirmation_date', row.probation_or_confirmation_date,
          'employment_status', row.employment_status,
          'is_new_employee', row.is_new_employee,
          'is_active', row.is_active,
          'external_identifier_types', row.external_identifier_types,
          'version', row.version
        ) order by row.employee_number
      ) from page row
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'refreshed_at', pg_catalog.transaction_timestamp()
  ) into v_payload
  where app_private.neon_people_hostname_matches(p_hostname)
    and app_private.neon_people_actor_has_role('property_ld_manager');

  if v_payload is null then
    raise exception using
      errcode = '42501',
      message = 'NEON_PEOPLE_MANAGER_FORBIDDEN';
  end if;

  perform app_private.append_neon_people_read_audit(
    'manager_directory',
    pg_catalog.jsonb_array_length(v_payload -> 'rows')
  );
  return v_payload;
end
$function$;

create function public.read_neon_people_manager_employee(
  p_hostname text,
  p_employee_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_payload jsonb;
begin
  perform app_private.assert_neon_people_runtime_session();
  perform app_private.assert_neon_people_hostname(p_hostname);
  perform app_private.assert_neon_people_manager();

  select pg_catalog.jsonb_build_object(
    'id', employee.id,
    'tenant_id', employee.tenant_id,
    'property_id', employee.property_id,
    'employee_number', employee.employee_number,
    'name_zh', employee.name_zh,
    'name_en', employee.name_en,
    'department_id', employee.department_id,
    'department_name', department.name_zh,
    'operational_unit_id', employee.operational_unit_id,
    'operational_unit_name', unit.name_zh,
    'position_id', employee.position_id,
    'position_name', position.name_zh,
    'position_family_id', employee.position_family_id,
    'position_family_name', family.name_zh,
    'grade_or_band', employee.grade_or_band,
    'hire_date', employee.hire_date,
    'probation_or_confirmation_date', employee.probation_or_confirmation_date,
    'employment_status', employee.employment_status::text,
    'is_new_employee', employee.is_new_employee,
    'is_active', employee.is_active,
    'external_identifier_types', coalesce((
      select pg_catalog.jsonb_agg(
        identifier.identifier_type::text
        order by identifier.identifier_type::text
      )
      from public.employee_external_identifiers identifier
      where identifier.employee_id = employee.id
        and identifier.tenant_id = employee.tenant_id
        and identifier.property_id = employee.property_id
        and identifier.is_active
    ), '[]'::jsonb),
    'version', employee.version
  ) into v_payload
  from public.employees employee
  left join public.departments department
    on department.id = employee.department_id
   and department.tenant_id = employee.tenant_id
   and department.property_id = employee.property_id
  left join public.operational_units unit
    on unit.id = employee.operational_unit_id
   and unit.tenant_id = employee.tenant_id
   and unit.property_id = employee.property_id
  left join public.positions position
    on position.id = employee.position_id
   and position.tenant_id = employee.tenant_id
   and position.property_id = employee.property_id
  left join public.position_families family
    on family.id = employee.position_family_id
   and family.tenant_id = employee.tenant_id
   and family.property_id = employee.property_id
  where employee.id = p_employee_id
    and employee.property_id = app_private.current_actor_property_id()
    and app_private.neon_people_hostname_matches(p_hostname)
    and app_private.neon_people_actor_has_role('property_ld_manager');

  perform app_private.append_neon_people_read_audit(
    'manager_employee',
    case when v_payload is null then 0 else 1 end
  );
  return v_payload;
end
$function$;

create function public.read_neon_people_manager_facets(p_hostname text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_payload jsonb;
  v_count integer;
begin
  perform app_private.assert_neon_people_runtime_session();
  perform app_private.assert_neon_people_hostname(p_hostname);
  perform app_private.assert_neon_people_manager();

  select pg_catalog.jsonb_build_object(
    'departments', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', department.id,
          'label', department.name_zh
        ) order by department.sort_order, department.name_zh
      )
      from public.departments department
      where department.property_id = app_private.current_actor_property_id()
        and department.is_active
    ), '[]'::jsonb),
    'positions', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', position.id,
          'label', position.name_zh
        ) order by position.name_zh
      )
      from public.positions position
      where position.property_id = app_private.current_actor_property_id()
        and position.is_active
    ), '[]'::jsonb),
    'position_families', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', family.id,
          'label', family.name_zh
        ) order by family.sort_order, family.name_zh
      )
      from public.position_families family
      where family.property_id = app_private.current_actor_property_id()
        and family.is_active
    ), '[]'::jsonb)
  ) into v_payload
  where app_private.neon_people_hostname_matches(p_hostname)
    and app_private.neon_people_actor_has_role('property_ld_manager');

  if v_payload is null then
    raise exception using
      errcode = '42501',
      message = 'NEON_PEOPLE_MANAGER_FORBIDDEN';
  end if;

  v_count := pg_catalog.jsonb_array_length(v_payload -> 'departments')
    + pg_catalog.jsonb_array_length(v_payload -> 'positions')
    + pg_catalog.jsonb_array_length(v_payload -> 'position_families');
  perform app_private.append_neon_people_read_audit('manager_facets', v_count);
  return v_payload;
end
$function$;

create function public.read_neon_people_department_directory(
  p_hostname text,
  p_query text,
  p_limit integer,
  p_offset integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_offset integer := least(
    greatest(coalesce(p_offset, 0), 0),
    1000000
  );
  v_search text;
  v_payload jsonb;
begin
  perform app_private.assert_neon_people_runtime_session();
  perform app_private.assert_neon_people_hostname(p_hostname);
  perform app_private.assert_neon_people_department();

  if p_query is not null and char_length(pg_catalog.btrim(p_query)) > 160 then
    raise exception using errcode = '22023', message = 'PEOPLE_QUERY_INVALID';
  end if;
  v_search := pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(pg_catalog.btrim(coalesce(p_query, '')), '\', '\\'),
      '%', '\%'
    ),
    '_', '\_'
  );

  with filtered as materialized (
    select
      employee.employee_number,
      employee.name_zh,
      employee.name_en,
      employee.department_id,
      department.name_zh as department_name,
      employee.operational_unit_id,
      unit.name_zh as operational_unit_name,
      employee.position_id,
      position.name_zh as position_name,
      employee.position_family_id,
      family.name_zh as position_family_name,
      employee.hire_date,
      employee.probation_or_confirmation_date,
      employee.employment_status::text as employment_status,
      employee.is_new_employee,
      employee.is_active
    from public.employees employee
    join public.departments department
      on department.id = employee.department_id
     and department.tenant_id = employee.tenant_id
     and department.property_id = employee.property_id
    left join public.operational_units unit
      on unit.id = employee.operational_unit_id
     and unit.tenant_id = employee.tenant_id
     and unit.property_id = employee.property_id
    left join public.positions position
      on position.id = employee.position_id
     and position.tenant_id = employee.tenant_id
     and position.property_id = employee.property_id
    left join public.position_families family
      on family.id = employee.position_family_id
     and family.tenant_id = employee.tenant_id
     and family.property_id = employee.property_id
    where employee.property_id = app_private.current_actor_property_id()
      and employee.department_id is not null
      and (
        v_search = ''
        or employee.employee_number ilike '%' || v_search || '%' escape '\'
        or coalesce(employee.name_zh, '') ilike '%' || v_search || '%' escape '\'
        or coalesce(employee.name_en, '') ilike '%' || v_search || '%' escape '\'
      )
  ),
  page as (
    select * from filtered
    order by employee_number
    limit v_limit
    offset v_offset
  ),
  live_scopes as materialized (
    select distinct
      scope.department_id,
      department.name_zh as department_name_zh,
      department.name_en as department_name_en,
      scope.include_descendants,
      scope.tenant_id,
      scope.property_id
    from public.user_accounts account
    join public.role_assignments assignment
      on assignment.user_id = account.user_id
     and assignment.tenant_id = account.tenant_id
     and assignment.property_id = account.property_id
     and assignment.status::text = 'active'
    join public.roles role
      on role.id = assignment.role_id
     and role.code = 'department_training_admin'
     and role.scope_level::text = 'department'
     and role.is_active
    join public.trainer_scopes scope
      on scope.role_assignment_id = assignment.id
     and scope.tenant_id = assignment.tenant_id
     and scope.property_id = assignment.property_id
     and scope.is_active
    join public.departments department
      on department.id = scope.department_id
     and department.tenant_id = scope.tenant_id
     and department.property_id = scope.property_id
     and department.is_active
    where account.auth_user_id = app_private.current_actor_auth_user_id()
      and account.property_id = app_private.current_actor_property_id()
  )
  select pg_catalog.jsonb_build_object(
    'rows', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'employee_number', row.employee_number,
          'name_zh', row.name_zh,
          'name_en', row.name_en,
          'department_id', row.department_id,
          'department_name', row.department_name,
          'operational_unit_id', row.operational_unit_id,
          'operational_unit_name', row.operational_unit_name,
          'position_id', row.position_id,
          'position_name', row.position_name,
          'position_family_id', row.position_family_id,
          'position_family_name', row.position_family_name,
          'hire_date', row.hire_date,
          'probation_or_confirmation_date', row.probation_or_confirmation_date,
          'employment_status', row.employment_status,
          'is_new_employee', row.is_new_employee,
          'is_active', row.is_active
        ) order by row.employee_number
      ) from page row
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'scopes', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'department_id', scope.department_id,
          'department_name_zh', scope.department_name_zh,
          'department_name_en', scope.department_name_en,
          'breadcrumb', coalesce((
            select pg_catalog.jsonb_agg(
              ancestor.name_zh order by closure.distance desc
            )
            from public.department_closure closure
            join public.departments ancestor
              on ancestor.id = closure.ancestor_department_id
             and ancestor.tenant_id = closure.tenant_id
             and ancestor.property_id = closure.property_id
            where closure.tenant_id = scope.tenant_id
              and closure.property_id = scope.property_id
              and closure.descendant_department_id = scope.department_id
          ), pg_catalog.jsonb_build_array(scope.department_name_zh)),
          'breadcrumb_en', coalesce((
            select pg_catalog.jsonb_agg(
              coalesce(ancestor.name_en, ancestor.name_zh)
              order by closure.distance desc
            )
            from public.department_closure closure
            join public.departments ancestor
              on ancestor.id = closure.ancestor_department_id
             and ancestor.tenant_id = closure.tenant_id
             and ancestor.property_id = closure.property_id
            where closure.tenant_id = scope.tenant_id
              and closure.property_id = scope.property_id
              and closure.descendant_department_id = scope.department_id
          ), pg_catalog.jsonb_build_array(
            coalesce(scope.department_name_en, scope.department_name_zh)
          )),
          'include_descendants', scope.include_descendants
        ) order by scope.department_name_zh
      ) from live_scopes scope
    ), '[]'::jsonb),
    'refreshed_at', pg_catalog.transaction_timestamp()
  ) into v_payload
  where app_private.neon_people_hostname_matches(p_hostname)
    and app_private.neon_people_actor_is_active()
    and app_private.neon_people_actor_has_role(
      'department_training_admin'
    )
    and exists (select 1 from live_scopes);

  if v_payload is null then
    raise exception using
      errcode = '42501',
      message = 'NEON_PEOPLE_DEPARTMENT_FORBIDDEN';
  end if;

  perform app_private.append_neon_people_read_audit(
    'department_directory',
    pg_catalog.jsonb_array_length(v_payload -> 'rows')
  );
  return v_payload;
end
$function$;

/* Private helpers remain owner-only; public entry points are granted later. */
revoke all on table app_private.people_read_audit_events
  from public, authenticated, neondb_owner,
       hotel_ld_people_read, hotel_ld_application, hotel_ld_readonly;

revoke all on function
  app_private.reject_people_read_audit_mutation(),
  app_private.assert_neon_people_runtime_session(),
  app_private.neon_people_actor_is_active(),
  app_private.neon_people_actor_has_role(text),
  app_private.neon_people_actor_has_department_scope(uuid),
  app_private.neon_people_can_read_employee(uuid,uuid),
  app_private.neon_people_hostname_matches(text),
  app_private.assert_neon_people_hostname(text),
  app_private.assert_neon_people_manager(),
  app_private.assert_neon_people_department(),
  app_private.append_neon_people_read_audit(text,integer)
from public, authenticated, neondb_owner,
     hotel_ld_people_read, hotel_ld_application, hotel_ld_readonly;

reset role;

/*
 * Exact authorizer/directory columns only. The runtime roles retain zero raw
 * table grants; sensitive login, email, identifier values, source and audit
 * columns are intentionally absent.
 */
grant select (tenant_id, property_id, hostname, verification_status, is_active)
  on public.property_domains to hotel_ld_migration_owner;
grant select (id, status)
  on public.tenants to hotel_ld_migration_owner;
grant select (id, tenant_id, status)
  on public.properties to hotel_ld_migration_owner;
grant select (id, is_active)
  on public.profiles to hotel_ld_migration_owner;
grant select (user_id, auth_user_id, tenant_id, property_id,
              account_status, must_change_password, locked_until)
  on public.user_accounts to hotel_ld_migration_owner;
grant select (tenant_id, user_id, status)
  on public.tenant_memberships to hotel_ld_migration_owner;
grant select (tenant_id, property_id, user_id, status)
  on public.property_memberships to hotel_ld_migration_owner;
grant select (id, code, scope_level, is_active)
  on public.roles to hotel_ld_migration_owner;
grant select (id, user_id, role_id, tenant_id, property_id, status)
  on public.role_assignments to hotel_ld_migration_owner;
grant select (role_assignment_id, tenant_id, property_id, department_id,
              include_descendants, is_active)
  on public.trainer_scopes to hotel_ld_migration_owner;
grant select (id, tenant_id, property_id, name_zh, name_en,
              sort_order, is_active)
  on public.departments to hotel_ld_migration_owner;
grant select (tenant_id, property_id, ancestor_department_id,
              descendant_department_id, distance)
  on public.department_closure to hotel_ld_migration_owner;
grant select (id, tenant_id, property_id, name_zh, name_en)
  on public.operational_units to hotel_ld_migration_owner;
grant select (id, tenant_id, property_id, name_zh, name_en,
              sort_order, is_active)
  on public.position_families to hotel_ld_migration_owner;
grant select (id, tenant_id, property_id, name_zh, name_en, is_active)
  on public.positions to hotel_ld_migration_owner;
grant select (id, tenant_id, property_id, employee_number, name_zh, name_en,
              department_id, operational_unit_id, position_id,
              position_family_id, grade_or_band, hire_date,
              probation_or_confirmation_date, employment_status,
              is_new_employee, is_active, version)
  on public.employees to hotel_ld_migration_owner;
grant select (tenant_id, property_id, employee_id, identifier_type, is_active)
  on public.employee_external_identifiers to hotel_ld_migration_owner;

create policy e2_people_property_domains_authorizer
on public.property_domains for select to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and is_active
  and verification_status::text = 'verified'
);

create policy e2_people_tenants_authorizer
on public.tenants for select to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and status::text = 'active'
);

create policy e2_people_properties_authorizer
on public.properties for select to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and status::text = 'active'
);

create policy e2_people_profiles_authorizer
on public.profiles for select to hotel_ld_migration_owner
using (session_user = 'hotel_ld_application');

create policy e2_people_user_accounts_authorizer
on public.user_accounts for select to hotel_ld_migration_owner
using (session_user = 'hotel_ld_application');

create policy e2_people_tenant_memberships_authorizer
on public.tenant_memberships for select to hotel_ld_migration_owner
using (session_user = 'hotel_ld_application');

create policy e2_people_property_memberships_authorizer
on public.property_memberships for select to hotel_ld_migration_owner
using (session_user = 'hotel_ld_application');

create policy e2_people_roles_authorizer
on public.roles for select to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and is_active
  and code in (
    'property_ld_manager',
    'department_training_admin'
  )
);

create policy e2_people_role_assignments_authorizer
on public.role_assignments for select to hotel_ld_migration_owner
using (session_user = 'hotel_ld_application');

create policy e2_people_trainer_scopes_authorizer
on public.trainer_scopes for select to hotel_ld_migration_owner
using (session_user = 'hotel_ld_application');

create policy e2_people_departments_property
on public.departments for select to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
);

create policy e2_people_department_closure_property
on public.department_closure for select to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
);

create policy e2_people_operational_units_property
on public.operational_units for select to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
);

create policy e2_people_position_families_property
on public.position_families for select to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
);

create policy e2_people_positions_property
on public.positions for select to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
);

create policy e2_people_employees_read
on public.employees for select to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and app_private.neon_people_can_read_employee(property_id, department_id)
);

create policy e2_people_identifier_types_manager
on public.employee_external_identifiers for select to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_people_actor_has_role('property_ld_manager')
);

set local role hotel_ld_migration_owner;

revoke all on function
  public.resolve_neon_people_property(text),
  public.read_neon_people_manager_directory(
    text,text,uuid,uuid,uuid,text,boolean,integer,integer
  ),
  public.read_neon_people_manager_employee(text,uuid),
  public.read_neon_people_manager_facets(text),
  public.read_neon_people_department_directory(text,text,integer,integer)
from public, authenticated, neondb_owner,
     hotel_ld_people_read, hotel_ld_application, hotel_ld_readonly;

grant execute on function
  public.resolve_neon_people_property(text),
  public.read_neon_people_manager_directory(
    text,text,uuid,uuid,uuid,text,boolean,integer,integer
  ),
  public.read_neon_people_manager_employee(text,uuid),
  public.read_neon_people_manager_facets(text),
  public.read_neon_people_department_directory(text,text,integer,integer)
to hotel_ld_people_read;

comment on table app_private.people_read_audit_events is
  'Append-only evidence without employee profile fields; stores a pseudonymous actor UUID';
comment on function public.resolve_neon_people_property(text) is
  'Pre-context trusted-hostname resolver for the application runtime only';
comment on function public.read_neon_people_manager_directory(
  text,text,uuid,uuid,uuid,text,boolean,integer,integer
) is
  'Property-manager People directory; actor/property/role enforced in Neon';
comment on function public.read_neon_people_department_directory(
  text,text,integer,integer
) is
  'Department-scoped People directory with exact and descendant scope';

reset role;

do $e2_post_assertions$
declare
  v_rls_tables integer;
  v_public_functions integer;
  v_private_helpers integer;
  v_policy_count integer;
  v_runtime_memberships integer;
  v_runtime_owned integer;
begin
  select count(*)
    into v_public_functions
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace namespace
    on namespace.oid = routine.pronamespace
  join pg_catalog.pg_roles owner_role
    on owner_role.oid = routine.proowner
  where routine.oid = any (array[
      pg_catalog.to_regprocedure(
        'public.resolve_neon_people_property(text)'
      ),
      pg_catalog.to_regprocedure(
        'public.read_neon_people_manager_directory(text,text,uuid,uuid,uuid,text,boolean,integer,integer)'
      ),
      pg_catalog.to_regprocedure(
        'public.read_neon_people_manager_employee(text,uuid)'
      ),
      pg_catalog.to_regprocedure(
        'public.read_neon_people_manager_facets(text)'
      ),
      pg_catalog.to_regprocedure(
        'public.read_neon_people_department_directory(text,text,integer,integer)'
      )
    ]::oid[])
    and namespace.nspname = 'public'
    and owner_role.rolname = 'hotel_ld_migration_owner'
    and routine.prosecdef
    and routine.proconfig = array['search_path=""']::text[];

  if v_public_functions <> 5 then
    raise exception using
      errcode = '42501',
      message = 'E2_ENTRYPOINT_HARDENING_ASSERTION_FAILED';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(array[
      'public.resolve_neon_people_property(text)',
      'public.read_neon_people_manager_directory(text,text,uuid,uuid,uuid,text,boolean,integer,integer)',
      'public.read_neon_people_manager_employee(text,uuid)',
      'public.read_neon_people_manager_facets(text)',
      'public.read_neon_people_department_directory(text,text,integer,integer)'
    ]) signature(value)
    where not pg_catalog.has_function_privilege(
      'hotel_ld_people_read', signature.value, 'EXECUTE'
    ) or not pg_catalog.has_function_privilege(
      'hotel_ld_application', signature.value, 'EXECUTE'
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'E2_RUNTIME_EXECUTE_ASSERTION_FAILED';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(array[
      'public.resolve_neon_people_property(text)',
      'public.read_neon_people_manager_directory(text,text,uuid,uuid,uuid,text,boolean,integer,integer)',
      'public.read_neon_people_manager_employee(text,uuid)',
      'public.read_neon_people_manager_facets(text)',
      'public.read_neon_people_department_directory(text,text,integer,integer)'
    ]) signature(value)
    cross join pg_catalog.unnest(array[
      'authenticated', 'hotel_ld_readonly'
    ]) forbidden_role(value)
    where pg_catalog.has_function_privilege(
      forbidden_role.value, signature.value, 'EXECUTE'
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'E2_ENTRYPOINT_ACL_ASSERTION_FAILED';
  end if;

  select count(*)
    into v_private_helpers
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace namespace
    on namespace.oid = routine.pronamespace
  join pg_catalog.pg_roles owner_role
    on owner_role.oid = routine.proowner
  where routine.oid = any (array[
      pg_catalog.to_regprocedure(
        'app_private.reject_people_read_audit_mutation()'
      ),
      pg_catalog.to_regprocedure(
        'app_private.assert_neon_people_runtime_session()'
      ),
      pg_catalog.to_regprocedure(
        'app_private.neon_people_actor_is_active()'
      ),
      pg_catalog.to_regprocedure(
        'app_private.neon_people_actor_has_role(text)'
      ),
      pg_catalog.to_regprocedure(
        'app_private.neon_people_actor_has_department_scope(uuid)'
      ),
      pg_catalog.to_regprocedure(
        'app_private.neon_people_can_read_employee(uuid,uuid)'
      ),
      pg_catalog.to_regprocedure(
        'app_private.neon_people_hostname_matches(text)'
      ),
      pg_catalog.to_regprocedure(
        'app_private.assert_neon_people_hostname(text)'
      ),
      pg_catalog.to_regprocedure(
        'app_private.assert_neon_people_manager()'
      ),
      pg_catalog.to_regprocedure(
        'app_private.assert_neon_people_department()'
      ),
      pg_catalog.to_regprocedure(
        'app_private.append_neon_people_read_audit(text,integer)'
      )
    ]::oid[])
    and namespace.nspname = 'app_private'
    and owner_role.rolname = 'hotel_ld_migration_owner'
    and not routine.prosecdef
    and routine.proconfig = array['search_path=""']::text[];

  if v_private_helpers <> 11 or exists (
    select 1
    from pg_catalog.unnest(array[
      'app_private.reject_people_read_audit_mutation()',
      'app_private.assert_neon_people_runtime_session()',
      'app_private.neon_people_actor_is_active()',
      'app_private.neon_people_actor_has_role(text)',
      'app_private.neon_people_actor_has_department_scope(uuid)',
      'app_private.neon_people_can_read_employee(uuid,uuid)',
      'app_private.neon_people_hostname_matches(text)',
      'app_private.assert_neon_people_hostname(text)',
      'app_private.assert_neon_people_manager()',
      'app_private.assert_neon_people_department()',
      'app_private.append_neon_people_read_audit(text,integer)'
    ]) signature(value)
    cross join pg_catalog.unnest(array[
      'authenticated', 'hotel_ld_people_read',
      'hotel_ld_application', 'hotel_ld_readonly'
    ]) forbidden_role(value)
    where pg_catalog.has_function_privilege(
      forbidden_role.value, signature.value, 'EXECUTE'
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'E2_PRIVATE_HELPER_ASSERTION_FAILED';
  end if;

  with expected(table_name, policy_name) as (
    values
      ('property_domains', 'e2_people_property_domains_authorizer'),
      ('tenants', 'e2_people_tenants_authorizer'),
      ('properties', 'e2_people_properties_authorizer'),
      ('profiles', 'e2_people_profiles_authorizer'),
      ('user_accounts', 'e2_people_user_accounts_authorizer'),
      ('tenant_memberships', 'e2_people_tenant_memberships_authorizer'),
      ('property_memberships', 'e2_people_property_memberships_authorizer'),
      ('roles', 'e2_people_roles_authorizer'),
      ('role_assignments', 'e2_people_role_assignments_authorizer'),
      ('trainer_scopes', 'e2_people_trainer_scopes_authorizer'),
      ('departments', 'e2_people_departments_property'),
      ('department_closure', 'e2_people_department_closure_property'),
      ('operational_units', 'e2_people_operational_units_property'),
      ('position_families', 'e2_people_position_families_property'),
      ('positions', 'e2_people_positions_property'),
      ('employees', 'e2_people_employees_read'),
      ('employee_external_identifiers',
       'e2_people_identifier_types_manager')
  )
  select count(*)
    into v_policy_count
  from expected
  join pg_catalog.pg_class relation
    on relation.relname = expected.table_name
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
   and namespace.nspname = 'public'
  join pg_catalog.pg_policy policy
    on policy.polrelid = relation.oid
   and policy.polname = expected.policy_name
  where policy.polcmd = 'r'
    and policy.polpermissive
    and policy.polroles = array[
      pg_catalog.to_regrole('hotel_ld_migration_owner')::oid
    ]
    and policy.polqual is not null
    and policy.polwithcheck is null
    and pg_catalog.strpos(
      pg_catalog.lower(
        pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
      ),
      'session_user'
    ) > 0;

  if v_policy_count <> 17 then
    raise exception using
      errcode = '42501',
      message = 'E2_POLICY_CATALOG_ASSERTION_FAILED';
  end if;

  select count(*)
    into v_runtime_memberships
  from pg_catalog.pg_auth_members membership
  join pg_catalog.pg_roles member_role
    on member_role.oid = membership.member
  where member_role.rolname = 'hotel_ld_application';

  if not exists (
    select 1
    from pg_catalog.pg_roles migration_role
    where migration_role.rolname = 'hotel_ld_migration_owner'
      and migration_role.rolcanlogin
      and not migration_role.rolsuper
      and not migration_role.rolbypassrls
      and not migration_role.rolcreatedb
      and not migration_role.rolcreaterole
      and not migration_role.rolreplication
      and not migration_role.rolinherit
  ) then
    raise exception using
      errcode = '42501',
      message = 'E2_DEFINER_ROLE_POST_ASSERTION_FAILED';
  end if;

  if v_runtime_memberships <> 1 or not exists (
    select 1
    from pg_catalog.pg_roles runtime_role
    where runtime_role.rolname = 'hotel_ld_application'
      and runtime_role.rolcanlogin
      and not runtime_role.rolsuper
      and not runtime_role.rolbypassrls
      and not runtime_role.rolcreatedb
      and not runtime_role.rolcreaterole
      and not runtime_role.rolreplication
      and not runtime_role.rolinherit
  ) or not exists (
    select 1
    from pg_catalog.pg_auth_members membership
    join pg_catalog.pg_roles granted_role
      on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles member_role
      on member_role.oid = membership.member
    where member_role.rolname = 'hotel_ld_application'
      and granted_role.rolname = 'hotel_ld_people_read'
      and membership.inherit_option
      and not membership.set_option
      and not membership.admin_option
  ) or pg_catalog.pg_has_role(
    'hotel_ld_application', 'neon_superuser', 'MEMBER'
  ) or pg_catalog.pg_has_role(
    'hotel_ld_application', 'neondb_owner', 'MEMBER'
  ) or pg_catalog.pg_has_role(
    'hotel_ld_application', 'hotel_ld_migration_owner', 'MEMBER'
  ) or pg_catalog.pg_has_role(
    'hotel_ld_application', 'authenticated', 'MEMBER'
  ) then
    raise exception using
      errcode = '42501',
      message = 'E2_RUNTIME_ROLE_POST_ASSERTION_FAILED';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(array[
      'public.profiles', 'public.tenants', 'public.properties',
      'public.property_domains', 'public.tenant_memberships',
      'public.property_memberships', 'public.roles',
      'public.role_assignments', 'public.trainer_scopes',
      'public.user_accounts', 'public.departments',
      'public.department_closure', 'public.operational_units',
      'public.position_families', 'public.positions',
      'public.employees', 'public.employee_external_identifiers'
    ]) relation(value)
    cross join pg_catalog.unnest(array[
      'hotel_ld_application', 'hotel_ld_people_read'
    ]) runtime_role(value)
    where pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'SELECT'
    ) or pg_catalog.has_any_column_privilege(
      runtime_role.value, relation.value, 'SELECT'
    )
  ) or pg_catalog.has_column_privilege(
    'hotel_ld_migration_owner',
    'public.employee_external_identifiers',
    'identifier_value',
    'SELECT'
  ) or exists (
    select 1
    from pg_catalog.unnest(array[
      'hotel_ld_application', 'hotel_ld_people_read'
    ]) runtime_role(value)
    cross join pg_catalog.unnest(array[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'
    ]) privilege(value)
    where pg_catalog.has_table_privilege(
      runtime_role.value,
      'app_private.people_read_audit_events',
      privilege.value
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'E2_RAW_DATA_GRANT_ASSERTION_FAILED';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(array[
      'hotel_ld_application', 'hotel_ld_people_read'
    ]) runtime_role(value)
    cross join pg_catalog.unnest(array[
      'INSERT', 'UPDATE', 'DELETE'
    ]) privilege(value)
    where pg_catalog.has_table_privilege(
      runtime_role.value, 'public.employees', privilege.value
    )
  ) or exists (
    select 1
    from pg_catalog.unnest(array[
      'hotel_ld_application', 'hotel_ld_people_read'
    ]) runtime_role(value)
    cross join pg_catalog.unnest(array[
      'INSERT', 'UPDATE', 'REFERENCES'
    ]) privilege(value)
    where pg_catalog.has_any_column_privilege(
      runtime_role.value, 'public.employees', privilege.value
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'E2_EMPLOYEE_WRITE_GRANT_ASSERTION_FAILED';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger audit_trigger
    join pg_catalog.pg_class audit_table
      on audit_table.oid = audit_trigger.tgrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = audit_table.relnamespace
    join pg_catalog.pg_roles owner_role
      on owner_role.oid = audit_table.relowner
    where namespace.nspname = 'app_private'
      and audit_table.relname = 'people_read_audit_events'
      and owner_role.rolname = 'hotel_ld_migration_owner'
      and audit_trigger.tgname = 'people_read_audit_append_only'
      and audit_trigger.tgenabled = 'O'
      and not audit_trigger.tgisinternal
  ) then
    raise exception using
      errcode = '42501',
      message = 'E2_AUDIT_TRIGGER_ASSERTION_FAILED';
  end if;

  select count(*)
    into v_runtime_owned
  from (
    select relation.relowner as owner_oid
    from pg_catalog.pg_class relation
    union all
    select routine.proowner
    from pg_catalog.pg_proc routine
    union all
    select namespace.nspowner
    from pg_catalog.pg_namespace namespace
    union all
    select data_type.typowner
    from pg_catalog.pg_type data_type
    union all
    select database_record.datdba
    from pg_catalog.pg_database database_record
  ) owned
  join pg_catalog.pg_roles owner_role
    on owner_role.oid = owned.owner_oid
  where owner_role.rolname in (
    'hotel_ld_application',
    'hotel_ld_people_read',
    'hotel_ld_readonly'
  );

  if v_runtime_owned <> 0 then
    raise exception using
      errcode = '42501',
      message = 'E2_RUNTIME_OBJECT_OWNERSHIP_ASSERTION_FAILED';
  end if;

  select count(*)
    into v_rls_tables
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind = 'r'
    and relation.relname = any (array[
      'profiles', 'tenants', 'properties', 'property_domains',
      'tenant_memberships', 'property_memberships', 'roles',
      'role_assignments', 'trainer_scopes', 'user_accounts',
      'departments', 'department_closure', 'operational_units',
      'position_families', 'positions', 'employees',
      'employee_external_identifiers'
    ])
    and relation.relrowsecurity
    and relation.relforcerowsecurity;

  if v_rls_tables <> 17 then
    raise exception using
      errcode = '42501',
      message = 'E2_FORCE_RLS_POST_ASSERTION_FAILED';
  end if;
end
$e2_post_assertions$;

commit;

/*
 * Semantic rollback (child-only, separately reviewed):
 * 1. REVOKE EXECUTE on the five public E2 entry points from
 *    hotel_ld_people_read.
 * 2. DROP the five public E2 entry points.
 * 3. DROP all e2_people_* policies from the seventeen source tables.
 * 4. REVOKE the exact column SELECT grants from hotel_ld_migration_owner.
 * 5. DROP private E2 helpers in reverse dependency order. Drop the audit
 *    append helper first; then DROP the audit trigger, its reject function,
 *    index and table. Do not use CASCADE. Never disable RLS and never alter
 *    the E1 actor functions.
 */
