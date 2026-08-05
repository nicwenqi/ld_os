/*
 * E3 Phase 3 / 202608050007 — Department move and closure rewrite boundary
 *
 * Child branch only. Runtime continues to use hotel_ld_application and can
 * execute only the two public entry points below; it receives no table DML.
 * A move is one transaction: actor checks, one property advisory lock,
 * deterministic key/subtree locks, hierarchy rewrite, and audit append.
 */

begin;

do $e3_phase3_preflight$
begin
  if current_database() <> 'neondb'
     or current_user <> 'neondb_owner'
     or session_user <> 'neondb_owner' then
    raise exception using errcode = '42501',
      message = 'E3_PHASE3_BOOTSTRAP_IDENTITY_MISMATCH';
  end if;

  if not pg_catalog.pg_has_role(
    current_user, 'hotel_ld_migration_owner', 'SET'
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE3_MIGRATION_OWNER_SET_ROLE_REQUIRED';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(array[
      'app_private.lock_neon_organization_hierarchy(uuid)',
      'public.preview_neon_organization_department_move(text,uuid,uuid)',
      'public.move_neon_organization_department(text,uuid,uuid,bigint)'
    ]) signature(value)
    where pg_catalog.to_regprocedure(signature.value) is not null
  ) then
    raise exception using errcode = '42710',
      message = 'E3_PHASE3_OBJECT_ALREADY_EXISTS';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace
      on namespace.oid = routine.pronamespace
    join pg_catalog.pg_roles owner_role
      on owner_role.oid = routine.proowner
    where routine.oid = pg_catalog.to_regprocedure(
      'public.create_neon_organization_department(text,uuid,uuid,uuid,text,text,text,text,integer)'
    )
      and namespace.nspname = 'public'
      and owner_role.rolname = 'hotel_ld_migration_owner'
      and routine.prosecdef
      and routine.proconfig = array['search_path=""']::text[]
  ) or not exists (
    select 1
    from pg_catalog.pg_policy policy
    join pg_catalog.pg_class relation on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and (relation.relname, policy.polname) in (
        ('departments', 'e3_phase2a_departments_update'),
        ('department_closure', 'e3_phase2a_department_closure_insert')
      )
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE3_PHASE2A_BASELINE_DRIFT';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('departments', 'department_closure')
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) <> 2 or exists (
    select 1
    from pg_catalog.pg_roles role_record
    where role_record.rolname = 'hotel_ld_application'
      and role_record.rolbypassrls
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE3_RLS_BASELINE_DRIFT';
  end if;
end
$e3_phase3_preflight$;

/* The move audit adds one operation and three structural field names without
 * changing the append-only table or its runtime access model. */
alter table app_private.organization_write_audit_events
  drop constraint organization_write_audit_operation_check;
alter table app_private.organization_write_audit_events
  add constraint organization_write_audit_operation_check check (
    operation in ('department_create', 'department_update', 'department_move')
  );
alter table app_private.organization_write_audit_events
  drop constraint organization_write_audit_version_check;
alter table app_private.organization_write_audit_events
  add constraint organization_write_audit_version_check check (
    result_version > 0
    and (
      (operation = 'department_create' and previous_version is null)
      or
      (operation in ('department_update', 'department_move')
       and previous_version is not null)
    )
  );
alter table app_private.organization_write_audit_events
  drop constraint organization_write_audit_fields_check;
alter table app_private.organization_write_audit_events
  add constraint organization_write_audit_fields_check check (
    pg_catalog.cardinality(changed_fields) > 0
    and changed_fields <@ array[
      'parent_id', 'node_type', 'code', 'name_zh', 'name_en',
      'sort_order', 'is_active', 'depth', 'path_ids', 'closure'
    ]::text[]
  );

/* Explicit and minimal authority for the NOBYPASSRLS function owner. */
grant select (id, tenant_id, property_id, parent_id, name_zh, depth,
              path_ids, is_active, version)
  on public.departments to hotel_ld_migration_owner;
grant update (parent_id, depth, path_ids, updated_by, version)
  on public.departments to hotel_ld_migration_owner;
grant select (tenant_id, property_id, ancestor_department_id,
              descendant_department_id, distance)
  on public.department_closure to hotel_ld_migration_owner;
grant delete on public.department_closure to hotel_ld_migration_owner;
grant select (property_id, target_department_id)
  on public.department_aliases to hotel_ld_migration_owner;

create policy e3_phase3_department_closure_delete
on public.department_closure
for delete to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_has_role('property_ld_manager')
);

create policy e3_phase3_department_aliases_preview_read
on public.department_aliases
for select to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_has_role('property_ld_manager')
);

set local role hotel_ld_migration_owner;

create function app_private.lock_neon_organization_hierarchy(
  p_property_id uuid
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  perform app_private.assert_neon_organization_manager();
  if p_property_id is null
     or p_property_id <> app_private.current_actor_property_id() then
    raise exception using errcode = '42501',
      message = 'NEON_ORGANIZATION_PROPERTY_FORBIDDEN';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hotel_ld:organization:' || p_property_id::text,
      0
    )
  );
end
$function$;

/* Replacing this entry point only serializes it with move; its API, insert
 * trigger contract, and post-insert closure verification are unchanged. */
create or replace function public.create_neon_organization_department(
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
       select 1 from public.properties property
       where property.id = p_property_id
         and property.tenant_id = p_tenant_id
         and property.status::text = 'active'
     ) then
    raise exception using errcode = '42501',
      message = 'NEON_ORGANIZATION_PROPERTY_FORBIDDEN';
  end if;

  perform app_private.lock_neon_organization_hierarchy(p_property_id);

  if p_parent_id is not null and not exists (
    select 1 from public.departments parent
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
    tenant_id, property_id, parent_id, node_type, code, name_zh, name_en,
    sort_order, created_by, updated_by
  ) values (
    p_tenant_id, p_property_id, p_parent_id,
    p_node_type::public.department_node_type, p_code, p_name_zh, p_name_en,
    coalesce(p_sort_order, 0), app_private.current_actor_auth_user_id(),
    app_private.current_actor_auth_user_id()
  )
  returning id, depth, path_ids
    into v_department_id, v_depth, v_path_ids;

  select count(*)::integer into v_closure_count
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
         select 1 from public.department_closure closure
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
    'department_create', v_department_id, null, 1, null, true,
    array['parent_id', 'node_type', 'code', 'name_zh', 'name_en',
          'sort_order', 'is_active']::text[]
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

create function public.preview_neon_organization_department_move(
  p_hostname text,
  p_department_id uuid,
  p_new_parent_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_moving public.departments;
  v_parent public.departments;
  v_current_path text;
  v_target_path text;
  v_child_count bigint;
  v_alias_count bigint;
  v_unit_count bigint;
begin
  perform app_private.assert_neon_organization_manager();
  perform app_private.assert_neon_organization_hostname(p_hostname);

  select * into v_moving
  from public.departments department
  where department.id = p_department_id
    and department.property_id = app_private.current_actor_property_id();
  if not found then
    raise exception using errcode = 'P2000',
      message = 'NEON_ORGANIZATION_DEPARTMENT_NOT_FOUND';
  end if;
  if v_moving.parent_id is not distinct from p_new_parent_id then
    raise exception using errcode = 'P5408',
      message = 'NEON_ORGANIZATION_DEPARTMENT_MOVE_NOOP';
  end if;
  if p_new_parent_id = p_department_id then
    raise exception using errcode = 'P5405',
      message = 'NEON_ORGANIZATION_DEPARTMENT_MOVE_SELF_PARENT';
  end if;

  if p_new_parent_id is not null then
    select * into v_parent
    from public.departments parent
    where parent.id = p_new_parent_id
      and parent.property_id = v_moving.property_id;
    if not found then
      raise exception using errcode = 'P2000',
        message = 'NEON_ORGANIZATION_DEPARTMENT_NOT_FOUND';
    end if;
    if not v_parent.is_active then
      raise exception using errcode = 'P5407',
        message = 'NEON_ORGANIZATION_DEPARTMENT_MOVE_PARENT_INACTIVE';
    end if;
    if exists (
      select 1 from public.department_closure closure
      where closure.tenant_id = v_moving.tenant_id
        and closure.property_id = v_moving.property_id
        and closure.ancestor_department_id = v_moving.id
        and closure.descendant_department_id = v_parent.id
    ) then
      raise exception using errcode = 'P5406',
        message = 'NEON_ORGANIZATION_DEPARTMENT_MOVE_CYCLE';
    end if;
  end if;

  select string_agg(department.name_zh, ' / ' order by path_item.ordinal)
    into v_current_path
  from pg_catalog.unnest(v_moving.path_ids)
    with ordinality path_item(id, ordinal)
  join public.departments department on department.id = path_item.id;
  if v_parent.id is not null then
    select string_agg(department.name_zh, ' / ' order by path_item.ordinal)
      into v_target_path
    from pg_catalog.unnest(v_parent.path_ids)
      with ordinality path_item(id, ordinal)
    join public.departments department on department.id = path_item.id;
  end if;

  with subtree as (
    select closure.descendant_department_id
    from public.department_closure closure
    where closure.tenant_id = v_moving.tenant_id
      and closure.property_id = v_moving.property_id
      and closure.ancestor_department_id = v_moving.id
  )
  select greatest(count(*) - 1, 0),
         (select count(*) from public.department_aliases alias_row
          where alias_row.property_id = v_moving.property_id
            and alias_row.target_department_id in (
              select descendant_department_id from subtree
            )),
         (select count(*) from public.operational_units unit_row
          where unit_row.property_id = v_moving.property_id
            and unit_row.department_id in (
              select descendant_department_id from subtree
            ))
    into v_child_count, v_alias_count, v_unit_count
  from subtree;

  return pg_catalog.jsonb_build_object(
    'current_path', coalesce(v_current_path, v_moving.name_zh),
    'proposed_path', case when v_parent.id is null then v_moving.name_zh
                          else v_target_path || ' / ' || v_moving.name_zh
                     end,
    'child_departments_affected', v_child_count,
    'employee_impact_placeholder', 0,
    'aliases_affected', v_alias_count,
    'operational_units_affected', v_unit_count
  );
end
$function$;

create function public.move_neon_organization_department(
  p_hostname text,
  p_department_id uuid,
  p_new_parent_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_moving public.departments;
  v_parent public.departments;
  v_new_root_path uuid[];
  v_subtree_ids uuid[];
  v_subtree_count integer;
  v_expected_closure_count bigint;
  v_actual_closure_count bigint;
  v_payload jsonb;
  v_result_version bigint;
begin
  perform app_private.assert_neon_organization_manager();
  perform app_private.assert_neon_organization_hostname(p_hostname);

  /* First visibility read finds the property for the transaction-scoped lock. */
  select * into v_moving
  from public.departments department
  where department.id = p_department_id
    and department.property_id = app_private.current_actor_property_id();
  if not found then
    raise exception using errcode = 'P2000',
      message = 'NEON_ORGANIZATION_DEPARTMENT_NOT_FOUND';
  end if;

  perform app_private.lock_neon_organization_hierarchy(v_moving.property_id);

  /* Lock source and target in UUID order before reading either authoritative
   * row. This remains deterministic even for a non-compliant concurrent
   * direct writer, while the property lock serializes compliant writers. */
  perform 1
  from public.departments department
  where department.id = any(
      pg_catalog.array_remove(
        array[p_department_id, p_new_parent_id]::uuid[], null
      )
    )
    and department.property_id = app_private.current_actor_property_id()
  order by department.id
  for update;

  /* Re-read after serialization and deterministic key locks. */
  select * into v_moving
  from public.departments department
  where department.id = p_department_id
    and department.property_id = app_private.current_actor_property_id()
  for update;
  if not found then
    raise exception using errcode = 'P2000',
      message = 'NEON_ORGANIZATION_DEPARTMENT_NOT_FOUND';
  end if;
  if v_moving.version <> p_expected_version then
    raise exception using errcode = 'P2002',
      message = 'NEON_ORGANIZATION_DEPARTMENT_STALE_VERSION';
  end if;
  if v_moving.parent_id is not distinct from p_new_parent_id then
    raise exception using errcode = 'P5408',
      message = 'NEON_ORGANIZATION_DEPARTMENT_MOVE_NOOP';
  end if;
  if p_new_parent_id = p_department_id then
    raise exception using errcode = 'P5405',
      message = 'NEON_ORGANIZATION_DEPARTMENT_MOVE_SELF_PARENT';
  end if;

  if p_new_parent_id is not null then
    /* The property advisory lock makes this second key lock wait-free for
     * compliant writers; the UUID predicate preserves deterministic intent. */
    select * into v_parent
    from public.departments parent
    where parent.id = p_new_parent_id
      and parent.property_id = v_moving.property_id;
    if not found then
      raise exception using errcode = 'P2000',
        message = 'NEON_ORGANIZATION_DEPARTMENT_NOT_FOUND';
    end if;
    if not v_parent.is_active then
      raise exception using errcode = 'P5407',
        message = 'NEON_ORGANIZATION_DEPARTMENT_MOVE_PARENT_INACTIVE';
    end if;
    if exists (
      select 1 from public.department_closure closure
      where closure.tenant_id = v_moving.tenant_id
        and closure.property_id = v_moving.property_id
        and closure.ancestor_department_id = v_moving.id
        and closure.descendant_department_id = v_parent.id
    ) then
      raise exception using errcode = 'P5406',
        message = 'NEON_ORGANIZATION_DEPARTMENT_MOVE_CYCLE';
    end if;
    v_new_root_path := v_parent.path_ids || v_moving.id;
  else
    v_new_root_path := array[v_moving.id];
  end if;

  select array_agg(closure.descendant_department_id
                   order by closure.descendant_department_id),
         count(*)::integer
    into v_subtree_ids, v_subtree_count
  from public.department_closure closure
  where closure.tenant_id = v_moving.tenant_id
    and closure.property_id = v_moving.property_id
    and closure.ancestor_department_id = v_moving.id;
  if v_subtree_count = 0 then
    raise exception using errcode = '23514',
      message = 'NEON_ORGANIZATION_DEPARTMENT_CLOSURE_INVALID';
  end if;

  /* Lock the complete subtree in stable UUID order before rewriting it. */
  perform 1
  from public.departments department
  where department.id = any(v_subtree_ids)
    and department.property_id = v_moving.property_id
  order by department.id
  for update;

  perform pg_catalog.set_config(
    'app_private.organization_mutation', 'on', true
  );

  delete from public.department_closure closure
  where closure.tenant_id = v_moving.tenant_id
    and closure.property_id = v_moving.property_id
    and closure.descendant_department_id = any(v_subtree_ids)
    and not closure.ancestor_department_id = any(v_subtree_ids);

  update public.departments department
  set parent_id = case when department.id = v_moving.id
                       then p_new_parent_id else department.parent_id end,
      depth = pg_catalog.cardinality(v_new_root_path) - 1
        + (department.depth - v_moving.depth),
      path_ids = v_new_root_path || coalesce(
        department.path_ids[(v_moving.depth + 2):
                            pg_catalog.cardinality(department.path_ids)],
        '{}'::uuid[]
      ),
      updated_by = app_private.current_actor_auth_user_id(),
      version = department.version + 1
  where department.id = any(v_subtree_ids)
    and department.property_id = v_moving.property_id;

  select department.version into v_result_version
  from public.departments department
  where department.id = v_moving.id
    and department.property_id = v_moving.property_id;

  if p_new_parent_id is not null then
    insert into public.department_closure (
      tenant_id, property_id, ancestor_department_id,
      descendant_department_id, distance
    )
    select v_moving.tenant_id,
           v_moving.property_id,
           parent_ancestor.ancestor_department_id,
           subtree.descendant_department_id,
           parent_ancestor.distance + 1 + subtree.distance
    from public.department_closure parent_ancestor
    cross join public.department_closure subtree
    where parent_ancestor.tenant_id = v_moving.tenant_id
      and parent_ancestor.property_id = v_moving.property_id
      and parent_ancestor.descendant_department_id = p_new_parent_id
      and subtree.tenant_id = v_moving.tenant_id
      and subtree.property_id = v_moving.property_id
      and subtree.ancestor_department_id = v_moving.id
    on conflict (ancestor_department_id, descendant_department_id)
    do nothing;
  end if;

  /* For a forest the closure cardinality is the sum of all path lengths.
   * Checking each moved row makes the invariant local and catches a partial
   * ancestor deletion or insertion before the audit record is appended. */
  select count(*) into v_actual_closure_count
  from public.department_closure closure
  where closure.tenant_id = v_moving.tenant_id
    and closure.property_id = v_moving.property_id
    and closure.descendant_department_id = any(v_subtree_ids);
  select coalesce(sum(pg_catalog.cardinality(department.path_ids)), 0)
    into v_expected_closure_count
  from public.departments department
  where department.id = any(v_subtree_ids)
    and department.property_id = v_moving.property_id;
  if v_actual_closure_count <> v_expected_closure_count
     or exists (
       select 1 from public.departments department
       where department.id = any(v_subtree_ids)
         and department.property_id = v_moving.property_id
         and (pg_catalog.cardinality(department.path_ids) <> department.depth + 1
              or department.path_ids[department.depth + 1] <> department.id)
     ) then
    raise exception using errcode = '23514',
      message = 'NEON_ORGANIZATION_DEPARTMENT_CLOSURE_INVALID';
  end if;

  perform app_private.append_neon_organization_write_audit(
    'department_move', v_moving.id, v_moving.version, v_result_version,
    v_moving.is_active, v_moving.is_active,
    array['parent_id', 'depth', 'path_ids', 'closure']::text[]
  );
  v_payload := app_private.neon_organization_department_payload(v_moving.id);
  if v_payload is null then
    raise exception using errcode = 'P2000',
      message = 'NEON_ORGANIZATION_DEPARTMENT_NOT_FOUND';
  end if;
  return v_payload;
end
$function$;

revoke all on function
  app_private.lock_neon_organization_hierarchy(uuid)
from public, authenticated, neondb_owner, hotel_ld_people_read,
     hotel_ld_application, hotel_ld_readonly;

revoke all on function
  public.preview_neon_organization_department_move(text,uuid,uuid),
  public.move_neon_organization_department(text,uuid,uuid,bigint)
from public, authenticated, neondb_owner, hotel_ld_people_read,
     hotel_ld_application, hotel_ld_readonly;
grant execute on function
  public.preview_neon_organization_department_move(text,uuid,uuid),
  public.move_neon_organization_department(text,uuid,uuid,bigint)
to hotel_ld_application;

reset role;

do $e3_phase3_postflight$
declare
  v_count integer;
begin
  select count(*) into v_count
  from pg_catalog.pg_proc routine
  join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
  join pg_catalog.pg_roles owner_role on owner_role.oid = routine.proowner
  where routine.oid = any(array[
    pg_catalog.to_regprocedure(
      'public.preview_neon_organization_department_move(text,uuid,uuid)'::text
    ),
    pg_catalog.to_regprocedure(
      'public.move_neon_organization_department(text,uuid,uuid,bigint)'::text
    )
  ]::oid[])
    and namespace.nspname = 'public'
    and owner_role.rolname = 'hotel_ld_migration_owner'
    and routine.prosecdef
    and routine.proconfig = array['search_path=""']::text[];
  if v_count <> 2 then
    raise exception using errcode = '42501',
      message = 'E3_PHASE3_ENTRYPOINT_CATALOG_ASSERTION_FAILED';
  end if;

  if not pg_catalog.has_function_privilege(
    'hotel_ld_application',
    'public.preview_neon_organization_department_move(text,uuid,uuid)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'hotel_ld_application',
    'public.move_neon_organization_department(text,uuid,uuid,bigint)',
    'EXECUTE'
  ) or exists (
    select 1 from pg_catalog.unnest(array[
      'public.preview_neon_organization_department_move(text,uuid,uuid)',
      'public.move_neon_organization_department(text,uuid,uuid,bigint)'
    ]) signature(value)
    where pg_catalog.has_function_privilege(
      'hotel_ld_people_read', signature.value, 'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'hotel_ld_readonly', signature.value, 'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'authenticated', signature.value, 'EXECUTE'
    )
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE3_ENTRYPOINT_ACL_ASSERTION_FAILED';
  end if;

  if pg_catalog.has_table_privilege(
    'hotel_ld_application', 'public.departments',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) or pg_catalog.has_any_column_privilege(
    'hotel_ld_application', 'public.departments',
    'SELECT,INSERT,UPDATE,REFERENCES'
  ) or pg_catalog.has_table_privilege(
    'hotel_ld_application', 'public.department_closure',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) or pg_catalog.has_any_column_privilege(
    'hotel_ld_application', 'public.department_closure',
    'SELECT,INSERT,UPDATE,REFERENCES'
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE3_RUNTIME_RAW_PRIVILEGE_ASSERTION_FAILED';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc routine
    cross join lateral pg_catalog.aclexplode(
      coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
    ) acl
    where routine.oid = any(array[
      pg_catalog.to_regprocedure(
        'public.preview_neon_organization_department_move(text,uuid,uuid)'::text
      ),
      pg_catalog.to_regprocedure(
        'public.move_neon_organization_department(text,uuid,uuid,bigint)'::text
      )
    ]::oid[])
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception using errcode = '42501',
      message = 'E3_PHASE3_PUBLIC_EXECUTE_ASSERTION_FAILED';
  end if;
end
$e3_phase3_postflight$;

commit;

/* Child-only rollback review order (do not execute as a batch blindly):
 * 1. Revoke and drop the two public Phase 3 entry points and private lock.
 * 2. Restore the Phase 2A create function from migration 005, then revoke
 *    Phase 3 grants and drop its two RLS policies.
 * 3. Restore the three audit constraints to their Phase 2A definitions.
 * 4. Verify raw runtime table privileges remain zero before retrying.
 */
