create extension if not exists pgcrypto with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create type public.entity_status as enum ('initializing', 'active', 'inactive');
create type public.membership_status as enum ('invited', 'active', 'suspended', 'revoked');
create type public.role_scope as enum ('tenant', 'property', 'department');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  full_name text,
  locale text not null default 'zh-CN',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_not_blank check (btrim(email) <> ''),
  constraint profiles_display_name_not_blank check (btrim(display_name) <> '')
);
create unique index profiles_email_lower_uidx on public.profiles (lower(email));

create table public.platform_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role_code text not null,
  is_active boolean not null default true,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_memberships_role_code_check check (role_code = 'platform_admin'),
  constraint platform_memberships_revocation_check check (is_active or revoked_at is not null),
  constraint platform_memberships_user_role_key unique (user_id, role_code)
);
create index platform_memberships_active_user_idx on public.platform_memberships (user_id)
where is_active and revoked_at is null;
create index platform_memberships_granted_by_idx on public.platform_memberships (granted_by);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  status public.entity_status not null default 'initializing',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_code_format_check check (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint tenants_name_not_blank check (btrim(name) <> ''),
  constraint tenants_code_key unique (code)
);
create index tenants_created_by_idx on public.tenants (created_by);

create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  status public.membership_status not null default 'invited',
  joined_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_memberships_user_key unique (tenant_id, user_id),
  constraint tenant_memberships_revocation_check check (status <> 'revoked' or revoked_at is not null)
);
create index tenant_memberships_user_status_idx on public.tenant_memberships (user_id, tenant_id, status);
create index tenant_memberships_tenant_status_idx on public.tenant_memberships (tenant_id, status);
create index tenant_memberships_created_by_idx on public.tenant_memberships (created_by);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  code text not null,
  name_zh text not null,
  name_en text not null,
  short_name text,
  status public.entity_status not null default 'initializing',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint properties_code_format_check check (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint properties_name_zh_not_blank check (btrim(name_zh) <> ''),
  constraint properties_name_en_not_blank check (btrim(name_en) <> ''),
  constraint properties_tenant_code_key unique (tenant_id, code),
  constraint properties_id_tenant_key unique (id, tenant_id)
);
create index properties_tenant_status_idx on public.properties (tenant_id, status);
create index properties_created_by_idx on public.properties (created_by);

create table public.property_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  status public.membership_status not null default 'invited',
  joined_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_memberships_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties(id, tenant_id) on delete restrict,
  constraint property_memberships_tenant_membership_fkey
    foreign key (tenant_id, user_id) references public.tenant_memberships(tenant_id, user_id) on delete restrict,
  constraint property_memberships_user_key unique (property_id, user_id),
  constraint property_memberships_revocation_check check (status <> 'revoked' or revoked_at is not null)
);
create index property_memberships_user_status_idx on public.property_memberships (user_id, property_id, status);
create index property_memberships_tenant_status_idx on public.property_memberships (tenant_id, status);
create index property_memberships_property_status_idx on public.property_memberships (property_id, status);
create index property_memberships_created_by_idx on public.property_memberships (created_by);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_zh text not null,
  name_en text not null,
  scope_level public.role_scope not null,
  permission_codes text[] not null default '{}',
  is_system boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_code_format_check check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint roles_name_zh_not_blank check (btrim(name_zh) <> ''),
  constraint roles_name_en_not_blank check (btrim(name_en) <> '')
);

create table public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  property_id uuid,
  status public.membership_status not null default 'active',
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint role_assignments_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties(id, tenant_id) on delete restrict,
  constraint role_assignments_tenant_membership_fkey
    foreign key (tenant_id, user_id) references public.tenant_memberships(tenant_id, user_id) on delete restrict,
  constraint role_assignments_id_tenant_property_key unique (id, tenant_id, property_id),
  constraint role_assignments_scope_presence_check check (tenant_id is not null),
  constraint role_assignments_revocation_check check (status <> 'revoked' or revoked_at is not null)
);
create unique index role_assignments_active_scope_uidx
  on public.role_assignments (user_id, role_id, tenant_id, coalesce(property_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'active';
create index role_assignments_user_status_idx on public.role_assignments (user_id, status);
create index role_assignments_tenant_status_idx on public.role_assignments (tenant_id, status);
create index role_assignments_property_status_idx on public.role_assignments (property_id, status) where property_id is not null;
create index role_assignments_role_idx on public.role_assignments (role_id);
create index role_assignments_granted_by_idx on public.role_assignments (granted_by);

create table public.trainer_scopes (
  id uuid primary key default gen_random_uuid(),
  role_assignment_id uuid not null,
  tenant_id uuid not null,
  property_id uuid not null,
  department_id uuid not null,
  include_descendants boolean not null default true,
  is_active boolean not null default true,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainer_scopes_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties(id, tenant_id) on delete restrict,
  constraint trainer_scopes_assignment_scope_fkey
    foreign key (role_assignment_id, tenant_id, property_id)
    references public.role_assignments(id, tenant_id, property_id) on delete restrict,
  constraint trainer_scopes_assignment_department_key unique (role_assignment_id, department_id),
  constraint trainer_scopes_revocation_check check (is_active or revoked_at is not null)
);
comment on column public.trainer_scopes.department_id is
  'Reserved department identifier. A foreign key and descendant helper are added with the department hierarchy migration.';
create index trainer_scopes_assignment_idx on public.trainer_scopes (role_assignment_id);
create index trainer_scopes_property_active_idx on public.trainer_scopes (property_id, is_active);
create index trainer_scopes_tenant_idx on public.trainer_scopes (tenant_id);
create index trainer_scopes_department_active_idx on public.trainer_scopes (department_id) where is_active;
create index trainer_scopes_granted_by_idx on public.trainer_scopes (granted_by);

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app_private.prevent_scope_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'platform_memberships' and
    (new.user_id is distinct from old.user_id or new.role_code is distinct from old.role_code) then
    raise exception 'platform membership identity is immutable' using errcode = '23514';
  elsif tg_table_name = 'tenant_memberships' and
    (new.tenant_id is distinct from old.tenant_id or new.user_id is distinct from old.user_id) then
    raise exception 'tenant membership scope is immutable' using errcode = '23514';
  elsif tg_table_name = 'properties' and new.tenant_id is distinct from old.tenant_id then
    raise exception 'property tenant is immutable' using errcode = '23514';
  elsif tg_table_name = 'property_memberships' and
    (new.tenant_id is distinct from old.tenant_id or new.property_id is distinct from old.property_id or new.user_id is distinct from old.user_id) then
    raise exception 'property membership scope is immutable' using errcode = '23514';
  elsif tg_table_name = 'role_assignments' and
    (new.user_id is distinct from old.user_id or new.role_id is distinct from old.role_id or
     new.tenant_id is distinct from old.tenant_id or new.property_id is distinct from old.property_id) then
    raise exception 'role assignment identity and scope are immutable' using errcode = '23514';
  elsif tg_table_name = 'trainer_scopes' and
    (new.role_assignment_id is distinct from old.role_assignment_id or new.tenant_id is distinct from old.tenant_id or
     new.property_id is distinct from old.property_id or new.department_id is distinct from old.department_id) then
    raise exception 'trainer scope identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_role_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_scope public.role_scope;
  selected_code text;
begin
  select role.scope_level, role.code into selected_scope, selected_code
  from public.roles as role
  where role.id = new.role_id and role.is_active;

  if selected_scope is null then
    raise exception 'role must exist and be active' using errcode = '23514';
  end if;

  if selected_scope = 'tenant' then
    if new.property_id is not null then
      raise exception 'tenant role cannot reference a property' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.tenant_memberships membership
      where membership.tenant_id = new.tenant_id and membership.user_id = new.user_id and membership.status = 'active'
    ) then
      raise exception 'tenant role requires an active tenant membership' using errcode = '23514';
    end if;
  else
    if new.property_id is null then
      raise exception 'property and department roles require a property' using errcode = '23514';
    end if;
    if not exists (
      select 1
      from public.property_memberships membership
      join public.tenant_memberships tenant_membership
        on tenant_membership.tenant_id = membership.tenant_id
        and tenant_membership.user_id = membership.user_id
      where membership.tenant_id = new.tenant_id
        and membership.property_id = new.property_id
        and membership.user_id = new.user_id
        and membership.status = 'active'
        and tenant_membership.status = 'active'
    ) then
      raise exception 'scoped role requires an active property membership' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_trainer_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.role_assignments assignment
    join public.roles role on role.id = assignment.role_id
    join public.property_memberships property_membership
      on property_membership.property_id = assignment.property_id
      and property_membership.user_id = assignment.user_id
    join public.tenant_memberships tenant_membership
      on tenant_membership.tenant_id = assignment.tenant_id
      and tenant_membership.user_id = assignment.user_id
    where assignment.id = new.role_assignment_id
      and assignment.tenant_id = new.tenant_id
      and assignment.property_id = new.property_id
      and assignment.status = 'active'
      and role.code = 'department_training_admin'
      and role.scope_level = 'department'
      and property_membership.status = 'active'
      and tenant_membership.status = 'active'
  ) then
    raise exception 'trainer scope requires an active department training administrator assignment' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function app_private.set_updated_at();
create trigger platform_memberships_set_updated_at before update on public.platform_memberships
for each row execute function app_private.set_updated_at();
create trigger tenants_set_updated_at before update on public.tenants
for each row execute function app_private.set_updated_at();
create trigger tenant_memberships_set_updated_at before update on public.tenant_memberships
for each row execute function app_private.set_updated_at();
create trigger properties_set_updated_at before update on public.properties
for each row execute function app_private.set_updated_at();
create trigger property_memberships_set_updated_at before update on public.property_memberships
for each row execute function app_private.set_updated_at();
create trigger roles_set_updated_at before update on public.roles
for each row execute function app_private.set_updated_at();
create trigger role_assignments_set_updated_at before update on public.role_assignments
for each row execute function app_private.set_updated_at();
create trigger trainer_scopes_set_updated_at before update on public.trainer_scopes
for each row execute function app_private.set_updated_at();

create trigger platform_memberships_immutable_scope before update on public.platform_memberships
for each row execute function app_private.prevent_scope_identity_change();
create trigger tenant_memberships_immutable_scope before update on public.tenant_memberships
for each row execute function app_private.prevent_scope_identity_change();
create trigger properties_immutable_tenant before update on public.properties
for each row execute function app_private.prevent_scope_identity_change();
create trigger property_memberships_immutable_scope before update on public.property_memberships
for each row execute function app_private.prevent_scope_identity_change();
create trigger role_assignments_immutable_scope before update on public.role_assignments
for each row execute function app_private.prevent_scope_identity_change();
create trigger trainer_scopes_immutable_scope before update on public.trainer_scopes
for each row execute function app_private.prevent_scope_identity_change();

create trigger role_assignments_validate before insert or update on public.role_assignments
for each row execute function app_private.validate_role_assignment();
create trigger trainer_scopes_validate before insert or update on public.trainer_scopes
for each row execute function app_private.validate_trainer_scope();
