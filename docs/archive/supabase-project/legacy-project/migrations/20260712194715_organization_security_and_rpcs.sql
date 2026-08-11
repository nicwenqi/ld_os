create or replace function app_private.can_read_property_organization(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_admin()
    or exists (
      select 1 from public.properties property
      where property.id = p_property_id and app_private.is_tenant_admin(property.tenant_id)
    )
    or app_private.has_property_role(p_property_id, 'property_ld_manager')
    or app_private.has_property_role(p_property_id, 'department_training_admin');
$$;

create or replace function app_private.assert_property_organization_manager(p_property_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.can_manage_property(p_property_id) then
    raise exception 'ORGANIZATION_FORBIDDEN: property organization manager role required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.create_department(
  p_tenant_id uuid,
  p_property_id uuid,
  p_parent_id uuid,
  p_node_type text,
  p_code text,
  p_name_zh text,
  p_name_en text,
  p_sort_order integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_id uuid;
begin
  perform app_private.assert_property_organization_manager(p_property_id);
  if not exists (
    select 1 from public.properties property
    where property.id = p_property_id and property.tenant_id = p_tenant_id
  ) then
    raise exception 'DEPARTMENT_PROPERTY_SCOPE: tenant and property do not match' using errcode = 'P2005';
  end if;
  if p_parent_id is not null and not exists (
    select 1 from public.departments department
    where department.id = p_parent_id
      and department.tenant_id = p_tenant_id
      and department.property_id = p_property_id
  ) then
    raise exception 'DEPARTMENT_PARENT_SCOPE: target parent must belong to the same property' using errcode = 'P2001';
  end if;

  insert into public.departments (
    tenant_id, property_id, parent_id, node_type, code, name_zh, name_en, sort_order,
    created_by, updated_by
  ) values (
    p_tenant_id, p_property_id, p_parent_id, p_node_type::public.department_node_type,
    p_code, p_name_zh, p_name_en, coalesce(p_sort_order, 0), auth.uid(), auth.uid()
  ) returning id into created_id;
  return created_id;
exception when invalid_text_representation then
  raise exception 'DEPARTMENT_NODE_TYPE: unsupported department node type' using errcode = 'P2006';
end;
$$;

create or replace function public.update_department_details(
  p_department_id uuid,
  p_expected_version bigint,
  p_name_zh text,
  p_name_en text,
  p_sort_order integer,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.departments;
begin
  select * into current_row from public.departments where id = p_department_id for update;
  if not found then
    raise exception 'DEPARTMENT_NOT_FOUND: department no longer exists' using errcode = 'P2000';
  end if;
  perform app_private.assert_property_organization_manager(current_row.property_id);
  if current_row.version <> p_expected_version then
    raise exception 'DEPARTMENT_STALE_VERSION: refresh the organization tree and retry' using errcode = 'P2002';
  end if;

  update public.departments
  set name_zh = btrim(p_name_zh), name_en = nullif(btrim(p_name_en), ''),
      sort_order = p_sort_order, is_active = p_is_active,
      updated_by = auth.uid(), version = version + 1
  where id = p_department_id;
  return p_department_id;
end;
$$;

create or replace function public.preview_department_move(
  p_department_id uuid,
  p_new_parent_id uuid
)
returns table (
  current_path text,
  proposed_path text,
  child_departments_affected bigint,
  employee_impact_placeholder bigint,
  aliases_affected bigint,
  operational_units_affected bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  moving public.departments;
  target public.departments;
begin
  select * into moving from public.departments where id = p_department_id;
  if not found then raise exception 'DEPARTMENT_NOT_FOUND: department no longer exists' using errcode = 'P2000'; end if;
  perform app_private.assert_property_organization_manager(moving.property_id);
  if p_new_parent_id = p_department_id then
    raise exception 'DEPARTMENT_SELF_PARENT: department cannot be its own parent' using errcode = 'P2004';
  end if;
  if p_new_parent_id is not null then
    select * into target from public.departments where id = p_new_parent_id;
    if not found or target.tenant_id <> moving.tenant_id or target.property_id <> moving.property_id then
      raise exception 'DEPARTMENT_PARENT_SCOPE: target parent must belong to the same property' using errcode = 'P2001';
    end if;
    if exists (
      select 1 from public.department_closure
      where ancestor_department_id = p_department_id and descendant_department_id = p_new_parent_id
    ) then
      raise exception 'DEPARTMENT_CYCLE: target parent is inside the moving subtree' using errcode = 'P2003';
    end if;
  end if;

  return query
  with subtree as (
    select descendant_department_id
    from public.department_closure where ancestor_department_id = p_department_id
  ), current_names as (
    select string_agg(department.name_zh, ' / ' order by path.ordinality) as path
    from unnest(moving.path_ids) with ordinality path(id, ordinality)
    join public.departments department on department.id = path.id
  ), target_names as (
    select string_agg(department.name_zh, ' / ' order by path.ordinality) as path
    from unnest(coalesce(target.path_ids, '{}'::uuid[])) with ordinality path(id, ordinality)
    join public.departments department on department.id = path.id
  )
  select
    (select path from current_names),
    concat_ws(' / ', (select path from target_names), moving.name_zh),
    greatest((select count(*) from subtree) - 1, 0),
    0::bigint,
    (select count(*) from public.department_aliases alias_row where alias_row.target_department_id in (select descendant_department_id from subtree)),
    (select count(*) from public.operational_units unit_row where unit_row.department_id in (select descendant_department_id from subtree));
end;
$$;

create or replace function public.reparent_department(
  p_department_id uuid,
  p_new_parent_id uuid,
  p_expected_version bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  moving public.departments;
  target public.departments;
  subtree_ids uuid[];
  new_root_path uuid[];
begin
  select * into moving from public.departments where id = p_department_id for update;
  if not found then raise exception 'DEPARTMENT_NOT_FOUND: department no longer exists' using errcode = 'P2000'; end if;
  perform app_private.assert_property_organization_manager(moving.property_id);
  if moving.version <> p_expected_version then
    raise exception 'DEPARTMENT_STALE_VERSION: refresh the organization tree and retry' using errcode = 'P2002';
  end if;
  if p_new_parent_id = p_department_id then
    raise exception 'DEPARTMENT_SELF_PARENT: department cannot be its own parent' using errcode = 'P2004';
  end if;
  if p_new_parent_id is not null then
    select * into target from public.departments where id = p_new_parent_id for share;
    if not found or target.tenant_id <> moving.tenant_id or target.property_id <> moving.property_id then
      raise exception 'DEPARTMENT_PARENT_SCOPE: target parent must belong to the same property' using errcode = 'P2001';
    end if;
    if exists (
      select 1 from public.department_closure
      where ancestor_department_id = p_department_id and descendant_department_id = p_new_parent_id
    ) then
      raise exception 'DEPARTMENT_CYCLE: target parent is inside the moving subtree' using errcode = 'P2003';
    end if;
    new_root_path := target.path_ids || p_department_id;
  else
    new_root_path := array[p_department_id];
  end if;

  select array_agg(descendant_department_id)
  into subtree_ids
  from public.department_closure
  where ancestor_department_id = p_department_id;

  perform set_config('app_private.organization_mutation', 'on', true);

  delete from public.department_closure closure
  where closure.descendant_department_id = any(subtree_ids)
    and not (closure.ancestor_department_id = any(subtree_ids));

  update public.departments department
  set parent_id = case when department.id = p_department_id then p_new_parent_id else department.parent_id end,
      depth = cardinality(new_root_path) - 1 + (department.depth - moving.depth),
      path_ids = new_root_path || coalesce(
        department.path_ids[(moving.depth + 2):cardinality(department.path_ids)], '{}'::uuid[]
      ),
      updated_by = auth.uid(), version = department.version + 1
  where department.id = any(subtree_ids);

  if p_new_parent_id is not null then
    insert into public.department_closure (
      tenant_id, property_id, ancestor_department_id, descendant_department_id, distance
    )
    select moving.tenant_id, moving.property_id,
      parent_ancestor.ancestor_department_id,
      subtree.descendant_department_id,
      parent_ancestor.distance + 1 + subtree.distance
    from public.department_closure parent_ancestor
    cross join public.department_closure subtree
    where parent_ancestor.descendant_department_id = p_new_parent_id
      and subtree.ancestor_department_id = p_department_id
    on conflict (ancestor_department_id, descendant_department_id)
    do update set distance = excluded.distance;
  end if;

  perform set_config('app_private.organization_mutation', 'off', true);
  return p_department_id;
end;
$$;

revoke execute on function app_private.can_read_property_organization(uuid) from public, anon;
grant execute on function app_private.can_read_property_organization(uuid) to authenticated;
revoke execute on function app_private.assert_property_organization_manager(uuid) from public, anon, authenticated;

revoke all on function public.create_department(uuid, uuid, uuid, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.update_department_details(uuid, bigint, text, text, integer, boolean) from public, anon, authenticated;
revoke all on function public.preview_department_move(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reparent_department(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.create_department(uuid, uuid, uuid, text, text, text, text, integer) to authenticated;
grant execute on function public.update_department_details(uuid, bigint, text, text, integer, boolean) to authenticated;
grant execute on function public.preview_department_move(uuid, uuid) to authenticated;
grant execute on function public.reparent_department(uuid, uuid, bigint) to authenticated;

revoke all on public.departments, public.department_closure, public.department_aliases,
  public.operational_units, public.operational_unit_aliases, public.position_families,
  public.positions, public.position_department_assignments, public.position_aliases
from anon, authenticated;

grant select on public.departments, public.department_closure, public.department_aliases,
  public.operational_units, public.operational_unit_aliases, public.position_families,
  public.positions, public.position_department_assignments, public.position_aliases
to authenticated;
grant insert, update on public.department_aliases, public.operational_units, public.operational_unit_aliases,
  public.position_families, public.positions, public.position_aliases to authenticated;
grant insert, update, delete on public.position_department_assignments to authenticated;

alter table public.departments enable row level security;
alter table public.department_closure enable row level security;
alter table public.department_aliases enable row level security;
alter table public.operational_units enable row level security;
alter table public.operational_unit_aliases enable row level security;
alter table public.position_families enable row level security;
alter table public.positions enable row level security;
alter table public.position_department_assignments enable row level security;
alter table public.position_aliases enable row level security;
alter table public.departments force row level security;
alter table public.department_closure force row level security;
alter table public.department_aliases force row level security;
alter table public.operational_units force row level security;
alter table public.operational_unit_aliases force row level security;
alter table public.position_families force row level security;
alter table public.positions force row level security;
alter table public.position_department_assignments force row level security;
alter table public.position_aliases force row level security;

create policy departments_select on public.departments for select to authenticated
using ((select app_private.can_read_property_organization(property_id)));
create policy department_closure_select on public.department_closure for select to authenticated
using ((select app_private.can_read_property_organization(property_id)));
create policy operational_units_select on public.operational_units for select to authenticated
using ((select app_private.can_read_property_organization(property_id)));
create policy position_families_select on public.position_families for select to authenticated
using ((select app_private.can_read_property_organization(property_id)));
create policy positions_select on public.positions for select to authenticated
using ((select app_private.can_read_property_organization(property_id)));
create policy position_department_assignments_select on public.position_department_assignments for select to authenticated
using ((select app_private.can_read_property_organization(property_id)));

create policy department_aliases_select on public.department_aliases for select to authenticated
using ((select app_private.can_manage_property(property_id)));
create policy operational_unit_aliases_select on public.operational_unit_aliases for select to authenticated
using ((select app_private.can_manage_property(property_id)));
create policy position_aliases_select on public.position_aliases for select to authenticated
using ((select app_private.can_manage_property(property_id)));

create policy department_aliases_insert on public.department_aliases for insert to authenticated
with check ((select app_private.can_manage_property(property_id)));
create policy department_aliases_update on public.department_aliases for update to authenticated
using ((select app_private.can_manage_property(property_id)))
with check ((select app_private.can_manage_property(property_id)));
create policy operational_units_insert on public.operational_units for insert to authenticated
with check ((select app_private.can_manage_property(property_id)));
create policy operational_units_update on public.operational_units for update to authenticated
using ((select app_private.can_manage_property(property_id)))
with check ((select app_private.can_manage_property(property_id)));
create policy operational_unit_aliases_insert on public.operational_unit_aliases for insert to authenticated
with check ((select app_private.can_manage_property(property_id)));
create policy operational_unit_aliases_update on public.operational_unit_aliases for update to authenticated
using ((select app_private.can_manage_property(property_id)))
with check ((select app_private.can_manage_property(property_id)));
create policy position_families_insert on public.position_families for insert to authenticated
with check ((select app_private.can_manage_property(property_id)));
create policy position_families_update on public.position_families for update to authenticated
using ((select app_private.can_manage_property(property_id)))
with check ((select app_private.can_manage_property(property_id)));
create policy positions_insert on public.positions for insert to authenticated
with check ((select app_private.can_manage_property(property_id)));
create policy positions_update on public.positions for update to authenticated
using ((select app_private.can_manage_property(property_id)))
with check ((select app_private.can_manage_property(property_id)));
create policy position_department_assignments_insert on public.position_department_assignments for insert to authenticated
with check ((select app_private.can_manage_property(property_id)));
create policy position_department_assignments_update on public.position_department_assignments for update to authenticated
using ((select app_private.can_manage_property(property_id)))
with check ((select app_private.can_manage_property(property_id)));
create policy position_department_assignments_delete on public.position_department_assignments for delete to authenticated
using ((select app_private.can_manage_property(property_id)));
create policy position_aliases_insert on public.position_aliases for insert to authenticated
with check ((select app_private.can_manage_property(property_id)));
create policy position_aliases_update on public.position_aliases for update to authenticated
using ((select app_private.can_manage_property(property_id)))
with check ((select app_private.can_manage_property(property_id)));

alter table public.trainer_scopes validate constraint trainer_scopes_department_scope_fkey;
