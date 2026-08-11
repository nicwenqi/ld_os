create or replace function app_private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_memberships membership
    where membership.user_id = (select auth.uid())
      and membership.role_code = 'platform_admin'
      and membership.is_active
      and membership.revoked_at is null
  );
$$;

create or replace function app_private.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  );
$$;

create or replace function app_private.is_tenant_admin(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.role_assignments assignment
    join public.roles role on role.id = assignment.role_id
    join public.tenant_memberships membership
      on membership.tenant_id = assignment.tenant_id and membership.user_id = assignment.user_id
    where assignment.user_id = (select auth.uid())
      and assignment.tenant_id = p_tenant_id
      and assignment.property_id is null
      and assignment.status = 'active'
      and role.code = 'tenant_admin'
      and role.scope_level = 'tenant'
      and role.is_active
      and membership.status = 'active'
  );
$$;

create or replace function app_private.is_property_member(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.property_memberships membership
    join public.tenant_memberships tenant_membership
      on tenant_membership.tenant_id = membership.tenant_id
      and tenant_membership.user_id = membership.user_id
    where membership.property_id = p_property_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and tenant_membership.status = 'active'
  );
$$;

create or replace function app_private.has_property_role(p_property_id uuid, p_role_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.role_assignments assignment
    join public.roles role on role.id = assignment.role_id
    join public.property_memberships membership
      on membership.property_id = assignment.property_id and membership.user_id = assignment.user_id
    join public.tenant_memberships tenant_membership
      on tenant_membership.tenant_id = membership.tenant_id
      and tenant_membership.user_id = membership.user_id
    where assignment.user_id = (select auth.uid())
      and assignment.property_id = p_property_id
      and assignment.status = 'active'
      and role.code = p_role_code
      and role.is_active
      and membership.status = 'active'
      and tenant_membership.status = 'active'
  );
$$;

create or replace function app_private.can_read_profile(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id = (select auth.uid())
    or app_private.is_platform_admin()
    or exists (
      select 1 from public.tenant_memberships target_membership
      where target_membership.user_id = p_user_id
        and target_membership.status = 'active'
        and app_private.is_tenant_admin(target_membership.tenant_id)
    )
    or exists (
      select 1
      from public.property_memberships target_membership
      join public.tenant_memberships target_tenant_membership
        on target_tenant_membership.tenant_id = target_membership.tenant_id
        and target_tenant_membership.user_id = target_membership.user_id
      where target_membership.user_id = p_user_id
        and target_membership.status = 'active'
        and target_tenant_membership.status = 'active'
        and app_private.has_property_role(target_membership.property_id, 'property_ld_manager')
    );
$$;

create or replace function app_private.can_view_role(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_admin()
    or exists (
      select 1 from public.role_assignments own_assignment
      where own_assignment.user_id = (select auth.uid())
        and own_assignment.role_id = p_role_id
        and own_assignment.status = 'active'
    )
    or exists (
      select 1 from public.role_assignments admin_assignment
      join public.roles admin_role on admin_role.id = admin_assignment.role_id
      where admin_assignment.user_id = (select auth.uid())
        and admin_assignment.status = 'active'
        and admin_role.code in ('tenant_admin', 'property_ld_manager')
    );
$$;

create or replace function app_private.can_read_role_assignment(
  p_user_id uuid, p_tenant_id uuid, p_property_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id = (select auth.uid())
    or app_private.is_platform_admin()
    or app_private.is_tenant_admin(p_tenant_id)
    or (p_property_id is not null and app_private.has_property_role(p_property_id, 'property_ld_manager'));
$$;

create or replace function app_private.can_grant_role(
  p_role_id uuid, p_tenant_id uuid, p_property_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_admin()
    or (
      app_private.is_tenant_admin(p_tenant_id)
      and exists (
        select 1 from public.roles role
        where role.id = p_role_id
          and role.code <> 'tenant_admin'
          and role.scope_level in ('property', 'department')
          and role.is_active
      )
      and p_property_id is not null
      and exists (
        select 1 from public.properties property
        where property.id = p_property_id and property.tenant_id = p_tenant_id
      )
    );
$$;

create or replace function app_private.can_read_trainer_scope(
  p_role_assignment_id uuid, p_tenant_id uuid, p_property_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_admin()
    or app_private.is_tenant_admin(p_tenant_id)
    or app_private.has_property_role(p_property_id, 'property_ld_manager')
    or exists (
      select 1 from public.role_assignments assignment
      where assignment.id = p_role_assignment_id
        and assignment.user_id = (select auth.uid())
        and assignment.status = 'active'
    );
$$;

create or replace function app_private.protect_profile_security_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'profile identity is immutable' using errcode = '23514';
  end if;
  if (new.email is distinct from old.email or new.is_active is distinct from old.is_active)
    and not app_private.is_platform_admin() then
    raise exception 'profile security fields require platform administrator' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_security_fields before update on public.profiles
for each row execute function app_private.protect_profile_security_fields();

revoke execute on all functions in schema app_private from public, anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.is_platform_admin() to authenticated;
grant execute on function app_private.is_tenant_member(uuid) to authenticated;
grant execute on function app_private.is_tenant_admin(uuid) to authenticated;
grant execute on function app_private.is_property_member(uuid) to authenticated;
grant execute on function app_private.has_property_role(uuid, text) to authenticated;
grant execute on function app_private.can_read_profile(uuid) to authenticated;
grant execute on function app_private.can_view_role(uuid) to authenticated;
grant execute on function app_private.can_read_role_assignment(uuid, uuid, uuid) to authenticated;
grant execute on function app_private.can_grant_role(uuid, uuid, uuid) to authenticated;
grant execute on function app_private.can_read_trainer_scope(uuid, uuid, uuid) to authenticated;

revoke all on public.profiles, public.platform_memberships, public.tenants,
  public.tenant_memberships, public.properties, public.property_memberships,
  public.roles, public.role_assignments, public.trainer_scopes from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.platform_memberships to authenticated;
grant select, insert, update on public.tenants to authenticated;
grant select, insert, update on public.tenant_memberships to authenticated;
grant select, insert, update on public.properties to authenticated;
grant select, insert, update on public.property_memberships to authenticated;
grant select, insert, update on public.roles to authenticated;
grant select, insert, update on public.role_assignments to authenticated;
grant select, insert, update on public.trainer_scopes to authenticated;

alter table public.profiles enable row level security;
alter table public.platform_memberships enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.properties enable row level security;
alter table public.property_memberships enable row level security;
alter table public.roles enable row level security;
alter table public.role_assignments enable row level security;
alter table public.trainer_scopes enable row level security;

alter table public.profiles force row level security;
alter table public.platform_memberships force row level security;
alter table public.tenants force row level security;
alter table public.tenant_memberships force row level security;
alter table public.properties force row level security;
alter table public.property_memberships force row level security;
alter table public.roles force row level security;
alter table public.role_assignments force row level security;
alter table public.trainer_scopes force row level security;

create policy profiles_select on public.profiles for select to authenticated
using ((select app_private.can_read_profile(id)));
create policy profiles_update on public.profiles for update to authenticated
using (id = (select auth.uid()) or (select app_private.is_platform_admin()))
with check (id = (select auth.uid()) or (select app_private.is_platform_admin()));

create policy platform_memberships_select on public.platform_memberships for select to authenticated
using (user_id = (select auth.uid()) or (select app_private.is_platform_admin()));
create policy platform_memberships_insert on public.platform_memberships for insert to authenticated
with check ((select app_private.is_platform_admin()));
create policy platform_memberships_update on public.platform_memberships for update to authenticated
using ((select app_private.is_platform_admin()))
with check ((select app_private.is_platform_admin()));

create policy tenants_select on public.tenants for select to authenticated
using ((select app_private.is_platform_admin()) or (select app_private.is_tenant_member(id)));
create policy tenants_insert on public.tenants for insert to authenticated
with check ((select app_private.is_platform_admin()));
create policy tenants_update on public.tenants for update to authenticated
using ((select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(id)))
with check ((select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(id)));

create policy tenant_memberships_select on public.tenant_memberships for select to authenticated
using (user_id = (select auth.uid()) or (select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(tenant_id)));
create policy tenant_memberships_insert on public.tenant_memberships for insert to authenticated
with check ((select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(tenant_id)));
create policy tenant_memberships_update on public.tenant_memberships for update to authenticated
using ((select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(tenant_id)))
with check ((select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(tenant_id)));

create policy properties_select on public.properties for select to authenticated
using (
  (select app_private.is_platform_admin()) or
  (select app_private.is_tenant_admin(tenant_id)) or
  (select app_private.is_property_member(id))
);
create policy properties_insert on public.properties for insert to authenticated
with check ((select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(tenant_id)));
create policy properties_update on public.properties for update to authenticated
using ((select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(tenant_id)))
with check ((select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(tenant_id)));

create policy property_memberships_select on public.property_memberships for select to authenticated
using (
  user_id = (select auth.uid()) or
  (select app_private.is_platform_admin()) or
  (select app_private.is_tenant_admin(tenant_id)) or
  (select app_private.has_property_role(property_id, 'property_ld_manager'))
);
create policy property_memberships_insert on public.property_memberships for insert to authenticated
with check ((select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(tenant_id)));
create policy property_memberships_update on public.property_memberships for update to authenticated
using ((select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(tenant_id)))
with check ((select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(tenant_id)));

create policy roles_select on public.roles for select to authenticated
using ((select app_private.can_view_role(id)));
create policy roles_insert on public.roles for insert to authenticated
with check ((select app_private.is_platform_admin()));
create policy roles_update on public.roles for update to authenticated
using ((select app_private.is_platform_admin()))
with check ((select app_private.is_platform_admin()));

create policy role_assignments_select on public.role_assignments for select to authenticated
using ((select app_private.can_read_role_assignment(user_id, tenant_id, property_id)));
create policy role_assignments_insert on public.role_assignments for insert to authenticated
with check ((select app_private.can_grant_role(role_id, tenant_id, property_id)));
create policy role_assignments_update on public.role_assignments for update to authenticated
using ((select app_private.can_grant_role(role_id, tenant_id, property_id)))
with check ((select app_private.can_grant_role(role_id, tenant_id, property_id)));

create policy trainer_scopes_select on public.trainer_scopes for select to authenticated
using ((select app_private.can_read_trainer_scope(role_assignment_id, tenant_id, property_id)));
create policy trainer_scopes_insert on public.trainer_scopes for insert to authenticated
with check ((select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(tenant_id)));
create policy trainer_scopes_update on public.trainer_scopes for update to authenticated
using ((select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(tenant_id)))
with check ((select app_private.is_platform_admin()) or (select app_private.is_tenant_admin(tenant_id)));
