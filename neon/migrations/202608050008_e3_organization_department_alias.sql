/*
 * E3 Phase 4A / 202608050008 — Department Alias read and resolution boundary
 *
 * Child branch only. `hotel_ld_application` has no raw alias privileges: it
 * receives exact EXECUTE on the two constrained public entry points below.
 * Both functions are actor-scoped and rely on forced RLS as defence in depth.
 */

begin;

do $e3_phase4a_preflight$
begin
  if current_database() <> 'neondb'
     or current_user <> 'neondb_owner'
     or session_user <> 'neondb_owner' then
    raise exception using errcode = '42501',
      message = 'E3_PHASE4A_BOOTSTRAP_IDENTITY_MISMATCH';
  end if;

  if not pg_catalog.pg_has_role(current_user, 'hotel_ld_migration_owner', 'SET') then
    raise exception using errcode = '42501',
      message = 'E3_PHASE4A_MIGRATION_OWNER_SET_ROLE_REQUIRED';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(array[
      'app_private.neon_organization_actor_can_read_aliases()',
      'app_private.neon_organization_actor_can_resolve_aliases()',
      'app_private.reject_organization_alias_audit_mutation()',
      'public.read_neon_organization_department_aliases(text)',
      'public.resolve_neon_organization_department_alias(text,uuid,text,uuid)'
    ]) signature(value)
    where pg_catalog.to_regprocedure(signature.value) is not null
  ) or pg_catalog.to_regclass('app_private.organization_alias_resolution_audit_events') is not null then
    raise exception using errcode = '42710',
      message = 'E3_PHASE4A_OBJECT_ALREADY_EXISTS';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
    join pg_catalog.pg_roles owner_role on owner_role.oid = routine.proowner
    where routine.oid = pg_catalog.to_regprocedure(
      'public.move_neon_organization_department(text,uuid,uuid,bigint)'
    )
      and owner_role.rolname = 'hotel_ld_migration_owner'
      and routine.prosecdef
      and routine.proconfig = array['search_path=""']::text[]
  ) or (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('departments', 'department_aliases')
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) <> 2 or exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'hotel_ld_application' and rolbypassrls
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE4A_BASELINE_DRIFT';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relname = 'department_aliases'
      and pg_catalog.has_table_privilege(
        'hotel_ld_application', relation.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      )
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE4A_RAW_ALIAS_PRIVILEGE_DRIFT';
  end if;
end
$e3_phase4a_preflight$;

/* The definer owner receives only the columns it needs. FORCE RLS still
 * applies because it is not the table owner and is NOBYPASSRLS. */
grant select (
  id, tenant_id, property_id, source_system, source_sheet, source_value,
  normalized_source_value, source_row_count, target_department_id,
  resolution_type, approved_by, approved_at, is_active, created_at
) on public.department_aliases to hotel_ld_migration_owner;
grant update (
  target_department_id, resolution_type, approved_by, approved_at, is_active
) on public.department_aliases to hotel_ld_migration_owner;
grant select (id, tenant_id, property_id, name_zh, is_active)
  on public.departments to hotel_ld_migration_owner;

set local role hotel_ld_migration_owner;

create function app_private.neon_organization_actor_can_read_aliases()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select session_user = 'hotel_ld_application'
    and app_private.neon_organization_actor_is_active()
    and (
      app_private.neon_organization_actor_has_role('property_ld_manager')
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
        where account.auth_user_id = app_private.current_actor_auth_user_id()
          and account.property_id = app_private.current_actor_property_id()
          and account.account_status::text = 'active'
      )
    );
$function$;

create function app_private.neon_organization_actor_can_resolve_aliases()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select session_user = 'hotel_ld_application'
    and app_private.neon_organization_actor_is_active()
    and app_private.neon_organization_actor_has_role('property_ld_manager');
$function$;

create table app_private.organization_alias_resolution_audit_events (
  id bigint generated always as identity primary key,
  request_id text not null,
  auth_user_id uuid not null,
  actor_user_id uuid not null,
  tenant_id uuid not null,
  property_id uuid not null,
  alias_id uuid not null,
  action text not null check (action in ('department', 'ignore', 'defer')),
  previous_resolution_type public.department_resolution_type not null,
  result_resolution_type public.department_resolution_type not null,
  previous_target_department_id uuid,
  result_target_department_id uuid,
  occurred_at timestamptz not null default pg_catalog.now(),
  constraint organization_alias_resolution_audit_result_check check (
    (action = 'department'
      and result_resolution_type = 'mapped'
      and result_target_department_id is not null)
    or (action = 'ignore'
      and result_resolution_type = 'ignored'
      and result_target_department_id is null)
    or (action = 'defer'
      and result_resolution_type = 'deferred'
      and result_target_department_id is null)
  )
);

alter table app_private.organization_alias_resolution_audit_events enable row level security;
alter table app_private.organization_alias_resolution_audit_events force row level security;

create function app_private.reject_organization_alias_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using errcode = '42501',
    message = 'NEON_ORGANIZATION_ALIAS_AUDIT_APPEND_ONLY';
end
$function$;

create trigger organization_alias_resolution_audit_append_only
before update or delete on app_private.organization_alias_resolution_audit_events
for each row execute function app_private.reject_organization_alias_audit_mutation();

reset role;

create policy e3_phase4a_department_aliases_read
on public.department_aliases
for select to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_can_read_aliases()
);

create policy e3_phase4a_department_aliases_update
on public.department_aliases
for update to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_can_resolve_aliases()
)
with check (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_can_resolve_aliases()
);

create policy e3_phase4a_departments_target_read
on public.departments
for select to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_can_resolve_aliases()
);

create policy e3_phase4a_organization_alias_audit_insert
on app_private.organization_alias_resolution_audit_events
for insert to hotel_ld_migration_owner
with check (
  session_user = 'hotel_ld_application'
  and auth_user_id = app_private.current_actor_auth_user_id()
  and actor_user_id = app_private.current_neon_organization_actor_user_id()
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_can_resolve_aliases()
);

grant insert (
  request_id, auth_user_id, actor_user_id, tenant_id, property_id, alias_id,
  action, previous_resolution_type, result_resolution_type,
  previous_target_department_id, result_target_department_id
) on app_private.organization_alias_resolution_audit_events
  to hotel_ld_migration_owner;

set local role hotel_ld_migration_owner;

create function app_private.neon_organization_department_alias_payload(
  p_alias_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', alias_row.id,
    'property_id', alias_row.property_id,
    'source_system', alias_row.source_system,
    'source_sheet', coalesce(alias_row.source_sheet, '历史批准来源'),
    'source_value', alias_row.source_value,
    'normalized_source_value', alias_row.normalized_source_value,
    'source_row_count', alias_row.source_row_count,
    'suggested_target_id', alias_row.target_department_id,
    'suggestion_label', case
      when alias_row.target_department_id is not null then '复用已批准映射'
      else '等待选择正式部门'
    end,
    'confidence', case when alias_row.approved_at is null then 0 else 100 end,
    'suggestion_reason', case
      when alias_row.approved_at is null then '尚未建立批准规则'
      else '来自已确认的历史映射'
    end,
    'target_department_id', alias_row.target_department_id,
    'resolution_type', alias_row.resolution_type::text,
    'is_active', alias_row.is_active
  )
  from public.department_aliases alias_row
  where alias_row.id = p_alias_id
    and alias_row.property_id = app_private.current_actor_property_id();
$function$;

create function public.read_neon_organization_department_aliases(
  p_hostname text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_payload jsonb;
begin
  perform app_private.assert_neon_runtime_session();
  perform app_private.assert_actor_context();
  perform app_private.assert_neon_organization_hostname(p_hostname);
  perform app_private.assert_neon_organization_reader();
  if not app_private.neon_organization_actor_can_read_aliases() then
    raise exception using errcode = '42501',
      message = 'NEON_ORGANIZATION_READER_FORBIDDEN';
  end if;

  select jsonb_build_object(
    'rows', coalesce(jsonb_agg(
      app_private.neon_organization_department_alias_payload(alias_row.id)
      order by alias_row.created_at, alias_row.id
    ), '[]'::jsonb)
  ) into v_payload
  from public.department_aliases alias_row
  where alias_row.property_id = app_private.current_actor_property_id();

  return v_payload;
end
$function$;

create function public.resolve_neon_organization_department_alias(
  p_hostname text,
  p_alias_id uuid,
  p_action text,
  p_target_department_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_alias public.department_aliases%rowtype;
  v_target public.departments%rowtype;
  v_result_resolution public.department_resolution_type;
  v_result_target uuid;
  v_previous_resolution public.department_resolution_type;
  v_previous_target uuid;
  v_payload jsonb;
begin
  perform app_private.assert_neon_runtime_session();
  perform app_private.assert_actor_context();
  perform app_private.assert_neon_organization_hostname(p_hostname);
  perform app_private.assert_neon_organization_manager();
  if not app_private.neon_organization_actor_can_resolve_aliases() then
    raise exception using errcode = '42501',
      message = 'NEON_ORGANIZATION_MANAGER_FORBIDDEN';
  end if;

  if p_action = 'department' and p_target_department_id is not null then
    v_result_resolution := 'mapped';
    v_result_target := p_target_department_id;
  elsif p_action = 'ignore' and p_target_department_id is null then
    v_result_resolution := 'ignored';
    v_result_target := null;
  elsif p_action = 'defer' and p_target_department_id is null then
    v_result_resolution := 'deferred';
    v_result_target := null;
  else
    raise exception using errcode = 'P2006',
      message = 'NEON_ORGANIZATION_ALIAS_ACTION_INVALID';
  end if;

  select * into v_alias
  from public.department_aliases
  where id = p_alias_id
    and property_id = app_private.current_actor_property_id()
  for update;
  if not found then
    raise exception using errcode = 'P2000',
      message = 'NEON_ORGANIZATION_ALIAS_NOT_FOUND';
  end if;

  if v_result_target is not null then
    select * into v_target
    from public.departments
    where id = v_result_target
      and tenant_id = v_alias.tenant_id
      and property_id = v_alias.property_id
      and is_active
    for key share;
    if not found then
      raise exception using errcode = 'P2006',
        message = 'NEON_ORGANIZATION_ALIAS_TARGET_INVALID';
    end if;
  end if;

  v_previous_resolution := v_alias.resolution_type;
  v_previous_target := v_alias.target_department_id;

  update public.department_aliases
  set target_department_id = v_result_target,
      resolution_type = v_result_resolution,
      approved_by = case when v_result_resolution = 'deferred' then null
                         else app_private.current_actor_auth_user_id() end,
      approved_at = case when v_result_resolution = 'deferred' then null
                         else pg_catalog.transaction_timestamp() end,
      is_active = true
  where id = v_alias.id
  returning * into v_alias;

  insert into app_private.organization_alias_resolution_audit_events (
    request_id, auth_user_id, actor_user_id, tenant_id, property_id, alias_id,
    action, previous_resolution_type, result_resolution_type,
    previous_target_department_id, result_target_department_id
  ) values (
    app_private.current_actor_request_id(),
    app_private.current_actor_auth_user_id(),
    app_private.current_neon_organization_actor_user_id(),
    v_alias.tenant_id, v_alias.property_id, v_alias.id, p_action,
    v_previous_resolution, v_result_resolution,
    v_previous_target, v_result_target
  );

  v_payload := app_private.neon_organization_department_alias_payload(v_alias.id);
  if v_payload is null then
    raise exception using errcode = 'P2000',
      message = 'NEON_ORGANIZATION_ALIAS_NOT_FOUND';
  end if;
  return v_payload;
end
$function$;

revoke all on function
  app_private.neon_organization_actor_can_read_aliases(),
  app_private.neon_organization_actor_can_resolve_aliases(),
  app_private.neon_organization_department_alias_payload(uuid),
  app_private.reject_organization_alias_audit_mutation(),
  public.read_neon_organization_department_aliases(text),
  public.resolve_neon_organization_department_alias(text,uuid,text,uuid)
from public, authenticated, neondb_owner, hotel_ld_people_read,
     hotel_ld_application, hotel_ld_readonly;

grant execute on function
  public.read_neon_organization_department_aliases(text),
  public.resolve_neon_organization_department_alias(text,uuid,text,uuid)
to hotel_ld_application;

revoke all on table app_private.organization_alias_resolution_audit_events
  from public, authenticated, neondb_owner, hotel_ld_people_read,
       hotel_ld_application, hotel_ld_readonly;

reset role;

do $e3_phase4a_postflight$
declare
  v_function_count integer;
begin
  select count(*) into v_function_count
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid = routine.proowner
  where routine.oid = any (array[
    pg_catalog.to_regprocedure('public.read_neon_organization_department_aliases(text)'),
    pg_catalog.to_regprocedure('public.resolve_neon_organization_department_alias(text,uuid,text,uuid)')
  ]::regprocedure[])
    and owner_role.rolname = 'hotel_ld_migration_owner'
    and routine.prosecdef
    and routine.proconfig = array['search_path=""']::text[]
    and not pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
    and pg_catalog.has_function_privilege(
      'hotel_ld_application', routine.oid, 'EXECUTE'
    );
  if v_function_count <> 2 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE4A_ENTRYPOINT_ACL_DRIFT';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where (namespace.nspname, relation.relname) in (
      ('public', 'department_aliases'),
      ('app_private', 'organization_alias_resolution_audit_events')
    ) and (not relation.relrowsecurity or not relation.relforcerowsecurity)
  ) or exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where (namespace.nspname, relation.relname) = ('public', 'department_aliases')
      and pg_catalog.has_table_privilege(
        'hotel_ld_application', relation.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      )
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    join pg_catalog.pg_class relation on relation.oid = trigger_record.tgrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_private'
      and relation.relname = 'organization_alias_resolution_audit_events'
      and trigger_record.tgname = 'organization_alias_resolution_audit_append_only'
      and not trigger_record.tgisinternal
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE4A_RLS_OR_AUDIT_DRIFT';
  end if;
end
$e3_phase4a_postflight$;

commit;
