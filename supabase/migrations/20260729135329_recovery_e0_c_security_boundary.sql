-- Recovery E0-C0: platform provisioning is a separate authorization plane.
-- This migration creates no Property, employee, Course, Requirement, Plan,
-- Session, Attendance, or Completion fact. It only defines the controlled
-- database boundary that a later C1 server workflow may invoke.

-- Platform-plane assertions -------------------------------------------------

create or replace function app_private.is_platform_provisioner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.platform_memberships membership
      where membership.user_id = (select auth.uid())
        and membership.role_code = 'platform_admin'
        and membership.is_active
        and membership.revoked_at is null
    );
$$;

create or replace function app_private.assert_platform_provisioner()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not app_private.is_platform_provisioner() then
    raise exception 'PLATFORM_PROVISIONER_REQUIRED' using errcode = '42501';
  end if;
end;
$$;

revoke all on function app_private.is_platform_provisioner() from public, anon;
revoke all on function app_private.assert_platform_provisioner() from public, anon, authenticated;
grant execute on function app_private.is_platform_provisioner() to authenticated;

-- Hotel-plane helpers may never use platform or tenant administration as a
-- substitute for an active property account and hotel role.

create or replace function app_private.can_manage_property(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_authorized_property_role(
    p_property_id,
    'property_ld_manager'
  );
$$;

create or replace function app_private.can_read_property_organization(
  p_property_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_authorized_property_role(
      p_property_id,
      'property_ld_manager'
    )
    or app_private.is_authorized_property_role(
      p_property_id,
      'department_training_admin'
    );
$$;

create or replace function app_private.can_manage_user_account(
  p_tenant_id uuid,
  p_property_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_authorized_property_role(
      p_property_id,
      'property_ld_manager'
    )
    and exists (
      select 1
      from public.properties property
      where property.id = p_property_id
        and property.tenant_id = p_tenant_id
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
    or exists (
      select 1
      from public.property_memberships target_membership
      where target_membership.user_id = p_user_id
        and target_membership.status = 'active'
        and app_private.is_authorized_property_role(
          target_membership.property_id,
          'property_ld_manager'
        )
    );
$$;

create or replace function app_private.can_view_role(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1
      from public.role_assignments own_assignment
      where own_assignment.user_id = (select auth.uid())
        and own_assignment.role_id = p_role_id
        and own_assignment.status = 'active'
    )
    or exists (
      select 1
      from public.user_accounts account
      where account.auth_user_id = (select auth.uid())
        and app_private.is_authorized_property_role(
          account.property_id,
          'property_ld_manager'
        )
    );
$$;

create or replace function app_private.can_read_role_assignment(
  p_user_id uuid,
  p_tenant_id uuid,
  p_property_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id = (select auth.uid())
    or (
      p_property_id is not null
      and app_private.is_authorized_property_role(
        p_property_id,
        'property_ld_manager'
      )
      and exists (
        select 1
        from public.properties property
        where property.id = p_property_id
          and property.tenant_id = p_tenant_id
      )
    );
$$;

create or replace function app_private.can_grant_role(
  p_role_id uuid,
  p_tenant_id uuid,
  p_property_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_property_id is not null
    and app_private.is_authorized_property_role(
      p_property_id,
      'property_ld_manager'
    )
    and exists (
      select 1
      from public.properties property
      join public.roles role on role.id = p_role_id
      where property.id = p_property_id
        and property.tenant_id = p_tenant_id
        and role.is_active
        and role.scope_level in ('property', 'department')
        and role.code in ('property_ld_manager', 'department_training_admin')
    );
$$;

create or replace function app_private.can_read_trainer_scope(
  p_role_assignment_id uuid,
  p_tenant_id uuid,
  p_property_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_authorized_property_role(
      p_property_id,
      'property_ld_manager'
    )
    or exists (
      select 1
      from public.role_assignments assignment
      where assignment.id = p_role_assignment_id
        and assignment.user_id = (select auth.uid())
        and assignment.tenant_id = p_tenant_id
        and assignment.property_id = p_property_id
        and assignment.status = 'active'
    );
$$;

-- Existing manager-only Storage helper inherits the narrowed hotel-plane
-- assertion rather than platform membership.
create or replace function app_private.can_manage_property_brand_object(
  p_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  parts text[];
  object_tenant_id uuid;
  object_property_id uuid;
begin
  parts := string_to_array(p_name, '/');
  if array_length(parts, 1) <> 5
    or parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or parts[3] <> 'branding'
    or parts[4] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or parts[5] !~ '^logo-v[1-9][0-9]*\.(png|jpg|webp)$' then
    return false;
  end if;

  object_tenant_id := parts[1]::uuid;
  object_property_id := parts[2]::uuid;
  return app_private.can_manage_property(object_property_id)
    and exists (
      select 1
      from public.properties property
      where property.id = object_property_id
        and property.tenant_id = object_tenant_id
    );
exception when invalid_text_representation then
  return false;
end;
$$;

-- Direct Data API access can never substitute for provisioning or hotel
-- administration RPCs. SECURITY DEFINER functions below retain the minimal
-- internal write path.

revoke insert, update, delete on public.platform_memberships,
  public.tenants,
  public.tenant_memberships,
  public.properties,
  public.property_memberships,
  public.roles,
  public.role_assignments,
  public.trainer_scopes,
  public.property_domains,
  public.property_settings,
  public.property_initialization_steps
from authenticated;

grant select on public.platform_memberships,
  public.tenants,
  public.tenant_memberships,
  public.properties,
  public.property_memberships,
  public.roles,
  public.role_assignments,
  public.trainer_scopes,
  public.property_domains,
  public.property_settings,
  public.property_initialization_steps
to authenticated;
grant update on public.profiles, public.properties, public.property_settings
to authenticated;

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists platform_memberships_select on public.platform_memberships;
drop policy if exists platform_memberships_insert on public.platform_memberships;
drop policy if exists platform_memberships_update on public.platform_memberships;
create policy platform_memberships_select on public.platform_memberships
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists tenants_select on public.tenants;
drop policy if exists tenants_insert on public.tenants;
drop policy if exists tenants_update on public.tenants;
create policy tenants_select on public.tenants for select to authenticated
using ((select app_private.is_tenant_member(id)));

drop policy if exists tenant_memberships_select on public.tenant_memberships;
drop policy if exists tenant_memberships_insert on public.tenant_memberships;
drop policy if exists tenant_memberships_update on public.tenant_memberships;
create policy tenant_memberships_select on public.tenant_memberships
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists properties_select on public.properties;
drop policy if exists properties_insert on public.properties;
drop policy if exists properties_update on public.properties;
create policy properties_select on public.properties for select to authenticated
using ((select app_private.is_property_member(id)));

drop policy if exists property_memberships_select on public.property_memberships;
drop policy if exists property_memberships_insert on public.property_memberships;
drop policy if exists property_memberships_update on public.property_memberships;
create policy property_memberships_select on public.property_memberships
for select to authenticated
using (
  user_id = (select auth.uid())
  or app_private.is_authorized_property_role(
    property_id,
    'property_ld_manager'
  )
);

drop policy if exists roles_insert on public.roles;
drop policy if exists roles_update on public.roles;

drop policy if exists role_assignments_insert on public.role_assignments;
drop policy if exists role_assignments_update on public.role_assignments;
drop policy if exists trainer_scopes_insert on public.trainer_scopes;
drop policy if exists trainer_scopes_update on public.trainer_scopes;

drop policy if exists property_domains_select on public.property_domains;
drop policy if exists property_domains_insert on public.property_domains;
drop policy if exists property_domains_update on public.property_domains;
create policy property_domains_select on public.property_domains
for select to authenticated
using ((select app_private.is_property_member(property_id)));

drop policy if exists property_settings_select on public.property_settings;
drop policy if exists property_settings_insert on public.property_settings;
drop policy if exists property_settings_update on public.property_settings;
create policy property_settings_select on public.property_settings
for select to authenticated
using ((select app_private.is_property_member(property_id)));
create policy property_settings_update on public.property_settings
for update to authenticated
using ((select app_private.can_manage_property(property_id)))
with check ((select app_private.can_manage_property(property_id)));

drop policy if exists property_brand_assets_select on public.property_brand_assets;
create policy property_brand_assets_select on public.property_brand_assets
for select to authenticated
using ((select app_private.is_property_member(property_id)));

-- Append-only provisioning audit. It is a platform-control record, not a
-- hotel or training business fact, and browser roles have no direct access.

create table public.platform_provisioning_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  property_id uuid not null,
  initial_manager_user_id uuid not null references auth.users(id) on delete restrict,
  initial_manager_account_id uuid not null,
  event_type text not null default 'property_container_and_initial_manager_provisioned',
  request_hash text not null,
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  performed_by uuid not null references auth.users(id) on delete restrict,
  constraint platform_provisioning_events_property_fkey
    foreign key (property_id, tenant_id)
    references public.properties(id, tenant_id) on delete restrict,
  constraint platform_provisioning_events_account_fkey
    foreign key (initial_manager_account_id)
    references public.user_accounts(id) on delete restrict,
  constraint platform_provisioning_events_type_check
    check (event_type = 'property_container_and_initial_manager_provisioned'),
  constraint platform_provisioning_events_request_hash_check
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint platform_provisioning_events_evidence_check
    check (jsonb_typeof(evidence) = 'object'),
  constraint platform_provisioning_events_property_unique unique (property_id)
);

create index platform_provisioning_events_tenant_occurred_idx
  on public.platform_provisioning_events(tenant_id, occurred_at desc);
create index platform_provisioning_events_actor_occurred_idx
  on public.platform_provisioning_events(performed_by, occurred_at desc);

alter table public.platform_provisioning_events enable row level security;
alter table public.platform_provisioning_events force row level security;
revoke all on public.platform_provisioning_events from public, anon, authenticated;

create or replace function app_private.reject_platform_provisioning_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'platform provisioning audit evidence is append-only'
    using errcode = '42501';
end;
$$;

create trigger platform_provisioning_events_append_only
before update or delete on public.platform_provisioning_events
for each row execute function app_private.reject_platform_provisioning_event_mutation();

revoke all on function app_private.reject_platform_provisioning_event_mutation()
from public, anon, authenticated;

-- This function defines the only platform-to-hotel handoff. It does not
-- create auth.users; a later C1 server workflow must provide an existing
-- controlled Auth identity and compensate outside the database if needed.

create or replace function public.provision_initial_property_and_manager(
  p_tenant_id uuid,
  p_property_container jsonb,
  p_initial_manager jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  property_id uuid;
  manager_account_id uuid;
  manager_role_id uuid;
  manager_auth_user_id uuid;
  property_code text;
  name_zh text;
  name_en text;
  brand text;
  city text;
  country_region text;
  timezone_name text;
  default_language text;
  hostname text;
  internal_email text;
  login_id text;
  display_name text;
  request_hash text;
begin
  perform app_private.assert_platform_provisioner();

  if jsonb_typeof(p_property_container) <> 'object'
    or jsonb_typeof(p_initial_manager) <> 'object' then
    raise exception 'PROVISIONING_PAYLOAD_INVALID' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_property_container) key
    where key not in (
      'code', 'nameZh', 'nameEn', 'brand', 'city', 'countryRegion',
      'timezone', 'defaultLanguage', 'hostname'
    )
  ) or exists (
    select 1
    from jsonb_object_keys(p_initial_manager) key
    where key not in ('authUserId', 'internalEmail', 'loginId', 'displayName')
  ) then
    raise exception 'PROVISIONING_PAYLOAD_FIELD_FORBIDDEN' using errcode = '22023';
  end if;

  begin
    manager_auth_user_id := nullif(
      btrim(p_initial_manager->>'authUserId'), ''
    )::uuid;
  exception when invalid_text_representation then
    raise exception 'PROVISIONING_MANAGER_ID_INVALID' using errcode = '22023';
  end;

  property_code := lower(nullif(btrim(p_property_container->>'code'), ''));
  name_zh := nullif(btrim(p_property_container->>'nameZh'), '');
  name_en := nullif(btrim(p_property_container->>'nameEn'), '');
  brand := nullif(btrim(p_property_container->>'brand'), '');
  city := nullif(btrim(p_property_container->>'city'), '');
  country_region := upper(nullif(btrim(p_property_container->>'countryRegion'), ''));
  timezone_name := nullif(btrim(p_property_container->>'timezone'), '');
  default_language := nullif(btrim(p_property_container->>'defaultLanguage'), '');
  hostname := lower(nullif(btrim(p_property_container->>'hostname'), ''));
  internal_email := lower(nullif(btrim(p_initial_manager->>'internalEmail'), ''));
  login_id := nullif(btrim(p_initial_manager->>'loginId'), '');
  display_name := nullif(btrim(p_initial_manager->>'displayName'), '');

  if property_code is null or name_zh is null or name_en is null
    or brand is null or city is null or country_region is null
    or timezone_name is null or default_language is null or hostname is null
    or manager_auth_user_id is null or internal_email is null
    or login_id is null or display_name is null then
    raise exception 'PROVISIONING_REQUIRED_FIELD_MISSING' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.tenants tenant
    where tenant.id = p_tenant_id
      and tenant.status = 'active'
  ) then
    raise exception 'PROVISIONING_TENANT_UNAVAILABLE' using errcode = '22023';
  end if;

  if not exists (select 1 from auth.users where id = manager_auth_user_id) then
    raise exception 'PROVISIONING_MANAGER_AUTH_IDENTITY_MISSING'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.user_accounts account
    where account.auth_user_id = manager_auth_user_id
  ) then
    raise exception 'PROVISIONING_MANAGER_ALREADY_HAS_BACKEND_ACCOUNT'
      using errcode = '22023';
  end if;

  select id into manager_role_id
  from public.roles role
  where role.code = 'property_ld_manager'
    and role.scope_level = 'property'
    and role.is_active;
  if manager_role_id is null then
    raise exception 'PROVISIONING_MANAGER_ROLE_UNAVAILABLE' using errcode = '22023';
  end if;

  insert into public.properties(
    tenant_id, code, name_zh, name_en, short_name, status, brand, city,
    country_region, timezone, default_language, created_by
  ) values (
    p_tenant_id, property_code, name_zh, name_en, name_zh, 'active', brand,
    city, country_region, timezone_name, default_language, auth.uid()
  ) returning id into property_id;

  insert into public.property_domains(
    tenant_id, property_id, hostname, is_primary, verification_status,
    is_active, created_by
  ) values (
    p_tenant_id, property_id, hostname, true, 'pending', true, auth.uid()
  );

  insert into public.property_settings(
    tenant_id, property_id, initialization_state, created_by, updated_by
  ) values (
    p_tenant_id, property_id, 'not_started', auth.uid(), auth.uid()
  );

  insert into public.profiles(id, email, display_name)
  values (manager_auth_user_id, internal_email, display_name)
  on conflict (id) do update
  set display_name = excluded.display_name;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = manager_auth_user_id
      and lower(profile.email) = internal_email
      and profile.is_active
  ) then
    raise exception 'PROVISIONING_MANAGER_PROFILE_MISMATCH' using errcode = '22023';
  end if;

  insert into public.tenant_memberships(
    tenant_id, user_id, status, joined_at, created_by
  ) values (
    p_tenant_id, manager_auth_user_id, 'active', now(), auth.uid()
  );

  insert into public.property_memberships(
    tenant_id, property_id, user_id, status, joined_at, created_by
  ) values (
    p_tenant_id, property_id, manager_auth_user_id, 'active', now(), auth.uid()
  );

  insert into public.role_assignments(
    user_id, role_id, tenant_id, property_id, status, granted_by, granted_at
  ) values (
    manager_auth_user_id, manager_role_id, p_tenant_id, property_id,
    'active', auth.uid(), now()
  );

  insert into public.user_accounts(
    user_id, auth_user_id, tenant_id, property_id, login_id, account_status,
    must_change_password, created_by, updated_by
  ) values (
    manager_auth_user_id, manager_auth_user_id, p_tenant_id, property_id,
    login_id, 'invited', true, auth.uid(), auth.uid()
  ) returning id into manager_account_id;

  request_hash := encode(
    extensions.digest(
      p_tenant_id::text || '|' || p_property_container::text || '|' ||
      p_initial_manager::text,
      'sha256'
    ),
    'hex'
  );

  insert into public.platform_provisioning_events(
    tenant_id, property_id, initial_manager_user_id,
    initial_manager_account_id, request_hash, evidence, performed_by
  ) values (
    p_tenant_id, property_id, manager_auth_user_id, manager_account_id,
    request_hash,
    jsonb_build_object(
      'propertyCode', property_code,
      'hostname', hostname,
      'initialManagerLoginId', login_id,
      'accountStatus', 'invited',
      'roleCode', 'property_ld_manager',
      'domainVerificationStatus', 'pending'
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'propertyId', property_id,
    'tenantId', p_tenant_id,
    'propertyCode', property_code,
    'hostname', hostname,
    'initialManagerAccountId', manager_account_id,
    'initialManagerStatus', 'invited',
    'initializationState', 'not_started'
  );
end;
$$;

revoke all on function public.provision_initial_property_and_manager(
  uuid, jsonb, jsonb
) from public, anon;
grant execute on function public.provision_initial_property_and_manager(
  uuid, jsonb, jsonb
) to authenticated;
