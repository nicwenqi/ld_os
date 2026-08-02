-- Platform Admin existing-Property account lifecycle boundary.
--
-- This migration exposes only Property metadata and Hotel L&D Manager account
-- lifecycle operations. It does not expose or mutate hotel business data,
-- employees, department scopes, or D0-D4 facts.

create unique index if not exists user_accounts_normalized_login_global_uidx
  on public.user_accounts(normalized_login_id);

create table public.platform_account_management_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  account_id uuid references public.user_accounts(id) on delete restrict,
  target_auth_user_id uuid references auth.users(id) on delete restrict,
  performed_by uuid not null references auth.users(id) on delete restrict,
  event_type text not null,
  outcome text not null check (outcome in ('requested', 'succeeded', 'failed')),
  request_id text not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  error_code text,
  occurred_at timestamptz not null default now(),
  constraint platform_account_management_events_type_check
    check (event_type in (
      'manager_created',
      'manager_password_reset_requested',
      'manager_password_reset_succeeded',
      'manager_password_reset_failed',
      'manager_status_changed',
      'manager_replaced'
    )),
  constraint platform_account_management_events_request_id_check
    check (btrim(request_id) <> '' and char_length(request_id) <= 120),
  constraint platform_account_management_events_json_check
    check (jsonb_typeof(before_state) = 'object' and jsonb_typeof(after_state) = 'object')
);

create index platform_account_management_events_property_idx
  on public.platform_account_management_events(property_id, occurred_at desc);
create index platform_account_management_events_account_idx
  on public.platform_account_management_events(account_id, occurred_at desc);

alter table public.platform_account_management_events enable row level security;
alter table public.platform_account_management_events force row level security;
revoke all on public.platform_account_management_events from public, anon, authenticated, service_role;

create or replace function app_private.reject_platform_account_management_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'platform account-management audit evidence is append-only'
    using errcode = '42501';
end;
$$;

revoke all on function app_private.reject_platform_account_management_event_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists platform_account_management_events_append_only
  on public.platform_account_management_events;
create trigger platform_account_management_events_append_only
before update or delete on public.platform_account_management_events
for each row execute function app_private.reject_platform_account_management_event_mutation();

create or replace function app_private.platform_manager_account_projection(
  p_account_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'accountId', account.id,
    'displayName', profile.display_name,
    'loginId', account.login_id,
    'roleCode', 'property_ld_manager',
    'status', account.account_status::text,
    'mustChangePassword', account.must_change_password,
    'lastLoginAt', account.last_login_at,
    'version', account.version,
    'updatedAt', account.updated_at
  )
  from public.user_accounts account
  join public.profiles profile on profile.id = account.user_id
  join public.role_assignments assignment
    on assignment.user_id = account.user_id
   and assignment.property_id = account.property_id
   and assignment.status = 'active'
  join public.roles role
    on role.id = assignment.role_id
   and role.code = 'property_ld_manager'
   and role.is_active
  where account.id = p_account_id;
$$;

revoke all on function app_private.platform_manager_account_projection(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.platform_list_properties()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform app_private.assert_platform_provisioner();

  select coalesce(jsonb_agg(item order by item->>'propertyCode'), '[]'::jsonb)
    into result
  from (
    select jsonb_build_object(
      'propertyId', property.id,
      'propertyCode', property.code,
      'nameZh', property.name_zh,
      'nameEn', property.name_en,
      'status', property.status::text,
      'hostname', (
        select domain.hostname
        from public.property_domains domain
        where domain.property_id = property.id
          and domain.tenant_id = property.tenant_id
          and domain.is_primary
          and domain.is_active
        order by domain.created_at asc
        limit 1
      ),
      'initializationState', (
        select settings.initialization_state::text
        from public.property_settings settings
        where settings.property_id = property.id
          and settings.tenant_id = property.tenant_id
        limit 1
      ),
      'managerCount', (
        select count(*)::integer
        from public.user_accounts account
        join public.role_assignments assignment
          on assignment.user_id = account.user_id
         and assignment.property_id = account.property_id
         and assignment.status = 'active'
        join public.roles role
          on role.id = assignment.role_id
         and role.code = 'property_ld_manager'
         and role.is_active
        where account.property_id = property.id
      ),
      'activeManagerCount', (
        select count(*)::integer
        from public.user_accounts account
        join public.role_assignments assignment
          on assignment.user_id = account.user_id
         and assignment.property_id = account.property_id
         and assignment.status = 'active'
        join public.roles role
          on role.id = assignment.role_id
         and role.code = 'property_ld_manager'
         and role.is_active
        where account.property_id = property.id
          and account.account_status = 'active'
          and account.locked_until is null
      ),
      'latestManagerLoginAt', (
        select max(account.last_login_at)
        from public.user_accounts account
        join public.role_assignments assignment
          on assignment.user_id = account.user_id
         and assignment.property_id = account.property_id
         and assignment.status = 'active'
        join public.roles role
          on role.id = assignment.role_id
         and role.code = 'property_ld_manager'
         and role.is_active
        where account.property_id = property.id
      )
    ) as item
    from public.properties property
  ) properties;

  return result;
end;
$$;

create or replace function public.platform_list_property_manager_accounts(
  p_property_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform app_private.assert_platform_provisioner();
  if not exists (select 1 from public.properties property where property.id = p_property_id) then
    raise exception 'PLATFORM_PROPERTY_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(app_private.platform_manager_account_projection(account.id)
    order by account.created_at asc), '[]'::jsonb)
    into result
  from public.user_accounts account
  join public.role_assignments assignment
    on assignment.user_id = account.user_id
   and assignment.property_id = account.property_id
   and assignment.status = 'active'
  join public.roles role
    on role.id = assignment.role_id
   and role.code = 'property_ld_manager'
   and role.is_active
  where account.property_id = p_property_id;

  return result;
end;
$$;

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
  normalized_login_id text := lower(btrim(coalesce(p_login_id, '')));
  normalized_email text := lower(btrim(coalesce(p_internal_email, '')));
  display_name text := btrim(coalesce(p_display_name, ''));
  request_id text := btrim(coalesce(p_request_id, ''));
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
  if p_auth_user_id is null or normalized_email = '' or normalized_login_id = ''
    or display_name = '' or request_id = '' then
    raise exception 'PLATFORM_MANAGER_INPUT_INVALID' using errcode = '22023';
  end if;
  if normalized_email !~ '^[^@[:space:]]+@accounts\.ldchub\.cn$'
    or normalized_login_id !~ '^[a-z0-9][a-z0-9._-]{2,79}$' then
    raise exception 'PLATFORM_MANAGER_INPUT_INVALID' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users auth_identity where auth_identity.id = p_auth_user_id and lower(auth_identity.email) = normalized_email) then
    raise exception 'PLATFORM_MANAGER_AUTH_IDENTITY_INVALID' using errcode = '22023';
  end if;
  if exists (select 1 from public.platform_memberships membership where membership.user_id = p_auth_user_id)
    or exists (select 1 from public.user_accounts account where account.auth_user_id = p_auth_user_id) then
    raise exception 'PLATFORM_MANAGER_AUTH_IDENTITY_ALREADY_LINKED' using errcode = '22023';
  end if;
  if exists (select 1 from public.user_accounts account where account.normalized_login_id = normalized_login_id) then
    raise exception 'PLATFORM_MANAGER_LOGIN_ID_ALREADY_EXISTS' using errcode = '23505';
  end if;

  select id into role_id from public.roles
  where code = 'property_ld_manager' and scope_level = 'property' and is_active;
  if role_id is null then
    raise exception 'PLATFORM_MANAGER_ROLE_UNAVAILABLE' using errcode = '22023';
  end if;

  insert into public.profiles(id, email, display_name, full_name, is_active)
  values (p_auth_user_id, normalized_email, display_name, display_name, true);
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
    normalized_login_id, 'active', true, auth.uid(), auth.uid()
  ) returning id into account_id;

  created_projection := app_private.platform_manager_account_projection(account_id);
  insert into public.platform_account_management_events(
    tenant_id, property_id, account_id, target_auth_user_id, performed_by,
    event_type, outcome, request_id, request_hash, after_state
  ) values (
    property_row.tenant_id, p_property_id, account_id, p_auth_user_id, auth.uid(),
    'manager_created', 'succeeded', request_id,
    encode(extensions.digest(request_id || '|' || account_id::text, 'sha256'), 'hex'),
    created_projection
  );
  return created_projection;
end;
$$;

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

  return jsonb_build_object(
    'eventId', event_id,
    'authUserId', account_row.auth_user_id,
    'version', account_row.version + 1
  );
end;
$$;

create or replace function public.platform_record_manager_password_reset_result(
  p_event_id uuid,
  p_succeeded boolean,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  original public.platform_account_management_events%rowtype;
begin
  perform app_private.assert_platform_provisioner();
  select * into original
  from public.platform_account_management_events event
  where event.id = p_event_id
    and event.event_type = 'manager_password_reset_requested'
    and event.outcome = 'requested'
    and event.performed_by = auth.uid();
  if original.id is null then
    raise exception 'PLATFORM_PASSWORD_RESET_EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.platform_account_management_events(
    tenant_id, property_id, account_id, target_auth_user_id, performed_by,
    event_type, outcome, request_id, request_hash, before_state, after_state, error_code
  ) values (
    original.tenant_id, original.property_id, original.account_id, original.target_auth_user_id, auth.uid(),
    case when p_succeeded then 'manager_password_reset_succeeded' else 'manager_password_reset_failed' end,
    case when p_succeeded then 'succeeded' else 'failed' end,
    original.request_id,
    encode(extensions.digest(original.request_hash || '|' || p_succeeded::text, 'sha256'), 'hex'),
    original.after_state,
    jsonb_build_object('passwordUpdated', p_succeeded),
    nullif(left(btrim(coalesce(p_error_code, '')), 120), '')
  );
  return jsonb_build_object('recorded', true);
end;
$$;

create or replace function public.platform_set_property_manager_status(
  p_property_id uuid,
  p_account_id uuid,
  p_expected_version bigint,
  p_account_status text,
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
  selected_status public.account_status;
  before_state jsonb;
  after_state jsonb;
begin
  perform app_private.assert_platform_provisioner();
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hotel-ld-os:platform-property-account:' || p_property_id::text, 0)
  );
  select * into property_row from public.properties where id = p_property_id for share;
  select * into account_row from public.user_accounts where id = p_account_id and property_id = p_property_id for update;
  if property_row.id is null or account_row.id is null or btrim(coalesce(p_request_id, '')) = '' then
    raise exception 'PLATFORM_MANAGER_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_expected_version is null or account_row.version <> p_expected_version then
    raise exception 'PLATFORM_MANAGER_ACCOUNT_STALE' using errcode = 'P0003';
  end if;
  begin
    selected_status := p_account_status::public.account_status;
  exception when invalid_text_representation then
    raise exception 'PLATFORM_MANAGER_STATUS_INVALID' using errcode = '22023';
  end;
  if selected_status not in ('active', 'suspended', 'disabled') then
    raise exception 'PLATFORM_MANAGER_STATUS_INVALID' using errcode = '22023';
  end if;
  if account_row.account_status = 'active' and selected_status <> 'active'
    and app_private.count_active_property_managers(p_property_id) <= 1 then
    raise exception 'P5006: final active hotel L&D manager is protected' using errcode = 'P5006';
  end if;

  before_state := jsonb_build_object('status', account_row.account_status::text, 'version', account_row.version);
  update public.user_accounts
  set account_status = selected_status, updated_by = auth.uid(), version = version + 1
  where id = p_account_id;
  after_state := jsonb_build_object('status', selected_status::text, 'version', account_row.version + 1);
  insert into public.platform_account_management_events(
    tenant_id, property_id, account_id, target_auth_user_id, performed_by,
    event_type, outcome, request_id, request_hash, before_state, after_state
  ) values (
    property_row.tenant_id, p_property_id, p_account_id, account_row.auth_user_id, auth.uid(),
    'manager_status_changed', 'succeeded', btrim(p_request_id),
    encode(extensions.digest(btrim(p_request_id) || '|' || p_account_id::text, 'sha256'), 'hex'),
    before_state, after_state
  );
  return app_private.platform_manager_account_projection(p_account_id);
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
  normalized_login_id text := lower(btrim(coalesce(p_new_login_id, '')));
  normalized_email text := lower(btrim(coalesce(p_new_internal_email, '')));
  display_name text := btrim(coalesce(p_new_display_name, ''));
  request_id text := btrim(coalesce(p_request_id, ''));
begin
  perform app_private.assert_platform_provisioner();
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hotel-ld-os:platform-property-account:' || p_property_id::text, 0)
  );
  select * into property_row from public.properties where id = p_property_id for share;
  select * into old_account from public.user_accounts where id = p_old_account_id and property_id = p_property_id for update;
  if property_row.id is null or old_account.id is null or request_id = '' then
    raise exception 'PLATFORM_MANAGER_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_new_auth_user_id is null or normalized_email = '' or normalized_login_id = '' or display_name = '' then
    raise exception 'PLATFORM_MANAGER_INPUT_INVALID' using errcode = '22023';
  end if;
  if normalized_email !~ '^[^@[:space:]]+@accounts\.ldchub\.cn$'
    or normalized_login_id !~ '^[a-z0-9][a-z0-9._-]{2,79}$' then
    raise exception 'PLATFORM_MANAGER_INPUT_INVALID' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users auth_identity where auth_identity.id = p_new_auth_user_id and lower(auth_identity.email) = normalized_email) then
    raise exception 'PLATFORM_MANAGER_AUTH_IDENTITY_INVALID' using errcode = '22023';
  end if;
  if exists (select 1 from public.user_accounts account where account.normalized_login_id = normalized_login_id)
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
  values (p_new_auth_user_id, normalized_email, display_name, display_name, true);
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
    normalized_login_id, 'active', true, auth.uid(), auth.uid()
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
    'manager_replaced', 'succeeded', request_id,
    encode(extensions.digest(request_id || '|' || old_account.id::text || '|' || new_account_id::text, 'sha256'), 'hex'),
    jsonb_build_object('oldAccountId', old_account.id, 'oldStatus', old_account.account_status::text),
    jsonb_build_object('newAccountId', new_account_id, 'newStatus', 'active')
  );
  return jsonb_build_object(
    'newManager', new_projection,
    'replacedAccountId', old_account.id
  );
end;
$$;

revoke all on function public.platform_list_properties() from public, anon, service_role;
revoke all on function public.platform_list_property_manager_accounts(uuid) from public, anon, service_role;
revoke all on function public.platform_create_property_manager_account(uuid, uuid, text, text, text, text) from public, anon, service_role;
revoke all on function public.platform_prepare_manager_password_reset(uuid, uuid, bigint, text) from public, anon, service_role;
revoke all on function public.platform_record_manager_password_reset_result(uuid, boolean, text) from public, anon, service_role;
revoke all on function public.platform_set_property_manager_status(uuid, uuid, bigint, text, text) from public, anon, service_role;
revoke all on function public.platform_replace_property_manager(uuid, uuid, uuid, text, text, text, text) from public, anon, service_role;

grant execute on function public.platform_list_properties() to authenticated;
grant execute on function public.platform_list_property_manager_accounts(uuid) to authenticated;
grant execute on function public.platform_create_property_manager_account(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.platform_prepare_manager_password_reset(uuid, uuid, bigint, text) to authenticated;
grant execute on function public.platform_record_manager_password_reset_result(uuid, boolean, text) to authenticated;
grant execute on function public.platform_set_property_manager_status(uuid, uuid, bigint, text, text) to authenticated;
grant execute on function public.platform_replace_property_manager(uuid, uuid, uuid, text, text, text, text) to authenticated;
