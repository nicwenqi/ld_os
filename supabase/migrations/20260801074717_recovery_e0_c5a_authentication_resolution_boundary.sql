-- Recovery E0 C5-A: resolve hotel application identity through three narrow
-- capabilities. This migration creates no Property, employee or D0-D4 fact,
-- grants no table privilege to service_role, and does not alter RLS.

create or replace function public.resolve_hotel_login_identity(
  p_hostname text,
  p_login_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_normalized_hostname text;
  v_normalized_login_id text;
  resolved_identity jsonb;
begin
  if coalesce((select auth.jwt()->>'role'), '') <> 'service_role' then
    raise exception 'SERVER_LOGIN_RESOLVER_REQUIRED' using errcode = '42501';
  end if;

  v_normalized_hostname := lower(split_part(btrim(coalesce(p_hostname, '')), ':', 1));
  v_normalized_login_id := lower(btrim(coalesce(p_login_id, '')));
  if v_normalized_hostname = '' or char_length(v_normalized_hostname) > 253
    or v_normalized_login_id = '' or char_length(v_normalized_login_id) > 80 then
    return null;
  end if;

  select jsonb_build_object('internalEmail', lower(auth_identity.email))
  into resolved_identity
  from public.property_domains domain
  join public.properties property
    on property.id = domain.property_id
   and property.tenant_id = domain.tenant_id
   and property.status = 'active'
  join public.tenants tenant
    on tenant.id = domain.tenant_id
   and tenant.status = 'active'
  join public.user_accounts account
    on account.tenant_id = domain.tenant_id
   and account.property_id = domain.property_id
   and account.normalized_login_id = v_normalized_login_id
   and account.account_status = 'active'
   and (account.locked_until is null or account.locked_until <= now())
  join public.profiles profile
    on profile.id = account.user_id
   and profile.is_active
  join auth.users auth_identity
    on auth_identity.id = account.auth_user_id
   and auth_identity.email is not null
   and lower(auth_identity.email) = lower(profile.email)
  where domain.hostname = v_normalized_hostname
    and domain.is_primary
    and domain.is_active
    and domain.verification_status = 'verified'
    and domain.verified_at is not null;

  return resolved_identity;
end;
$$;

comment on function public.resolve_hotel_login_identity(text,text) is
  'Server-only User ID to internal Supabase Auth email lookup. It returns no hotel role, scope, employee or business data.';

create or replace function public.resolve_hotel_application_session(
  p_hostname text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_auth_user_id uuid := (select auth.uid());
  v_normalized_hostname text;
  account_user_id uuid;
  account_property_id uuid;
  account_tenant_id uuid;
  account_must_change_password boolean;
  account_display_name text;
  property_name_zh text;
  property_name_en text;
  effective_role text := 'unauthorized';
  department_scopes jsonb := '[]'::jsonb;
begin
  if actor_auth_user_id is null then
    raise exception 'AUTHENTICATED_HOTEL_ACTOR_REQUIRED' using errcode = '42501';
  end if;

  v_normalized_hostname := lower(split_part(btrim(coalesce(p_hostname, '')), ':', 1));
  if v_normalized_hostname = '' or char_length(v_normalized_hostname) > 253 then
    return null;
  end if;

  select
    account.user_id,
    account.property_id,
    account.tenant_id,
    account.must_change_password,
    profile.display_name,
    property.name_zh,
    property.name_en
  into
    account_user_id,
    account_property_id,
    account_tenant_id,
    account_must_change_password,
    account_display_name,
    property_name_zh,
    property_name_en
  from public.property_domains domain
  join public.properties property
    on property.id = domain.property_id
   and property.tenant_id = domain.tenant_id
   and property.status = 'active'
  join public.tenants tenant
    on tenant.id = domain.tenant_id
   and tenant.status = 'active'
  join public.user_accounts account
    on account.tenant_id = domain.tenant_id
   and account.property_id = domain.property_id
   and account.auth_user_id = actor_auth_user_id
   and account.account_status = 'active'
   and (account.locked_until is null or account.locked_until <= now())
  join public.profiles profile
    on profile.id = account.user_id
   and profile.is_active
  join public.tenant_memberships tenant_membership
    on tenant_membership.tenant_id = account.tenant_id
   and tenant_membership.user_id = account.user_id
   and tenant_membership.status = 'active'
  join public.property_memberships property_membership
    on property_membership.tenant_id = account.tenant_id
   and property_membership.property_id = account.property_id
   and property_membership.user_id = account.user_id
   and property_membership.status = 'active'
  where domain.hostname = v_normalized_hostname
    and domain.is_primary
    and domain.is_active
    and domain.verification_status = 'verified'
    and domain.verified_at is not null;

  if account_user_id is null then
    return null;
  end if;

  if app_private.is_authorized_property_role(
    account_property_id,
    'property_ld_manager'
  ) then
    effective_role := 'property_ld_manager';
  elsif app_private.is_authorized_property_role(
    account_property_id,
    'department_training_admin'
  ) then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'departmentId', scope.department_id,
          'departmentNameZh', department.name_zh,
          'departmentNameEn', department.name_en,
          'breadcrumb', (
            select coalesce(jsonb_agg(ancestor.name_zh order by path.ordinality), '[]'::jsonb)
            from unnest(department.path_ids) with ordinality path(department_id, ordinality)
            join public.departments ancestor
              on ancestor.id = path.department_id
             and ancestor.tenant_id = account_tenant_id
             and ancestor.property_id = account_property_id
          ),
          'breadcrumbEn', (
            select coalesce(
              jsonb_agg(coalesce(ancestor.name_en, ancestor.name_zh) order by path.ordinality),
              '[]'::jsonb
            )
            from unnest(department.path_ids) with ordinality path(department_id, ordinality)
            join public.departments ancestor
              on ancestor.id = path.department_id
             and ancestor.tenant_id = account_tenant_id
             and ancestor.property_id = account_property_id
          ),
          'includeDescendants', scope.include_descendants
        )
        order by department.sort_order, department.name_zh, scope.department_id
      ),
      '[]'::jsonb
    )
    into department_scopes
    from public.role_assignments assignment
    join public.roles role
      on role.id = assignment.role_id
     and role.code = 'department_training_admin'
     and role.scope_level = 'department'
     and role.is_active
    join public.trainer_scopes scope
      on scope.role_assignment_id = assignment.id
     and scope.tenant_id = assignment.tenant_id
     and scope.property_id = assignment.property_id
     and scope.is_active
    join public.departments department
      on department.id = scope.department_id
     and department.tenant_id = scope.tenant_id
     and department.property_id = scope.property_id
     and department.is_active
    where assignment.user_id = account_user_id
      and assignment.tenant_id = account_tenant_id
      and assignment.property_id = account_property_id
      and assignment.status = 'active';

    if jsonb_array_length(department_scopes) > 0 then
      effective_role := 'department_training_responsible';
    end if;
  end if;

  return jsonb_build_object(
    'authenticated', true,
    'userId', account_user_id,
    'displayName', account_display_name,
    'propertyId', account_property_id,
    'propertyNameZh', property_name_zh,
    'propertyNameEn', property_name_en,
    'propertyLogoUrl', null,
    'role', effective_role,
    'departmentScopes', department_scopes,
    'mustChangePassword', account_must_change_password
  );
end;
$$;

comment on function public.resolve_hotel_application_session(text) is
  'Authenticated actor projection for one hostname. auth.uid(), active memberships, exact hotel role and stored department scopes are authoritative.';

create or replace function public.record_hotel_login_success(
  p_hostname text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_auth_user_id uuid := (select auth.uid());
  resolved_session jsonb;
  resolved_property_id uuid;
  changed_rows integer;
begin
  if actor_auth_user_id is null then
    raise exception 'AUTHENTICATED_HOTEL_ACTOR_REQUIRED' using errcode = '42501';
  end if;

  resolved_session := public.resolve_hotel_application_session(p_hostname);
  if resolved_session is null
    or resolved_session->>'role' not in (
      'property_ld_manager', 'department_training_responsible'
    ) then
    raise exception 'AUTHORIZED_HOTEL_SESSION_REQUIRED' using errcode = '42501';
  end if;

  resolved_property_id := (resolved_session->>'propertyId')::uuid;
  update public.user_accounts account
  set last_login_at = now(),
      failed_login_count = 0,
      updated_by = actor_auth_user_id
  where account.auth_user_id = actor_auth_user_id
    and account.property_id = resolved_property_id
    and account.account_status = 'active'
    and (account.locked_until is null or account.locked_until <= now());
  get diagnostics changed_rows = row_count;

  if changed_rows <> 1 then
    raise exception 'AUTHORIZED_HOTEL_SESSION_REQUIRED' using errcode = '42501';
  end if;

  return jsonb_build_object('recorded', true);
end;
$$;

comment on function public.record_hotel_login_success(text) is
  'Authenticated own-account login telemetry transition. It cannot change identity, membership, role, scope or account status.';

revoke all on function public.resolve_hotel_login_identity(text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_hotel_application_session(text)
  from public, anon, authenticated, service_role;
revoke all on function public.record_hotel_login_success(text)
  from public, anon, authenticated, service_role;

grant execute on function public.resolve_hotel_login_identity(text,text)
  to service_role;
grant execute on function public.resolve_hotel_application_session(text)
  to authenticated;
grant execute on function public.record_hotel_login_success(text)
  to authenticated;
