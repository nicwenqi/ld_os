begin;
set local role hotel_ld_migration_owner;
set local check_function_bodies = off;

create type public.probation_field_meaning as enum (
  'probation_end_date', 'confirmation_date', 'unused'
);
create type public.employee_status_source as enum (
  'excel_import', 'manual', 'future_hris'
);
create type public.property_initialization_state as enum (
  'not_started', 'in_progress', 'ready'
);

alter table public.properties
  add constraint properties_country_region_not_blank
    check (btrim(country_region) <> ''),
  add constraint properties_timezone_not_blank
    check (btrim(timezone) <> ''),
  add constraint properties_default_language_not_blank
    check (btrim(default_language) <> '');

create table public.property_settings (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  new_employee_days smallint not null default 90
    check (new_employee_days between 1 and 365),
  probation_field_meaning public.probation_field_meaning not null default 'confirmation_date',
  employee_status_source public.employee_status_source not null default 'manual',
  ctc_mandatory boolean not null default true,
  gtc_mandatory boolean not null default true,
  initialization_state public.property_initialization_state not null default 'not_started',
  initialization_last_active_step smallint not null default 1
    check (initialization_last_active_step between 1 and 5),
  initialization_completed_at timestamptz,
  initialization_completed_by uuid,
  version bigint not null default 1 check (version > 0),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  updated_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint property_settings_scope_fkey
    foreign key (tenant_id, property_id)
    references public.properties(tenant_id, id) on delete restrict,
  constraint property_settings_property_key unique (property_id),
  constraint property_settings_ready_fields_check check (
    initialization_state <> 'ready'
    or (initialization_completed_at is not null and initialization_completed_by is not null)
  )
);

create index property_settings_tenant_idx
  on public.property_settings (tenant_id, property_id);

create table public.property_initialization_steps (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  step_key text not null check (step_key in (
    'identity', 'rules', 'organization', 'positions',
    'upload', 'mapping', 'access', 'readiness'
  )),
  explicitly_confirmed boolean not null default false,
  warning_message text,
  blocking_reason text,
  version bigint not null default 1 check (version > 0),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  updated_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint property_initialization_steps_scope_fkey
    foreign key (tenant_id, property_id)
    references public.properties(tenant_id, id) on delete restrict,
  constraint property_initialization_steps_key unique (property_id, step_key)
);

create index property_initialization_steps_scope_idx
  on public.property_initialization_steps (tenant_id, property_id);

create table app_private.property_read_audit_events (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  auth_user_id uuid not null,
  tenant_id uuid not null,
  property_id uuid not null,
  operation text not null,
  result_row_count integer not null check (result_row_count >= 0),
  occurred_at timestamptz not null default pg_catalog.transaction_timestamp()
);

create table app_private.property_write_audit_events (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  auth_user_id uuid not null,
  tenant_id uuid not null,
  property_id uuid not null,
  operation text not null,
  target_id uuid not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default pg_catalog.transaction_timestamp()
);

create table app_private.initialization_audit_events (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  auth_user_id uuid not null,
  tenant_id uuid not null,
  property_id uuid not null,
  operation text not null,
  step_key text,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default pg_catalog.transaction_timestamp()
);

create function app_private.reject_property_audit_mutation()
returns trigger language plpgsql volatile security invoker set search_path = ''
as $function$
begin
  raise exception using errcode = '42501', message = 'PROPERTY_AUDIT_APPEND_ONLY';
end
$function$;

create trigger property_read_audit_append_only
before update or delete on app_private.property_read_audit_events
for each row execute function app_private.reject_property_audit_mutation();

create trigger property_write_audit_append_only
before update or delete on app_private.property_write_audit_events
for each row execute function app_private.reject_property_audit_mutation();

create trigger initialization_audit_append_only
before update or delete on app_private.initialization_audit_events
for each row execute function app_private.reject_property_audit_mutation();

create function app_private.neon_property_actor_is_active()
returns boolean language sql stable security invoker set search_path = ''
as $function$
  select exists (
    select 1
    from public.user_accounts account
    join public.profiles profile
      on profile.id = account.user_id and profile.is_active
    join public.tenants tenant
      on tenant.id = account.tenant_id and tenant.status = 'active'
    join public.properties property
      on property.id = account.property_id
      and property.tenant_id = account.tenant_id
      and property.status in ('initializing', 'active')
    join public.tenant_memberships tenant_membership
      on tenant_membership.tenant_id = account.tenant_id
      and tenant_membership.user_id = account.user_id
      and tenant_membership.status = 'active'
    join public.property_memberships property_membership
      on property_membership.tenant_id = account.tenant_id
      and property_membership.property_id = account.property_id
      and property_membership.user_id = account.user_id
      and property_membership.status = 'active'
    where account.auth_user_id = app_private.current_actor_auth_user_id()
      and account.property_id = app_private.current_actor_property_id()
      and account.account_status = 'active'
      and (account.locked_until is null or account.locked_until <= transaction_timestamp())
  )
$function$;

create function app_private.neon_property_actor_has_role(p_role_code text)
returns boolean language sql stable security invoker set search_path = ''
as $function$
  select app_private.neon_property_actor_is_active()
    and exists (
      select 1
      from public.user_accounts account
      join public.role_assignments assignment
        on assignment.tenant_id = account.tenant_id
        and assignment.property_id = account.property_id
        and assignment.user_id = account.user_id
        and assignment.status = 'active'
      join public.roles role
        on role.tenant_id = assignment.tenant_id
        and role.id = assignment.role_id
        and role.is_active
      where account.auth_user_id = app_private.current_actor_auth_user_id()
        and account.property_id = app_private.current_actor_property_id()
        and role.code = p_role_code
    )
$function$;

create function app_private.assert_neon_property_hostname(p_hostname text)
returns void language plpgsql stable security invoker set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from public.property_domains domain
    join public.properties property
      on property.id = domain.property_id
      and property.tenant_id = domain.tenant_id
    join public.tenants tenant on tenant.id = domain.tenant_id
    where lower(domain.hostname) = lower(split_part(btrim(coalesce(p_hostname, '')), ':', 1))
      and domain.property_id = app_private.current_actor_property_id()
      and domain.is_active
      and domain.verification_status = 'verified'
      and property.status in ('initializing', 'active')
      and tenant.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'NEON_PROPERTY_CONTEXT_CHANGED';
  end if;
end
$function$;

create function app_private.assert_neon_property_reader()
returns void language plpgsql stable security invoker set search_path = ''
as $function$
begin
  if not app_private.neon_property_actor_is_active()
    or not (
      app_private.neon_property_actor_has_role('property_ld_manager')
      or app_private.neon_property_actor_has_role('department_training_admin')
    ) then
    raise exception using errcode = '42501', message = 'NEON_PROPERTY_READ_DENIED';
  end if;
end
$function$;

create function app_private.assert_neon_property_manager()
returns void language plpgsql stable security invoker set search_path = ''
as $function$
begin
  if not app_private.neon_property_actor_has_role('property_ld_manager') then
    raise exception using errcode = '42501', message = 'NEON_PROPERTY_MANAGER_REQUIRED';
  end if;
end
$function$;

create function app_private.count_neon_property_managers(p_property_id uuid)
returns integer language sql stable security invoker set search_path = ''
as $function$
  select count(*)::integer
  from public.role_assignments assignment
  join public.roles role
    on role.tenant_id = assignment.tenant_id
    and role.id = assignment.role_id
    and role.code = 'property_ld_manager'
    and role.is_active
  join public.property_memberships membership
    on membership.tenant_id = assignment.tenant_id
    and membership.property_id = assignment.property_id
    and membership.user_id = assignment.user_id
    and membership.status = 'active'
  join public.user_accounts account
    on account.tenant_id = assignment.tenant_id
    and account.property_id = assignment.property_id
    and account.user_id = assignment.user_id
    and account.account_status = 'active'
  join public.profiles profile on profile.id = account.user_id and profile.is_active
  where assignment.property_id = p_property_id
    and assignment.status = 'active'
$function$;

create function app_private.append_neon_property_read_audit(p_operation text, p_count integer)
returns void language plpgsql volatile security invoker set search_path = ''
as $function$
declare v_tenant_id uuid;
begin
  select tenant_id into v_tenant_id
  from public.properties
  where id = app_private.current_actor_property_id();
  insert into app_private.property_read_audit_events(
    request_id, auth_user_id, tenant_id, property_id, operation, result_row_count
  ) values (
    app_private.current_actor_request_id(),
    app_private.current_actor_auth_user_id(),
    v_tenant_id,
    app_private.current_actor_property_id(),
    p_operation,
    greatest(coalesce(p_count, 0), 0)
  );
end
$function$;

create function app_private.append_neon_property_write_audit(p_operation text, p_target uuid, p_details jsonb)
returns void language plpgsql volatile security invoker set search_path = ''
as $function$
declare v_tenant_id uuid;
begin
  select tenant_id into v_tenant_id
  from public.properties
  where id = app_private.current_actor_property_id();
  insert into app_private.property_write_audit_events(
    request_id, auth_user_id, tenant_id, property_id, operation, target_id, details
  ) values (
    app_private.current_actor_request_id(),
    app_private.current_actor_auth_user_id(),
    v_tenant_id,
    app_private.current_actor_property_id(),
    p_operation,
    p_target,
    coalesce(p_details, '{}'::jsonb)
  );
end
$function$;

create function app_private.append_neon_initialization_audit(p_operation text, p_step_key text, p_details jsonb)
returns void language plpgsql volatile security invoker set search_path = ''
as $function$
declare v_tenant_id uuid;
begin
  select tenant_id into v_tenant_id
  from public.properties
  where id = app_private.current_actor_property_id();
  insert into app_private.initialization_audit_events(
    request_id, auth_user_id, tenant_id, property_id, operation, step_key, details
  ) values (
    app_private.current_actor_request_id(),
    app_private.current_actor_auth_user_id(),
    v_tenant_id,
    app_private.current_actor_property_id(),
    p_operation,
    p_step_key,
    coalesce(p_details, '{}'::jsonb)
  );
end
$function$;

create function public.resolve_neon_property_context(p_hostname text)
returns table (
  tenant_id uuid, property_id uuid, hostname text, name_zh text, name_en text,
  short_name text, brand text, city text, country_region text, timezone text,
  default_language text, logo_url text
)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if session_user <> 'hotel_ld_application' then
    raise exception using errcode = '42501', message = 'CANONICAL_RUNTIME_REQUIRED';
  end if;
  return query
    select domain.tenant_id, domain.property_id, domain.hostname,
      property.name_zh, property.name_en,
      coalesce(property.short_name, property.name_zh), property.brand, property.city,
      property.country_region, property.timezone, property.default_language,
      null::text
    from public.property_domains domain
    join public.properties property
      on property.id = domain.property_id and property.tenant_id = domain.tenant_id
    join public.tenants tenant on tenant.id = domain.tenant_id
    where lower(domain.hostname) = lower(split_part(btrim(coalesce(p_hostname, '')), ':', 1))
      and domain.is_active and domain.verification_status = 'verified'
      and property.status in ('initializing', 'active') and tenant.status = 'active'
    limit 1;
end
$function$;

create function public.read_neon_property(p_hostname text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare r jsonb;
begin
  perform app_private.assert_neon_property_hostname(p_hostname);
  perform app_private.assert_neon_property_reader();
  select jsonb_build_object(
    'identity', jsonb_build_object(
      'id', property.id, 'tenantId', property.tenant_id, 'code', upper(property.code),
      'nameZh', property.name_zh, 'nameEn', coalesce(property.name_en, ''),
      'shortName', coalesce(property.short_name, property.name_zh), 'brand', coalesce(property.brand, ''),
      'city', coalesce(property.city, ''), 'countryRegion', property.country_region,
      'timezone', property.timezone, 'defaultLanguage', property.default_language,
      'status', property.status, 'updatedAt', property.updated_at
    ),
    'settings', jsonb_build_object(
      'id', settings.id, 'propertyId', settings.property_id,
      'newEmployeeDays', settings.new_employee_days,
      'probationFieldMeaning', settings.probation_field_meaning,
      'employeeStatusSource', settings.employee_status_source,
      'ctcMandatory', settings.ctc_mandatory, 'gtcMandatory', settings.gtc_mandatory,
      'initializationState', settings.initialization_state,
      'version', settings.version, 'updatedAt', settings.updated_at
    ),
    'currentLogo', null::jsonb
  ) into r
  from public.properties property
  join public.property_settings settings on settings.property_id = property.id
  where property.id = app_private.current_actor_property_id();
  if r is null then
    raise exception using errcode = '40400', message = 'NEON_PROPERTY_NOT_FOUND';
  end if;
  perform app_private.append_neon_property_read_audit('property_record', 1);
  return r;
end
$function$;

create function public.save_neon_property_identity(
  p_hostname text, p_expected_updated_at timestamptz, p_code text,
  p_name_zh text, p_name_en text, p_short_name text, p_brand text,
  p_city text, p_country_region text, p_timezone text, p_default_language text
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_property uuid;
begin
  perform app_private.assert_neon_property_hostname(p_hostname);
  perform app_private.assert_neon_property_manager();
  v_property := app_private.current_actor_property_id();
  if nullif(btrim(coalesce(p_code, '')), '') is null
    or nullif(btrim(coalesce(p_name_zh, '')), '') is null
    or nullif(btrim(coalesce(p_name_en, '')), '') is null
    or nullif(btrim(coalesce(p_short_name, '')), '') is null
    or nullif(btrim(coalesce(p_brand, '')), '') is null
    or nullif(btrim(coalesce(p_city, '')), '') is null
    or nullif(btrim(coalesce(p_country_region, '')), '') is null
    or nullif(btrim(coalesce(p_timezone, '')), '') is null
    or nullif(btrim(coalesce(p_default_language, '')), '') is null then
    raise exception using errcode = '22023', message = 'NEON_PROPERTY_IDENTITY_INVALID';
  end if;
  update public.properties
  set code = lower(btrim(p_code)), name_zh = btrim(p_name_zh), name_en = btrim(p_name_en),
    short_name = btrim(p_short_name), brand = btrim(p_brand), city = btrim(p_city),
    country_region = btrim(p_country_region), timezone = btrim(p_timezone),
    default_language = btrim(p_default_language), updated_at = transaction_timestamp()
  where id = v_property and (p_expected_updated_at is null or updated_at = p_expected_updated_at);
  if not found then
    raise exception using errcode = '40001', message = 'NEON_PROPERTY_VERSION_CONFLICT';
  end if;
  perform app_private.append_neon_property_write_audit('identity_save', v_property, '{}'::jsonb);
  return public.read_neon_property(p_hostname);
end
$function$;

create function public.save_neon_property_settings(
  p_hostname text, p_expected_version bigint, p_new_employee_days smallint,
  p_probation_field_meaning text, p_employee_status_source text,
  p_ctc_mandatory boolean, p_gtc_mandatory boolean
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_property uuid;
begin
  perform app_private.assert_neon_property_hostname(p_hostname);
  perform app_private.assert_neon_property_manager();
  v_property := app_private.current_actor_property_id();
  if p_new_employee_days is null or p_new_employee_days not between 1 and 365
    or p_probation_field_meaning not in ('probation_end_date', 'confirmation_date', 'unused')
    or p_employee_status_source not in ('excel_import', 'manual', 'future_hris')
    or p_ctc_mandatory is null or p_gtc_mandatory is null then
    raise exception using errcode = '22023', message = 'NEON_PROPERTY_SETTINGS_INVALID';
  end if;
  update public.property_settings
  set new_employee_days = p_new_employee_days,
    probation_field_meaning = p_probation_field_meaning::public.probation_field_meaning,
    employee_status_source = p_employee_status_source::public.employee_status_source,
    ctc_mandatory = p_ctc_mandatory, gtc_mandatory = p_gtc_mandatory,
    version = version + 1, updated_by = app_private.current_actor_auth_user_id(),
    updated_at = transaction_timestamp()
  where property_id = v_property and version = p_expected_version;
  if not found then
    raise exception using errcode = '40001', message = 'NEON_PROPERTY_VERSION_CONFLICT';
  end if;
  perform app_private.append_neon_property_write_audit('settings_save', v_property, '{}'::jsonb);
  return public.read_neon_property(p_hostname);
end
$function$;

create function public.get_neon_initialization_progress(p_hostname text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare r jsonb; v_property uuid;
begin
  perform app_private.assert_neon_property_hostname(p_hostname);
  perform app_private.assert_neon_property_manager();
  v_property := app_private.current_actor_property_id();
  select jsonb_build_object(
    'lastActiveStep', least(settings.initialization_last_active_step, 5),
    'version', settings.version, 'state', settings.initialization_state::text,
    'completedAt', settings.initialization_completed_at,
    'steps', coalesce(jsonb_object_agg(step.step_key, jsonb_build_object(
      'explicitlyConfirmed', step.explicitly_confirmed,
      'warning', step.warning_message, 'blockingReason', step.blocking_reason
    ) order by step.step_key) filter (where step.id is not null), '{}'::jsonb)
  ) into r
  from public.property_settings settings
  left join public.property_initialization_steps step on step.property_id = settings.property_id
  where settings.property_id = v_property
  group by settings.initialization_last_active_step, settings.version,
    settings.initialization_state, settings.initialization_completed_at;
  perform app_private.append_neon_property_read_audit('initialization_progress', 1);
  return coalesce(r, '{}'::jsonb);
end
$function$;

create function public.save_neon_initialization_navigation(
  p_hostname text, p_last_active_step smallint, p_expected_version bigint
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_property uuid;
begin
  perform app_private.assert_neon_property_hostname(p_hostname);
  perform app_private.assert_neon_property_manager();
  if p_last_active_step is null or p_last_active_step not between 1 and 5 then
    raise exception using errcode = '22023', message = 'NEON_INITIALIZATION_STEP_INVALID';
  end if;
  v_property := app_private.current_actor_property_id();
  update public.property_settings
  set initialization_last_active_step = p_last_active_step,
    version = version + 1, updated_by = app_private.current_actor_auth_user_id(),
    updated_at = transaction_timestamp()
  where property_id = v_property and version = p_expected_version;
  if not found then
    raise exception using errcode = '40001', message = 'NEON_INITIALIZATION_VERSION_CONFLICT';
  end if;
  perform app_private.append_neon_initialization_audit('navigation_save', null, '{}'::jsonb);
  return public.get_neon_initialization_progress(p_hostname);
end
$function$;

create function public.save_neon_initialization_step(
  p_hostname text, p_step_key text, p_last_active_step smallint,
  p_explicitly_confirmed boolean, p_warning text, p_blocking_reason text,
  p_expected_version bigint
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_property uuid; v_tenant uuid;
begin
  perform app_private.assert_neon_property_hostname(p_hostname);
  perform app_private.assert_neon_property_manager();
  if p_step_key not in ('identity', 'rules', 'organization', 'positions', 'upload', 'mapping', 'access', 'readiness')
    or p_last_active_step is null or p_last_active_step not between 1 and 5
    or p_explicitly_confirmed is null then
    raise exception using errcode = '22023', message = 'NEON_INITIALIZATION_STEP_INVALID';
  end if;
  v_property := app_private.current_actor_property_id();
  select tenant_id into v_tenant from public.properties where id = v_property for update;
  insert into public.property_initialization_steps(
    tenant_id, property_id, step_key, explicitly_confirmed, warning_message,
    blocking_reason, created_by, updated_by
  ) values (
    v_tenant, v_property, p_step_key, p_explicitly_confirmed,
    nullif(btrim(p_warning), ''), nullif(btrim(p_blocking_reason), ''),
    app_private.current_actor_auth_user_id(), app_private.current_actor_auth_user_id()
  ) on conflict (property_id, step_key) do update set
    explicitly_confirmed = excluded.explicitly_confirmed,
    warning_message = excluded.warning_message,
    blocking_reason = excluded.blocking_reason,
    version = property_initialization_steps.version + 1,
    updated_by = excluded.updated_by,
    updated_at = transaction_timestamp();
  update public.property_settings
  set initialization_last_active_step = p_last_active_step,
    initialization_state = case when initialization_state = 'ready' then 'ready' else 'in_progress' end,
    version = version + 1, updated_by = app_private.current_actor_auth_user_id(),
    updated_at = transaction_timestamp()
  where property_id = v_property and version = p_expected_version;
  if not found then
    raise exception using errcode = '40001', message = 'NEON_INITIALIZATION_VERSION_CONFLICT';
  end if;
  perform app_private.append_neon_initialization_audit('step_save', p_step_key, '{}'::jsonb);
  return public.get_neon_initialization_progress(p_hostname);
end
$function$;

create function public.complete_neon_initialization(p_hostname text, p_expected_version bigint)
returns void language plpgsql volatile security definer set search_path = ''
as $function$
declare v_property uuid; v_settings public.property_settings;
begin
  perform app_private.assert_neon_property_hostname(p_hostname);
  perform app_private.assert_neon_property_manager();
  v_property := app_private.current_actor_property_id();
  select * into v_settings from public.property_settings where property_id = v_property for update;
  if v_settings.id is null or v_settings.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'NEON_INITIALIZATION_VERSION_CONFLICT';
  end if;
  if not exists (select 1 from public.properties property where property.id = v_property
    and btrim(property.name_zh) <> '' and btrim(coalesce(property.name_en, '')) <> ''
    and btrim(property.code) <> '' and btrim(coalesce(property.brand, '')) <> ''
    and btrim(coalesce(property.city, '')) <> '' and btrim(property.country_region) <> ''
    and btrim(property.timezone) <> '' and btrim(property.default_language) <> '') then
    raise exception using errcode = '22023', message = 'NEON_INITIALIZATION_IDENTITY_INCOMPLETE';
  end if;
  if not exists (select 1 from public.departments department where department.property_id = v_property and department.is_active) then
    raise exception using errcode = '22023', message = 'NEON_INITIALIZATION_ORGANIZATION_INCOMPLETE';
  end if;
  if app_private.count_neon_property_managers(v_property) < 1 then
    raise exception using errcode = '22023', message = 'NEON_INITIALIZATION_MANAGER_REQUIRED';
  end if;
  update public.property_settings
  set initialization_state = 'ready', initialization_completed_at = coalesce(initialization_completed_at, transaction_timestamp()),
    initialization_completed_by = coalesce(initialization_completed_by, app_private.current_actor_auth_user_id()),
    initialization_last_active_step = 5, version = version + 1,
    updated_by = app_private.current_actor_auth_user_id(), updated_at = transaction_timestamp()
  where property_id = v_property and version = p_expected_version;
  if not found then
    raise exception using errcode = '40001', message = 'NEON_INITIALIZATION_VERSION_CONFLICT';
  end if;
  update public.properties set status = 'active', updated_at = transaction_timestamp() where id = v_property;
  perform app_private.append_neon_initialization_audit('complete', 'readiness', '{}'::jsonb);
end
$function$;

create function public.read_neon_initialization_access_summary(p_hostname text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare v_property uuid; v_current jsonb; v_managers integer; v_admins integer;
begin
  perform app_private.assert_neon_property_hostname(p_hostname);
  perform app_private.assert_neon_property_manager();
  v_property := app_private.current_actor_property_id();
  select jsonb_build_object(
    'displayName', profile.display_name, 'loginId', coalesce(account.login_id, profile.email),
    'accountStatus', account.account_status
  ) into v_current
  from public.user_accounts account join public.profiles profile on profile.id = account.user_id
  where account.auth_user_id = app_private.current_actor_auth_user_id()
    and account.property_id = v_property;
  select count(*)::integer into v_managers from public.role_assignments assignment
  join public.roles role on role.id = assignment.role_id and role.code = 'property_ld_manager' and role.is_active
  where assignment.property_id = v_property and assignment.status = 'active'
    and exists (select 1 from public.property_memberships membership where membership.property_id = v_property and membership.user_id = assignment.user_id and membership.status = 'active')
    and exists (select 1 from public.user_accounts account where account.property_id = v_property and account.user_id = assignment.user_id and account.account_status = 'active');
  select count(*)::integer into v_admins from public.role_assignments assignment
  join public.roles role on role.id = assignment.role_id and role.code = 'department_training_admin' and role.is_active
  where assignment.property_id = v_property and assignment.status = 'active'
    and exists (select 1 from public.property_memberships membership where membership.property_id = v_property and membership.user_id = assignment.user_id and membership.status = 'active')
    and exists (select 1 from public.user_accounts account where account.property_id = v_property and account.user_id = assignment.user_id and account.account_status = 'active');
  perform app_private.append_neon_property_read_audit('initialization_access', 1);
  return jsonb_build_object('currentManager', v_current, 'activePropertyManagers', v_managers,
    'activeDepartmentAdministrators', v_admins, 'canConfirm', v_managers > 0);
end
$function$;

alter table public.property_settings enable row level security;
alter table public.property_settings force row level security;
alter table public.property_initialization_steps enable row level security;
alter table public.property_initialization_steps force row level security;
alter table app_private.property_read_audit_events enable row level security;
alter table app_private.property_read_audit_events force row level security;
alter table app_private.property_write_audit_events enable row level security;
alter table app_private.property_write_audit_events force row level security;
alter table app_private.initialization_audit_events enable row level security;
alter table app_private.initialization_audit_events force row level security;

create policy canonical_property_settings_scope on public.property_settings for all to hotel_ld_migration_owner
  using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id())
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_initialization_steps_scope on public.property_initialization_steps for all to hotel_ld_migration_owner
  using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id())
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_property_read_audit_insert on app_private.property_read_audit_events for insert to hotel_ld_migration_owner
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_property_write_audit_insert on app_private.property_write_audit_events for insert to hotel_ld_migration_owner
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_initialization_audit_insert on app_private.initialization_audit_events for insert to hotel_ld_migration_owner
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());

revoke all on public.property_settings, public.property_initialization_steps from public, hotel_ld_application;
revoke all on app_private.property_read_audit_events, app_private.property_write_audit_events, app_private.initialization_audit_events from public, hotel_ld_application;
revoke all on function public.resolve_neon_property_context(text) from public;
revoke all on function public.read_neon_property(text) from public;
revoke all on function public.save_neon_property_identity(text,timestamptz,text,text,text,text,text,text,text,text,text) from public;
revoke all on function public.save_neon_property_settings(text,bigint,smallint,text,text,boolean,boolean) from public;
revoke all on function public.get_neon_initialization_progress(text) from public;
revoke all on function public.save_neon_initialization_navigation(text,smallint,bigint) from public;
revoke all on function public.save_neon_initialization_step(text,text,smallint,boolean,text,text,bigint) from public;
revoke all on function public.complete_neon_initialization(text,bigint) from public;
revoke all on function public.read_neon_initialization_access_summary(text) from public;
grant execute on function public.resolve_neon_property_context(text) to hotel_ld_application;
grant execute on function public.read_neon_property(text) to hotel_ld_application;
grant execute on function public.save_neon_property_identity(text,timestamptz,text,text,text,text,text,text,text,text,text) to hotel_ld_application;
grant execute on function public.save_neon_property_settings(text,bigint,smallint,text,text,boolean,boolean) to hotel_ld_application;
grant execute on function public.get_neon_initialization_progress(text) to hotel_ld_application;
grant execute on function public.save_neon_initialization_navigation(text,smallint,bigint) to hotel_ld_application;
grant execute on function public.save_neon_initialization_step(text,text,smallint,boolean,text,text,bigint) to hotel_ld_application;
grant execute on function public.complete_neon_initialization(text,bigint) to hotel_ld_application;
grant execute on function public.read_neon_initialization_access_summary(text) to hotel_ld_application;

revoke all on function app_private.reject_property_audit_mutation() from public;
revoke all on function app_private.neon_property_actor_is_active() from public;
revoke all on function app_private.neon_property_actor_has_role(text) from public;
revoke all on function app_private.assert_neon_property_hostname(text) from public;
revoke all on function app_private.assert_neon_property_reader() from public;
revoke all on function app_private.assert_neon_property_manager() from public;
revoke all on function app_private.count_neon_property_managers(uuid) from public;
revoke all on function app_private.append_neon_property_read_audit(text,integer) from public;
revoke all on function app_private.append_neon_property_write_audit(text,uuid,jsonb) from public;
revoke all on function app_private.append_neon_initialization_audit(text,text,jsonb) from public;

set local check_function_bodies = on;
do $canonical_property_compile$
declare routine_definition text;
begin
  for routine_definition in
    select pg_catalog.pg_get_functiondef(routine.oid)
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname in ('public', 'app_private')
    order by namespace.nspname, routine.proname, pg_catalog.pg_get_function_identity_arguments(routine.oid)
  loop
    execute routine_definition;
  end loop;
end
$canonical_property_compile$;

commit;
