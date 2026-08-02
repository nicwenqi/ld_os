-- Narrow hardening for the Platform Property account lifecycle boundary.
--
-- This migration does not touch D0-D4 facts. It removes the internal Auth UUID
-- from an authenticated RPC projection and adds append-only compensation
-- evidence when server-side Auth identity cleanup succeeds or needs review.

alter table public.platform_account_management_events
  drop constraint platform_account_management_events_target_auth_user_id_fkey;

alter table public.platform_account_management_events
  add constraint platform_account_management_events_target_auth_user_id_fkey
  foreign key (target_auth_user_id) references auth.users(id) on delete set null;

alter table public.platform_account_management_events
  drop constraint platform_account_management_events_type_check;

alter table public.platform_account_management_events
  add constraint platform_account_management_events_type_check
  check (event_type in (
    'manager_created',
    'manager_password_reset_requested',
    'manager_password_reset_succeeded',
    'manager_password_reset_failed',
    'manager_status_changed',
    'manager_replaced',
    'manager_create_auth_cleanup_succeeded',
    'manager_create_auth_cleanup_failed',
    'manager_replace_auth_cleanup_succeeded',
    'manager_replace_auth_cleanup_failed'
  ));

create or replace function public.platform_prepare_manager_password_reset(
  p_property_id uuid,
  p_account_id uuid,
  p_expected_version bigint,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_row public.user_accounts%rowtype;
  property_row public.properties%rowtype;
  role_exists boolean;
  event_id uuid;
  request_id text := btrim(coalesce(p_request_id, ''));
begin
  perform app_private.assert_platform_provisioner();
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hotel-ld-os:platform-property-account:' || p_property_id::text, 0)
  );
  select * into property_row from public.properties where id = p_property_id for share;
  select * into account_row from public.user_accounts where id = p_account_id and property_id = p_property_id for update;
  if property_row.id is null or account_row.id is null or request_id = '' then
    raise exception 'PLATFORM_MANAGER_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_expected_version is null or account_row.version <> p_expected_version then
    raise exception 'PLATFORM_MANAGER_ACCOUNT_STALE' using errcode = 'P0003';
  end if;
  select exists (
    select 1 from public.role_assignments assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.user_id = account_row.user_id
      and assignment.property_id = p_property_id
      and assignment.status = 'active'
      and role.code = 'property_ld_manager'
      and role.is_active
  ) into role_exists;
  if not role_exists then
    raise exception 'PLATFORM_MANAGER_ROLE_REQUIRED' using errcode = '42501';
  end if;

  update public.user_accounts
  set must_change_password = true,
      failed_login_count = 0,
      locked_until = null,
      updated_by = auth.uid(),
      version = version + 1
  where id = p_account_id;

  insert into public.platform_account_management_events(
    tenant_id, property_id, account_id, target_auth_user_id, performed_by,
    event_type, outcome, request_id, request_hash,
    before_state, after_state
  ) values (
    property_row.tenant_id, p_property_id, p_account_id, account_row.auth_user_id, auth.uid(),
    'manager_password_reset_requested', 'requested', request_id,
    encode(extensions.digest(request_id || '|' || p_account_id::text, 'sha256'), 'hex'),
    jsonb_build_object('mustChangePassword', account_row.must_change_password, 'version', account_row.version),
    jsonb_build_object('mustChangePassword', true, 'version', account_row.version + 1)
  ) returning id into event_id;

  return jsonb_build_object('eventId', event_id, 'version', account_row.version + 1);
end;
$$;

create or replace function public.platform_record_manager_auth_cleanup_result(
  p_property_id uuid,
  p_target_auth_user_id uuid,
  p_operation text,
  p_succeeded boolean,
  p_request_id text,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  property_row public.properties%rowtype;
  operation text := btrim(coalesce(p_operation, ''));
  request_id text := btrim(coalesce(p_request_id, ''));
  error_code text := nullif(left(btrim(coalesce(p_error_code, '')), 120), '');
begin
  perform app_private.assert_platform_provisioner();
  select * into property_row from public.properties where id = p_property_id for share;
  if property_row.id is null or p_target_auth_user_id is null or request_id = ''
    or operation not in ('create', 'replace') then
    raise exception 'PLATFORM_MANAGER_CLEANUP_INPUT_INVALID' using errcode = '22023';
  end if;

  insert into public.platform_account_management_events(
    tenant_id, property_id, target_auth_user_id, performed_by,
    event_type, outcome, request_id, request_hash, after_state, error_code
  ) values (
    property_row.tenant_id, p_property_id, p_target_auth_user_id, auth.uid(),
    case
      when operation = 'create' and p_succeeded then 'manager_create_auth_cleanup_succeeded'
      when operation = 'create' then 'manager_create_auth_cleanup_failed'
      when p_succeeded then 'manager_replace_auth_cleanup_succeeded'
      else 'manager_replace_auth_cleanup_failed'
    end,
    case when p_succeeded then 'succeeded' else 'failed' end,
    request_id,
    encode(extensions.digest(request_id || '|' || p_target_auth_user_id::text || '|' || operation, 'sha256'), 'hex'),
    jsonb_build_object('authIdentityCleanup', case when p_succeeded then 'succeeded' else 'failed' end, 'operation', operation),
    error_code
  );

  return jsonb_build_object('recorded', true);
end;
$$;

revoke all on function public.platform_prepare_manager_password_reset(uuid, uuid, bigint, text)
  from public, anon, service_role;
revoke all on function public.platform_record_manager_auth_cleanup_result(uuid, uuid, text, boolean, text, text)
  from public, anon, service_role;

grant execute on function public.platform_prepare_manager_password_reset(uuid, uuid, bigint, text)
  to authenticated;
grant execute on function public.platform_record_manager_auth_cleanup_result(uuid, uuid, text, boolean, text, text)
  to authenticated;

-- The original Platform account lifecycle migration used variable names that
-- collide with user_accounts columns in two global-login-ID checks. Recompile
-- the same narrow operations with explicitly named local variables so live
-- calls cannot fail before their audited transaction begins.
create or replace function public.platform_create_property_manager_account(
  p_property_id uuid,
  p_auth_user_id uuid,
  p_internal_email text,
  p_login_id text,
  p_display_name text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  property_row public.properties%rowtype;
  role_id uuid;
  account_id uuid;
  v_normalized_login_id text := lower(btrim(coalesce(p_login_id, '')));
  v_normalized_email text := lower(btrim(coalesce(p_internal_email, '')));
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_request_id text := btrim(coalesce(p_request_id, ''));
  created_projection jsonb;
begin
  perform app_private.assert_platform_provisioner();
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hotel-ld-os:platform-property-account:' || p_property_id::text, 0)
  );
  select * into property_row from public.properties where id = p_property_id for share;
  if property_row.id is null then
    raise exception 'PLATFORM_PROPERTY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_auth_user_id is null or v_normalized_email = '' or v_normalized_login_id = ''
    or v_display_name = '' or v_request_id = '' then
    raise exception 'PLATFORM_MANAGER_INPUT_INVALID' using errcode = '22023';
  end if;
  if v_normalized_email !~ '^[^@[:space:]]+@accounts\.ldchub\.cn$'
    or v_normalized_login_id !~ '^[a-z0-9][a-z0-9._-]{2,79}$' then
    raise exception 'PLATFORM_MANAGER_INPUT_INVALID' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users auth_identity where auth_identity.id = p_auth_user_id and lower(auth_identity.email) = v_normalized_email) then
    raise exception 'PLATFORM_MANAGER_AUTH_IDENTITY_INVALID' using errcode = '22023';
  end if;
  if exists (select 1 from public.platform_memberships membership where membership.user_id = p_auth_user_id)
    or exists (select 1 from public.user_accounts account where account.auth_user_id = p_auth_user_id) then
    raise exception 'PLATFORM_MANAGER_AUTH_IDENTITY_ALREADY_LINKED' using errcode = '22023';
  end if;
  if exists (select 1 from public.user_accounts account where account.normalized_login_id = v_normalized_login_id) then
    raise exception 'PLATFORM_MANAGER_LOGIN_ID_ALREADY_EXISTS' using errcode = '23505';
  end if;
  select id into role_id from public.roles
  where code = 'property_ld_manager' and scope_level = 'property' and is_active;
  if role_id is null then
    raise exception 'PLATFORM_MANAGER_ROLE_UNAVAILABLE' using errcode = '22023';
  end if;

  insert into public.profiles(id, email, display_name, full_name, is_active)
  values (p_auth_user_id, v_normalized_email, v_display_name, v_display_name, true);
  insert into public.tenant_memberships(tenant_id, user_id, status, joined_at, created_by)
  values (property_row.tenant_id, p_auth_user_id, 'active', now(), auth.uid());
  insert into public.property_memberships(tenant_id, property_id, user_id, status, joined_at, created_by)
  values (property_row.tenant_id, p_property_id, p_auth_user_id, 'active', now(), auth.uid());
  insert into public.role_assignments(user_id, role_id, tenant_id, property_id, status, granted_by, granted_at)
  values (p_auth_user_id, role_id, property_row.tenant_id, p_property_id, 'active', auth.uid(), now());
  insert into public.user_accounts(
    user_id, auth_user_id, tenant_id, property_id, login_id,
    account_status, must_change_password, created_by, updated_by
  ) values (
    p_auth_user_id, p_auth_user_id, property_row.tenant_id, p_property_id,
    v_normalized_login_id, 'active', true, auth.uid(), auth.uid()
  ) returning id into account_id;

  created_projection := app_private.platform_manager_account_projection(account_id);
  insert into public.platform_account_management_events(
    tenant_id, property_id, account_id, target_auth_user_id, performed_by,
    event_type, outcome, request_id, request_hash, after_state
  ) values (
    property_row.tenant_id, p_property_id, account_id, p_auth_user_id, auth.uid(),
    'manager_created', 'succeeded', v_request_id,
    encode(extensions.digest(v_request_id || '|' || account_id::text, 'sha256'), 'hex'),
    created_projection
  );
  return created_projection;
end;
$$;

create or replace function public.platform_replace_property_manager(
  p_property_id uuid,
  p_old_account_id uuid,
  p_new_auth_user_id uuid,
  p_new_internal_email text,
  p_new_login_id text,
  p_new_display_name text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  property_row public.properties%rowtype;
  old_account public.user_accounts%rowtype;
  role_id uuid;
  new_account_id uuid;
  new_projection jsonb;
  v_normalized_login_id text := lower(btrim(coalesce(p_new_login_id, '')));
  v_normalized_email text := lower(btrim(coalesce(p_new_internal_email, '')));
  v_display_name text := btrim(coalesce(p_new_display_name, ''));
  v_request_id text := btrim(coalesce(p_request_id, ''));
begin
  perform app_private.assert_platform_provisioner();
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hotel-ld-os:platform-property-account:' || p_property_id::text, 0)
  );
  select * into property_row from public.properties where id = p_property_id for share;
  select * into old_account from public.user_accounts where id = p_old_account_id and property_id = p_property_id for update;
  if property_row.id is null or old_account.id is null or v_request_id = '' then
    raise exception 'PLATFORM_MANAGER_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_new_auth_user_id is null or v_normalized_email = '' or v_normalized_login_id = '' or v_display_name = '' then
    raise exception 'PLATFORM_MANAGER_INPUT_INVALID' using errcode = '22023';
  end if;
  if v_normalized_email !~ '^[^@[:space:]]+@accounts\.ldchub\.cn$'
    or v_normalized_login_id !~ '^[a-z0-9][a-z0-9._-]{2,79}$' then
    raise exception 'PLATFORM_MANAGER_INPUT_INVALID' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users auth_identity where auth_identity.id = p_new_auth_user_id and lower(auth_identity.email) = v_normalized_email) then
    raise exception 'PLATFORM_MANAGER_AUTH_IDENTITY_INVALID' using errcode = '22023';
  end if;
  if exists (select 1 from public.user_accounts account where account.normalized_login_id = v_normalized_login_id)
    or exists (select 1 from public.platform_memberships membership where membership.user_id = p_new_auth_user_id)
    or exists (select 1 from public.user_accounts account where account.auth_user_id = p_new_auth_user_id) then
    raise exception 'PLATFORM_MANAGER_IDENTITY_OR_LOGIN_ALREADY_EXISTS' using errcode = '23505';
  end if;
  if not exists (
    select 1 from public.role_assignments assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.user_id = old_account.user_id
      and assignment.property_id = p_property_id
      and assignment.status = 'active'
      and role.code = 'property_ld_manager'
      and role.is_active
  ) then
    raise exception 'PLATFORM_MANAGER_ROLE_REQUIRED' using errcode = '42501';
  end if;
  select id into role_id from public.roles where code = 'property_ld_manager' and scope_level = 'property' and is_active;
  if role_id is null then
    raise exception 'PLATFORM_MANAGER_ROLE_UNAVAILABLE' using errcode = '22023';
  end if;

  insert into public.profiles(id, email, display_name, full_name, is_active)
  values (p_new_auth_user_id, v_normalized_email, v_display_name, v_display_name, true);
  insert into public.tenant_memberships(tenant_id, user_id, status, joined_at, created_by)
  values (property_row.tenant_id, p_new_auth_user_id, 'active', now(), auth.uid());
  insert into public.property_memberships(tenant_id, property_id, user_id, status, joined_at, created_by)
  values (property_row.tenant_id, p_property_id, p_new_auth_user_id, 'active', now(), auth.uid());
  insert into public.role_assignments(user_id, role_id, tenant_id, property_id, status, granted_by, granted_at)
  values (p_new_auth_user_id, role_id, property_row.tenant_id, p_property_id, 'active', auth.uid(), now());
  insert into public.user_accounts(
    user_id, auth_user_id, tenant_id, property_id, login_id,
    account_status, must_change_password, created_by, updated_by
  ) values (
    p_new_auth_user_id, p_new_auth_user_id, property_row.tenant_id, p_property_id,
    v_normalized_login_id, 'active', true, auth.uid(), auth.uid()
  ) returning id into new_account_id;

  update public.user_accounts
  set account_status = 'disabled', updated_by = auth.uid(), version = version + 1
  where id = old_account.id;
  new_projection := app_private.platform_manager_account_projection(new_account_id);
  insert into public.platform_account_management_events(
    tenant_id, property_id, account_id, target_auth_user_id, performed_by,
    event_type, outcome, request_id, request_hash,
    before_state, after_state
  ) values (
    property_row.tenant_id, p_property_id, old_account.id, old_account.auth_user_id, auth.uid(),
    'manager_replaced', 'succeeded', v_request_id,
    encode(extensions.digest(v_request_id || '|' || old_account.id::text || '|' || new_account_id::text, 'sha256'), 'hex'),
    jsonb_build_object('oldAccountId', old_account.id, 'oldStatus', old_account.account_status::text),
    jsonb_build_object('newAccountId', new_account_id, 'newStatus', 'active')
  );
  return jsonb_build_object(
    'newManager', new_projection,
    'replacedAccountId', old_account.id
  );
end;
$$;

revoke all on function public.platform_create_property_manager_account(uuid, uuid, text, text, text, text)
  from public, anon, service_role;
revoke all on function public.platform_replace_property_manager(uuid, uuid, uuid, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.platform_create_property_manager_account(uuid, uuid, text, text, text, text)
  to authenticated;
grant execute on function public.platform_replace_property_manager(uuid, uuid, uuid, text, text, text, text)
  to authenticated;
