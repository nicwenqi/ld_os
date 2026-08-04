/*
 * E3 Phase 1 / 202608040004 — Organization Department read boundary
 *
 * Apply only as the reviewed child bootstrap identity after E1 and E2.
 * Runtime remains function-only. This migration adds no Organization write
 * path, no runtime raw-table grant, and no permissive policy to an E2 table.
 */

begin;
do $e3_phase1_preflight$ begin
  if current_database() <> 'neondb'
     or current_user <> 'neondb_owner'
     or session_user <> 'neondb_owner' then
    raise exception using errcode='42501',
      message='E3_PHASE1_BOOTSTRAP_IDENTITY_MISMATCH';
  end if;
end $e3_phase1_preflight$;

do $e3_phase1_catalog_preflight$
declare
  v_count integer;
  v_runtime_memberships integer;
  v_runtime_owned integer;
begin
  if not pg_catalog.pg_has_role(
    current_user, 'hotel_ld_migration_owner', 'SET'
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_MIGRATION_OWNER_SET_ROLE_REQUIRED';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles role_record
    where role_record.rolname = 'hotel_ld_migration_owner'
      and role_record.rolcanlogin
      and not role_record.rolsuper
      and not role_record.rolbypassrls
      and not role_record.rolcreatedb
      and not role_record.rolcreaterole
      and not role_record.rolreplication
      and not role_record.rolinherit
  ) or not exists (
    select 1
    from pg_catalog.pg_roles role_record
    where role_record.rolname = 'hotel_ld_application'
      and role_record.rolcanlogin
      and not role_record.rolsuper
      and not role_record.rolbypassrls
      and not role_record.rolcreatedb
      and not role_record.rolcreaterole
      and not role_record.rolreplication
      and not role_record.rolinherit
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_ROLE_BASELINE_DRIFT';
  end if;

  select count(*)
    into v_runtime_memberships
  from pg_catalog.pg_auth_members membership
  join pg_catalog.pg_roles member_role
    on member_role.oid = membership.member
  where member_role.rolname = 'hotel_ld_application';

  if v_runtime_memberships <> 1 or not exists (
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
  ) or pg_catalog.pg_has_role(
    'hotel_ld_application', 'neon_superuser', 'MEMBER'
  ) or pg_catalog.pg_has_role(
    'hotel_ld_application', 'neondb_owner', 'MEMBER'
  ) or pg_catalog.pg_has_role(
    'hotel_ld_application', 'hotel_ld_migration_owner', 'MEMBER'
  ) or pg_catalog.pg_has_role(
    'hotel_ld_application', 'authenticated', 'MEMBER'
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_RUNTIME_MEMBERSHIP_DRIFT';
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
  where owner_role.rolname = 'hotel_ld_application';

  if v_runtime_owned <> 0 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_RUNTIME_OWNERSHIP_DRIFT';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_roles owner_role
    on owner_role.oid = relation.relowner
  where namespace.nspname = 'public'
    and relation.relkind = 'r'
    and relation.relname = any (array[
      'departments', 'department_closure', 'department_aliases',
      'operational_units', 'operational_unit_aliases'
    ])
    and owner_role.rolname = 'neondb_owner'
    and relation.relrowsecurity
    and relation.relforcerowsecurity;

  if v_count <> 5 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_ORGANIZATION_TABLE_BASELINE_DRIFT';
  end if;

  if pg_catalog.to_regclass(
    'app_private.organization_read_audit_events'
  ) is not null or exists (
    select 1
    from pg_catalog.unnest(array[
      'app_private.reject_organization_read_audit_mutation()',
      'app_private.assert_neon_organization_runtime_session()',
      'app_private.neon_organization_actor_is_active()',
      'app_private.neon_organization_actor_has_role(text)',
      'app_private.neon_organization_actor_has_department_scope(uuid)',
      'app_private.neon_organization_actor_can_read_department(uuid)',
      'app_private.neon_organization_hostname_matches(text)',
      'app_private.assert_neon_organization_hostname(text)',
      'app_private.assert_neon_organization_reader()',
      'app_private.append_neon_organization_read_audit(text,integer)',
      'public.resolve_neon_organization_property(text)',
      'public.read_neon_organization_department_tree(text)'
    ]) signature(value)
    where pg_catalog.to_regprocedure(signature.value) is not null
  ) then
    raise exception using errcode = '42710',
      message = 'E3_PHASE1_OBJECT_ALREADY_EXISTS';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace namespace
    on namespace.oid = routine.pronamespace
  join pg_catalog.pg_roles owner_role
    on owner_role.oid = routine.proowner
  where routine.oid = any (array[
      pg_catalog.to_regprocedure(
        'app_private.actor_uuid_setting_or_null(text)'
      ),
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

  if v_count <> 5 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_ACTOR_FOUNDATION_DRIFT';
  end if;

  select count(*)
    into v_count
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

  if v_count <> 5 or (
    select count(*)
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace
      on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and (
        routine.proname = 'resolve_neon_people_property'
        or routine.proname like 'read_neon_people_%'
      )
  ) <> 5 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_PEOPLE_ENTRYPOINT_DRIFT';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_policy policy
  join pg_catalog.pg_class relation
    on relation.oid = policy.polrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and (relation.relname, policy.polname) in (
      ('departments', 'e2_people_departments_property'),
      ('department_closure', 'e2_people_department_closure_property')
    )
    and policy.polcmd = 'r'
    and policy.polpermissive
    and policy.polroles = array[
      pg_catalog.to_regrole('hotel_ld_migration_owner')::oid
    ]
    and policy.polqual is not null
    and policy.polwithcheck is null
    and pg_catalog.regexp_replace(
      pg_catalog.lower(
        pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
      ),
      '[()[:space:]]+',
      '',
      'g'
    ) = 'session_user=''hotel_ld_application''::nameandproperty_id=app_private.current_actor_property_id';

  if v_count <> 2 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_DEPARTMENT_POLICY_DRIFT';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_trigger trigger_record
  join pg_catalog.pg_class relation
    on relation.oid = trigger_record.tgrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_proc trigger_function
    on trigger_function.oid = trigger_record.tgfoid
  join pg_catalog.pg_roles function_owner
    on function_owner.oid = trigger_function.proowner
  where namespace.nspname = 'public'
    and relation.relname in ('departments', 'department_closure')
    and not trigger_record.tgisinternal
    and trigger_function.prosecdef
    and function_owner.rolbypassrls;

  if v_count <> 1 or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    join pg_catalog.pg_class relation
      on relation.oid = trigger_record.tgrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc trigger_function
      on trigger_function.oid = trigger_record.tgfoid
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = trigger_function.pronamespace
    join pg_catalog.pg_roles function_owner
      on function_owner.oid = trigger_function.proowner
    where namespace.nspname = 'public'
      and relation.relname = 'departments'
      and not trigger_record.tgisinternal
      and trigger_record.tgname = 'departments_insert_closure'
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgtype = 5
      and trigger_record.tgqual is null
      and trigger_record.tgnargs = 0
      and pg_catalog.octet_length(trigger_record.tgargs) = 0
      and trigger_record.tgconstraint = 0
      and not trigger_record.tgdeferrable
      and not trigger_record.tginitdeferred
      and function_namespace.nspname = 'app_private'
      and trigger_function.proname = 'insert_department_closure'
      and trigger_function.pronargs = 0
      and trigger_function.prorettype = 'trigger'::pg_catalog.regtype
      and trigger_function.provolatile = 'v'
      and trigger_function.prosecdef
      and trigger_function.proconfig = array['search_path=""']::text[]
      and function_owner.rolname = 'neondb_owner'
      and function_owner.rolbypassrls
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_TRIGGER_DEFINER_BYPASS_DRIFT';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(array[
      'public.departments', 'public.department_closure'
    ]) relation(value)
    cross join pg_catalog.unnest(array[
      'hotel_ld_application', 'hotel_ld_people_read'
    ]) runtime_role(value)
    where pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'INSERT'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'UPDATE'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'DELETE'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'TRUNCATE'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'REFERENCES'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'TRIGGER'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'MAINTAIN'
    ) or pg_catalog.has_any_column_privilege(
      runtime_role.value, relation.value, 'INSERT'
    ) or pg_catalog.has_any_column_privilege(
      runtime_role.value, relation.value, 'UPDATE'
    ) or pg_catalog.has_any_column_privilege(
      runtime_role.value, relation.value, 'REFERENCES'
    )
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_LEGACY_TRIGGER_NOT_READ_PATH_INERT';
  end if;
end
$e3_phase1_catalog_preflight$;

set local role hotel_ld_migration_owner;

create table app_private.organization_read_audit_events (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  auth_user_id uuid not null,
  property_id uuid not null,
  operation text not null,
  result_row_count integer not null,
  occurred_at timestamptz not null
    default pg_catalog.transaction_timestamp(),
  constraint organization_read_audit_operation_check check (
    operation = 'department_tree'
  ),
  constraint organization_read_audit_count_check check (
    result_row_count >= 0
  )
);

create index organization_read_audit_request_idx
  on app_private.organization_read_audit_events(request_id, occurred_at);

create function app_private.reject_organization_read_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using errcode = '42501',
    message = 'ORGANIZATION_READ_AUDIT_APPEND_ONLY';
end
$function$;

create trigger organization_read_audit_append_only
before update or delete on app_private.organization_read_audit_events
for each row
execute function app_private.reject_organization_read_audit_mutation();

create function app_private.assert_neon_organization_runtime_session()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_memberships integer;
begin
  select count(*)
    into v_memberships
  from pg_catalog.pg_auth_members membership
  join pg_catalog.pg_roles member_role
    on member_role.oid = membership.member
  where member_role.rolname = session_user;

  if session_user <> 'hotel_ld_application'
     or current_user <> 'hotel_ld_migration_owner'
     or v_memberships <> 1
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
         and not runtime_role.rolinherit
     )
     or not exists (
       select 1
       from pg_catalog.pg_auth_members membership
       join pg_catalog.pg_roles granted_role
         on granted_role.oid = membership.roleid
       join pg_catalog.pg_roles member_role
         on member_role.oid = membership.member
       where granted_role.rolname = 'hotel_ld_people_read'
         and member_role.rolname = session_user
         and membership.inherit_option
         and not membership.set_option
         and not membership.admin_option
     )
     or pg_catalog.pg_has_role(
       session_user, 'neon_superuser', 'MEMBER'
     )
     or pg_catalog.pg_has_role(
       session_user, 'neondb_owner', 'MEMBER'
     )
     or pg_catalog.pg_has_role(
       session_user, 'hotel_ld_migration_owner', 'MEMBER'
     )
     or pg_catalog.pg_has_role(
       session_user, 'authenticated', 'MEMBER'
     ) then
    raise exception using errcode = '42501',
      message = 'NEON_ORGANIZATION_RUNTIME_FORBIDDEN';
  end if;
end
$function$;

create function app_private.neon_organization_actor_is_active()
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
    where account.auth_user_id =
      app_private.current_actor_auth_user_id()
      and account.property_id =
        app_private.current_actor_property_id()
      and account.account_status::text = 'active'
      and not account.must_change_password
      and (
        account.locked_until is null
        or account.locked_until <= pg_catalog.now()
      )
  );
$function$;

create function app_private.neon_organization_actor_has_role(
  p_role_code text
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select app_private.neon_organization_actor_is_active()
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
       and role.scope_level::text = case p_role_code
         when 'property_ld_manager' then 'property'
         else 'department'
       end
      where account.auth_user_id =
        app_private.current_actor_auth_user_id()
        and account.property_id =
          app_private.current_actor_property_id()
        and account.account_status::text = 'active'
    );
$function$;

create function app_private.neon_organization_actor_has_department_scope(
  p_department_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select p_department_id is not null
    and app_private.neon_organization_actor_has_role(
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
      where account.auth_user_id =
        app_private.current_actor_auth_user_id()
        and account.property_id =
          app_private.current_actor_property_id()
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

create function app_private.neon_organization_actor_can_read_department(
  p_department_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select p_department_id is not null
    and app_private.neon_organization_actor_is_active()
    and exists (
      select 1
      from public.departments target_department
      where target_department.id = p_department_id
        and target_department.property_id =
          app_private.current_actor_property_id()
    )
    and (
      app_private.neon_organization_actor_has_role(
        'property_ld_manager'
      )
      or app_private.neon_organization_actor_has_department_scope(
        p_department_id
      )
      or exists (
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
        join public.department_closure closure
          on closure.tenant_id = scope.tenant_id
         and closure.property_id = scope.property_id
         and closure.ancestor_department_id = p_department_id
         and closure.descendant_department_id = scope.department_id
        where account.auth_user_id =
          app_private.current_actor_auth_user_id()
          and account.property_id =
            app_private.current_actor_property_id()
          and app_private.neon_organization_actor_has_role(
            'department_training_admin'
          )
      )
    );
$function$;

create function app_private.neon_organization_hostname_matches(
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
        pg_catalog.split_part(
          pg_catalog.btrim(p_hostname), ':', 1
        )
      )
        and domain.property_id =
          app_private.current_actor_property_id()
        and domain.is_active
        and domain.verification_status::text = 'verified'
    );
$function$;

create function app_private.assert_neon_organization_hostname(p_hostname text)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_hostname text := pg_catalog.lower(
    pg_catalog.split_part(
      pg_catalog.btrim(coalesce(p_hostname, '')), ':', 1
    )
  );
begin
  perform app_private.assert_actor_context();
  if v_hostname = ''
     or not app_private.neon_organization_hostname_matches(v_hostname) then
    raise exception using errcode = '42501',
      message = 'NEON_ORGANIZATION_PROPERTY_CONTEXT_CHANGED';
  end if;
end
$function$;

create function app_private.assert_neon_organization_reader()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  perform app_private.assert_actor_context();
  if not app_private.neon_organization_actor_is_active()
     or not (
       app_private.neon_organization_actor_has_role(
         'property_ld_manager'
       )
       or exists (
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
         where account.auth_user_id =
           app_private.current_actor_auth_user_id()
           and account.property_id =
             app_private.current_actor_property_id()
       )
     ) then
    raise exception using errcode = '42501',
      message = 'NEON_ORGANIZATION_READER_FORBIDDEN';
  end if;
end
$function$;

create function app_private.append_neon_organization_read_audit(
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
  insert into app_private.organization_read_audit_events (
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

create function public.resolve_neon_organization_property(p_hostname text)
returns table (tenant_id uuid, property_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_hostname text := pg_catalog.lower(
    pg_catalog.split_part(
      pg_catalog.btrim(coalesce(p_hostname, '')), ':', 1
    )
  );
begin
  perform app_private.assert_neon_organization_runtime_session();
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

create function public.read_neon_organization_department_tree(p_hostname text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_payload jsonb;
  v_row_count integer;
begin
  perform app_private.assert_neon_organization_runtime_session();
  perform app_private.assert_actor_context();
  perform app_private.assert_neon_organization_hostname(p_hostname);
  perform app_private.assert_neon_organization_reader();

  with authorized as materialized (
    select
      department.id,
      department.tenant_id,
      department.property_id,
      department.parent_id,
      department.node_type::text as node_type,
      department.code,
      department.name_zh,
      department.name_en,
      department.sort_order,
      department.depth,
      department.path_ids,
      department.is_active,
      department.version,
      array(
        select pg_catalog.lpad(
          (ancestor.sort_order::bigint + 2147483648)::text,
          10,
          '0'
        ) || pg_catalog.chr(31) || ancestor.name_zh
          || pg_catalog.chr(31) || ancestor.id::text
        from pg_catalog.unnest(department.path_ids)
          with ordinality path(ancestor_id, ordinal)
        join public.departments ancestor
          on ancestor.id = path.ancestor_id
         and ancestor.tenant_id = department.tenant_id
         and ancestor.property_id = department.property_id
        order by path.ordinal
      ) as tree_sort_path
    from public.departments department
    where department.property_id =
      app_private.current_actor_property_id()
      and app_private.neon_organization_actor_can_read_department(
        department.id
      )
  )
  select pg_catalog.jsonb_build_object(
    'rows', coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', row.id,
          'tenant_id', row.tenant_id,
          'property_id', row.property_id,
          'parent_id', row.parent_id,
          'node_type', row.node_type,
          'code', row.code,
          'name_zh', row.name_zh,
          'name_en', row.name_en,
          'sort_order', row.sort_order,
          'depth', row.depth,
          'path_ids', row.path_ids,
          'is_active', row.is_active,
          'version', row.version,
          'synthetic_employee_count', 0
        ) order by row.tree_sort_path
      ),
      '[]'::jsonb
    ),
    'refreshed_at', pg_catalog.transaction_timestamp()
  )
  into v_payload
  from authorized row;

  v_row_count := pg_catalog.jsonb_array_length(v_payload -> 'rows');
  perform app_private.append_neon_organization_read_audit(
    'department_tree', v_row_count
  );
  return v_payload;
end
$function$;

revoke all on table app_private.organization_read_audit_events
  from public, authenticated, neondb_owner, hotel_ld_people_read,
       hotel_ld_application, hotel_ld_readonly;

revoke all on function
  app_private.reject_organization_read_audit_mutation(),
  app_private.assert_neon_organization_runtime_session(),
  app_private.neon_organization_actor_is_active(),
  app_private.neon_organization_actor_has_role(text),
  app_private.neon_organization_actor_has_department_scope(uuid),
  app_private.neon_organization_actor_can_read_department(uuid),
  app_private.neon_organization_hostname_matches(text),
  app_private.assert_neon_organization_hostname(text),
  app_private.assert_neon_organization_reader(),
  app_private.append_neon_organization_read_audit(text,integer)
from public, authenticated, neondb_owner, hotel_ld_people_read,
     hotel_ld_application, hotel_ld_readonly;

reset role;

grant select (parent_id,node_type,code,depth,path_ids,version)
  on public.departments to hotel_ld_migration_owner;

set local role hotel_ld_migration_owner;

revoke all on function public.resolve_neon_organization_property(text)
  from public, authenticated, neondb_owner, hotel_ld_people_read,
       hotel_ld_application, hotel_ld_readonly;
grant execute on function public.resolve_neon_organization_property(text)
  to hotel_ld_application;

revoke all on function public.read_neon_organization_department_tree(text)
  from public, authenticated, neondb_owner, hotel_ld_people_read,
       hotel_ld_application, hotel_ld_readonly;
grant execute on function public.read_neon_organization_department_tree(text)
  to hotel_ld_application;

comment on table app_private.organization_read_audit_events is
  'Append-only Organization read evidence; stores no names or search values';
comment on function public.resolve_neon_organization_property(text) is
  'Pre-context verified property-domain resolver for the exact Neon runtime';
comment on function public.read_neon_organization_department_tree(text) is
  'Actor-, property-, role-, and Department-scope constrained tree read';

reset role;

do $e3_phase1_postflight$
declare
  v_count integer;
  v_runtime_memberships integer;
  v_runtime_owned integer;
begin
  if current_database() <> 'neondb'
     or current_user <> 'neondb_owner'
     or session_user <> 'neondb_owner' then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_POSTFLIGHT_IDENTITY_MISMATCH';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace namespace
    on namespace.oid = routine.pronamespace
  join pg_catalog.pg_roles owner_role
    on owner_role.oid = routine.proowner
  where routine.oid = any (array[
      pg_catalog.to_regprocedure(
        'public.resolve_neon_organization_property(text)'
      ),
      pg_catalog.to_regprocedure(
        'public.read_neon_organization_department_tree(text)'
      )
    ]::oid[])
    and namespace.nspname = 'public'
    and owner_role.rolname = 'hotel_ld_migration_owner'
    and routine.prosecdef
    and routine.proconfig = array['search_path=""']::text[];

  if v_count <> 2 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_ENTRYPOINT_CATALOG_ASSERTION_FAILED';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(array[
      'public.resolve_neon_organization_property(text)',
      'public.read_neon_organization_department_tree(text)'
    ]) signature(value)
    where not pg_catalog.has_function_privilege(
      'hotel_ld_application', signature.value, 'EXECUTE'
    )
  ) or exists (
    select 1
    from pg_catalog.unnest(array[
      'public.resolve_neon_organization_property(text)',
      'public.read_neon_organization_department_tree(text)'
    ]) signature(value)
    cross join pg_catalog.unnest(array[
      'authenticated', 'hotel_ld_people_read', 'hotel_ld_readonly'
    ]) forbidden_role(value)
    where pg_catalog.has_function_privilege(
      forbidden_role.value, signature.value, 'EXECUTE'
    )
  ) or exists (
    select 1
    from pg_catalog.pg_proc routine
    cross join lateral pg_catalog.aclexplode(routine.proacl) acl
    where routine.oid = any (array[
      pg_catalog.to_regprocedure(
        'public.resolve_neon_organization_property(text)'
      ),
      pg_catalog.to_regprocedure(
        'public.read_neon_organization_department_tree(text)'
      )
    ]::oid[])
      and acl.privilege_type = 'EXECUTE'
      and (
        acl.grantee not in (
          pg_catalog.to_regrole('hotel_ld_migration_owner')::oid,
          pg_catalog.to_regrole('hotel_ld_application')::oid
        )
        or (
          acl.grantee =
            pg_catalog.to_regrole('hotel_ld_application')::oid
          and (
            acl.is_grantable
            or acl.grantor <>
              pg_catalog.to_regrole('hotel_ld_migration_owner')::oid
          )
        )
      )
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_ENTRYPOINT_ACL_ASSERTION_FAILED';
  end if;

  with checked(signature) as (
    values
      ('app_private.actor_uuid_setting_or_null(text)'),
      ('app_private.current_actor_auth_user_id()'),
      ('app_private.current_actor_property_id()'),
      ('app_private.current_actor_request_id()'),
      ('app_private.assert_actor_context()'),
      ('app_private.reject_organization_read_audit_mutation()'),
      ('app_private.assert_neon_organization_runtime_session()'),
      ('app_private.neon_organization_actor_is_active()'),
      ('app_private.neon_organization_actor_has_role(text)'),
      ('app_private.neon_organization_actor_has_department_scope(uuid)'),
      ('app_private.neon_organization_actor_can_read_department(uuid)'),
      ('app_private.neon_organization_hostname_matches(text)'),
      ('app_private.assert_neon_organization_hostname(text)'),
      ('app_private.assert_neon_organization_reader()'),
      ('app_private.append_neon_organization_read_audit(text,integer)'),
      ('public.resolve_neon_organization_property(text)'),
      ('public.read_neon_organization_department_tree(text)')
  )
  select count(*)
    into v_count
  from checked
  where pg_catalog.to_regprocedure(checked.signature) is not null;

  if v_count <> 17 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_READ_CALL_CLOSURE_INCOMPLETE';
  end if;

  if exists (
    with checked(signature) as (
      values
        ('app_private.actor_uuid_setting_or_null(text)'),
        ('app_private.current_actor_auth_user_id()'),
        ('app_private.current_actor_property_id()'),
        ('app_private.current_actor_request_id()'),
        ('app_private.assert_actor_context()'),
        ('app_private.reject_organization_read_audit_mutation()'),
        ('app_private.assert_neon_organization_runtime_session()'),
        ('app_private.neon_organization_actor_is_active()'),
        ('app_private.neon_organization_actor_has_role(text)'),
        ('app_private.neon_organization_actor_has_department_scope(uuid)'),
        ('app_private.neon_organization_actor_can_read_department(uuid)'),
        ('app_private.neon_organization_hostname_matches(text)'),
        ('app_private.assert_neon_organization_hostname(text)'),
        ('app_private.assert_neon_organization_reader()'),
        ('app_private.append_neon_organization_read_audit(text,integer)'),
        ('public.resolve_neon_organization_property(text)'),
        ('public.read_neon_organization_department_tree(text)')
    )
    select 1
    from checked
    join pg_catalog.pg_proc routine
      on routine.oid = pg_catalog.to_regprocedure(checked.signature)
    where pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid)),
      '[[:space:]]+',
      ' ',
      'g'
    ) ~ '(insert into|update|delete from|merge into|truncate( table)?)( only)? ["]?public["]?[[:space:]]*[.][[:space:]]*["]?(departments|department_closure|department_aliases|operational_units|operational_unit_aliases)["]?'
      or pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid)),
        '[[:space:]]+',
        ' ',
        'g'
      ) ~ '(^|[^a-z_])execute[[:space:](]'
      or pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(routine.oid),
        '"'
      ) > 0
  ) or exists (
    with checked(signature) as (
      values
        ('app_private.actor_uuid_setting_or_null(text)'),
        ('app_private.current_actor_auth_user_id()'),
        ('app_private.current_actor_property_id()'),
        ('app_private.current_actor_request_id()'),
        ('app_private.assert_actor_context()'),
        ('app_private.reject_organization_read_audit_mutation()'),
        ('app_private.assert_neon_organization_runtime_session()'),
        ('app_private.neon_organization_actor_is_active()'),
        ('app_private.neon_organization_actor_has_role(text)'),
        ('app_private.neon_organization_actor_has_department_scope(uuid)'),
        ('app_private.neon_organization_actor_can_read_department(uuid)'),
        ('app_private.neon_organization_hostname_matches(text)'),
        ('app_private.assert_neon_organization_hostname(text)'),
        ('app_private.assert_neon_organization_reader()'),
        ('app_private.append_neon_organization_read_audit(text,integer)'),
        ('public.resolve_neon_organization_property(text)'),
        ('public.read_neon_organization_department_tree(text)')
    )
    select 1
    from checked
    join pg_catalog.pg_proc routine
      on routine.oid = pg_catalog.to_regprocedure(checked.signature)
    cross join lateral pg_catalog.regexp_matches(
      pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.pg_get_functiondef(routine.oid)),
        'insert[[:space:]]+into[[:space:]]+app_private[.]organization_read_audit_events[[:space:]]*[(]',
        'insert into audited_relation ',
        'g'
      ),
      '([a-z_][a-z0-9_]*)[[:space:]]*[.][[:space:]]*([a-z_][a-z0-9_]*)[[:space:]]*[(]',
      'g'
    ) function_call(match)
    where (function_call.match)[1] <> 'pg_catalog'
      and (
        (function_call.match)[1],
        (function_call.match)[2]
      ) not in (
      ('app_private', 'actor_uuid_setting_or_null'),
      ('app_private', 'current_actor_auth_user_id'),
      ('app_private', 'current_actor_property_id'),
      ('app_private', 'current_actor_request_id'),
      ('app_private', 'assert_actor_context'),
      ('app_private', 'reject_organization_read_audit_mutation'),
      ('app_private', 'assert_neon_organization_runtime_session'),
      ('app_private', 'neon_organization_actor_is_active'),
      ('app_private', 'neon_organization_actor_has_role'),
      ('app_private', 'neon_organization_actor_has_department_scope'),
      ('app_private', 'neon_organization_actor_can_read_department'),
      ('app_private', 'neon_organization_hostname_matches'),
      ('app_private', 'assert_neon_organization_hostname'),
      ('app_private', 'assert_neon_organization_reader'),
      ('app_private', 'append_neon_organization_read_audit'),
      ('public', 'resolve_neon_organization_property'),
      ('public', 'read_neon_organization_department_tree')
    )
  ) or exists (
    with checked(signature) as (
      values
        ('app_private.actor_uuid_setting_or_null(text)'),
        ('app_private.current_actor_auth_user_id()'),
        ('app_private.current_actor_property_id()'),
        ('app_private.current_actor_request_id()'),
        ('app_private.assert_actor_context()'),
        ('app_private.reject_organization_read_audit_mutation()'),
        ('app_private.assert_neon_organization_runtime_session()'),
        ('app_private.neon_organization_actor_is_active()'),
        ('app_private.neon_organization_actor_has_role(text)'),
        ('app_private.neon_organization_actor_has_department_scope(uuid)'),
        ('app_private.neon_organization_actor_can_read_department(uuid)'),
        ('app_private.neon_organization_hostname_matches(text)'),
        ('app_private.assert_neon_organization_hostname(text)'),
        ('app_private.assert_neon_organization_reader()'),
        ('app_private.append_neon_organization_read_audit(text,integer)'),
        ('public.resolve_neon_organization_property(text)'),
        ('public.read_neon_organization_department_tree(text)')
    )
    select 1
    from checked
    join pg_catalog.pg_depend dependency
      on dependency.objid = pg_catalog.to_regprocedure(checked.signature)
    join pg_catalog.pg_proc referenced_function
      on referenced_function.oid = dependency.refobjid
    join pg_catalog.pg_namespace referenced_namespace
      on referenced_namespace.oid = referenced_function.pronamespace
    where dependency.classid =
        'pg_catalog.pg_proc'::pg_catalog.regclass
      and dependency.refclassid =
        'pg_catalog.pg_proc'::pg_catalog.regclass
      and referenced_namespace.nspname <> 'pg_catalog'
      and dependency.refobjid <> all (array[
        pg_catalog.to_regprocedure(
          'app_private.actor_uuid_setting_or_null(text)'
        ),
        pg_catalog.to_regprocedure(
          'app_private.current_actor_auth_user_id()'
        ),
        pg_catalog.to_regprocedure(
          'app_private.current_actor_property_id()'
        ),
        pg_catalog.to_regprocedure(
          'app_private.current_actor_request_id()'
        ),
        pg_catalog.to_regprocedure('app_private.assert_actor_context()'),
        pg_catalog.to_regprocedure(
          'app_private.reject_organization_read_audit_mutation()'
        ),
        pg_catalog.to_regprocedure(
          'app_private.assert_neon_organization_runtime_session()'
        ),
        pg_catalog.to_regprocedure(
          'app_private.neon_organization_actor_is_active()'
        ),
        pg_catalog.to_regprocedure(
          'app_private.neon_organization_actor_has_role(text)'
        ),
        pg_catalog.to_regprocedure(
          'app_private.neon_organization_actor_has_department_scope(uuid)'
        ),
        pg_catalog.to_regprocedure(
          'app_private.neon_organization_actor_can_read_department(uuid)'
        ),
        pg_catalog.to_regprocedure(
          'app_private.neon_organization_hostname_matches(text)'
        ),
        pg_catalog.to_regprocedure(
          'app_private.assert_neon_organization_hostname(text)'
        ),
        pg_catalog.to_regprocedure(
          'app_private.assert_neon_organization_reader()'
        ),
        pg_catalog.to_regprocedure(
          'app_private.append_neon_organization_read_audit(text,integer)'
        ),
        pg_catalog.to_regprocedure(
          'public.resolve_neon_organization_property(text)'
        ),
        pg_catalog.to_regprocedure(
          'public.read_neon_organization_department_tree(text)'
        )
      ]::oid[])
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_ENTRYPOINT_NOT_SELECT_ONLY';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_trigger trigger_record
  join pg_catalog.pg_class relation
    on relation.oid = trigger_record.tgrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_proc trigger_function
    on trigger_function.oid = trigger_record.tgfoid
  join pg_catalog.pg_roles function_owner
    on function_owner.oid = trigger_function.proowner
  where namespace.nspname = 'public'
    and relation.relname in ('departments', 'department_closure')
    and not trigger_record.tgisinternal
    and trigger_function.prosecdef
    and function_owner.rolbypassrls;

  if v_count <> 1 or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    join pg_catalog.pg_class relation
      on relation.oid = trigger_record.tgrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc trigger_function
      on trigger_function.oid = trigger_record.tgfoid
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = trigger_function.pronamespace
    join pg_catalog.pg_roles function_owner
      on function_owner.oid = trigger_function.proowner
    where namespace.nspname = 'public'
      and relation.relname = 'departments'
      and not trigger_record.tgisinternal
      and trigger_record.tgname = 'departments_insert_closure'
      and trigger_record.tgenabled = 'O'
      and trigger_record.tgtype = 5
      and trigger_record.tgqual is null
      and trigger_record.tgnargs = 0
      and pg_catalog.octet_length(trigger_record.tgargs) = 0
      and trigger_record.tgconstraint = 0
      and not trigger_record.tgdeferrable
      and not trigger_record.tginitdeferred
      and function_namespace.nspname = 'app_private'
      and trigger_function.proname = 'insert_department_closure'
      and trigger_function.pronargs = 0
      and trigger_function.prorettype = 'trigger'::pg_catalog.regtype
      and trigger_function.provolatile = 'v'
      and trigger_function.prosecdef
      and trigger_function.proconfig = array['search_path=""']::text[]
      and function_owner.rolname = 'neondb_owner'
      and function_owner.rolbypassrls
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_LEGACY_TRIGGER_POST_ASSERTION_FAILED';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace namespace
    on namespace.oid = routine.pronamespace
  join pg_catalog.pg_roles owner_role
    on owner_role.oid = routine.proowner
  where routine.oid = any (array[
      pg_catalog.to_regprocedure(
        'app_private.reject_organization_read_audit_mutation()'
      ),
      pg_catalog.to_regprocedure(
        'app_private.assert_neon_organization_runtime_session()'
      ),
      pg_catalog.to_regprocedure(
        'app_private.neon_organization_actor_is_active()'
      ),
      pg_catalog.to_regprocedure(
        'app_private.neon_organization_actor_has_role(text)'
      ),
      pg_catalog.to_regprocedure(
        'app_private.neon_organization_actor_has_department_scope(uuid)'
      ),
      pg_catalog.to_regprocedure(
        'app_private.neon_organization_actor_can_read_department(uuid)'
      ),
      pg_catalog.to_regprocedure(
        'app_private.neon_organization_hostname_matches(text)'
      ),
      pg_catalog.to_regprocedure(
        'app_private.assert_neon_organization_hostname(text)'
      ),
      pg_catalog.to_regprocedure(
        'app_private.assert_neon_organization_reader()'
      ),
      pg_catalog.to_regprocedure(
        'app_private.append_neon_organization_read_audit(text,integer)'
      )
    ]::oid[])
    and namespace.nspname = 'app_private'
    and owner_role.rolname = 'hotel_ld_migration_owner'
    and not routine.prosecdef
    and routine.proconfig = array['search_path=""']::text[];

  if v_count <> 10 or exists (
    select 1
    from pg_catalog.unnest(array[
      'app_private.reject_organization_read_audit_mutation()',
      'app_private.assert_neon_organization_runtime_session()',
      'app_private.neon_organization_actor_is_active()',
      'app_private.neon_organization_actor_has_role(text)',
      'app_private.neon_organization_actor_has_department_scope(uuid)',
      'app_private.neon_organization_actor_can_read_department(uuid)',
      'app_private.neon_organization_hostname_matches(text)',
      'app_private.assert_neon_organization_hostname(text)',
      'app_private.assert_neon_organization_reader()',
      'app_private.append_neon_organization_read_audit(text,integer)'
    ]) signature(value)
    cross join pg_catalog.unnest(array[
      'authenticated', 'hotel_ld_people_read',
      'hotel_ld_application', 'hotel_ld_readonly'
    ]) forbidden_role(value)
    where pg_catalog.has_function_privilege(
      forbidden_role.value, signature.value, 'EXECUTE'
    )
  ) or exists (
    select 1
    from pg_catalog.pg_proc routine
    cross join lateral pg_catalog.aclexplode(routine.proacl) acl
    where routine.oid = any (array[
      pg_catalog.to_regprocedure(
        'app_private.reject_organization_read_audit_mutation()'
      ),
      pg_catalog.to_regprocedure(
        'app_private.assert_neon_organization_runtime_session()'
      ),
      pg_catalog.to_regprocedure(
        'app_private.neon_organization_actor_is_active()'
      ),
      pg_catalog.to_regprocedure(
        'app_private.neon_organization_actor_has_role(text)'
      ),
      pg_catalog.to_regprocedure(
        'app_private.neon_organization_actor_has_department_scope(uuid)'
      ),
      pg_catalog.to_regprocedure(
        'app_private.neon_organization_actor_can_read_department(uuid)'
      ),
      pg_catalog.to_regprocedure(
        'app_private.neon_organization_hostname_matches(text)'
      ),
      pg_catalog.to_regprocedure(
        'app_private.assert_neon_organization_hostname(text)'
      ),
      pg_catalog.to_regprocedure(
        'app_private.assert_neon_organization_reader()'
      ),
      pg_catalog.to_regprocedure(
        'app_private.append_neon_organization_read_audit(text,integer)'
      )
    ]::oid[])
      and acl.privilege_type = 'EXECUTE'
      and acl.grantee <>
        pg_catalog.to_regrole('hotel_ld_migration_owner')::oid
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_PRIVATE_HELPER_ASSERTION_FAILED';
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
      and audit_table.relname = 'organization_read_audit_events'
      and owner_role.rolname = 'hotel_ld_migration_owner'
      and audit_trigger.tgname = 'organization_read_audit_append_only'
      and audit_trigger.tgenabled = 'O'
      and not audit_trigger.tgisinternal
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_AUDIT_TRIGGER_ASSERTION_FAILED';
  end if;

  select count(*)
    into v_runtime_memberships
  from pg_catalog.pg_auth_members membership
  join pg_catalog.pg_roles member_role
    on member_role.oid = membership.member
  where member_role.rolname = 'hotel_ld_application';

  if v_runtime_memberships <> 1 or not exists (
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
  ) or pg_catalog.pg_has_role(
    'hotel_ld_application', 'neon_superuser', 'MEMBER'
  ) or pg_catalog.pg_has_role(
    'hotel_ld_application', 'neondb_owner', 'MEMBER'
  ) or pg_catalog.pg_has_role(
    'hotel_ld_application', 'hotel_ld_migration_owner', 'MEMBER'
  ) or pg_catalog.pg_has_role(
    'hotel_ld_application', 'authenticated', 'MEMBER'
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_RUNTIME_TOPOLOGY_ASSERTION_FAILED';
  end if;

  if has_table_privilege(
    'hotel_ld_application', 'public.departments', 'SELECT'
  ) then
    raise exception using errcode='42501',
      message='E3_PHASE1_RUNTIME_RAW_PRIVILEGE_DRIFT';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(array[
      'public.departments', 'public.department_closure'
    ]) relation(value)
    cross join pg_catalog.unnest(array[
      'hotel_ld_application', 'hotel_ld_people_read'
    ]) runtime_role(value)
    where pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'INSERT'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'UPDATE'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'DELETE'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'TRUNCATE'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'REFERENCES'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'TRIGGER'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'MAINTAIN'
    ) or pg_catalog.has_any_column_privilege(
      runtime_role.value, relation.value, 'INSERT'
    ) or pg_catalog.has_any_column_privilege(
      runtime_role.value, relation.value, 'UPDATE'
    ) or pg_catalog.has_any_column_privilege(
      runtime_role.value, relation.value, 'REFERENCES'
    )
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_RUNTIME_DEPARTMENT_DML_DRIFT';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(array[
      'public.profiles', 'public.tenants', 'public.properties',
      'public.property_domains', 'public.tenant_memberships',
      'public.property_memberships', 'public.roles',
      'public.role_assignments', 'public.trainer_scopes',
      'public.user_accounts', 'public.departments',
      'public.department_closure', 'public.department_aliases',
      'public.operational_units', 'public.operational_unit_aliases',
      'public.position_families', 'public.positions',
      'public.employees', 'public.employee_external_identifiers'
    ]) relation(value)
    cross join pg_catalog.unnest(array[
      'hotel_ld_application', 'hotel_ld_people_read'
    ]) runtime_role(value)
    where pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'SELECT'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'INSERT'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'UPDATE'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'DELETE'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'TRUNCATE'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'REFERENCES'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'TRIGGER'
    ) or pg_catalog.has_table_privilege(
      runtime_role.value, relation.value, 'MAINTAIN'
    ) or pg_catalog.has_any_column_privilege(
      runtime_role.value, relation.value, 'SELECT'
    ) or pg_catalog.has_any_column_privilege(
      runtime_role.value, relation.value, 'INSERT'
    ) or pg_catalog.has_any_column_privilege(
      runtime_role.value, relation.value, 'UPDATE'
    ) or pg_catalog.has_any_column_privilege(
      runtime_role.value, relation.value, 'REFERENCES'
    )
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
      'app_private.organization_read_audit_events',
      privilege.value
    )
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_RAW_DATA_GRANT_ASSERTION_FAILED';
  end if;

  with expected(table_name, policy_name) as (
    values
      ('property_domains', 'e2_people_property_domains_authorizer'),
      ('tenants', 'e2_people_tenants_authorizer'),
      ('properties', 'e2_people_properties_authorizer'),
      ('profiles', 'e2_people_profiles_authorizer'),
      ('user_accounts', 'e2_people_user_accounts_authorizer'),
      ('tenant_memberships', 'e2_people_tenant_memberships_authorizer'),
      ('property_memberships',
       'e2_people_property_memberships_authorizer'),
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
    into v_count
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
    ) > 0
    and (
      expected.policy_name not in (
        'e2_people_departments_property',
        'e2_people_department_closure_property'
      )
      or pg_catalog.regexp_replace(
        pg_catalog.lower(
          pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
        ),
        '[()[:space:]]+',
        '',
        'g'
      ) = 'session_user=''hotel_ld_application''::nameandproperty_id=app_private.current_actor_property_id'
    );

  if v_count <> 17 or (
    select count(*)
    from pg_catalog.pg_policy policy
    join pg_catalog.pg_class relation
      on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and policy.polname like 'e2_people_%'
  ) <> 17 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_E2_POLICY_INVENTORY_DRIFT';
  end if;

  select count(*)
    into v_count
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

  if v_count <> 5 or (
    select count(*)
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace
      on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and (
        routine.proname = 'resolve_neon_people_property'
        or routine.proname like 'read_neon_people_%'
      )
  ) <> 5 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_E2_FUNCTION_INVENTORY_DRIFT';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind = 'r'
    and relation.relname = any (array[
      'departments', 'department_closure', 'department_aliases',
      'operational_units', 'operational_unit_aliases'
    ])
    and relation.relrowsecurity
    and relation.relforcerowsecurity;

  if v_count <> 5 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_FORCE_RLS_ASSERTION_FAILED';
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
    raise exception using errcode = '42501',
      message = 'E3_PHASE1_RUNTIME_OBJECT_OWNERSHIP_ASSERTION_FAILED';
  end if;
end
$e3_phase1_postflight$;

commit;
