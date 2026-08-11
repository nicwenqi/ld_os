-- Recovery B: activation is finite and records readiness without requiring
-- Recovery C employee data or Recovery D training facts.

create or replace function public.get_property_initialization_progress(
  p_property_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'lastActiveStep', least(settings.initialization_last_active_step, 5),
    'version', settings.version,
    'state', settings.initialization_state::text,
    'completedAt', settings.initialization_completed_at,
    'steps', coalesce(
      jsonb_object_agg(
        step.step_key,
        jsonb_build_object(
          'explicitlyConfirmed', step.explicitly_confirmed,
          'warning', step.warning_message,
          'blockingReason', step.blocking_reason
        )
      ) filter (where step.id is not null),
      '{}'::jsonb
    )
  )
  from public.property_settings settings
  left join public.property_initialization_steps step
    on step.property_id = settings.property_id
  where settings.property_id = p_property_id
    and app_private.can_manage_property(settings.property_id)
  group by
    settings.initialization_last_active_step,
    settings.version,
    settings.initialization_state,
    settings.initialization_completed_at;
$$;

create or replace function public.save_property_initialization_step(
  p_property_id uuid,
  p_step_key text,
  p_last_active_step smallint,
  p_explicitly_confirmed boolean,
  p_warning text,
  p_blocking_reason text,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_version bigint;
  v_state public.property_initialization_state;
begin
  if p_step_key not in (
    'identity', 'rules', 'organization', 'positions',
    'upload', 'mapping', 'access'
  ) or p_last_active_step not between 1 and 5 then
    raise exception 'P4001: invalid activation step'
      using errcode = 'P4001';
  end if;

  select tenant_id, version, initialization_state
  into v_tenant_id, v_version, v_state
  from public.property_settings
  where property_id = p_property_id
  for update;

  if v_tenant_id is null
    or not app_private.can_manage_property(p_property_id) then
    raise exception 'P4002: property activation access denied'
      using errcode = 'P4002';
  end if;
  if p_expected_version is not null
    and p_expected_version <> v_version then
    raise exception 'P4003: activation progress is stale'
      using errcode = 'P4003';
  end if;

  insert into public.property_initialization_steps(
    tenant_id, property_id, step_key, explicitly_confirmed,
    warning_message, blocking_reason, created_by, updated_by
  )
  values (
    v_tenant_id, p_property_id, p_step_key, p_explicitly_confirmed,
    nullif(btrim(p_warning), ''), nullif(btrim(p_blocking_reason), ''),
    auth.uid(), auth.uid()
  )
  on conflict(property_id, step_key) do update
  set explicitly_confirmed = excluded.explicitly_confirmed,
      warning_message = excluded.warning_message,
      blocking_reason = excluded.blocking_reason;

  update public.property_settings
  set initialization_last_active_step = p_last_active_step,
      initialization_state = case
        when v_state = 'ready' then 'ready'::public.property_initialization_state
        else 'in_progress'::public.property_initialization_state
      end,
      updated_by = auth.uid()
  where property_id = p_property_id;

  return public.get_property_initialization_progress(p_property_id);
end;
$$;

create or replace function public.save_property_initialization_navigation(
  p_property_id uuid,
  p_last_active_step smallint,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_version bigint;
begin
  if p_last_active_step not between 1 and 5 then
    raise exception 'P4020: invalid activation navigation step'
      using errcode = 'P4020';
  end if;

  select tenant_id, version
  into v_tenant_id, v_version
  from public.property_settings
  where property_id = p_property_id
  for update;

  if v_tenant_id is null
    or not app_private.can_manage_property(p_property_id) then
    raise exception 'P4021: property activation navigation access denied'
      using errcode = 'P4021';
  end if;
  if p_expected_version is not null
    and p_expected_version <> v_version then
    raise exception 'P4022: activation navigation is stale'
      using errcode = 'P4022';
  end if;

  update public.property_settings
  set initialization_last_active_step = p_last_active_step,
      updated_by = auth.uid()
  where property_id = p_property_id;

  return public.get_property_initialization_progress(p_property_id);
end;
$$;

create or replace function public.complete_property_initialization(
  p_property_id uuid,
  p_expected_version bigint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.property_settings%rowtype;
begin
  select * into v_settings
  from public.property_settings
  where property_id = p_property_id
  for update;

  if v_settings.id is null
    or not app_private.can_manage_property(p_property_id) then
    raise exception 'P4010: property activation access denied'
      using errcode = 'P4010';
  end if;
  if p_expected_version is not null
    and p_expected_version <> v_settings.version then
    raise exception 'P4011: activation progress is stale'
      using errcode = 'P4011';
  end if;

  if not exists (
    select 1
    from public.properties property
    where property.id = p_property_id
      and btrim(property.name_zh) <> ''
      and btrim(property.name_en) <> ''
      and btrim(property.code) <> ''
      and btrim(property.brand) <> ''
      and btrim(property.city) <> ''
      and btrim(property.timezone) <> ''
      and btrim(property.country_region) <> ''
      and btrim(property.default_language) <> ''
  ) then
    raise exception 'P4012: hotel identity is incomplete'
      using errcode = 'P4012';
  end if;

  if v_settings.new_employee_days not between 1 and 365
    or v_settings.probation_field_meaning is null
    or v_settings.employee_status_source is null then
    raise exception 'P4018: required hotel business rules are incomplete'
      using errcode = 'P4018';
  end if;

  if not exists (
    select 1
    from public.departments department
    where department.property_id = p_property_id
      and department.is_active
  ) then
    raise exception 'P4013: at least one active official department is required'
      using errcode = 'P4013';
  end if;

  if app_private.count_active_property_managers(p_property_id) < 1 then
    raise exception 'P4017: active hotel L&D manager account is required'
      using errcode = 'P4017';
  end if;

  update public.property_settings
  set initialization_state = 'ready',
      initialization_completed_at = coalesce(
        initialization_completed_at,
        now()
      ),
      initialization_completed_by = coalesce(
        initialization_completed_by,
        auth.uid()
      ),
      initialization_last_active_step = 5,
      updated_by = auth.uid()
  where property_id = p_property_id;
end;
$$;

revoke all on function public.get_property_initialization_progress(uuid)
  from public, anon;
revoke all on function public.save_property_initialization_step(uuid,text,smallint,boolean,text,text,bigint)
  from public, anon;
revoke all on function public.save_property_initialization_navigation(uuid,smallint,bigint)
  from public, anon;
revoke all on function public.complete_property_initialization(uuid,bigint)
  from public, anon;

grant execute on function public.get_property_initialization_progress(uuid)
  to authenticated;
grant execute on function public.save_property_initialization_step(uuid,text,smallint,boolean,text,text,bigint)
  to authenticated;
grant execute on function public.save_property_initialization_navigation(uuid,smallint,bigint)
  to authenticated;
grant execute on function public.complete_property_initialization(uuid,bigint)
  to authenticated;
