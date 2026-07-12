create type public.department_node_type as enum ('division', 'department', 'section', 'team', 'other');
create type public.department_resolution_type as enum ('mapped', 'created_top_level', 'created_child', 'merged', 'ignored', 'deferred');
create type public.operational_unit_type as enum ('venue', 'outlet', 'kitchen', 'restaurant', 'recreation', 'other');
create type public.position_resolution_status as enum ('mapped', 'family_only', 'external_only', 'ignored', 'deferred');

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  parent_id uuid,
  node_type public.department_node_type not null default 'department',
  code text,
  name_zh text not null,
  name_en text,
  sort_order integer not null default 0,
  depth integer not null default 0,
  path_ids uuid[] not null default '{}',
  is_active boolean not null default true,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  version bigint not null default 1,
  constraint departments_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties(id, tenant_id) on delete restrict,
  constraint departments_id_tenant_property_key unique (id, tenant_id, property_id),
  constraint departments_parent_scope_fkey
    foreign key (parent_id, tenant_id, property_id)
    references public.departments(id, tenant_id, property_id) on delete restrict,
  constraint departments_name_zh_not_blank check (btrim(name_zh) <> ''),
  constraint departments_name_en_not_blank check (name_en is null or btrim(name_en) <> ''),
  constraint departments_code_format_check check (code is null or code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint departments_no_self_parent check (parent_id is null or parent_id <> id),
  constraint departments_depth_check check (depth >= 0),
  constraint departments_path_check check (cardinality(path_ids) = depth + 1 and path_ids[depth + 1] = id),
  constraint departments_effective_dates_check check (effective_to is null or effective_from is null or effective_to >= effective_from),
  constraint departments_version_check check (version > 0)
);
create unique index departments_property_code_uidx on public.departments (property_id, code) where code is not null;
create index departments_property_parent_sort_idx on public.departments (property_id, parent_id, sort_order, name_zh);
create index departments_property_active_idx on public.departments (property_id, is_active);
create index departments_path_gin_idx on public.departments using gin (path_ids);
create index departments_created_by_idx on public.departments (created_by) where created_by is not null;
create index departments_updated_by_idx on public.departments (updated_by) where updated_by is not null;

create table public.department_closure (
  tenant_id uuid not null,
  property_id uuid not null,
  ancestor_department_id uuid not null,
  descendant_department_id uuid not null,
  distance integer not null,
  primary key (ancestor_department_id, descendant_department_id),
  constraint department_closure_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties(id, tenant_id) on delete restrict,
  constraint department_closure_ancestor_scope_fkey
    foreign key (ancestor_department_id, tenant_id, property_id)
    references public.departments(id, tenant_id, property_id) on delete cascade,
  constraint department_closure_descendant_scope_fkey
    foreign key (descendant_department_id, tenant_id, property_id)
    references public.departments(id, tenant_id, property_id) on delete cascade,
  constraint department_closure_distance_check check (distance >= 0),
  constraint department_closure_self_distance_check check (
    (ancestor_department_id = descendant_department_id and distance = 0) or
    (ancestor_department_id <> descendant_department_id and distance > 0)
  )
);
create index department_closure_ancestor_idx on public.department_closure (property_id, ancestor_department_id, distance);
create index department_closure_descendant_idx on public.department_closure (property_id, descendant_department_id, distance);

create table public.department_aliases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  source_system text not null,
  source_value text not null,
  normalized_source_value text not null,
  target_department_id uuid,
  resolution_type public.department_resolution_type not null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint department_aliases_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties(id, tenant_id) on delete restrict,
  constraint department_aliases_target_scope_fkey
    foreign key (target_department_id, tenant_id, property_id)
    references public.departments(id, tenant_id, property_id) on delete restrict,
  constraint department_aliases_source_not_blank check (btrim(source_system) <> '' and btrim(source_value) <> ''),
  constraint department_aliases_normalized_not_blank check (btrim(normalized_source_value) <> ''),
  constraint department_aliases_target_check check (
    (resolution_type in ('mapped', 'created_top_level', 'created_child', 'merged') and target_department_id is not null) or
    (resolution_type in ('ignored', 'deferred') and target_department_id is null)
  ),
  constraint department_aliases_approval_check check (
    (resolution_type = 'deferred') or (approved_by is not null and approved_at is not null)
  )
);
create unique index department_aliases_active_source_uidx
  on public.department_aliases (property_id, source_system, normalized_source_value) where is_active;
create index department_aliases_target_idx on public.department_aliases (target_department_id) where target_department_id is not null;
create index department_aliases_approved_by_idx on public.department_aliases (approved_by) where approved_by is not null;

create table public.operational_units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  department_id uuid not null,
  parent_operational_unit_id uuid,
  unit_type public.operational_unit_type not null default 'other',
  code text,
  name_zh text not null,
  name_en text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operational_units_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties(id, tenant_id) on delete restrict,
  constraint operational_units_id_tenant_property_key unique (id, tenant_id, property_id),
  constraint operational_units_department_scope_fkey
    foreign key (department_id, tenant_id, property_id)
    references public.departments(id, tenant_id, property_id) on delete restrict,
  constraint operational_units_parent_scope_fkey
    foreign key (parent_operational_unit_id, tenant_id, property_id)
    references public.operational_units(id, tenant_id, property_id) on delete restrict,
  constraint operational_units_no_self_parent check (parent_operational_unit_id is null or parent_operational_unit_id <> id),
  constraint operational_units_name_zh_not_blank check (btrim(name_zh) <> ''),
  constraint operational_units_code_format_check check (code is null or code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint operational_units_effective_dates_check check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
create unique index operational_units_property_code_uidx on public.operational_units (property_id, code) where code is not null;
create index operational_units_department_idx on public.operational_units (department_id, is_active, sort_order);
create index operational_units_parent_idx on public.operational_units (parent_operational_unit_id) where parent_operational_unit_id is not null;

create table public.operational_unit_aliases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  source_system text not null,
  source_value text not null,
  normalized_source_value text not null,
  operational_unit_id uuid not null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operational_unit_aliases_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties(id, tenant_id) on delete restrict,
  constraint operational_unit_aliases_target_scope_fkey
    foreign key (operational_unit_id, tenant_id, property_id)
    references public.operational_units(id, tenant_id, property_id) on delete restrict,
  constraint operational_unit_aliases_source_not_blank check (btrim(source_system) <> '' and btrim(source_value) <> ''),
  constraint operational_unit_aliases_normalized_not_blank check (btrim(normalized_source_value) <> '')
);
create unique index operational_unit_aliases_active_source_uidx
  on public.operational_unit_aliases (property_id, source_system, normalized_source_value) where is_active;
create index operational_unit_aliases_target_idx on public.operational_unit_aliases (operational_unit_id);
create index operational_unit_aliases_approved_by_idx on public.operational_unit_aliases (approved_by) where approved_by is not null;

create table public.position_families (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  code text not null,
  name_zh text not null,
  name_en text,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint position_families_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties(id, tenant_id) on delete restrict,
  constraint position_families_id_tenant_property_key unique (id, tenant_id, property_id),
  constraint position_families_code_format_check check (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint position_families_name_zh_not_blank check (btrim(name_zh) <> ''),
  constraint position_families_property_code_key unique (property_id, code)
);
create index position_families_property_sort_idx on public.position_families (property_id, sort_order, name_zh);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  position_family_id uuid,
  code text not null,
  name_zh text not null,
  name_en text,
  grade_or_band text,
  is_active boolean not null default true,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  constraint positions_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties(id, tenant_id) on delete restrict,
  constraint positions_id_tenant_property_key unique (id, tenant_id, property_id),
  constraint positions_family_scope_fkey
    foreign key (position_family_id, tenant_id, property_id)
    references public.position_families(id, tenant_id, property_id) on delete restrict,
  constraint positions_code_format_check check (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint positions_name_zh_not_blank check (btrim(name_zh) <> ''),
  constraint positions_effective_dates_check check (effective_to is null or effective_from is null or effective_to >= effective_from),
  constraint positions_version_check check (version > 0),
  constraint positions_property_code_key unique (property_id, code)
);
create index positions_property_family_idx on public.positions (property_id, position_family_id, is_active);

create table public.position_department_assignments (
  tenant_id uuid not null,
  property_id uuid not null,
  position_id uuid not null,
  department_id uuid not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (position_id, department_id),
  constraint position_department_assignments_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties(id, tenant_id) on delete restrict,
  constraint position_department_assignments_position_scope_fkey
    foreign key (position_id, tenant_id, property_id)
    references public.positions(id, tenant_id, property_id) on delete cascade,
  constraint position_department_assignments_department_scope_fkey
    foreign key (department_id, tenant_id, property_id)
    references public.departments(id, tenant_id, property_id) on delete restrict
);
create unique index position_department_assignments_primary_uidx
  on public.position_department_assignments (position_id) where is_primary;
create index position_department_assignments_department_idx on public.position_department_assignments (department_id);

create table public.position_aliases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  source_system text not null,
  source_value text not null,
  normalized_source_value text not null,
  target_position_id uuid,
  target_position_family_id uuid,
  external_role_code text,
  external_role_name text,
  resolution_status public.position_resolution_status not null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint position_aliases_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties(id, tenant_id) on delete restrict,
  constraint position_aliases_position_scope_fkey
    foreign key (target_position_id, tenant_id, property_id)
    references public.positions(id, tenant_id, property_id) on delete restrict,
  constraint position_aliases_family_scope_fkey
    foreign key (target_position_family_id, tenant_id, property_id)
    references public.position_families(id, tenant_id, property_id) on delete restrict,
  constraint position_aliases_source_not_blank check (btrim(source_system) <> '' and btrim(source_value) <> ''),
  constraint position_aliases_normalized_not_blank check (btrim(normalized_source_value) <> ''),
  constraint position_aliases_resolution_check check (
    (resolution_status = 'mapped' and target_position_id is not null) or
    (resolution_status = 'family_only' and target_position_family_id is not null and target_position_id is null) or
    (resolution_status = 'external_only' and external_role_code is not null and target_position_id is null) or
    (resolution_status in ('ignored', 'deferred') and target_position_id is null and target_position_family_id is null)
  ),
  constraint position_aliases_approval_check check (
    resolution_status = 'deferred' or (approved_by is not null and approved_at is not null)
  )
);
create unique index position_aliases_active_source_uidx
  on public.position_aliases (property_id, source_system, normalized_source_value) where is_active;
create index position_aliases_position_idx on public.position_aliases (target_position_id) where target_position_id is not null;
create index position_aliases_family_idx on public.position_aliases (target_position_family_id) where target_position_family_id is not null;
create index position_aliases_approved_by_idx on public.position_aliases (approved_by) where approved_by is not null;

alter table public.trainer_scopes
  add constraint trainer_scopes_department_scope_fkey
  foreign key (department_id, tenant_id, property_id)
  references public.departments(id, tenant_id, property_id) on delete restrict
  not valid;

create or replace function app_private.normalize_source_label(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g'));
$$;

create or replace function app_private.prepare_department_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_row public.departments;
begin
  if new.parent_id is null then
    new.depth := 0;
    new.path_ids := array[new.id];
  else
    select * into parent_row from public.departments where id = new.parent_id;
    if not found or parent_row.tenant_id <> new.tenant_id or parent_row.property_id <> new.property_id then
      raise exception 'department parent must belong to the same tenant and property' using errcode = '23514';
    end if;
    new.depth := parent_row.depth + 1;
    new.path_ids := parent_row.path_ids || new.id;
  end if;
  new.code := nullif(lower(btrim(new.code)), '');
  new.name_zh := btrim(new.name_zh);
  new.name_en := nullif(btrim(new.name_en), '');
  return new;
end;
$$;

create or replace function app_private.insert_department_closure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.department_closure
    (tenant_id, property_id, ancestor_department_id, descendant_department_id, distance)
  values (new.tenant_id, new.property_id, new.id, new.id, 0);

  if new.parent_id is not null then
    insert into public.department_closure
      (tenant_id, property_id, ancestor_department_id, descendant_department_id, distance)
    select new.tenant_id, new.property_id, ancestor_department_id, new.id, distance + 1
    from public.department_closure
    where descendant_department_id = new.parent_id;
  end if;
  return new;
end;
$$;

create or replace function app_private.protect_department_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.property_id is distinct from old.property_id then
    raise exception 'department tenant and property are immutable' using errcode = '23514';
  end if;
  if (new.parent_id is distinct from old.parent_id or new.depth is distinct from old.depth or new.path_ids is distinct from old.path_ids)
    and current_setting('app_private.organization_mutation', true) is distinct from 'on' then
    raise exception 'department hierarchy changes require the restricted organization service' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app_private.prepare_source_alias()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.tenant_id is distinct from old.tenant_id or new.property_id is distinct from old.property_id or
    new.source_system is distinct from old.source_system or new.source_value is distinct from old.source_value or
    new.normalized_source_value is distinct from old.normalized_source_value
  ) then
    if tg_table_name = 'position_aliases' then
      raise exception 'position alias source evidence is immutable' using errcode = '23514';
    elsif tg_table_name = 'department_aliases' then
      raise exception 'department alias source evidence is immutable' using errcode = '23514';
    else
      raise exception 'operational unit alias source evidence is immutable' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.source_system := lower(btrim(new.source_system));
    new.source_value := btrim(new.source_value);
    new.normalized_source_value := app_private.normalize_source_label(new.source_value);
  end if;
  return new;
end;
$$;

create or replace function app_private.protect_organization_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.property_id is distinct from old.property_id then
    raise exception 'organization tenant and property are immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app_private.bump_position_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.property_id is distinct from old.property_id then
    raise exception 'position tenant and property are immutable' using errcode = '23514';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger departments_prepare_insert before insert on public.departments
for each row execute function app_private.prepare_department_insert();
create trigger departments_protect_identity before update on public.departments
for each row execute function app_private.protect_department_identity();
create trigger departments_set_updated_at before update on public.departments
for each row execute function app_private.set_updated_at();
create trigger departments_insert_closure after insert on public.departments
for each row execute function app_private.insert_department_closure();

create trigger department_aliases_prepare before insert or update on public.department_aliases
for each row execute function app_private.prepare_source_alias();
create trigger department_aliases_set_updated_at before update on public.department_aliases
for each row execute function app_private.set_updated_at();
create trigger operational_unit_aliases_prepare before insert or update on public.operational_unit_aliases
for each row execute function app_private.prepare_source_alias();
create trigger operational_unit_aliases_set_updated_at before update on public.operational_unit_aliases
for each row execute function app_private.set_updated_at();
create trigger position_aliases_prepare before insert or update on public.position_aliases
for each row execute function app_private.prepare_source_alias();
create trigger position_aliases_set_updated_at before update on public.position_aliases
for each row execute function app_private.set_updated_at();

create trigger operational_units_protect_scope before update on public.operational_units
for each row execute function app_private.protect_organization_scope();
create trigger operational_units_set_updated_at before update on public.operational_units
for each row execute function app_private.set_updated_at();
create trigger position_families_protect_scope before update on public.position_families
for each row execute function app_private.protect_organization_scope();
create trigger position_families_set_updated_at before update on public.position_families
for each row execute function app_private.set_updated_at();
create trigger positions_bump_version before update on public.positions
for each row execute function app_private.bump_position_version();
create trigger position_department_assignments_protect_scope before update on public.position_department_assignments
for each row execute function app_private.protect_organization_scope();

revoke execute on function app_private.normalize_source_label(text) from public, anon, authenticated;
revoke execute on function app_private.prepare_department_insert() from public, anon, authenticated;
revoke execute on function app_private.insert_department_closure() from public, anon, authenticated;
revoke execute on function app_private.protect_department_identity() from public, anon, authenticated;
revoke execute on function app_private.prepare_source_alias() from public, anon, authenticated;
revoke execute on function app_private.protect_organization_scope() from public, anon, authenticated;
revoke execute on function app_private.bump_position_version() from public, anon, authenticated;
