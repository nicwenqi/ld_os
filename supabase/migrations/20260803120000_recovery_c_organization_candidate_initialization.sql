-- Recovery C: organization candidate initialization.
-- Candidates are staging evidence only. They do not create employees or facts.

-- Gender is an approved employee-master attribute, not a training field.
alter table public.employees add column if not exists gender text;
-- Employment category is distinct from the ordered Grade/Band attribute.
-- In the source workbook, T means Trainee and must never be persisted as a Band.
alter table public.employees add column if not exists employment_category text;
alter table public.employee_fact_versions add column if not exists gender text;
alter table public.employee_fact_versions add column if not exists employment_category text;
alter table public.import_field_mappings drop constraint if exists import_field_mappings_target_field_check;
alter table public.import_field_mappings add constraint import_field_mappings_target_field_check check (
  target_field in ('employee_number','name_zh','name_en','gender','department_source_label','position_source_label','grade_or_band','hire_date','probation_or_confirmation_date','employment_status','lms_employee_id','merlin_id')
);

create or replace function app_private.populate_employee_import_gender()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  batch_id uuid := nullif(current_setting('app.employee_import_batch_id', true), '')::uuid;
  gender_value text;
begin
  if batch_id is null then return new; end if;
  select nullif(btrim(source_row.normalized_values->>'gender'), '')
    into gender_value
  from public.import_source_rows source_row
  where source_row.import_batch_id = batch_id
    and source_row.normalized_values->>'employee_number' = new.employee_number
  order by source_row.source_row_number
  limit 1;
  if gender_value is not null then new.gender := gender_value; end if;
  return new;
end;
$$;
create or replace function app_private.populate_employee_import_employment_category()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  batch_id uuid := nullif(current_setting('app.employee_import_batch_id', true), '')::uuid;
  source_band text;
begin
  if batch_id is null then return new; end if;
  select nullif(btrim(source_row.normalized_values->>'grade_or_band'), '')
    into source_band
  from public.import_source_rows source_row
  where source_row.import_batch_id = batch_id
    and source_row.normalized_values->>'employee_number' = new.employee_number
  order by source_row.source_row_number
  limit 1;
  if lower(coalesce(source_band, '')) = 't' then
    new.grade_or_band := null;
    new.employment_category := 'Trainee';
  else
    new.employment_category := null;
  end if;
  return new;
end;
$$;
drop trigger if exists employees_import_gender on public.employees;
create trigger employees_import_gender
before insert or update on public.employees
for each row execute function app_private.populate_employee_import_gender();
drop trigger if exists employees_import_employment_category on public.employees;
create trigger employees_import_employment_category
before insert or update on public.employees
for each row execute function app_private.populate_employee_import_employment_category();

create or replace function app_private.employee_change_kinds(
  p_old public.employees,
  p_new public.employees,
  p_source_type text
)
returns text[] language plpgsql stable set search_path = '' as $$
declare kinds text[] := '{}';
begin
  if p_old is null then kinds := array_append(kinds, 'hire');
  else
    if p_old.employee_number is distinct from p_new.employee_number then kinds := array_append(kinds, 'employee_number_change'); end if;
    if p_old.department_id is distinct from p_new.department_id or p_old.operational_unit_id is distinct from p_new.operational_unit_id then kinds := array_append(kinds, 'department_transfer'); end if;
    if p_old.position_id is distinct from p_new.position_id or p_old.position_family_id is distinct from p_new.position_family_id then kinds := array_append(kinds, 'position_change'); end if;
    if p_old.employment_status is distinct from p_new.employment_status or p_old.is_active is distinct from p_new.is_active then
      kinds := array_append(kinds, 'status_change');
      if p_new.employment_status = 'terminated' then kinds := array_append(kinds, 'termination');
      elsif not p_old.is_active and p_new.is_active then kinds := array_append(kinds, 'rehire'); end if;
    end if;
    if p_old.name_zh is distinct from p_new.name_zh or p_old.name_en is distinct from p_new.name_en or p_old.gender is distinct from p_new.gender or p_old.grade_or_band is distinct from p_new.grade_or_band or p_old.employment_category is distinct from p_new.employment_category or p_old.hire_date is distinct from p_new.hire_date or p_old.probation_or_confirmation_date is distinct from p_new.probation_or_confirmation_date then
      kinds := array_append(kinds, 'profile_correction');
    end if;
  end if;
  if p_source_type = 'baseline' then kinds := array_append(kinds, 'baseline'); end if;
  if p_source_type = 'import_commit' then kinds := array_append(kinds, 'import'); end if;
  if p_source_type = 'revert' then kinds := array_append(kinds, 'revert'); end if;
  return array(select distinct unnest(kinds));
end;
$$;

create or replace function app_private.record_employee_fact_version()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  configured_source text := nullif(current_setting('app.employee_change_source', true), '');
  configured_date text := nullif(current_setting('app.employee_effective_date', true), '');
  configured_reason text := nullif(current_setting('app.employee_change_reason', true), '');
  selected_source text;
  selected_date date;
  selected_reason text;
  selected_rule integer;
  before_row public.employees;
begin
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then return new; end if;
  selected_source := coalesce(configured_source, case when new.source_batch_id is not null then 'import_commit' else 'manual_correction' end);
  if selected_source not in ('baseline','import_commit','manual_correction','revert') then raise exception 'EMPLOYEE_CHANGE_SOURCE_INVALID' using errcode = '23514'; end if;
  if configured_date is not null then selected_date := configured_date::date;
  elsif new.source_batch_id is not null then select batch.lifecycle_effective_date into selected_date from public.import_batches batch where batch.id = new.source_batch_id; end if;
  selected_date := coalesce(selected_date, current_date);
  select settings.new_employee_days into selected_rule from public.property_settings settings where settings.property_id = new.property_id;
  if selected_rule is null or selected_rule <= 0 then raise exception 'EMPLOYEE_FACT_PROPERTY_RULE_MISSING' using errcode = '23514'; end if;
  selected_reason := coalesce(configured_reason, case selected_source when 'import_commit' then '经审批的员工资料更新批次' when 'revert' then '经冲突检查的员工资料更新撤销' else '经授权的员工主数据更正' end);
  if tg_op = 'UPDATE' then before_row := old; end if;
  insert into public.employee_fact_versions(
    tenant_id, property_id, employee_id, employee_version, effective_date,
    employee_number, name_zh, name_en, gender, department_id,
    operational_unit_id, position_id, position_family_id, grade_or_band,
    employment_category,
    hire_date, probation_or_confirmation_date, employment_status, is_active,
    new_employee_days_rule, source_type, source_batch_id, change_kinds,
    reason, before_snapshot, after_snapshot, recorded_by
  ) values (
    new.tenant_id, new.property_id, new.id, new.version, selected_date,
    new.employee_number, new.name_zh, new.name_en, new.gender, new.department_id,
    new.operational_unit_id, new.position_id, new.position_family_id, new.grade_or_band,
    new.employment_category,
    new.hire_date, new.probation_or_confirmation_date, new.employment_status, new.is_active,
    selected_rule, selected_source, new.source_batch_id,
    app_private.employee_change_kinds(before_row, new, selected_source), selected_reason,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new), auth.uid()
  );
  return new;
end;
$$;

create or replace function app_private.is_employee_import_excluded_key(p_key text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_key, '') ~* (
    'ctc|gtc|course|课程|training|培训|completion|完成|orientation|入职引导|onboarding|' ||
    'checklist|清单|journey|旅程|first\s*aid|急救|problem\s*handling|问题处理|' ||
    'attendance|出勤|考勤|feedback|反馈|risk|风险|kpi|绩效'
  );
$$;

-- The historical staging validator predates Gender as an approved employee
-- master field. Re-assert the same validation contract additively so a
-- recognized Gender column can pass staging without permitting training or
-- sensitive fields.
create or replace function app_private.assert_employee_import_staging_payload_allowed(
  p_staging jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  mappings_payload jsonb;
  rows_payload jsonb;
  mapping_payload jsonb;
  row_payload jsonb;
  mapping_sheet_id text;
  row_sheet_id text;
  mapping_source text;
  mapping_target text;
  source_key text;
  normalized_key text;
  source_token text;
  target_token text;
  mapping_source_tokens text[] := array[]::text[];
  mapping_target_tokens text[] := array[]::text[];
  allowed_targets constant text[] := array[
    'employee_number',
    'name_zh',
    'name_en',
    'gender',
    'department_source_label',
    'position_source_label',
    'grade_or_band',
    'hire_date',
    'probation_or_confirmation_date',
    'employment_status',
    'lms_employee_id',
    'merlin_id'
  ]::text[];
begin
  if jsonb_typeof(p_staging) <> 'object' then return; end if;
  mappings_payload := coalesce(p_staging->'fieldMappings', '[]'::jsonb);
  rows_payload := coalesce(p_staging->'rows', '[]'::jsonb);
  if jsonb_typeof(mappings_payload) <> 'array'
    or jsonb_typeof(rows_payload) <> 'array' then return; end if;

  for mapping_payload in select value from jsonb_array_elements(mappings_payload) loop
    if jsonb_typeof(mapping_payload) <> 'object' then
      raise exception 'IMPORT_STAGING_FIELD_ALLOWLIST_INVALID' using errcode = 'P3220';
    end if;
    mapping_sheet_id := nullif(btrim(mapping_payload->>'sheetId'), '');
    mapping_source := nullif(btrim(mapping_payload->>'sourceColumnName'), '');
    mapping_target := nullif(btrim(mapping_payload->>'targetField'), '');
    if mapping_sheet_id is null or mapping_source is null or mapping_target is null then
      raise exception 'IMPORT_STAGING_FIELD_ALLOWLIST_INVALID' using errcode = 'P3220';
    end if;
    if app_private.is_employee_import_excluded_key(mapping_source)
      or app_private.is_employee_import_excluded_key(mapping_target) then
      raise exception 'IMPORT_STAGING_EXCLUDED_FIELD' using errcode = 'P3220';
    end if;
    if not (mapping_target = any(allowed_targets)) then
      raise exception 'IMPORT_STAGING_FIELD_ALLOWLIST_INVALID' using errcode = 'P3220';
    end if;
    source_token := mapping_sheet_id || chr(31) || mapping_source;
    target_token := mapping_sheet_id || chr(31) || mapping_target;
    if source_token = any(mapping_source_tokens)
      or target_token = any(mapping_target_tokens) then
      raise exception 'IMPORT_STAGING_FIELD_ALLOWLIST_INVALID' using errcode = 'P3220';
    end if;
    mapping_source_tokens := array_append(mapping_source_tokens, source_token);
    mapping_target_tokens := array_append(mapping_target_tokens, target_token);
  end loop;

  for row_payload in select value from jsonb_array_elements(rows_payload) loop
    if jsonb_typeof(row_payload) <> 'object'
      or jsonb_typeof(row_payload->'rawValues') <> 'object'
      or jsonb_typeof(coalesce(row_payload->'normalizedValues', '{}'::jsonb)) <> 'object' then
      raise exception 'IMPORT_STAGING_FIELD_ALLOWLIST_INVALID' using errcode = 'P3220';
    end if;
    row_sheet_id := nullif(btrim(row_payload->>'sheetId'), '');
    if row_sheet_id is null then
      raise exception 'IMPORT_STAGING_FIELD_ALLOWLIST_INVALID' using errcode = 'P3220';
    end if;
    for source_key in select key from jsonb_object_keys(row_payload->'rawValues') key loop
      if app_private.is_employee_import_excluded_key(source_key) then
        raise exception 'IMPORT_STAGING_EXCLUDED_FIELD' using errcode = 'P3220';
      end if;
      if not (row_sheet_id || chr(31) || source_key = any(mapping_source_tokens)) then
        raise exception 'IMPORT_STAGING_FIELD_ALLOWLIST_INVALID' using errcode = 'P3220';
      end if;
    end loop;
    for normalized_key in select key from jsonb_object_keys(coalesce(row_payload->'normalizedValues', '{}'::jsonb)) key loop
      if app_private.is_employee_import_excluded_key(normalized_key) then
        raise exception 'IMPORT_STAGING_EXCLUDED_FIELD' using errcode = 'P3220';
      end if;
      if not (normalized_key = any(allowed_targets))
        or not (row_sheet_id || chr(31) || normalized_key = any(mapping_target_tokens)) then
        raise exception 'IMPORT_STAGING_FIELD_ALLOWLIST_INVALID' using errcode = 'P3220';
      end if;
    end loop;
  end loop;
end;
$$;

create type public.import_organization_candidate_type as enum (
  'department', 'position', 'band'
);

create type public.import_organization_candidate_decision as enum (
  'pending', 'create', 'map', 'exclude', 'defer'
);

create table public.import_organization_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  import_batch_id uuid not null,
  candidate_type public.import_organization_candidate_type not null,
  source_value text not null,
  normalized_value text not null,
  department_source_value text,
  department_normalized_value text,
  employee_count integer not null default 0,
  position_count integer not null default 0,
  trainee_count integer not null default 0,
  band_values jsonb not null default '[]'::jsonb,
  family_suggestion jsonb,
  decision public.import_organization_candidate_decision not null default 'pending',
  target_entity_id uuid,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (property_id, tenant_id) references public.properties(id, tenant_id),
  foreign key (import_batch_id, tenant_id, property_id) references public.import_batches(id, tenant_id, property_id) on delete cascade,
  unique (import_batch_id, candidate_type, normalized_value, department_normalized_value),
  check (btrim(source_value) <> '' and btrim(normalized_value) <> ''),
  check (employee_count >= 0 and position_count >= 0 and trainee_count >= 0),
  check (jsonb_typeof(band_values) = 'array'),
  check (family_suggestion is null or jsonb_typeof(family_suggestion) = 'object')
);

create table public.import_employee_attribution_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  import_batch_id uuid not null,
  import_source_row_id uuid not null,
  department_candidate_id uuid references public.import_organization_candidates(id) on delete restrict,
  position_candidate_id uuid references public.import_organization_candidates(id) on delete restrict,
  source_department_value text,
  normalized_department_value text,
  source_position_value text,
  normalized_position_value text,
  source_band_value text,
  band_value text,
  employment_category text,
  gender text,
  status text not null default 'unable_to_determine',
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (property_id, tenant_id) references public.properties(id, tenant_id),
  foreign key (import_batch_id, tenant_id, property_id) references public.import_batches(id, tenant_id, property_id) on delete cascade,
  foreign key (import_source_row_id, tenant_id, property_id, import_batch_id) references public.import_source_rows(id, tenant_id, property_id, import_batch_id) on delete cascade,
  unique (import_batch_id, import_source_row_id),
  check (status in ('eligible', 'unable_to_determine')),
  check (jsonb_typeof(reasons) = 'array')
);

create index import_org_candidates_batch_idx
  on public.import_organization_candidates(import_batch_id, candidate_type, normalized_value);
create index import_employee_attribution_candidates_batch_idx
  on public.import_employee_attribution_candidates(import_batch_id, status);

alter table public.import_organization_candidates enable row level security;
alter table public.import_employee_attribution_candidates enable row level security;
alter table public.import_organization_candidates force row level security;
alter table public.import_employee_attribution_candidates force row level security;

create policy import_org_candidates_manager_select
  on public.import_organization_candidates for select to authenticated
  using ((select app_private.can_manage_property(property_id)));
create policy import_employee_attribution_candidates_manager_select
  on public.import_employee_attribution_candidates for select to authenticated
  using ((select app_private.can_manage_property(property_id)));

revoke insert, update, delete on public.import_organization_candidates
  from public, anon, authenticated;
revoke insert, update, delete on public.import_employee_attribution_candidates
  from public, anon, authenticated;
grant select on public.import_organization_candidates,
  public.import_employee_attribution_candidates to authenticated;

create or replace function public.preview_employee_import_organization_candidates(
  p_batch_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.import_batches%rowtype;
  row_record record;
  department_id uuid;
  position_id uuid;
  department_count integer;
  position_count integer;
  band_count integer;
  trainee_count integer;
  unresolved_count integer;
begin
  select * into batch from public.import_batches where id = p_batch_id for update;
  if batch.id is null then raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'P3000'; end if;
  perform app_private.assert_active_property_import_manager(batch.property_id);
  if batch.version <> p_expected_version then raise exception 'IMPORT_STALE_VERSION' using errcode = 'P3001'; end if;

  delete from public.import_employee_attribution_candidates where import_batch_id = batch.id;
  delete from public.import_organization_candidates where import_batch_id = batch.id;

  insert into public.import_organization_candidates(
    tenant_id, property_id, import_batch_id, candidate_type,
    source_value, normalized_value, employee_count
  )
  select batch.tenant_id, batch.property_id, batch.id, 'department',
    min(btrim(source_row.normalized_values->>'department_source_label')),
    app_private.normalize_source_label(source_row.normalized_values->>'department_source_label'),
    count(*)::integer
  from public.import_source_rows source_row
  where source_row.import_batch_id = batch.id
    and nullif(btrim(source_row.normalized_values->>'department_source_label'), '') is not null
  group by app_private.normalize_source_label(source_row.normalized_values->>'department_source_label');

  insert into public.import_organization_candidates(
    tenant_id, property_id, import_batch_id, candidate_type,
    source_value, normalized_value, department_source_value,
    department_normalized_value, employee_count, band_values, trainee_count
  )
  select batch.tenant_id, batch.property_id, batch.id, 'position',
    min(btrim(source_row.normalized_values->>'position_source_label')),
    app_private.normalize_source_label(source_row.normalized_values->>'position_source_label'),
    min(btrim(source_row.normalized_values->>'department_source_label')),
    app_private.normalize_source_label(source_row.normalized_values->>'department_source_label'),
    count(*)::integer,
    coalesce(jsonb_agg(distinct nullif(btrim(source_row.normalized_values->>'grade_or_band'), '') order by nullif(btrim(source_row.normalized_values->>'grade_or_band'), '')) filter (where lower(btrim(source_row.normalized_values->>'grade_or_band')) <> 't'), '[]'::jsonb),
    count(*) filter (where lower(btrim(source_row.normalized_values->>'grade_or_band')) = 't')::integer
  from public.import_source_rows source_row
  where source_row.import_batch_id = batch.id
    and nullif(btrim(source_row.normalized_values->>'position_source_label'), '') is not null
    and nullif(btrim(source_row.normalized_values->>'department_source_label'), '') is not null
  group by
    app_private.normalize_source_label(source_row.normalized_values->>'position_source_label'),
    app_private.normalize_source_label(source_row.normalized_values->>'department_source_label');

  insert into public.import_organization_candidates(
    tenant_id, property_id, import_batch_id, candidate_type,
    source_value, normalized_value, employee_count, position_count
  )
  select batch.tenant_id, batch.property_id, batch.id, 'band',
    min(btrim(source_row.normalized_values->>'grade_or_band')),
    app_private.normalize_source_label(source_row.normalized_values->>'grade_or_band'),
    count(*)::integer,
    count(distinct concat_ws(':',
      app_private.normalize_source_label(source_row.normalized_values->>'department_source_label'),
      app_private.normalize_source_label(source_row.normalized_values->>'position_source_label')
    ))::integer
  from public.import_source_rows source_row
  where source_row.import_batch_id = batch.id
    and nullif(btrim(source_row.normalized_values->>'grade_or_band'), '') is not null
    and lower(btrim(source_row.normalized_values->>'grade_or_band')) <> 't'
  group by app_private.normalize_source_label(source_row.normalized_values->>'grade_or_band');

  for row_record in
    select source_row.*,
      department_candidate.id as department_candidate_id,
      position_candidate.id as position_candidate_id
    from public.import_source_rows source_row
    left join public.import_organization_candidates department_candidate
      on department_candidate.import_batch_id = source_row.import_batch_id
      and department_candidate.candidate_type = 'department'
      and department_candidate.normalized_value = app_private.normalize_source_label(source_row.normalized_values->>'department_source_label')
    left join public.import_organization_candidates position_candidate
      on position_candidate.import_batch_id = source_row.import_batch_id
      and position_candidate.candidate_type = 'position'
      and position_candidate.normalized_value = app_private.normalize_source_label(source_row.normalized_values->>'position_source_label')
      and position_candidate.department_normalized_value = app_private.normalize_source_label(source_row.normalized_values->>'department_source_label')
    where source_row.import_batch_id = batch.id
  loop
    insert into public.import_employee_attribution_candidates(
      tenant_id, property_id, import_batch_id, import_source_row_id,
      department_candidate_id, position_candidate_id,
      source_department_value, normalized_department_value,
      source_position_value, normalized_position_value,
      source_band_value, band_value, employment_category, gender,
      status, reasons
    ) values (
      batch.tenant_id, batch.property_id, batch.id, row_record.id,
      row_record.department_candidate_id, row_record.position_candidate_id,
      nullif(btrim(row_record.normalized_values->>'department_source_label'), ''),
      app_private.normalize_source_label(row_record.normalized_values->>'department_source_label'),
      nullif(btrim(row_record.normalized_values->>'position_source_label'), ''),
      app_private.normalize_source_label(row_record.normalized_values->>'position_source_label'),
      nullif(btrim(row_record.normalized_values->>'grade_or_band'), ''),
      case when lower(btrim(row_record.normalized_values->>'grade_or_band')) = 't' then null else nullif(btrim(row_record.normalized_values->>'grade_or_band'), '') end,
      case when lower(btrim(row_record.normalized_values->>'grade_or_band')) = 't' then 'Trainee' else null end,
      nullif(btrim(row_record.normalized_values->>'gender'), ''),
      case when row_record.department_candidate_id is not null and row_record.position_candidate_id is not null then 'eligible' else 'unable_to_determine' end,
      case when row_record.department_candidate_id is null then '["missing_department"]'::jsonb when row_record.position_candidate_id is null then '["missing_position"]'::jsonb else '[]'::jsonb end
    );
  end loop;

  select count(*) filter (where candidate_type = 'department'), count(*) filter (where candidate_type = 'position'), count(*) filter (where candidate_type = 'band') into department_count, position_count, band_count from public.import_organization_candidates where import_batch_id = batch.id;
  select count(*) filter (where employment_category = 'Trainee'), count(*) filter (where status = 'unable_to_determine') into trainee_count, unresolved_count from public.import_employee_attribution_candidates where import_batch_id = batch.id;
  return jsonb_build_object(
    'batchId', batch.id,
    'batchVersion', batch.version,
    'employees', (select count(*) from public.import_employee_attribution_candidates where import_batch_id = batch.id),
    'departments', department_count,
    'positions', position_count,
    'bands', band_count,
    'trainees', trainee_count,
    'unresolvedEmployees', unresolved_count,
    'trainingHistoryImported', false,
    'ctcGtcImported', false
  );
end;
$$;

create or replace function public.confirm_employee_import_organization_candidates(
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
  decision_payload jsonb;
  candidate public.import_organization_candidates%rowtype;
  department_id uuid;
  position_id uuid;
begin
  select * into batch from public.import_batches where id = p_batch_id for update;
  if batch.id is null then raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'P3000'; end if;
  perform app_private.assert_active_property_import_manager(batch.property_id);
  if batch.version <> p_expected_version then raise exception 'IMPORT_STALE_VERSION' using errcode = 'P3001'; end if;
  if jsonb_typeof(p_decisions) <> 'array' then raise exception 'ORGANIZATION_CANDIDATE_DECISIONS_INVALID' using errcode = 'P3020'; end if;

  for decision_payload in select * from jsonb_array_elements(p_decisions)
  loop
    select * into candidate from public.import_organization_candidates
    where id = nullif(decision_payload->>'candidateId', '')::uuid
      and import_batch_id = batch.id for update;
    if candidate.id is null then raise exception 'ORGANIZATION_CANDIDATE_NOT_FOUND' using errcode = 'P3000'; end if;
    if (decision_payload->>'decision') not in ('create','map','exclude','defer') then raise exception 'ORGANIZATION_CANDIDATE_DECISION_INVALID' using errcode = 'P3020'; end if;
    if candidate.candidate_type = 'band' and (decision_payload->>'decision') = 'create' then
      update public.import_organization_candidates set decision = 'create', version = version + 1, updated_at = now() where id = candidate.id;
    else
      update public.import_organization_candidates set decision = (decision_payload->>'decision')::public.import_organization_candidate_decision, target_entity_id = nullif(decision_payload->>'targetEntityId', '')::uuid, version = version + 1, updated_at = now() where id = candidate.id;
    end if;
    if (decision_payload->>'decision') = 'map' and nullif(decision_payload->>'targetEntityId', '') is not null then
      if candidate.candidate_type = 'department' then
        insert into public.import_source_label_resolutions(
          tenant_id, property_id, import_batch_id, resolution_type,
          source_label, normalized_source_label, affected_row_count,
          decision, target_entity_type, target_entity_id, approved_by, decided_at
        ) values (
          batch.tenant_id, batch.property_id, batch.id, 'department',
          candidate.source_value, candidate.normalized_value, candidate.employee_count,
          'mapped', 'department', (decision_payload->>'targetEntityId')::uuid, auth.uid(), now()
        ) on conflict (import_batch_id, resolution_type, normalized_source_label)
        do update set decision = 'mapped', target_entity_type = 'department', target_entity_id = excluded.target_entity_id, approved_by = auth.uid(), decided_at = now(), version = public.import_source_label_resolutions.version + 1;
        update public.import_source_rows source_row
        set normalized_values = source_row.normalized_values || jsonb_build_object('department_id', decision_payload->>'targetEntityId'), updated_at = now()
        where source_row.import_batch_id = batch.id
          and app_private.normalize_source_label(source_row.normalized_values->>'department_source_label') = candidate.normalized_value;
      elsif candidate.candidate_type = 'position' then
        update public.import_source_rows source_row
        set normalized_values = source_row.normalized_values || jsonb_build_object('position_id', decision_payload->>'targetEntityId'), updated_at = now()
        where source_row.import_batch_id = batch.id
          and app_private.normalize_source_label(source_row.normalized_values->>'position_source_label') = candidate.normalized_value
          and app_private.normalize_source_label(source_row.normalized_values->>'department_source_label') = candidate.department_normalized_value;
      end if;
    end if;
  end loop;
  perform app_private.append_import_activity(
    batch,
    'organization_candidate_decisions_confirmed',
    jsonb_build_object(
      'decisionCount', jsonb_array_length(p_decisions),
      'candidateIds', p_decisions,
      'employeeFactsWritten', false,
      'trainingFactsWritten', false
    )
  );
  update public.import_batches set version = version + 1 where id = batch.id;
  return jsonb_build_object('batchId', batch.id, 'version', batch.version + 1, 'status', batch.status, 'decisions', jsonb_array_length(p_decisions));
end;
$$;

revoke all on function public.preview_employee_import_organization_candidates(uuid,bigint), public.confirm_employee_import_organization_candidates(uuid,bigint,jsonb) from public, anon;
grant execute on function public.preview_employee_import_organization_candidates(uuid,bigint), public.confirm_employee_import_organization_candidates(uuid,bigint,jsonb) to authenticated;

-- Preserve the existing guarded commit wrapper while making the approved
-- employee-master gender field available to the immutable commit path.
create or replace function app_private.commit_employee_import(
  p_batch_id uuid,
  p_expected_version bigint
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  batch public.import_batches%rowtype;
  existing_commit_id uuid;
  result_id uuid;
begin
  select * into batch from public.import_batches where id = p_batch_id for update;
  if batch.id is null then return app_private.commit_employee_import_base(p_batch_id, p_expected_version); end if;
  perform app_private.assert_active_property_import_manager(batch.property_id);
  select commit.id into existing_commit_id from public.import_commits commit where commit.import_batch_id = batch.id;
  if existing_commit_id is not null and batch.status in ('completed','completed_with_warnings') then return app_private.commit_employee_import_base(p_batch_id, p_expected_version); end if;
  if batch.version <> p_expected_version then raise exception 'IMPORT_STALE_VERSION' using errcode = 'P3001'; end if;
  if batch.status <> 'ready_for_review' then raise exception 'IMPORT_NOT_READY' using errcode = 'P3002'; end if;
  perform app_private.assert_employee_import_commit_targets(batch);
  perform set_config('app.employee_import_batch_id', batch.id::text, true);
  result_id := app_private.commit_employee_import_base(p_batch_id, p_expected_version);
  return result_id;
end;
$$;
