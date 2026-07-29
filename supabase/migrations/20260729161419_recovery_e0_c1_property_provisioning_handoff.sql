-- Recovery E0-C1: complete the first Property handoff through the C0
-- platform-only RPC. This replaces no D0-D4 fact semantics and creates no
-- employee, organization, Course, Requirement, Plan, Session, Attendance,
-- Completion, KPI, Feedback, Forecast, Risk, Health, or AI fact.
--
-- The server-side C1 route creates the controlled Auth identity only after a
-- signed preview is accepted. This RPC binds that already-created identity to
-- exactly one Property, active Hotel L&D Manager account, and append-only
-- provisioning event in one transaction.

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

  -- C1 commits the hostname that the platform operator has already validated
  -- for the initial technical handoff. Domain mutation remains outside the
  -- hotel plane and is not available to ordinary hotel administrators.
  insert into public.property_domains(
    tenant_id, property_id, hostname, is_primary, verification_status,
    is_active, created_by
  ) values (
    p_tenant_id, property_id, hostname, true, 'verified', true, auth.uid()
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

  -- An active account is deliberately created with a forced change. This is
  -- the only state that can reach the existing hotel password-change boundary;
  -- it cannot reach ordinary hotel work until that change has completed.
  insert into public.user_accounts(
    user_id, auth_user_id, tenant_id, property_id, login_id, account_status,
    must_change_password, created_by, updated_by
  ) values (
    manager_auth_user_id, manager_auth_user_id, p_tenant_id, property_id,
    login_id, 'active', true, auth.uid(), auth.uid()
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
      'accountStatus', 'active',
      'passwordChangeRequired', true,
      'handoffState', 'manager_password_change_required',
      'roleCode', 'property_ld_manager',
      'domainVerificationStatus', 'verified'
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'propertyId', property_id,
    'hostname', hostname,
    'managerDisplayName', display_name,
    'passwordChangeRequired', true,
    'handoffState', 'manager_password_change_required',
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
