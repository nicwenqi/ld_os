-- Recovery C follow-up: an explicit, preview-first batch boundary for source
-- position attribution. This only changes import staging; Employee Fact
-- Versions remain created exclusively by commit_employee_import.

alter table public.import_source_label_resolutions
  add column decision_mode text not null default 'pending',
  add constraint import_source_label_resolutions_decision_mode_check
    check (decision_mode in ('pending', 'create', 'map', 'exclude', 'defer'));

update public.import_source_label_resolutions
set decision_mode = case decision
  when 'mapped' then 'map'
  when 'excluded' then 'exclude'
  when 'deferred' then 'defer'
  else 'pending'
end
where decision_mode = 'pending';

create table public.import_position_attribution_batch_previews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  import_batch_id uuid not null,
  expected_batch_version bigint not null,
  preview_hash text not null,
  decision_payload jsonb not null,
  preview_summary jsonb not null,
  previewed_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  constraint import_position_attribution_preview_scope_fkey
    foreign key (import_batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete cascade,
  constraint import_position_attribution_preview_version_check
    check (expected_batch_version > 0),
  constraint import_position_attribution_preview_hash_check
    check (preview_hash ~ '^[a-f0-9]{64}$'),
  constraint import_position_attribution_preview_payload_check
    check (jsonb_typeof(decision_payload) = 'array' and jsonb_typeof(preview_summary) = 'object')
);

create index import_position_attribution_preview_lookup_idx
  on public.import_position_attribution_batch_previews(
    import_batch_id, previewed_by, expected_batch_version, expires_at desc
  );

alter table public.import_position_attribution_batch_previews enable row level security;
alter table public.import_position_attribution_batch_previews force row level security;
revoke all on public.import_position_attribution_batch_previews
  from public, anon, authenticated, service_role;

create table public.import_position_attribution_decision_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  import_batch_id uuid not null,
  preview_id uuid not null references public.import_position_attribution_batch_previews(id) on delete restrict,
  source_label_resolution_id uuid not null references public.import_source_label_resolutions(id) on delete restrict,
  source_label text not null,
  decision_mode text not null,
  target_position_id uuid references public.positions(id) on delete restrict,
  affected_row_count integer not null,
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null default now(),
  constraint import_position_attribution_decision_event_scope_fkey
    foreign key (import_batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete cascade,
  constraint import_position_attribution_decision_event_check
    check (
      decision_mode in ('create', 'map', 'exclude', 'defer')
      and btrim(source_label) <> ''
      and affected_row_count > 0
      and ((decision_mode in ('create','map') and target_position_id is not null)
        or (decision_mode in ('exclude','defer') and target_position_id is null))
    )
);

create index import_position_attribution_decision_event_batch_idx
  on public.import_position_attribution_decision_events(import_batch_id, decided_at desc);
alter table public.import_position_attribution_decision_events enable row level security;
alter table public.import_position_attribution_decision_events force row level security;
revoke all on public.import_position_attribution_decision_events
  from public, anon, authenticated, service_role;

create or replace function public.resolve_employee_import_source_label(
  p_batch_id uuid,
  p_expected_version bigint,
  p_resolution_type text,
  p_source_label text,
  p_target_entity_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  result := app_private.resolve_employee_import_source_label(
    p_batch_id, p_expected_version, p_resolution_type, p_source_label,
    p_target_entity_id, p_decision
  );
  update public.import_source_label_resolutions
  set decision_mode = case p_decision
    when 'mapped' then 'map'
    when 'excluded' then 'exclude'
    when 'deferred' then 'defer'
    else 'pending'
  end
  where import_batch_id = p_batch_id
    and resolution_type = p_resolution_type
    and normalized_source_label = app_private.normalize_source_label(p_source_label);
  return result;
end;
$$;

create or replace function public.preview_employee_import_position_attribution_batch(
  p_batch_id uuid,
  p_expected_version bigint,
  p_decisions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.import_batches%rowtype;
  entry jsonb;
  normalized_label text;
  source_label text;
  requested_action text;
  target_position_id uuid;
  create_distinct boolean;
  source_count integer;
  matching_positions jsonb;
  detail_rows jsonb := '[]'::jsonb;
  canonical_decisions jsonb := '[]'::jsonb;
  summary jsonb;
  preview_hash text;
  expires_at timestamptz := now() + interval '10 minutes';
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) = 0 then
    raise exception 'POSITION_ATTRIBUTION_DECISIONS_REQUIRED' using errcode = 'P3203';
  end if;

  select * into batch from public.import_batches where id = p_batch_id for share;
  if batch.id is null then
    raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'P3000';
  end if;
  perform app_private.assert_active_property_import_manager(batch.property_id);
  if batch.version <> p_expected_version then
    raise exception 'IMPORT_STALE_VERSION' using errcode = 'P3001';
  end if;
  if batch.status in ('completed','completed_with_warnings','reverted','cancelled') then
    raise exception 'IMPORT_POSITION_ATTRIBUTION_NOT_MUTABLE' using errcode = 'P3203';
  end if;

  for entry in select value from jsonb_array_elements(p_decisions)
  loop
    source_label := btrim(coalesce(entry->>'sourceValue', ''));
    normalized_label := app_private.normalize_source_label(source_label);
    requested_action := entry->>'action';
    create_distinct := coalesce((entry->>'createDistinct')::boolean, false);
    target_position_id := nullif(entry->>'targetPositionId', '')::uuid;
    if normalized_label = '' or requested_action not in ('create','map','exclude','defer') then
      raise exception 'POSITION_ATTRIBUTION_DECISION_INVALID' using errcode = 'P3203';
    end if;
    if exists (
      select 1 from jsonb_array_elements(canonical_decisions) as existing_decision(value)
      where existing_decision.value->>'normalizedSourceLabel' = normalized_label
    ) then
      raise exception 'POSITION_ATTRIBUTION_DECISION_DUPLICATE' using errcode = 'P3203';
    end if;
    select affected_row_count into source_count
    from public.import_source_label_resolutions resolution
    where resolution.import_batch_id = batch.id
      and resolution.resolution_type = 'position'
      and resolution.normalized_source_label = normalized_label;
    if source_count is null then
      raise exception 'POSITION_ATTRIBUTION_SOURCE_LABEL_NOT_FOUND' using errcode = 'P3203';
    end if;
    if requested_action = 'map' then
      if target_position_id is null or not exists (
        select 1 from public.positions position
        where position.id = target_position_id
          and position.tenant_id = batch.tenant_id
          and position.property_id = batch.property_id
          and position.is_active
      ) then
        raise exception 'POSITION_ATTRIBUTION_TARGET_SCOPE' using errcode = 'P3203';
      end if;
    elsif target_position_id is not null then
      raise exception 'POSITION_ATTRIBUTION_TARGET_NOT_ALLOWED' using errcode = 'P3203';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('id', position.id, 'name', position.name_zh) order by position.name_zh), '[]'::jsonb)
      into matching_positions
    from public.positions position
    where position.tenant_id = batch.tenant_id
      and position.property_id = batch.property_id
      and position.is_active
      and app_private.normalize_source_label(position.name_zh) = normalized_label;

    canonical_decisions := canonical_decisions || jsonb_build_array(jsonb_build_object(
      'sourceLabel', source_label,
      'normalizedSourceLabel', normalized_label,
      'action', requested_action,
      'targetPositionId', target_position_id,
      'createDistinct', create_distinct,
      'affectedRows', source_count
    ));
    detail_rows := detail_rows || jsonb_build_array(jsonb_build_object(
      'sourceValue', source_label,
      'affectedRows', source_count,
      'action', requested_action,
      'status', case
        when requested_action = 'create' and jsonb_array_length(matching_positions) > 0 and not create_distinct
          then 'same_name_requires_choice'
        else 'ready'
      end,
      'targetPositionId', target_position_id,
      'targetPositionName', case when requested_action = 'create' then source_label else (
        select name_zh from public.positions where id = target_position_id
      ) end,
      'matchingPositions', matching_positions,
      'reason', case
        when requested_action = 'create' and jsonb_array_length(matching_positions) > 0 and not create_distinct
          then '酒店已有同名有效正式职位。请明确选择关联已有职位，或确认新建独立职位。'
        else null
      end
    ));
  end loop;

  summary := jsonb_build_object(
    'sourceLabels', jsonb_array_length(canonical_decisions),
    'affectedRows', coalesce((select sum((decision.value->>'affectedRows')::integer) from jsonb_array_elements(canonical_decisions) as decision(value)), 0),
    'create', coalesce((select count(*) from jsonb_array_elements(canonical_decisions) as decision(value) where decision.value->>'action' = 'create'), 0),
    'map', coalesce((select count(*) from jsonb_array_elements(canonical_decisions) as decision(value) where decision.value->>'action' = 'map'), 0),
    'exclude', coalesce((select count(*) from jsonb_array_elements(canonical_decisions) as decision(value) where decision.value->>'action' = 'exclude'), 0),
    'defer', coalesce((select count(*) from jsonb_array_elements(canonical_decisions) as decision(value) where decision.value->>'action' = 'defer'), 0)
  );
  preview_hash := encode(extensions.digest(jsonb_build_object(
    'batchId', batch.id, 'expectedVersion', batch.version, 'actorId', auth.uid(), 'decisions', canonical_decisions
  )::text, 'sha256'), 'hex');
  insert into public.import_position_attribution_batch_previews(
    tenant_id, property_id, import_batch_id, expected_batch_version, preview_hash,
    decision_payload, preview_summary, previewed_by, expires_at
  ) values (
    batch.tenant_id, batch.property_id, batch.id, batch.version, preview_hash,
    canonical_decisions, summary, auth.uid(), expires_at
  );
  return jsonb_build_object(
    'previewHash', preview_hash,
    'expectedVersion', batch.version,
    'expiresAt', expires_at,
    'summary', summary,
    'decisions', detail_rows
  );
end;
$$;

create or replace function public.confirm_employee_import_position_attribution_batch(
  p_batch_id uuid,
  p_expected_version bigint,
  p_preview_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.import_batches%rowtype;
  preview public.import_position_attribution_batch_previews%rowtype;
  entry jsonb;
  created_position_id uuid;
  target_position_id uuid;
  normalized_label text;
  target_type text;
  resolution_id uuid;
  created_count integer := 0;
  mapped_count integer := 0;
  excluded_count integer := 0;
  deferred_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  select * into batch from public.import_batches where id = p_batch_id for update;
  if batch.id is null then raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'P3000'; end if;
  perform app_private.assert_active_property_import_manager(batch.property_id);
  if batch.version <> p_expected_version then raise exception 'IMPORT_STALE_VERSION' using errcode = 'P3001'; end if;
  select * into preview
  from public.import_position_attribution_batch_previews
  where import_batch_id = batch.id
    and expected_batch_version = batch.version
    and preview_hash = p_preview_hash
    and previewed_by = auth.uid()
    and consumed_at is null
    and expires_at > now()
  for update;
  if preview.id is null then raise exception 'POSITION_ATTRIBUTION_PREVIEW_INVALID' using errcode = 'P3202'; end if;
  if exists (
    select 1 from jsonb_array_elements(preview.decision_payload) as decision(value)
    where decision.value->>'action' = 'create'
      and coalesce((decision.value->>'createDistinct')::boolean, false) = false
      and exists (
        select 1 from public.positions position
        where position.tenant_id = batch.tenant_id and position.property_id = batch.property_id
          and position.is_active
          and app_private.normalize_source_label(position.name_zh) = decision.value->>'normalizedSourceLabel'
      )
  ) then raise exception 'POSITION_ATTRIBUTION_SAME_NAME_CHOICE_REQUIRED' using errcode = 'P3203'; end if;

  for entry in select value from jsonb_array_elements(preview.decision_payload)
  loop
    normalized_label := entry->>'normalizedSourceLabel';
    target_position_id := nullif(entry->>'targetPositionId', '')::uuid;
    target_type := null;
    if entry->>'action' = 'create' then
      insert into public.positions(tenant_id, property_id, code, name_zh, is_active)
      values (
        batch.tenant_id, batch.property_id,
        'import-pos-' || substring(encode(extensions.digest(batch.id::text || ':' || normalized_label, 'sha256'), 'hex') from 1 for 16),
        entry->>'sourceLabel', true
      ) returning id into created_position_id;
      target_position_id := created_position_id;
      target_type := 'position';
      created_count := created_count + 1;
    elsif entry->>'action' = 'map' then
      if not exists (select 1 from public.positions position where position.id = target_position_id and position.tenant_id = batch.tenant_id and position.property_id = batch.property_id and position.is_active) then
        raise exception 'POSITION_ATTRIBUTION_TARGET_SCOPE' using errcode = 'P3203';
      end if;
      target_type := 'position';
      mapped_count := mapped_count + 1;
    elsif entry->>'action' = 'exclude' then
      excluded_count := excluded_count + 1;
    else
      deferred_count := deferred_count + 1;
    end if;

    insert into public.import_source_label_resolutions(
      tenant_id, property_id, import_batch_id, resolution_type, source_label, normalized_source_label,
      affected_row_count, decision, decision_mode, target_entity_type, target_entity_id, approved_by, decided_at
    )
    select batch.tenant_id, batch.property_id, batch.id, 'position', resolution.source_label, resolution.normalized_source_label,
      resolution.affected_row_count,
      case entry->>'action' when 'create' then 'mapped' when 'map' then 'mapped' when 'exclude' then 'excluded' else 'deferred' end,
      entry->>'action', target_type, target_position_id, auth.uid(), now()
    from public.import_source_label_resolutions resolution
    where resolution.import_batch_id = batch.id and resolution.resolution_type = 'position'
      and resolution.normalized_source_label = normalized_label
    on conflict (import_batch_id, resolution_type, normalized_source_label) do update set
      decision = excluded.decision, decision_mode = excluded.decision_mode,
      target_entity_type = excluded.target_entity_type, target_entity_id = excluded.target_entity_id,
      approved_by = auth.uid(), decided_at = now(), updated_at = now(),
      version = public.import_source_label_resolutions.version + 1
    returning id into resolution_id;
    insert into public.import_position_attribution_decision_events(
      tenant_id, property_id, import_batch_id, preview_id, source_label_resolution_id,
      source_label, decision_mode, target_position_id, affected_row_count, decided_by
    )
    values (
      batch.tenant_id, batch.property_id, batch.id, preview.id, resolution_id,
      entry->>'sourceLabel', entry->>'action', target_position_id,
      (entry->>'affectedRows')::integer, auth.uid()
    );
  end loop;

  update public.import_position_attribution_batch_previews set consumed_at = now() where id = preview.id;
  update public.import_batches set status = 'mapping_required', version = version + 1,
    lifecycle_effective_date = null, preview_hash = null, preview_summary = '{}'::jsonb,
    previewed_by = null, previewed_at = null
  where id = batch.id returning * into batch;
  perform app_private.append_import_activity(batch, 'position_attribution_batch_confirmed', jsonb_build_object(
    'createdPositions', created_count, 'mappedSourceLabels', mapped_count,
    'excludedSourceLabels', excluded_count, 'deferredSourceLabels', deferred_count,
    'detailRecordType', 'import_position_attribution_decision_events', 'batchVersion', batch.version
  ));
  return jsonb_build_object('version', batch.version, 'status', batch.status, 'createdPositions', created_count, 'mappedSourceLabels', mapped_count);
end;
$$;

revoke all on function public.preview_employee_import_position_attribution_batch(uuid, bigint, jsonb)
  from public, anon, service_role;
revoke all on function public.confirm_employee_import_position_attribution_batch(uuid, bigint, text)
  from public, anon, service_role;
grant execute on function public.preview_employee_import_position_attribution_batch(uuid, bigint, jsonb) to authenticated;
grant execute on function public.confirm_employee_import_position_attribution_batch(uuid, bigint, text) to authenticated;
