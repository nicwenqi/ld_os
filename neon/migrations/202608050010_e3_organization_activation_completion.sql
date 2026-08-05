/* E3 Activation Completion — child-only Organization contract parity. */
begin;

do $preflight$
begin
  if current_database() <> 'neondb'
     or current_user <> 'neondb_owner'
     or session_user <> 'neondb_owner' then
    raise exception using errcode = '42501',
      message = 'E3_ACTIVATION_BOOTSTRAP_IDENTITY_MISMATCH';
  end if;
  if not pg_catalog.pg_has_role(
    current_user, 'hotel_ld_migration_owner', 'SET'
  ) then
    raise exception using errcode = '42501',
      message = 'E3_ACTIVATION_MIGRATION_OWNER_SET_ROLE_REQUIRED';
  end if;
  if pg_catalog.to_regprocedure(
       'public.resolve_neon_organization_department_alias(text,uuid,text,uuid)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.create_neon_organization_department(text,uuid,uuid,uuid,text,text,text,text,integer)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.read_neon_organization_operational_units(text)'
     ) is null then
    raise exception using errcode = '42501',
      message = 'E3_ACTIVATION_BASELINE_MISSING';
  end if;
  if exists (
    select 1
    from pg_catalog.unnest(array[
      'app_private.append_neon_organization_alias_activation_audit(text,uuid,uuid,uuid,public.department_resolution_type,uuid,uuid)',
      'app_private.reject_organization_alias_activation_audit_mutation()',
      'public.merge_neon_organization_department_alias(text,uuid,uuid)',
      'public.resolve_neon_organization_department_alias_to_operational_unit(text,uuid,uuid)',
      'public.create_neon_organization_department_from_alias(text,uuid,text,uuid,text,text,text,text,integer)'
    ]) signature(value)
    where pg_catalog.to_regprocedure(signature.value) is not null
  ) or pg_catalog.to_regclass(
    'app_private.organization_alias_activation_audit_events'
  ) is not null then
    raise exception using errcode = '42710',
      message = 'E3_ACTIVATION_OBJECT_ALREADY_EXISTS';
  end if;
  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'hotel_ld_application' and rolbypassrls
  ) or exists (
    select 1
    from pg_catalog.unnest(array[
      'public.departments', 'public.department_aliases',
      'public.operational_units', 'public.operational_unit_aliases'
    ]) relation(value)
    where pg_catalog.has_table_privilege(
      'hotel_ld_application', relation.value,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  ) then
    raise exception using errcode = '42501',
      message = 'E3_ACTIVATION_RUNTIME_TOPOLOGY_DRIFT';
  end if;
  if (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'departments', 'department_aliases',
        'operational_units', 'operational_unit_aliases'
      )
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) <> 4 then
    raise exception using errcode = '42501',
      message = 'E3_ACTIVATION_FORCE_RLS_DRIFT';
  end if;
end
$preflight$;

grant insert (
  tenant_id, property_id, source_system, source_value,
  normalized_source_value, operational_unit_id,
  approved_by, approved_at, is_active
) on public.operational_unit_aliases to hotel_ld_migration_owner;

set local role hotel_ld_migration_owner;

create table app_private.organization_alias_activation_audit_events (
  id bigint generated always as identity primary key,
  request_id text not null,
  auth_user_id uuid not null,
  actor_user_id uuid not null,
  tenant_id uuid not null,
  property_id uuid not null,
  alias_id uuid not null,
  action text not null check (
    action in (
      'merge', 'operational_unit', 'created_top_level', 'created_child'
    )
  ),
  previous_resolution_type public.department_resolution_type not null,
  previous_target_department_id uuid,
  result_target_department_id uuid,
  result_operational_unit_id uuid,
  occurred_at timestamptz not null
    default pg_catalog.transaction_timestamp(),
  constraint organization_alias_activation_target_check check (
    (
      action in ('merge', 'created_top_level', 'created_child')
      and result_target_department_id is not null
      and result_operational_unit_id is null
    ) or (
      action = 'operational_unit'
      and result_target_department_id is null
      and result_operational_unit_id is not null
    )
  )
);

alter table app_private.organization_alias_activation_audit_events
  enable row level security;
alter table app_private.organization_alias_activation_audit_events
  force row level security;

create function app_private.reject_organization_alias_activation_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using errcode = '42501',
    message = 'NEON_ORGANIZATION_ALIAS_ACTIVATION_AUDIT_APPEND_ONLY';
end
$function$;

create trigger organization_alias_activation_audit_append_only
before update or delete
on app_private.organization_alias_activation_audit_events
for each row execute function
  app_private.reject_organization_alias_activation_audit_mutation();

reset role;

create policy e3_activation_operational_unit_alias_insert
on public.operational_unit_aliases
for insert to hotel_ld_migration_owner
with check (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_can_resolve_aliases()
);

create policy e3_activation_alias_audit_insert
on app_private.organization_alias_activation_audit_events
for insert to hotel_ld_migration_owner
with check (
  session_user = 'hotel_ld_application'
  and auth_user_id = app_private.current_actor_auth_user_id()
  and actor_user_id = app_private.current_neon_organization_actor_user_id()
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_can_resolve_aliases()
);

grant insert (
  request_id, auth_user_id, actor_user_id, tenant_id, property_id,
  alias_id, action, previous_resolution_type,
  previous_target_department_id, result_target_department_id,
  result_operational_unit_id
) on app_private.organization_alias_activation_audit_events
to hotel_ld_migration_owner;

set local role hotel_ld_migration_owner;

create function app_private.append_neon_organization_alias_activation_audit(
  p_action text,
  p_alias_id uuid,
  p_tenant_id uuid,
  p_property_id uuid,
  p_previous_resolution public.department_resolution_type,
  p_previous_target_department_id uuid,
  p_result_target_id uuid
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  perform app_private.assert_neon_organization_manager();
  if p_property_id <> app_private.current_actor_property_id()
     or p_action not in (
       'merge', 'operational_unit', 'created_top_level', 'created_child'
     ) then
    raise exception using errcode = '42501',
      message = 'NEON_ORGANIZATION_PROPERTY_FORBIDDEN';
  end if;

  insert into app_private.organization_alias_activation_audit_events (
    request_id, auth_user_id, actor_user_id, tenant_id, property_id,
    alias_id, action, previous_resolution_type,
    previous_target_department_id, result_target_department_id,
    result_operational_unit_id
  ) values (
    app_private.current_actor_request_id(),
    app_private.current_actor_auth_user_id(),
    app_private.current_neon_organization_actor_user_id(),
    p_tenant_id, p_property_id, p_alias_id, p_action,
    p_previous_resolution, p_previous_target_department_id,
    case when p_action = 'operational_unit' then null else p_result_target_id end,
    case when p_action = 'operational_unit' then p_result_target_id else null end
  );
end
$function$;

create function public.merge_neon_organization_department_alias(
  p_hostname text,
  p_alias_id uuid,
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
  v_previous_resolution public.department_resolution_type;
  v_previous_target uuid;
begin
  perform app_private.assert_neon_runtime_session();
  perform app_private.assert_actor_context();
  perform app_private.assert_neon_organization_hostname(p_hostname);
  perform app_private.assert_neon_organization_manager();
  if not app_private.neon_organization_actor_can_resolve_aliases() then
    raise exception using errcode = '42501',
      message = 'NEON_ORGANIZATION_MANAGER_FORBIDDEN';
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

  select * into v_target
  from public.departments
  where id = p_target_department_id
    and tenant_id = v_alias.tenant_id
    and property_id = v_alias.property_id
    and is_active
  for key share;
  if not found then
    raise exception using errcode = 'P2006',
      message = 'NEON_ORGANIZATION_ALIAS_TARGET_INVALID';
  end if;

  v_previous_resolution := v_alias.resolution_type;
  v_previous_target := v_alias.target_department_id;

  update public.department_aliases
  set target_department_id = v_target.id,
      resolution_type = 'merged',
      approved_by = app_private.current_actor_auth_user_id(),
      approved_at = pg_catalog.transaction_timestamp(),
      is_active = true
  where id = v_alias.id
  returning * into v_alias;

  perform app_private.append_neon_organization_alias_activation_audit(
    'merge', v_alias.id, v_alias.tenant_id, v_alias.property_id,
    v_previous_resolution, v_previous_target, v_target.id
  );
  return app_private.neon_organization_department_alias_payload(v_alias.id);
end
$function$;

create function public.resolve_neon_organization_department_alias_to_operational_unit(
  p_hostname text,
  p_alias_id uuid,
  p_operational_unit_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_alias public.department_aliases%rowtype;
  v_unit public.operational_units%rowtype;
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

  select * into v_alias
  from public.department_aliases
  where id = p_alias_id
    and property_id = app_private.current_actor_property_id()
  for update;
  if not found then
    raise exception using errcode = 'P2000',
      message = 'NEON_ORGANIZATION_ALIAS_NOT_FOUND';
  end if;

  select * into v_unit
  from public.operational_units
  where id = p_operational_unit_id
    and tenant_id = v_alias.tenant_id
    and property_id = v_alias.property_id
    and is_active
  for key share;
  if not found then
    raise exception using errcode = 'P2006',
      message = 'NEON_ORGANIZATION_OPERATIONAL_UNIT_TARGET_INVALID';
  end if;

  v_previous_resolution := v_alias.resolution_type;
  v_previous_target := v_alias.target_department_id;

  insert into public.operational_unit_aliases (
    tenant_id, property_id, source_system, source_value,
    normalized_source_value, operational_unit_id,
    approved_by, approved_at, is_active
  ) values (
    v_alias.tenant_id, v_alias.property_id, v_alias.source_system,
    v_alias.source_value, v_alias.normalized_source_value, v_unit.id,
    app_private.current_actor_auth_user_id(),
    pg_catalog.transaction_timestamp(), true
  );

  update public.department_aliases
  set target_department_id = null,
      approved_by = app_private.current_actor_auth_user_id(),
      approved_at = pg_catalog.transaction_timestamp(),
      is_active = false
  where id = v_alias.id
  returning * into v_alias;

  perform app_private.append_neon_organization_alias_activation_audit(
    'operational_unit', v_alias.id, v_alias.tenant_id, v_alias.property_id,
    v_previous_resolution, v_previous_target, v_unit.id
  );

  v_payload := app_private.neon_organization_department_alias_payload(v_alias.id);
  return v_payload || pg_catalog.jsonb_build_object(
    'target_department_id', null,
    'operational_unit_id', v_unit.id,
    'resolution_type', 'mapped',
    'is_active', false
  );
end
$function$;

create function public.create_neon_organization_department_from_alias(
  p_hostname text,
  p_alias_id uuid,
  p_resolution_type text,
  p_parent_id uuid,
  p_node_type text,
  p_code text,
  p_name_zh text,
  p_name_en text,
  p_sort_order integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_alias public.department_aliases%rowtype;
  v_parent public.departments%rowtype;
  v_created jsonb;
  v_created_id uuid;
  v_previous_resolution public.department_resolution_type;
  v_previous_target uuid;
begin
  perform app_private.assert_neon_runtime_session();
  perform app_private.assert_actor_context();
  perform app_private.assert_neon_organization_hostname(p_hostname);
  perform app_private.assert_neon_organization_manager();
  if not app_private.neon_organization_actor_can_resolve_aliases() then
    raise exception using errcode = '42501',
      message = 'NEON_ORGANIZATION_MANAGER_FORBIDDEN';
  end if;
  if not (
    (p_resolution_type = 'created_top_level' and p_parent_id is null)
    or (p_resolution_type = 'created_child' and p_parent_id is not null)
  ) then
    raise exception using errcode = 'P2006',
      message = 'NEON_ORGANIZATION_ALIAS_CREATED_SHAPE_INVALID';
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

  if p_parent_id is not null then
    select * into v_parent
    from public.departments
    where id = p_parent_id
      and tenant_id = v_alias.tenant_id
      and property_id = v_alias.property_id
      and is_active
    for key share;
    if not found then
      raise exception using errcode = 'P2006',
        message = 'NEON_ORGANIZATION_ALIAS_PARENT_INVALID';
    end if;
  end if;

  v_previous_resolution := v_alias.resolution_type;
  v_previous_target := v_alias.target_department_id;

  v_created := public.create_neon_organization_department(
    p_hostname, v_alias.tenant_id, v_alias.property_id, p_parent_id,
    p_node_type, p_code, p_name_zh, p_name_en, p_sort_order
  );
  v_created_id := (v_created ->> 'id')::uuid;
  if v_created_id is null then
    raise exception using errcode = 'P2006',
      message = 'NEON_ORGANIZATION_DEPARTMENT_CREATE_INVALID';
  end if;

  update public.department_aliases
  set target_department_id = v_created_id,
      resolution_type = p_resolution_type::public.department_resolution_type,
      approved_by = app_private.current_actor_auth_user_id(),
      approved_at = pg_catalog.transaction_timestamp(),
      is_active = true
  where id = v_alias.id
  returning * into v_alias;

  perform app_private.append_neon_organization_alias_activation_audit(
    p_resolution_type, v_alias.id, v_alias.tenant_id, v_alias.property_id,
    v_previous_resolution, v_previous_target, v_created_id
  );
  return app_private.neon_organization_department_alias_payload(v_alias.id);
end
$function$;

revoke all on function
  app_private.append_neon_organization_alias_activation_audit(
    text,uuid,uuid,uuid,public.department_resolution_type,uuid,uuid
  ),
  app_private.reject_organization_alias_activation_audit_mutation(),
  public.merge_neon_organization_department_alias(text,uuid,uuid),
  public.resolve_neon_organization_department_alias_to_operational_unit(
    text,uuid,uuid
  ),
  public.create_neon_organization_department_from_alias(
    text,uuid,text,uuid,text,text,text,text,integer
  )
from public, authenticated, neondb_owner, hotel_ld_people_read,
     hotel_ld_application, hotel_ld_readonly;

grant execute on function
  public.merge_neon_organization_department_alias(text,uuid,uuid),
  public.resolve_neon_organization_department_alias_to_operational_unit(
    text,uuid,uuid
  ),
  public.create_neon_organization_department_from_alias(
    text,uuid,text,uuid,text,text,text,text,integer
  )
to hotel_ld_application;

revoke all on table
  app_private.organization_alias_activation_audit_events
from public, authenticated, neondb_owner, hotel_ld_people_read,
     hotel_ld_application, hotel_ld_readonly;

reset role;

do $postflight$
declare
  v_function_count integer;
begin
  select count(*) into v_function_count
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_roles owner_role on owner_role.oid = routine.proowner
  where routine.oid = any (array[
    pg_catalog.to_regprocedure(
      'public.merge_neon_organization_department_alias(text,uuid,uuid)'
    ),
    pg_catalog.to_regprocedure(
      'public.resolve_neon_organization_department_alias_to_operational_unit(text,uuid,uuid)'
    ),
    pg_catalog.to_regprocedure(
      'public.create_neon_organization_department_from_alias(text,uuid,text,uuid,text,text,text,text,integer)'
    )
  ]::regprocedure[])
    and owner_role.rolname = 'hotel_ld_migration_owner'
    and routine.prosecdef
    and routine.proconfig = array['search_path=""']::text[]
    and not pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
    and pg_catalog.has_function_privilege(
      'hotel_ld_application', routine.oid, 'EXECUTE'
    );
  if v_function_count <> 3 then
    raise exception using errcode = '42501',
      message = 'E3_ACTIVATION_ENTRYPOINT_ACL_DRIFT';
  end if;

  if not (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation
    where relation.oid =
      'app_private.organization_alias_activation_audit_events'::regclass
  ) or exists (
    select 1
    from pg_catalog.unnest(array[
      'public.departments', 'public.department_aliases',
      'public.operational_units', 'public.operational_unit_aliases',
      'app_private.organization_alias_activation_audit_events'
    ]) relation(value)
    where pg_catalog.has_table_privilege(
      'hotel_ld_application', relation.value,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  ) or exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'hotel_ld_application'
      and (rolbypassrls or rolsuper)
  ) then
    raise exception using errcode = '42501',
      message = 'E3_ACTIVATION_RUNTIME_OR_RLS_DRIFT';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
      'app_private.organization_alias_activation_audit_events'::regclass
      and trigger_record.tgname =
        'organization_alias_activation_audit_append_only'
      and not trigger_record.tgisinternal
  ) then
    raise exception using errcode = '42501',
      message = 'E3_ACTIVATION_AUDIT_TRIGGER_MISSING';
  end if;
end
$postflight$;

commit;
