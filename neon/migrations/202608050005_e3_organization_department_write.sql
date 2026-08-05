/*
 * E3 Phase 2A / 202608050005 — Organization Department write boundary
 *
 * Apply only with the direct child bootstrap credential after E3 Phase 1.
 * Runtime remains function-only. This migration adds Department create and
 * version-checked detail/active-state update, but no move, closure rewrite,
 * aliases, operational units, Position, Import, or Employee write.
 */

begin;

do $e3_phase2a_preflight$
declare
  v_count integer;
  v_memberships integer;
begin
  if current_database() <> 'neondb'
     or current_user <> 'neondb_owner'
     or session_user <> 'neondb_owner' then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_BOOTSTRAP_IDENTITY_MISMATCH';
  end if;

  if not pg_catalog.pg_has_role(
    current_user, 'hotel_ld_migration_owner', 'SET'
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_MIGRATION_OWNER_SET_ROLE_REQUIRED';
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
      message = 'E3_PHASE2A_ROLE_BASELINE_DRIFT';
  end if;

  select count(*)
    into v_memberships
  from pg_catalog.pg_auth_members membership
  join pg_catalog.pg_roles member_role
    on member_role.oid = membership.member
  where member_role.rolname = 'hotel_ld_application';

  if v_memberships <> 1 or not exists (
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
    'hotel_ld_application', 'neondb_owner', 'MEMBER'
  ) or pg_catalog.pg_has_role(
    'hotel_ld_application', 'hotel_ld_migration_owner', 'MEMBER'
  ) or pg_catalog.pg_has_role(
    'hotel_ld_application', 'authenticated', 'MEMBER'
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_RUNTIME_TOPOLOGY_DRIFT';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  join pg_catalog.pg_roles owner_role
    on owner_role.oid = relation.relowner
  where namespace.nspname = 'public'
    and relation.relname in (
      'departments', 'department_closure',
      'position_department_assignments'
    )
    and relation.relkind = 'r'
    and relation.relrowsecurity
    and relation.relforcerowsecurity
    and owner_role.rolname = 'neondb_owner';

  if v_count <> 3 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_TABLE_BASELINE_DRIFT';
  end if;

  if pg_catalog.to_regprocedure(
    'app_private.current_actor_auth_user_id()'
  ) is null or pg_catalog.to_regprocedure(
    'app_private.current_actor_property_id()'
  ) is null or pg_catalog.to_regprocedure(
    'app_private.current_actor_request_id()'
  ) is null or pg_catalog.to_regprocedure(
    'app_private.assert_actor_context()'
  ) is null or pg_catalog.to_regprocedure(
    'app_private.assert_neon_organization_runtime_session()'
  ) is null or pg_catalog.to_regprocedure(
    'app_private.neon_organization_actor_has_role(text)'
  ) is null or pg_catalog.to_regprocedure(
    'app_private.assert_neon_organization_hostname(text)'
  ) is null then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_AUTHORIZATION_FOUNDATION_DRIFT';
  end if;

  if pg_catalog.to_regclass(
    'app_private.organization_write_audit_events'
  ) is not null or exists (
    select 1
    from pg_catalog.unnest(array[
      'app_private.reject_organization_write_audit_mutation()',
      'app_private.current_neon_organization_actor_user_id()',
      'app_private.assert_neon_organization_manager()',
      'app_private.neon_organization_department_payload(uuid)',
      'app_private.append_neon_organization_write_audit(text,uuid,bigint,bigint,boolean,boolean,text[])',
      'public.create_neon_organization_department(text,uuid,uuid,uuid,text,text,text,text,integer)',
      'public.update_neon_organization_department(text,uuid,bigint,text,text,integer,boolean)'
    ]) signature(value)
    where pg_catalog.to_regprocedure(signature.value) is not null
  ) then
    raise exception using errcode = '42710',
      message = 'E3_PHASE2A_OBJECT_ALREADY_EXISTS';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    join pg_catalog.pg_class relation
      on relation.oid = trigger_record.tgrelid
    join pg_catalog.pg_namespace relation_namespace
      on relation_namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc trigger_function
      on trigger_function.oid = trigger_record.tgfoid
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = trigger_function.pronamespace
    join pg_catalog.pg_roles function_owner
      on function_owner.oid = trigger_function.proowner
    where relation_namespace.nspname = 'public'
      and relation.relname = 'departments'
      and trigger_record.tgname = 'departments_insert_closure'
      and trigger_record.tgenabled = 'O'
      and not trigger_record.tgisinternal
      and function_namespace.nspname = 'app_private'
      and trigger_function.proname = 'insert_department_closure'
      and trigger_function.prosecdef
      and trigger_function.proconfig = array['search_path=""']::text[]
      and function_owner.rolname = 'neondb_owner'
      and function_owner.rolbypassrls
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    join pg_catalog.pg_class relation
      on relation.oid = trigger_record.tgrelid
    join pg_catalog.pg_namespace relation_namespace
      on relation_namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc trigger_function
      on trigger_function.oid = trigger_record.tgfoid
    where relation_namespace.nspname = 'public'
      and relation.relname = 'departments'
      and trigger_record.tgname = 'departments_prepare_insert'
      and trigger_record.tgenabled = 'O'
      and not trigger_record.tgisinternal
      and trigger_function.proname = 'prepare_department_insert'
      and not trigger_function.prosecdef
      and trigger_function.proconfig = array['search_path=""']::text[]
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_TRIGGER_BASELINE_DRIFT';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc routine
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        routine.proacl,
        pg_catalog.acldefault('f', routine.proowner)
      )
    ) acl
    where routine.oid = pg_catalog.to_regprocedure(
      'app_private.insert_department_closure()'
    )
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) or not exists (
    select 1
    from pg_catalog.pg_proc routine
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        routine.proacl,
        pg_catalog.acldefault('f', routine.proowner)
      )
    ) acl
    where routine.oid = pg_catalog.to_regprocedure(
      'public.create_department(uuid,uuid,uuid,text,text,text,text,integer)'
    )
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) or not exists (
    select 1
    from pg_catalog.pg_proc routine
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        routine.proacl,
        pg_catalog.acldefault('f', routine.proowner)
      )
    ) acl
    where routine.oid = pg_catalog.to_regprocedure(
      'public.update_department_details(uuid,bigint,text,text,integer,boolean)'
    )
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_LEGACY_EXECUTE_BASELINE_DRIFT';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(array[
      'public.departments', 'public.department_closure'
    ]) relation(value)
    where pg_catalog.has_table_privilege(
      'hotel_ld_application', relation.value,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_any_column_privilege(
      'hotel_ld_application', relation.value,
      'SELECT,INSERT,UPDATE,REFERENCES'
    )
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_RUNTIME_RAW_PRIVILEGE_DRIFT';
  end if;
end
$e3_phase2a_preflight$;

/* Remove ambient access to the old owner-definer Neon copies. The retained
 * Supabase fallback is a separate database and is not changed here. */
revoke all on function
  public.create_department(uuid,uuid,uuid,text,text,text,text,integer),
  public.update_department_details(uuid,bigint,text,text,integer,boolean)
from public, authenticated, hotel_ld_people_read,
     hotel_ld_application, hotel_ld_readonly;

revoke all on function
  app_private.prepare_department_insert(),
  app_private.insert_department_closure()
from public, authenticated, hotel_ld_people_read,
     hotel_ld_application, hotel_ld_readonly;

alter function app_private.prepare_department_insert()
  owner to hotel_ld_migration_owner;
alter function app_private.insert_department_closure()
  owner to hotel_ld_migration_owner;

/* Exact column authority for the constrained, NOBYPASSRLS function owner. */
grant insert (
  tenant_id, property_id, parent_id, node_type, code,
  name_zh, name_en, sort_order, created_by, updated_by
) on public.departments to hotel_ld_migration_owner;
grant update (
  name_zh, name_en, sort_order, is_active, updated_by, version
) on public.departments to hotel_ld_migration_owner;
grant insert (
  tenant_id, property_id, ancestor_department_id,
  descendant_department_id, distance
) on public.department_closure to hotel_ld_migration_owner;
grant select (position_id, department_id, property_id)
  on public.position_department_assignments
  to hotel_ld_migration_owner;
grant select (department_id, is_active)
  on public.operational_units to hotel_ld_migration_owner;
grant usage on type public.department_node_type
  to hotel_ld_migration_owner;

set local role hotel_ld_migration_owner;

create or replace function app_private.prepare_department_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_parent_tenant_id uuid;
  v_parent_property_id uuid;
  v_parent_depth integer;
  v_parent_path_ids uuid[];
begin
  if tg_op <> 'INSERT'
     or tg_table_schema <> 'public'
     or tg_table_name <> 'departments'
     or pg_catalog.pg_trigger_depth() <> 1 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_DEPARTMENT_PREPARE_TRIGGER_REQUIRED';
  end if;

  perform app_private.assert_neon_organization_runtime_session();
  perform app_private.assert_actor_context();
  if not app_private.neon_organization_actor_has_role(
    'property_ld_manager'
  ) then
    raise exception using errcode = '42501',
      message = 'NEON_ORGANIZATION_MANAGER_FORBIDDEN';
  end if;
  if new.property_id <> app_private.current_actor_property_id() then
    raise exception using errcode = '42501',
      message = 'NEON_ORGANIZATION_PROPERTY_FORBIDDEN';
  end if;

  if new.parent_id is null then
    new.depth := 0;
    new.path_ids := array[new.id];
  else
    select parent.tenant_id,
           parent.property_id,
           parent.depth,
           parent.path_ids
      into v_parent_tenant_id,
           v_parent_property_id,
           v_parent_depth,
           v_parent_path_ids
    from public.departments parent
    where parent.id = new.parent_id;

    if not found
       or v_parent_tenant_id <> new.tenant_id
       or v_parent_property_id <> new.property_id then
      raise exception using errcode = 'P2000',
        message = 'NEON_ORGANIZATION_DEPARTMENT_NOT_FOUND';
    end if;
    new.depth := v_parent_depth + 1;
    new.path_ids := v_parent_path_ids || new.id;
  end if;

  new.code := nullif(
    pg_catalog.lower(pg_catalog.btrim(new.code)), ''
  );
  new.name_zh := pg_catalog.btrim(new.name_zh);
  new.name_en := nullif(pg_catalog.btrim(new.name_en), '');
  return new;
end
$function$;

create or replace function app_private.insert_department_closure()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op <> 'INSERT'
     or tg_table_schema <> 'public'
     or tg_table_name <> 'departments'
     or pg_catalog.pg_trigger_depth() <> 1 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_DEPARTMENT_CLOSURE_TRIGGER_REQUIRED';
  end if;

  perform app_private.assert_neon_organization_runtime_session();
  perform app_private.assert_actor_context();
  if not app_private.neon_organization_actor_has_role(
    'property_ld_manager'
  ) then
    raise exception using errcode = '42501',
      message = 'NEON_ORGANIZATION_MANAGER_FORBIDDEN';
  end if;
  if new.property_id <> app_private.current_actor_property_id() then
    raise exception using errcode = '42501',
      message = 'NEON_ORGANIZATION_PROPERTY_FORBIDDEN';
  end if;

  insert into public.department_closure (
    tenant_id,
    property_id,
    ancestor_department_id,
    descendant_department_id,
    distance
  ) values (
    new.tenant_id,
    new.property_id,
    new.id,
    new.id,
    0
  );

  if new.parent_id is not null then
    insert into public.department_closure (
      tenant_id,
      property_id,
      ancestor_department_id,
      descendant_department_id,
      distance
    )
    select new.tenant_id,
           new.property_id,
           closure.ancestor_department_id,
           new.id,
           closure.distance + 1
    from public.department_closure closure
    where closure.tenant_id = new.tenant_id
      and closure.property_id = new.property_id
      and closure.descendant_department_id = new.parent_id;
  end if;
  return new;
end
$function$;

create table app_private.organization_write_audit_events (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  auth_user_id uuid not null,
  actor_user_id uuid not null,
  tenant_id uuid not null,
  property_id uuid not null,
  operation text not null,
  department_id uuid not null,
  previous_version bigint,
  result_version bigint not null,
  previous_is_active boolean,
  result_is_active boolean not null,
  changed_fields text[] not null,
  occurred_at timestamptz not null
    default pg_catalog.transaction_timestamp(),
  constraint organization_write_audit_operation_check check (
    operation in ('department_create', 'department_update')
  ),
  constraint organization_write_audit_version_check check (
    result_version > 0
    and (
      (operation = 'department_create' and previous_version is null)
      or
      (operation = 'department_update' and previous_version is not null)
    )
  ),
  constraint organization_write_audit_fields_check check (
    pg_catalog.cardinality(changed_fields) > 0
    and changed_fields <@ array[
      'parent_id', 'node_type', 'code', 'name_zh', 'name_en',
      'sort_order', 'is_active'
    ]::text[]
  )
);

create index organization_write_audit_request_idx
  on app_private.organization_write_audit_events(request_id, occurred_at);
create index organization_write_audit_department_idx
  on app_private.organization_write_audit_events(
    property_id, department_id, occurred_at
  );

alter table app_private.organization_write_audit_events
  enable row level security;
alter table app_private.organization_write_audit_events
  force row level security;

create function app_private.reject_organization_write_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using errcode = '42501',
    message = 'ORGANIZATION_WRITE_AUDIT_APPEND_ONLY';
end
$function$;

create trigger organization_write_audit_append_only
before update or delete on app_private.organization_write_audit_events
for each row
execute function app_private.reject_organization_write_audit_mutation();

create function app_private.current_neon_organization_actor_user_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $function$
  select account.user_id
  from public.user_accounts account
  where account.auth_user_id =
      app_private.current_actor_auth_user_id()
    and account.property_id =
      app_private.current_actor_property_id()
    and account.account_status::text = 'active'
  limit 1;
$function$;

create function app_private.assert_neon_organization_manager()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  perform app_private.assert_neon_organization_runtime_session();
  perform app_private.assert_actor_context();
  if not app_private.neon_organization_actor_has_role(
    'property_ld_manager'
  ) or app_private.current_neon_organization_actor_user_id() is null then
    raise exception using errcode = '42501',
      message = 'NEON_ORGANIZATION_MANAGER_FORBIDDEN';
  end if;
end
$function$;

create function app_private.neon_organization_department_payload(
  p_department_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', department.id,
    'tenant_id', department.tenant_id,
    'property_id', department.property_id,
    'parent_id', department.parent_id,
    'node_type', department.node_type,
    'code', department.code,
    'name_zh', department.name_zh,
    'name_en', department.name_en,
    'sort_order', department.sort_order,
    'depth', department.depth,
    'path_ids', department.path_ids,
    'is_active', department.is_active,
    'version', department.version,
    'synthetic_employee_count', 0
  )
  from public.departments department
  where department.id = p_department_id
    and department.property_id =
      app_private.current_actor_property_id();
$function$;

create function app_private.append_neon_organization_write_audit(
  p_operation text,
  p_department_id uuid,
  p_previous_version bigint,
  p_result_version bigint,
  p_previous_is_active boolean,
  p_result_is_active boolean,
  p_changed_fields text[]
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_actor_user_id uuid;
  v_tenant_id uuid;
begin
  perform app_private.assert_neon_organization_manager();
  v_actor_user_id :=
    app_private.current_neon_organization_actor_user_id();

  select property.tenant_id
    into v_tenant_id
  from public.properties property
  where property.id = app_private.current_actor_property_id()
    and property.status::text = 'active';

  if v_tenant_id is null then
    raise exception using errcode = '42501',
      message = 'NEON_ORGANIZATION_PROPERTY_FORBIDDEN';
  end if;

  insert into app_private.organization_write_audit_events (
    request_id,
    auth_user_id,
    actor_user_id,
    tenant_id,
    property_id,
    operation,
    department_id,
    previous_version,
    result_version,
    previous_is_active,
    result_is_active,
    changed_fields
  ) values (
    app_private.current_actor_request_id(),
    app_private.current_actor_auth_user_id(),
    v_actor_user_id,
    v_tenant_id,
    app_private.current_actor_property_id(),
    p_operation,
    p_department_id,
    p_previous_version,
    p_result_version,
    p_previous_is_active,
    p_result_is_active,
    p_changed_fields
  );
end
$function$;

create function public.create_neon_organization_department(
  p_hostname text,
  p_tenant_id uuid,
  p_property_id uuid,
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
  v_department_id uuid;
  v_depth integer;
  v_path_ids uuid[];
  v_closure_count integer;
  v_payload jsonb;
begin
  perform app_private.assert_neon_organization_manager();
  perform app_private.assert_neon_organization_hostname(p_hostname);

  if p_property_id <> app_private.current_actor_property_id()
     or not exists (
       select 1
       from public.properties property
       where property.id = p_property_id
         and property.tenant_id = p_tenant_id
         and property.status::text = 'active'
     ) then
    raise exception using errcode = '42501',
      message = 'NEON_ORGANIZATION_PROPERTY_FORBIDDEN';
  end if;
  if p_parent_id is not null and not exists (
    select 1
    from public.departments parent
    where parent.id = p_parent_id
      and parent.tenant_id = p_tenant_id
      and parent.property_id = p_property_id
  ) then
    raise exception using errcode = 'P2000',
      message = 'NEON_ORGANIZATION_DEPARTMENT_NOT_FOUND';
  end if;
  if pg_catalog.btrim(coalesce(p_name_zh, '')) = '' then
    raise exception using errcode = 'P2006',
      message = 'NEON_ORGANIZATION_DEPARTMENT_NAME_INVALID';
  end if;

  insert into public.departments (
    tenant_id,
    property_id,
    parent_id,
    node_type,
    code,
    name_zh,
    name_en,
    sort_order,
    created_by,
    updated_by
  ) values (
    p_tenant_id,
    p_property_id,
    p_parent_id,
    p_node_type::public.department_node_type,
    p_code,
    p_name_zh,
    p_name_en,
    coalesce(p_sort_order, 0),
    app_private.current_actor_auth_user_id(),
    app_private.current_actor_auth_user_id()
  )
  returning id, depth, path_ids
    into v_department_id, v_depth, v_path_ids;

  select count(*)::integer
    into v_closure_count
  from public.department_closure closure
  where closure.tenant_id = p_tenant_id
    and closure.property_id = p_property_id
    and closure.descendant_department_id = v_department_id;

  if pg_catalog.cardinality(v_path_ids) <> v_depth + 1
     or v_path_ids[v_depth + 1] <> v_department_id
     or v_closure_count <> pg_catalog.cardinality(v_path_ids)
     or exists (
       select 1
       from pg_catalog.unnest(v_path_ids)
         with ordinality path_item(id, ordinal)
       where not exists (
         select 1
         from public.department_closure closure
         where closure.tenant_id = p_tenant_id
           and closure.property_id = p_property_id
           and closure.ancestor_department_id = path_item.id
           and closure.descendant_department_id = v_department_id
           and closure.distance =
             pg_catalog.cardinality(v_path_ids) - path_item.ordinal
       )
     ) then
    raise exception using errcode = '23514',
      message = 'NEON_ORGANIZATION_DEPARTMENT_CLOSURE_INVALID';
  end if;

  perform app_private.append_neon_organization_write_audit(
    'department_create',
    v_department_id,
    null,
    1,
    null,
    true,
    array[
      'parent_id', 'node_type', 'code', 'name_zh',
      'name_en', 'sort_order', 'is_active'
    ]::text[]
  );

  v_payload := app_private.neon_organization_department_payload(
    v_department_id
  );
  if v_payload is null then
    raise exception using errcode = 'P2000',
      message = 'NEON_ORGANIZATION_DEPARTMENT_NOT_FOUND';
  end if;
  return v_payload;
exception
  when invalid_text_representation then
    raise exception using errcode = 'P2006',
      message = 'NEON_ORGANIZATION_DEPARTMENT_NODE_TYPE_INVALID';
end
$function$;

create function public.update_neon_organization_department(
  p_hostname text,
  p_department_id uuid,
  p_expected_version bigint,
  p_name_zh text,
  p_name_en text,
  p_sort_order integer,
  p_is_active boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_current_id uuid;
  v_current_tenant_id uuid;
  v_current_property_id uuid;
  v_current_name_zh text;
  v_current_name_en text;
  v_current_sort_order integer;
  v_current_is_active boolean;
  v_current_version bigint;
  v_result_version bigint;
  v_payload jsonb;
  v_changed_fields text[];
begin
  perform app_private.assert_neon_organization_manager();
  perform app_private.assert_neon_organization_hostname(p_hostname);

  select department.id,
         department.tenant_id,
         department.property_id,
         department.name_zh,
         department.name_en,
         department.sort_order,
         department.is_active,
         department.version
    into v_current_id,
         v_current_tenant_id,
         v_current_property_id,
         v_current_name_zh,
         v_current_name_en,
         v_current_sort_order,
         v_current_is_active,
         v_current_version
  from public.departments department
  where department.id = p_department_id
    and department.property_id =
      app_private.current_actor_property_id()
  for update;

  if v_current_id is null then
    raise exception using errcode = 'P2000',
      message = 'NEON_ORGANIZATION_DEPARTMENT_NOT_FOUND';
  end if;
  if v_current_version <> p_expected_version then
    raise exception using errcode = 'P2002',
      message = 'NEON_ORGANIZATION_DEPARTMENT_STALE_VERSION';
  end if;
  if pg_catalog.btrim(coalesce(p_name_zh, '')) = '' then
    raise exception using errcode = 'P2006',
      message = 'NEON_ORGANIZATION_DEPARTMENT_NAME_INVALID';
  end if;

  if v_current_is_active and not p_is_active then
    if exists (
      select 1
      from public.department_closure closure
      join public.departments child
        on child.id = closure.descendant_department_id
       and child.tenant_id = closure.tenant_id
       and child.property_id = closure.property_id
      where closure.tenant_id = v_current_tenant_id
        and closure.property_id = v_current_property_id
        and closure.ancestor_department_id = v_current_id
        and closure.distance > 0
        and child.is_active
    ) then
      raise exception using errcode = 'P5401',
        message = 'NEON_ORGANIZATION_DEPARTMENT_ACTIVE_CHILDREN';
    end if;
    if exists (
      select 1
      from public.trainer_scopes scope
      where scope.property_id = v_current_property_id
        and scope.department_id = v_current_id
        and scope.is_active
    ) then
      raise exception using errcode = 'P5402',
        message = 'NEON_ORGANIZATION_DEPARTMENT_ACTIVE_SCOPES';
    end if;
    if exists (
      select 1
      from public.position_department_assignments assignment
      join public.positions position
        on position.id = assignment.position_id
       and position.property_id = assignment.property_id
      where assignment.property_id = v_current_property_id
        and assignment.department_id = v_current_id
        and position.is_active
    ) then
      raise exception using errcode = 'P5403',
        message = 'NEON_ORGANIZATION_DEPARTMENT_ACTIVE_POSITIONS';
    end if;
    if exists (
      select 1
      from public.operational_units unit
      where unit.property_id = v_current_property_id
        and unit.department_id = v_current_id
        and unit.is_active
    ) then
      raise exception using errcode = 'P5404',
        message = 'NEON_ORGANIZATION_DEPARTMENT_ACTIVE_UNITS';
    end if;
  end if;

  v_changed_fields := pg_catalog.array_remove(array[
    case when pg_catalog.btrim(p_name_zh) is distinct from
      v_current_name_zh then 'name_zh' end,
    case when nullif(pg_catalog.btrim(p_name_en), '')
      is distinct from v_current_name_en then 'name_en' end,
    case when p_sort_order is distinct from
      v_current_sort_order then 'sort_order' end,
    case when p_is_active is distinct from
      v_current_is_active then 'is_active' end
  ]::text[], null);
  if pg_catalog.cardinality(v_changed_fields) = 0 then
    v_changed_fields := array['name_zh']::text[];
  end if;

  update public.departments
  set name_zh = pg_catalog.btrim(p_name_zh),
      name_en = nullif(pg_catalog.btrim(p_name_en), ''),
      sort_order = p_sort_order,
      is_active = p_is_active,
      updated_by = app_private.current_actor_auth_user_id(),
      version = version + 1
  where id = v_current_id
  returning version into v_result_version;

  perform app_private.append_neon_organization_write_audit(
    'department_update',
    v_current_id,
    v_current_version,
    v_result_version,
    v_current_is_active,
    p_is_active,
    v_changed_fields
  );

  v_payload := app_private.neon_organization_department_payload(
    v_current_id
  );
  if v_payload is null then
    raise exception using errcode = 'P2000',
      message = 'NEON_ORGANIZATION_DEPARTMENT_NOT_FOUND';
  end if;
  return v_payload;
end
$function$;

revoke all on function
  app_private.prepare_department_insert(),
  app_private.insert_department_closure(),
  app_private.reject_organization_write_audit_mutation(),
  app_private.current_neon_organization_actor_user_id(),
  app_private.assert_neon_organization_manager(),
  app_private.neon_organization_department_payload(uuid),
  app_private.append_neon_organization_write_audit(
    text,uuid,bigint,bigint,boolean,boolean,text[]
  )
from public, authenticated, neondb_owner, hotel_ld_people_read,
     hotel_ld_application, hotel_ld_readonly;

revoke all on table app_private.organization_write_audit_events
  from public, authenticated, neondb_owner, hotel_ld_people_read,
       hotel_ld_application, hotel_ld_readonly;

reset role;

create policy e3_phase2a_departments_insert
on public.departments
for insert to hotel_ld_migration_owner
with check (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_has_role(
    'property_ld_manager'
  )
  and exists (
    select 1
    from public.properties property
    where property.id = property_id
      and property.tenant_id = tenant_id
      and property.status::text = 'active'
  )
);

create policy e3_phase2a_departments_update
on public.departments
for update to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_has_role(
    'property_ld_manager'
  )
)
with check (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_has_role(
    'property_ld_manager'
  )
);

create policy e3_phase2a_department_closure_insert
on public.department_closure
for insert to hotel_ld_migration_owner
with check (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_has_role(
    'property_ld_manager'
  )
  and exists (
    select 1
    from public.departments ancestor
    where ancestor.id = ancestor_department_id
      and ancestor.tenant_id = tenant_id
      and ancestor.property_id = property_id
  )
  and exists (
    select 1
    from public.departments descendant
    where descendant.id = descendant_department_id
      and descendant.tenant_id = tenant_id
      and descendant.property_id = property_id
  )
);

create policy e3_phase2a_position_assignments_blocker_read
on public.position_department_assignments
for select to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_has_role(
    'property_ld_manager'
  )
);

create policy e3_phase2a_organization_write_audit_insert
on app_private.organization_write_audit_events
for insert to hotel_ld_migration_owner
with check (
  session_user = 'hotel_ld_application'
  and auth_user_id = app_private.current_actor_auth_user_id()
  and actor_user_id =
    app_private.current_neon_organization_actor_user_id()
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_has_role(
    'property_ld_manager'
  )
);

set local role hotel_ld_migration_owner;

revoke all on function
  public.create_neon_organization_department(
    text,uuid,uuid,uuid,text,text,text,text,integer
  ),
  public.update_neon_organization_department(
    text,uuid,bigint,text,text,integer,boolean
  )
from public, authenticated, neondb_owner, hotel_ld_people_read,
     hotel_ld_application, hotel_ld_readonly;

grant execute on function
  public.create_neon_organization_department(
    text,uuid,uuid,uuid,text,text,text,text,integer
  ),
  public.update_neon_organization_department(
    text,uuid,bigint,text,text,integer,boolean
  )
to hotel_ld_application;

reset role;

do $e3_phase2a_postflight$
declare
  v_count integer;
  v_memberships integer;
  v_runtime_owned integer;
begin
  select count(*)
    into v_count
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace namespace
    on namespace.oid = routine.pronamespace
  join pg_catalog.pg_roles owner_role
    on owner_role.oid = routine.proowner
  where routine.oid = any (array[
    pg_catalog.to_regprocedure(
      'public.create_neon_organization_department(text,uuid,uuid,uuid,text,text,text,text,integer)'
    ),
    pg_catalog.to_regprocedure(
      'public.update_neon_organization_department(text,uuid,bigint,text,text,integer,boolean)'
    )
  ]::oid[])
    and namespace.nspname = 'public'
    and owner_role.rolname = 'hotel_ld_migration_owner'
    and routine.prosecdef
    and routine.proconfig = array['search_path=""']::text[];

  if v_count <> 2 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_ENTRYPOINT_CATALOG_ASSERTION_FAILED';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(array[
      'public.create_neon_organization_department(text,uuid,uuid,uuid,text,text,text,text,integer)',
      'public.update_neon_organization_department(text,uuid,bigint,text,text,integer,boolean)'
    ]) signature(value)
    where not pg_catalog.has_function_privilege(
      'hotel_ld_application', signature.value, 'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'hotel_ld_people_read', signature.value, 'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'hotel_ld_readonly', signature.value, 'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'authenticated', signature.value, 'EXECUTE'
    )
  ) or exists (
    select 1
    from pg_catalog.pg_proc routine
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        routine.proacl,
        pg_catalog.acldefault('f', routine.proowner)
      )
    ) acl
    where routine.oid = any (array[
      pg_catalog.to_regprocedure(
        'public.create_neon_organization_department(text,uuid,uuid,uuid,text,text,text,text,integer)'
      ),
      pg_catalog.to_regprocedure(
        'public.update_neon_organization_department(text,uuid,bigint,text,text,integer,boolean)'
      )
    ]::oid[])
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_ENTRYPOINT_ACL_ASSERTION_FAILED';
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
      'app_private.prepare_department_insert()'
    ),
    pg_catalog.to_regprocedure(
      'app_private.insert_department_closure()'
    )
  ]::oid[])
    and namespace.nspname = 'app_private'
    and owner_role.rolname = 'hotel_ld_migration_owner'
    and not routine.prosecdef
    and routine.proconfig = array['search_path=""']::text[];

  if v_count <> 2 or exists (
    select 1
    from pg_catalog.unnest(array[
      'app_private.prepare_department_insert()',
      'app_private.insert_department_closure()'
    ]) signature(value)
    cross join pg_catalog.unnest(array[
      'authenticated', 'hotel_ld_people_read',
      'hotel_ld_application', 'hotel_ld_readonly'
    ]) forbidden_role(value)
    where pg_catalog.has_function_privilege(
      forbidden_role.value, signature.value, 'EXECUTE'
    )
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_TRIGGER_HELPER_ASSERTION_FAILED';
  end if;

  if pg_catalog.has_function_privilege(
    'hotel_ld_application',
    'public.create_department(uuid,uuid,uuid,text,text,text,text,integer)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'hotel_ld_application',
    'public.update_department_details(uuid,bigint,text,text,integer,boolean)',
    'EXECUTE'
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_LEGACY_EXECUTE_ASSERTION_FAILED';
  end if;

  select count(*)
    into v_count
  from pg_catalog.pg_policies policy
  where policy.schemaname in ('public', 'app_private')
    and policy.policyname in (
      'e3_phase2a_departments_insert',
      'e3_phase2a_departments_update',
      'e3_phase2a_department_closure_insert',
      'e3_phase2a_position_assignments_blocker_read',
      'e3_phase2a_organization_write_audit_insert'
    );

  if v_count <> 5 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_POLICY_ASSERTION_FAILED';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    join pg_catalog.pg_class relation
      on relation.oid = trigger_record.tgrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_private'
      and relation.relname = 'organization_write_audit_events'
      and trigger_record.tgname = 'organization_write_audit_append_only'
      and trigger_record.tgenabled = 'O'
      and not trigger_record.tgisinternal
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_AUDIT_TRIGGER_ASSERTION_FAILED';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(array[
      'public.departments', 'public.department_closure',
      'public.position_department_assignments',
      'app_private.organization_write_audit_events'
    ]) relation(value)
    cross join pg_catalog.unnest(array[
      'hotel_ld_application', 'hotel_ld_people_read'
    ]) runtime_role(value)
    where pg_catalog.has_table_privilege(
      runtime_role.value, relation.value,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    ) or pg_catalog.has_any_column_privilege(
      runtime_role.value, relation.value,
      'SELECT,INSERT,UPDATE,REFERENCES'
    )
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_RUNTIME_RAW_PRIVILEGE_ASSERTION_FAILED';
  end if;

  if pg_catalog.has_table_privilege(
    'hotel_ld_migration_owner',
    'public.department_closure',
    'UPDATE,DELETE'
  ) or pg_catalog.has_any_column_privilege(
    'hotel_ld_migration_owner',
    'public.department_closure',
    'UPDATE'
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_CLOSURE_REWRITE_ASSERTION_FAILED';
  end if;

  select count(*)
    into v_memberships
  from pg_catalog.pg_auth_members membership
  join pg_catalog.pg_roles member_role
    on member_role.oid = membership.member
  where member_role.rolname = 'hotel_ld_application';

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
    'hotel_ld_application', 'hotel_ld_people_read'
  );

  if v_memberships <> 1 or v_runtime_owned <> 0 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_RUNTIME_TOPOLOGY_ASSERTION_FAILED';
  end if;
end
$e3_phase2a_postflight$;

commit;

/*
 * Child-only rollback review order (do not execute as a batch blindly):
 * 1. Revoke and drop the two Phase 2A public entry points.
 * 2. Drop the five Phase 2A policies and private audit/helper objects.
 * 3. Revoke only Phase 2A migration-owner write/blocker column grants.
 * 4. Restore the pinned pre-Phase-2A trigger helper definitions/owners only
 *    if returning to the reviewed read-only child baseline is required.
 * 5. Re-run E1/E2/E3 Phase 1 catalog, Actor Context, RLS, and read checks.
 * Never restore PUBLIC/application execution on the legacy owner-definer RPCs.
 */
