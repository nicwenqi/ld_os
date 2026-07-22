-- Recovery D0: close the trusted-foundation gate before any training fact
-- exists. This migration deliberately contains no course, plan, session,
-- attendance, feedback, KPI, forecast, risk, health, or AI structures.

-- -------------------------------------------------------------------------
-- One authorization assertion for every future property and department fact
-- -------------------------------------------------------------------------

create or replace function app_private.is_authorized_property_role(
  p_property_id uuid,
  p_role_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.user_accounts account
      join public.profiles profile
        on profile.id = account.user_id
       and profile.is_active
      join public.tenants tenant
        on tenant.id = account.tenant_id
       and tenant.status = 'active'
      join public.properties property
        on property.id = account.property_id
       and property.tenant_id = account.tenant_id
       and property.status = 'active'
      join public.tenant_memberships tenant_membership
        on tenant_membership.tenant_id = account.tenant_id
       and tenant_membership.user_id = account.user_id
       and tenant_membership.status = 'active'
      join public.property_memberships property_membership
        on property_membership.tenant_id = account.tenant_id
       and property_membership.property_id = account.property_id
       and property_membership.user_id = account.user_id
       and property_membership.status = 'active'
      join public.role_assignments assignment
        on assignment.user_id = account.user_id
       and assignment.tenant_id = account.tenant_id
       and assignment.property_id = account.property_id
       and assignment.status = 'active'
      join public.roles role
        on role.id = assignment.role_id
       and role.code = p_role_code
       and role.is_active
      where account.auth_user_id = (select auth.uid())
        and account.property_id = p_property_id
        and account.account_status = 'active'
        and (
          account.locked_until is null
          or account.locked_until <= now()
        )
    );
$$;

create or replace function app_private.has_authorized_department_scope(
  p_property_id uuid,
  p_department_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_authorized_property_role(
      p_property_id,
      'department_training_admin'
    )
    and exists (
      select 1
      from public.user_accounts account
      join public.role_assignments assignment
        on assignment.user_id = account.user_id
       and assignment.tenant_id = account.tenant_id
       and assignment.property_id = account.property_id
       and assignment.status = 'active'
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
      join public.departments target_department
        on target_department.id = p_department_id
       and target_department.tenant_id = account.tenant_id
       and target_department.property_id = account.property_id
       and target_department.is_active
      where account.auth_user_id = (select auth.uid())
        and account.property_id = p_property_id
        and (
          scope.department_id = p_department_id
          or (
            scope.include_descendants
            and exists (
              select 1
              from public.department_closure closure
              where closure.tenant_id = account.tenant_id
                and closure.property_id = p_property_id
                and closure.ancestor_department_id = scope.department_id
                and closure.descendant_department_id = p_department_id
            )
          )
        )
    );
$$;

create or replace function app_private.has_property_role(
  p_property_id uuid,
  p_role_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_authorized_property_role(
    p_property_id,
    p_role_code
  );
$$;

create or replace function app_private.has_department_management_scope(
  p_property_id uuid,
  p_department_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.has_authorized_department_scope(
    p_property_id,
    p_department_id
  );
$$;

create or replace function app_private.is_active_property_import_manager(
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
  );
$$;

revoke all on function
  app_private.is_authorized_property_role(uuid,text),
  app_private.has_authorized_department_scope(uuid,uuid),
  app_private.has_property_role(uuid,text),
  app_private.has_department_management_scope(uuid,uuid),
  app_private.is_active_property_import_manager(uuid)
from public, anon, authenticated;

grant execute on function
  app_private.is_authorized_property_role(uuid,text),
  app_private.has_authorized_department_scope(uuid,uuid),
  app_private.has_property_role(uuid,text),
  app_private.has_department_management_scope(uuid,uuid),
  app_private.is_active_property_import_manager(uuid)
to authenticated;

-- Storage path inspection delegates to storage helpers and live authorization
-- facts, so it must not be declared STABLE.
alter function app_private.can_stage_property_import_object(text) volatile;

create or replace function app_private.assert_active_property_import_manager(
  p_property_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.role_assignments assignment
    join public.roles role
      on role.id = assignment.role_id
     and role.code = 'property_ld_manager'
     and role.is_active
    where assignment.user_id = auth.uid()
      and assignment.property_id = p_property_id
      and assignment.status = 'active'
  ) then
    raise exception 'IMPORT_MANAGER_REQUIRED' using errcode = '42501';
  end if;
  if not app_private.is_authorized_property_role(
    p_property_id,
    'property_ld_manager'
  ) then
    raise exception 'IMPORT_MANAGER_ACCOUNT_INACTIVE' using errcode = '42501';
  end if;
end;
$$;

revoke all on function
  app_private.assert_active_property_import_manager(uuid)
from public, anon, authenticated;

-- -------------------------------------------------------------------------
-- Append-only employee facts and explicit future-fact dependency gate
-- -------------------------------------------------------------------------

alter table public.import_batches
  add column lifecycle_effective_date date,
  add column preview_hash text,
  add constraint import_batches_preview_hash_check check (
    preview_hash is null or preview_hash ~ '^[a-f0-9]{64}$'
  );

alter table public.import_commits
  add column approved_preview_version bigint,
  add column approved_preview_hash text,
  add column approved_at timestamptz,
  add column approval_evidence jsonb,
  add constraint import_commits_approval_evidence_check check (
    (
      approved_preview_version is null
      and approved_preview_hash is null
      and approved_at is null
      and approval_evidence is null
    )
    or (
      approved_preview_version is not null
      and approved_preview_version > 0
      and approved_preview_hash ~ '^[a-f0-9]{64}$'
      and approved_at is not null
      and jsonb_typeof(approval_evidence) = 'object'
    )
  );

create table public.employee_fact_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  employee_id uuid not null,
  employee_version bigint not null,
  effective_date date not null,
  employee_number text not null,
  name_zh text,
  name_en text,
  department_id uuid,
  operational_unit_id uuid,
  position_id uuid,
  position_family_id uuid,
  grade_or_band text,
  hire_date date,
  probation_or_confirmation_date date,
  employment_status public.employee_employment_status not null,
  is_active boolean not null,
  new_employee_days_rule integer not null,
  source_type text not null,
  source_batch_id uuid,
  change_kinds text[] not null default '{}',
  reason text not null,
  before_snapshot jsonb,
  after_snapshot jsonb not null,
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  constraint employee_fact_versions_scope_fkey
    foreign key (property_id, tenant_id)
    references public.properties(id, tenant_id) on delete restrict,
  constraint employee_fact_versions_employee_fkey
    foreign key (employee_id, tenant_id, property_id)
    references public.employees(id, tenant_id, property_id) on delete restrict,
  constraint employee_fact_versions_department_fkey
    foreign key (department_id, tenant_id, property_id)
    references public.departments(id, tenant_id, property_id) on delete restrict,
  constraint employee_fact_versions_unit_fkey
    foreign key (operational_unit_id, tenant_id, property_id)
    references public.operational_units(id, tenant_id, property_id) on delete restrict,
  constraint employee_fact_versions_position_fkey
    foreign key (position_id, tenant_id, property_id)
    references public.positions(id, tenant_id, property_id) on delete restrict,
  constraint employee_fact_versions_family_fkey
    foreign key (position_family_id, tenant_id, property_id)
    references public.position_families(id, tenant_id, property_id) on delete restrict,
  constraint employee_fact_versions_batch_fkey
    foreign key (source_batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete restrict,
  constraint employee_fact_versions_employee_version_key
    unique (employee_id, employee_version),
  constraint employee_fact_versions_version_check check (employee_version > 0),
  constraint employee_fact_versions_number_check check (btrim(employee_number) <> ''),
  constraint employee_fact_versions_rule_check check (new_employee_days_rule > 0),
  constraint employee_fact_versions_source_check check (
    source_type in ('baseline','import_commit','manual_correction','revert')
  ),
  constraint employee_fact_versions_change_kinds_check check (
    change_kinds <@ array[
      'baseline','hire','department_transfer','position_change',
      'status_change','termination','rehire','employee_number_change',
      'profile_correction','import','revert'
    ]::text[]
  ),
  constraint employee_fact_versions_reason_check check (btrim(reason) <> ''),
  constraint employee_fact_versions_snapshots_check check (
    (before_snapshot is null or jsonb_typeof(before_snapshot) = 'object')
    and jsonb_typeof(after_snapshot) = 'object'
  )
);

create index employee_fact_versions_point_in_time_idx
  on public.employee_fact_versions(
    employee_id,
    effective_date desc,
    employee_version desc
  );
create index employee_fact_versions_property_date_idx
  on public.employee_fact_versions(property_id, effective_date desc);

create table public.employee_fact_dependencies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  employee_id uuid not null,
  employee_fact_version_id uuid not null,
  fact_type text not null,
  fact_id uuid not null,
  recorded_at timestamptz not null default now(),
  constraint employee_fact_dependencies_scope_fkey
    foreign key (property_id, tenant_id)
    references public.properties(id, tenant_id) on delete restrict,
  constraint employee_fact_dependencies_employee_fkey
    foreign key (employee_id, tenant_id, property_id)
    references public.employees(id, tenant_id, property_id) on delete restrict,
  constraint employee_fact_dependencies_version_fkey
    foreign key (employee_fact_version_id)
    references public.employee_fact_versions(id) on delete restrict,
  constraint employee_fact_dependencies_type_check check (btrim(fact_type) <> ''),
  constraint employee_fact_dependencies_fact_key unique (fact_type, fact_id, employee_id)
);

create index employee_fact_dependencies_employee_idx
  on public.employee_fact_dependencies(employee_id, fact_type);

alter table public.employee_fact_versions enable row level security;
alter table public.employee_fact_versions force row level security;
alter table public.employee_fact_dependencies enable row level security;
alter table public.employee_fact_dependencies force row level security;

revoke all on
  public.employee_fact_versions,
  public.employee_fact_dependencies
from public, anon, authenticated;

grant select on public.employee_fact_versions to authenticated;

create policy employee_fact_versions_manager_select
on public.employee_fact_versions for select to authenticated
using (
  app_private.is_authorized_property_role(
    property_id,
    'property_ld_manager'
  )
);

create or replace function app_private.reject_employee_fact_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'EMPLOYEE_FACT_EVIDENCE_APPEND_ONLY' using errcode = '42501';
end;
$$;

create trigger employee_fact_versions_append_only
before update or delete on public.employee_fact_versions
for each row execute function app_private.reject_employee_fact_mutation();

create trigger employee_fact_dependencies_append_only
before update or delete on public.employee_fact_dependencies
for each row execute function app_private.reject_employee_fact_mutation();

create or replace function app_private.employee_change_kinds(
  p_old public.employees,
  p_new public.employees,
  p_source_type text
)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  kinds text[] := '{}'::text[];
begin
  if p_old is null then
    kinds := array_append(kinds, 'hire');
  else
    if p_old.employee_number is distinct from p_new.employee_number then
      kinds := array_append(kinds, 'employee_number_change');
    end if;
    if p_old.department_id is distinct from p_new.department_id
      or p_old.operational_unit_id is distinct from p_new.operational_unit_id then
      kinds := array_append(kinds, 'department_transfer');
    end if;
    if p_old.position_id is distinct from p_new.position_id
      or p_old.position_family_id is distinct from p_new.position_family_id then
      kinds := array_append(kinds, 'position_change');
    end if;
    if p_old.employment_status is distinct from p_new.employment_status
      or p_old.is_active is distinct from p_new.is_active then
      kinds := array_append(kinds, 'status_change');
      if p_new.employment_status = 'terminated' then
        kinds := array_append(kinds, 'termination');
      elsif not p_old.is_active and p_new.is_active then
        kinds := array_append(kinds, 'rehire');
      end if;
    end if;
    if p_old.name_zh is distinct from p_new.name_zh
      or p_old.name_en is distinct from p_new.name_en
      or p_old.grade_or_band is distinct from p_new.grade_or_band
      or p_old.hire_date is distinct from p_new.hire_date
      or p_old.probation_or_confirmation_date
        is distinct from p_new.probation_or_confirmation_date then
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
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  configured_source text := nullif(
    current_setting('app.employee_change_source', true),
    ''
  );
  configured_date text := nullif(
    current_setting('app.employee_effective_date', true),
    ''
  );
  configured_reason text := nullif(
    current_setting('app.employee_change_reason', true),
    ''
  );
  selected_source text;
  selected_date date;
  selected_reason text;
  selected_rule integer;
  before_row public.employees;
begin
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return new;
  end if;

  selected_source := coalesce(
    configured_source,
    case when new.source_batch_id is not null
      then 'import_commit'
      else 'manual_correction'
    end
  );
  if selected_source not in (
    'baseline','import_commit','manual_correction','revert'
  ) then
    raise exception 'EMPLOYEE_CHANGE_SOURCE_INVALID' using errcode = '23514';
  end if;

  if configured_date is not null then
    selected_date := configured_date::date;
  elsif new.source_batch_id is not null then
    select batch.lifecycle_effective_date into selected_date
    from public.import_batches batch
    where batch.id = new.source_batch_id;
  end if;
  selected_date := coalesce(selected_date, current_date);

  select settings.new_employee_days into selected_rule
  from public.property_settings settings
  where settings.property_id = new.property_id;
  if selected_rule is null or selected_rule <= 0 then
    raise exception 'EMPLOYEE_FACT_PROPERTY_RULE_MISSING' using errcode = '23514';
  end if;

  selected_reason := coalesce(
    configured_reason,
    case selected_source
      when 'import_commit' then '经审批的员工资料更新批次'
      when 'revert' then '经冲突检查的员工资料更新撤销'
      else '经授权的员工主数据更正'
    end
  );
  if tg_op = 'UPDATE' then before_row := old; end if;

  insert into public.employee_fact_versions(
    tenant_id,
    property_id,
    employee_id,
    employee_version,
    effective_date,
    employee_number,
    name_zh,
    name_en,
    department_id,
    operational_unit_id,
    position_id,
    position_family_id,
    grade_or_band,
    hire_date,
    probation_or_confirmation_date,
    employment_status,
    is_active,
    new_employee_days_rule,
    source_type,
    source_batch_id,
    change_kinds,
    reason,
    before_snapshot,
    after_snapshot,
    recorded_by
  ) values (
    new.tenant_id,
    new.property_id,
    new.id,
    new.version,
    selected_date,
    new.employee_number,
    new.name_zh,
    new.name_en,
    new.department_id,
    new.operational_unit_id,
    new.position_id,
    new.position_family_id,
    new.grade_or_band,
    new.hire_date,
    new.probation_or_confirmation_date,
    new.employment_status,
    new.is_active,
    selected_rule,
    selected_source,
    new.source_batch_id,
    app_private.employee_change_kinds(before_row, new, selected_source),
    selected_reason,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new),
    auth.uid()
  );
  return new;
end;
$$;

create trigger employees_record_fact_version
after insert or update on public.employees
for each row execute function app_private.record_employee_fact_version();

-- Existing rows are not assigned invented history. They receive one clearly
-- marked, known-current baseline fact on the migration date only.
insert into public.employee_fact_versions(
  tenant_id,
  property_id,
  employee_id,
  employee_version,
  effective_date,
  employee_number,
  name_zh,
  name_en,
  department_id,
  operational_unit_id,
  position_id,
  position_family_id,
  grade_or_band,
  hire_date,
  probation_or_confirmation_date,
  employment_status,
  is_active,
  new_employee_days_rule,
  source_type,
  source_batch_id,
  change_kinds,
  reason,
  before_snapshot,
  after_snapshot,
  recorded_by,
  recorded_at
)
select
  employee.tenant_id,
  employee.property_id,
  employee.id,
  employee.version,
  current_date,
  employee.employee_number,
  employee.name_zh,
  employee.name_en,
  employee.department_id,
  employee.operational_unit_id,
  employee.position_id,
  employee.position_family_id,
  employee.grade_or_band,
  employee.hire_date,
  employee.probation_or_confirmation_date,
  employee.employment_status,
  employee.is_active,
  settings.new_employee_days,
  'baseline',
  employee.source_batch_id,
  array['baseline']::text[],
  'D0 迁移时已知的当前员工状态；不代表迁移前历史',
  null,
  to_jsonb(employee),
  employee.updated_by,
  now()
from public.employees employee
join public.property_settings settings
  on settings.property_id = employee.property_id
on conflict (employee_id, employee_version) do nothing;

create or replace function app_private.resolve_employee_fact_at(
  p_employee_id uuid,
  p_event_date date
)
returns table (
  fact_version_id uuid,
  employee_id uuid,
  employee_version bigint,
  effective_date date,
  tenant_id uuid,
  property_id uuid,
  employee_number text,
  department_id uuid,
  operational_unit_id uuid,
  position_id uuid,
  position_family_id uuid,
  hire_date date,
  probation_or_confirmation_date date,
  employment_status public.employee_employment_status,
  is_active boolean,
  is_new_employee_at_event boolean,
  new_employee_days_rule integer,
  source_type text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    fact.id,
    fact.employee_id,
    fact.employee_version,
    fact.effective_date,
    fact.tenant_id,
    fact.property_id,
    fact.employee_number,
    fact.department_id,
    fact.operational_unit_id,
    fact.position_id,
    fact.position_family_id,
    fact.hire_date,
    fact.probation_or_confirmation_date,
    fact.employment_status,
    fact.is_active,
    fact.hire_date is not null
      and p_event_date between fact.hire_date
        and fact.hire_date + (fact.new_employee_days_rule - 1),
    fact.new_employee_days_rule,
    fact.source_type
  from public.employee_fact_versions fact
  where fact.employee_id = p_employee_id
    and fact.effective_date <= p_event_date
  order by fact.effective_date desc, fact.employee_version desc
  limit 1;
$$;

revoke all on function
  app_private.reject_employee_fact_mutation(),
  app_private.employee_change_kinds(public.employees,public.employees,text),
  app_private.record_employee_fact_version(),
  app_private.resolve_employee_fact_at(uuid,date)
from public, anon, authenticated;

-- Raw employee and identifier DML is no longer an application mutation path.
drop policy if exists employees_manager_insert on public.employees;
drop policy if exists employees_manager_update on public.employees;
drop policy if exists employee_identifiers_manager_insert
  on public.employee_external_identifiers;
drop policy if exists employee_identifiers_manager_update
  on public.employee_external_identifiers;

revoke insert, update, delete on public.employees
from public, anon, authenticated;
revoke insert, update, delete on public.employee_external_identifiers
from public, anon, authenticated;

create or replace function app_private.prevent_employee_scope_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
    or new.property_id is distinct from old.property_id then
    raise exception 'EMPLOYEE_IDENTITY_IMMUTABLE: tenant and property cannot change'
      using errcode = '23514';
  end if;
  if new.employee_number is distinct from old.employee_number
    and not (
      current_setting('app.employee_change_source', true) = 'manual_correction'
      and app_private.is_active_property_import_manager(old.property_id)
    ) then
    raise exception 'EMPLOYEE_NUMBER_CHANGE_REQUIRES_CONTROLLED_CORRECTION'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function app_private.prevent_employee_scope_change()
from public, anon, authenticated;

-- -------------------------------------------------------------------------
-- Confirmed field recognition must re-project immutable workbook raw values
-- -------------------------------------------------------------------------

create or replace function app_private.normalize_employee_import_field_value(
  p_target_field text,
  p_source_value jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  value_text text;
  normalized_status text;
  parsed_date date;
begin
  if p_source_value is null or p_source_value = 'null'::jsonb then
    return 'null'::jsonb;
  end if;
  value_text := btrim(p_source_value #>> '{}');
  if value_text = '' then return 'null'::jsonb; end if;

  if p_target_field = 'employment_status' then
    normalized_status := lower(value_text);
    normalized_status := case normalized_status
      when 'active' then 'active'
      when 'employed' then 'active'
      when '在职' then 'active'
      when 'leave' then 'leave'
      when 'on leave' then 'leave'
      when '休假' then 'leave'
      when 'inactive' then 'inactive'
      when '停用' then 'inactive'
      when 'terminated' then 'terminated'
      when '离职' then 'terminated'
      when 'unknown' then 'unknown'
      when '未知' then 'unknown'
      else null
    end;
    if normalized_status is null then
      return jsonb_build_object('invalid', true, 'source', value_text);
    end if;
    return to_jsonb(normalized_status);
  end if;

  if p_target_field in (
    'hire_date',
    'probation_or_confirmation_date'
  ) then
    begin
      if value_text ~ '^\d{4}-\d{2}-\d{2}' then
        parsed_date := substring(value_text from 1 for 10)::date;
      else
        return jsonb_build_object('invalid', true, 'source', value_text);
      end if;
      return to_jsonb(parsed_date::text);
    exception
      when invalid_datetime_format or datetime_field_overflow then
        return jsonb_build_object('invalid', true, 'source', value_text);
    end;
  end if;

  return to_jsonb(value_text);
end;
$$;

create or replace function app_private.reproject_employee_import_rows(
  p_batch_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.import_batches%rowtype;
begin
  select * into batch
  from public.import_batches
  where id = p_batch_id
  for update;
  if batch.id is null then
    raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'P3000';
  end if;
  perform app_private.assert_active_property_import_manager(batch.property_id);

  if exists (
    select 1
    from public.import_field_mappings mapping
    where mapping.import_batch_id = batch.id
      and mapping.mapping_status = 'confirmed'
      and app_private.is_employee_import_excluded_key(
        mapping.source_column_name
      )
  ) then
    raise exception 'IMPORT_EXCLUDED_SOURCE_COLUMN'
      using errcode = 'P3201';
  end if;

  if exists (
    select mapping.target_field
    from public.import_field_mappings mapping
    where mapping.import_batch_id = batch.id
      and mapping.mapping_status = 'confirmed'
    group by mapping.target_field
    having count(*) > 1
  ) then
    raise exception 'IMPORT_MAPPING_TARGET_DUPLICATE'
      using errcode = 'P3201';
  end if;

  update public.import_source_rows source_row
  set normalized_values = coalesce((
        select jsonb_object_agg(
          mapping.target_field,
          app_private.normalize_employee_import_field_value(
            mapping.target_field,
            source_row.raw_values -> mapping.source_column_name
          )
        )
        from public.import_field_mappings mapping
        where mapping.import_batch_id = batch.id
          and mapping.import_sheet_id = source_row.import_sheet_id
          and mapping.mapping_status = 'confirmed'
      ), '{}'::jsonb),
      processing_status = 'staged',
      proposed_action = 'unresolved',
      matched_employee_id = null,
      validation_summary = '{}'::jsonb,
      updated_at = now()
  where source_row.import_batch_id = batch.id;

  delete from public.import_issues issue
  where issue.import_batch_id = batch.id
    and issue.issue_type in (
      'duplicate_employee_number_in_file',
      'missing_employee_number',
      'missing_name',
      'unresolved_department',
      'unresolved_position',
      'invalid_date',
      'missing_required_field',
      'unsupported_status'
    );

  delete from public.import_source_label_resolutions resolution
  where resolution.import_batch_id = batch.id;

  insert into public.import_source_label_resolutions(
    tenant_id,
    property_id,
    import_batch_id,
    resolution_type,
    source_label,
    normalized_source_label,
    affected_row_count,
    decision
  )
  select
    batch.tenant_id,
    batch.property_id,
    batch.id,
    label.resolution_type,
    min(label.source_label),
    label.normalized_source_label,
    count(*)::integer,
    'pending'
  from (
    select
      'department'::text resolution_type,
      btrim(source_row.normalized_values->>'department_source_label') source_label,
      app_private.normalize_source_label(
        source_row.normalized_values->>'department_source_label'
      ) normalized_source_label
    from public.import_source_rows source_row
    where source_row.import_batch_id = batch.id
      and nullif(
        btrim(source_row.normalized_values->>'department_source_label'),
        ''
      ) is not null
    union all
    select
      'position'::text,
      btrim(source_row.normalized_values->>'position_source_label'),
      app_private.normalize_source_label(
        source_row.normalized_values->>'position_source_label'
      )
    from public.import_source_rows source_row
    where source_row.import_batch_id = batch.id
      and nullif(
        btrim(source_row.normalized_values->>'position_source_label'),
        ''
      ) is not null
  ) label
  group by label.resolution_type, label.normalized_source_label;

  insert into public.import_issues(
    tenant_id,
    property_id,
    import_batch_id,
    import_source_row_id,
    issue_type,
    severity,
    source_field,
    source_value,
    message,
    resolution_status
  )
  select
    batch.tenant_id,
    batch.property_id,
    batch.id,
    source_row.id,
    issue.issue_type,
    'error',
    issue.source_field,
    issue.source_value,
    issue.message,
    'unresolved'
  from public.import_source_rows source_row
  cross join lateral (
    select * from (
      values
        (
          'missing_employee_number'::text,
          'employee_number'::text,
          source_row.normalized_values->>'employee_number',
          '员工编号缺失，不能确认员工身份'::text,
          nullif(btrim(source_row.normalized_values->>'employee_number'), '') is null
        ),
        (
          'missing_name',
          'name_zh',
          null,
          '员工中文名与英文名均缺失',
          nullif(btrim(source_row.normalized_values->>'name_zh'), '') is null
            and nullif(btrim(source_row.normalized_values->>'name_en'), '') is null
        ),
        (
          'unresolved_department',
          'department_source_label',
          source_row.normalized_values->>'department_source_label',
          '部门来源值缺失或尚未确认归属',
          nullif(btrim(source_row.normalized_values->>'department_source_label'), '') is null
        ),
        (
          'unresolved_position',
          'position_source_label',
          source_row.normalized_values->>'position_source_label',
          '职位来源值缺失或尚未确认归属',
          nullif(btrim(source_row.normalized_values->>'position_source_label'), '') is null
        ),
        (
          'invalid_date',
          'hire_date',
          source_row.normalized_values->>'hire_date',
          '入职日期格式无法确定',
          jsonb_typeof(source_row.normalized_values->'hire_date') = 'object'
        ),
        (
          'invalid_date',
          'probation_or_confirmation_date',
          source_row.normalized_values->>'probation_or_confirmation_date',
          '转正日期格式无法确定',
          jsonb_typeof(
            source_row.normalized_values->'probation_or_confirmation_date'
          ) = 'object'
        ),
        (
          'unsupported_status',
          'employment_status',
          source_row.normalized_values->>'employment_status',
          '员工状态值不在已批准范围内',
          jsonb_typeof(source_row.normalized_values->'employment_status') = 'object'
        )
    ) issue(
      issue_type,
      source_field,
      source_value,
      message,
      applies
    )
    where issue.applies
  ) issue
  where source_row.import_batch_id = batch.id;

  insert into public.import_issues(
    tenant_id,
    property_id,
    import_batch_id,
    import_source_row_id,
    issue_type,
    severity,
    source_field,
    source_value,
    message,
    resolution_status
  )
  select
    batch.tenant_id,
    batch.property_id,
    batch.id,
    source_row.id,
    'duplicate_employee_number_in_file',
    'error',
    'employee_number',
    source_row.normalized_values->>'employee_number',
    '同一文件中员工编号重复，必须先明确身份',
    'unresolved'
  from public.import_source_rows source_row
  join (
    select normalized_values->>'employee_number' employee_number
    from public.import_source_rows
    where import_batch_id = batch.id
      and nullif(btrim(normalized_values->>'employee_number'), '') is not null
    group by normalized_values->>'employee_number'
    having count(*) > 1
  ) duplicate
    on duplicate.employee_number =
      source_row.normalized_values->>'employee_number'
  where source_row.import_batch_id = batch.id;

  update public.import_source_rows source_row
  set processing_status = case
        when exists (
          select 1
          from public.import_issues issue
          where issue.import_source_row_id = source_row.id
            and issue.severity = 'error'
            and issue.resolution_status in ('unresolved','deferred')
        ) then 'error'::public.import_row_status
        else 'staged'::public.import_row_status
      end,
      validation_summary = jsonb_build_object(
        'projectionVersion', batch.version,
        'blockingIssues', coalesce((
          select jsonb_agg(issue.issue_type order by issue.issue_type)
          from public.import_issues issue
          where issue.import_source_row_id = source_row.id
            and issue.severity = 'error'
            and issue.resolution_status in ('unresolved','deferred')
        ), '[]'::jsonb)
      )
  where source_row.import_batch_id = batch.id;

  update public.import_batches
  set lifecycle_effective_date = null,
      preview_hash = null,
      preview_summary = '{}'::jsonb,
      previewed_by = null,
      previewed_at = null,
      error_rows = (
        select count(*)
        from public.import_source_rows source_row
        where source_row.import_batch_id = batch.id
          and source_row.processing_status = 'error'
      )
  where id = batch.id;
end;
$$;

create or replace function public.confirm_employee_import_field_mapping(
  p_batch_id uuid,
  p_expected_version bigint,
  p_mapping_decisions jsonb
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
  result := app_private.confirm_employee_import_field_mapping(
    p_batch_id,
    p_expected_version,
    p_mapping_decisions
  );
  perform app_private.reproject_employee_import_rows(p_batch_id);
  return result;
end;
$$;

revoke all on function
  app_private.normalize_employee_import_field_value(text,jsonb),
  app_private.reproject_employee_import_rows(uuid)
from public, anon, authenticated;

-- -------------------------------------------------------------------------
-- Exact approval evidence: row, field, before, after, reason, version, hash
-- -------------------------------------------------------------------------

create or replace function app_private.is_position_allowed_in_department(
  p_property_id uuid,
  p_position_id uuid,
  p_department_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1
      from public.positions position
      where position.id = p_position_id
        and position.property_id = p_property_id
    )
    and (
      not exists (
        select 1
        from public.position_department_assignments assignment
        where assignment.property_id = p_property_id
          and assignment.position_id = p_position_id
      )
      or exists (
        select 1
        from public.position_department_assignments assignment
        where assignment.property_id = p_property_id
          and assignment.position_id = p_position_id
          and assignment.department_id = p_department_id
      )
    );
$$;

create or replace function app_private.employee_preview_display_value(
  p_property_id uuid,
  p_field text,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  raw_value jsonb;
  entity_id uuid;
  display_value text;
begin
  if p_snapshot is null then return 'null'::jsonb; end if;
  raw_value := p_snapshot -> p_field;
  if raw_value is null or raw_value = 'null'::jsonb then
    return 'null'::jsonb;
  end if;
  if p_field not in (
    'department_id','operational_unit_id','position_id','position_family_id'
  ) then
    return raw_value;
  end if;
  begin
    entity_id := nullif(raw_value #>> '{}', '')::uuid;
  exception when invalid_text_representation then
    return raw_value;
  end;
  if entity_id is null then return 'null'::jsonb; end if;
  if p_field = 'department_id' then
    select department.name_zh into display_value
    from public.departments department
    where department.id = entity_id
      and department.property_id = p_property_id;
  elsif p_field = 'operational_unit_id' then
    select unit.name_zh into display_value
    from public.operational_units unit
    where unit.id = entity_id
      and unit.property_id = p_property_id;
  elsif p_field = 'position_id' then
    select position.name_zh into display_value
    from public.positions position
    where position.id = entity_id
      and position.property_id = p_property_id;
  else
    select family.name_zh into display_value
    from public.position_families family
    where family.id = entity_id
      and family.property_id = p_property_id;
  end if;
  return to_jsonb(coalesce(display_value, entity_id::text));
end;
$$;

create or replace function app_private.employee_preview_changes(
  p_property_id uuid,
  p_action public.import_proposed_action,
  p_before jsonb,
  p_after jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  field_record record;
  before_value jsonb;
  after_value jsonb;
  changes jsonb := '[]'::jsonb;
begin
  if p_action not in ('insert','update') then return changes; end if;
  for field_record in
    select * from (values
      ('employee_number','员工编号',1),
      ('name_zh','中文姓名',2),
      ('name_en','英文姓名',3),
      ('department_id','正式部门',4),
      ('operational_unit_id','运营单元',5),
      ('position_id','正式职位',6),
      ('position_family_id','职位族',7),
      ('grade_or_band','职级',8),
      ('hire_date','入职日期',9),
      ('probation_or_confirmation_date','转正日期',10),
      ('employment_status','员工状态',11),
      ('is_active','有效状态',12)
    ) fields(field_key, field_label, sort_order)
    order by sort_order
  loop
    before_value := app_private.employee_preview_display_value(
      p_property_id,
      field_record.field_key,
      p_before
    );
    after_value := app_private.employee_preview_display_value(
      p_property_id,
      field_record.field_key,
      p_after
    );
    if p_action = 'insert' then before_value := 'null'::jsonb; end if;
    if before_value is distinct from after_value then
      changes := changes || jsonb_build_array(jsonb_build_object(
        'field', field_record.field_label,
        'before', before_value,
        'after', after_value,
        'reason', case field_record.field_key
          when 'department_id' then '经理确认的部门归属'
          when 'operational_unit_id' then '经理确认的运营单元归属'
          when 'position_id' then '经理确认的职位归属'
          when 'position_family_id' then '正式职位关联的职位族'
          when 'employment_status' then '已批准的状态处理规则'
          when 'is_active' then '已批准的员工状态决定'
          else '确认字段识别后的工作簿值'
        end
      ));
    end if;
  end loop;
  return changes;
end;
$$;

create or replace function public.prepare_employee_import_preview(
  p_batch_id uuid,
  p_expected_version bigint,
  p_options jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.import_batches%rowtype;
  selected_date date;
  additions integer;
  updates integer;
  unchanged integer;
  exclusions integer;
  blocked integer;
  unresolved integer;
  row_evidence jsonb;
  evidence_payload jsonb;
  evidence_hash text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  begin
    selected_date := nullif(btrim(p_options->>'effectiveDate'), '')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'IMPORT_EFFECTIVE_DATE_INVALID' using errcode = 'P3020';
  end;
  if selected_date is null or selected_date > current_date then
    raise exception 'IMPORT_EFFECTIVE_DATE_REQUIRED' using errcode = 'P3020';
  end if;

  perform app_private.prepare_employee_import_preview(
    p_batch_id,
    p_expected_version,
    p_options
  );

  select * into batch
  from public.import_batches
  where id = p_batch_id
  for update;

  update public.import_source_rows source_row
  set normalized_values = source_row.normalized_values
      || jsonb_build_object(
        'is_new_employee',
        nullif(source_row.normalized_values->>'hire_date', '')::date
          between selected_date - (settings.new_employee_days - 1)
            and selected_date
      )
  from public.property_settings settings
  where source_row.import_batch_id = batch.id
    and settings.property_id = batch.property_id
    and source_row.proposed_action in ('insert','update','unchanged')
    and nullif(source_row.normalized_values->>'hire_date', '') is not null;

  update public.import_source_rows source_row
  set processing_status = 'error',
      proposed_action = 'unresolved',
      validation_summary = jsonb_set(jsonb_set(
          source_row.validation_summary,
          '{errors}',
          coalesce(source_row.validation_summary->'errors', '[]'::jsonb)
            || jsonb_build_array('position_not_allowed_for_department'),
          true
        ), '{preview_classification}', '"blocked"'::jsonb, true),
      updated_at = now()
  where source_row.import_batch_id = batch.id
    and source_row.proposed_action in ('insert','update')
    and not app_private.is_position_allowed_in_department(
      batch.property_id,
      (source_row.normalized_values->>'position_id')::uuid,
      (source_row.normalized_values->>'department_id')::uuid
    );

  update public.import_source_rows source_row
  set processing_status = 'error',
      proposed_action = 'unresolved',
      validation_summary = jsonb_set(jsonb_set(
          source_row.validation_summary,
          '{errors}',
          coalesce(source_row.validation_summary->'errors', '[]'::jsonb)
            || jsonb_build_array('effective_date_precedes_known_history'),
          true
        ), '{preview_classification}', '"blocked"'::jsonb, true),
      updated_at = now()
  where source_row.import_batch_id = batch.id
    and source_row.proposed_action = 'update'
    and exists (
      select 1
      from public.employee_fact_versions fact
      where fact.employee_id = source_row.matched_employee_id
        and fact.effective_date > selected_date
    );

  select
    count(*) filter (where proposed_action = 'insert'),
    count(*) filter (where proposed_action = 'update'),
    count(*) filter (where proposed_action = 'unchanged'),
    count(*) filter (where proposed_action = 'excluded'),
    count(*) filter (
      where proposed_action = 'unresolved'
        and coalesce(
          validation_summary->>'preview_classification',
          ''
        ) = 'blocked'
    ),
    count(*) filter (
      where proposed_action = 'unresolved'
        and coalesce(
          validation_summary->>'preview_classification',
          ''
        ) <> 'blocked'
    )
  into additions, updates, unchanged, exclusions, blocked, unresolved
  from public.import_source_rows
  where import_batch_id = batch.id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'rowId', source_row.id,
      'rowNumber', source_row.source_row_number,
      'action', source_row.proposed_action,
      'employeeNumber', nullif(
        btrim(source_row.normalized_values->>'employee_number'),
        ''
      ),
      'employeeName', coalesce(
        nullif(btrim(source_row.normalized_values->>'name_zh'), ''),
        nullif(btrim(source_row.normalized_values->>'name_en'), '')
      ),
      'effectiveDate', selected_date,
      'changes', app_private.employee_preview_changes(
        batch.property_id,
        source_row.proposed_action,
        source_row.validation_summary->'current_snapshot',
        source_row.normalized_values
      )
    ) order by source_row.source_row_number, source_row.id
  ), '[]'::jsonb)
  into row_evidence
  from public.import_source_rows source_row
  where source_row.import_batch_id = batch.id;

  evidence_payload := jsonb_build_object(
    'batchId', batch.id,
    'batchVersion', batch.version,
    'effectiveDate', selected_date,
    'statusTreatment', batch.status_treatment,
    'additions', additions,
    'updates', updates,
    'unchanged', unchanged,
    'exclusions', exclusions,
    'blocked', blocked,
    'unresolved', unresolved,
    'rows', row_evidence,
    'trainingHistoryImported', false,
    'ctcGtcImported', false
  );
  evidence_hash := encode(
    extensions.digest(convert_to(evidence_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  update public.import_batches
  set status = case when blocked + unresolved = 0
        then 'ready_for_review'::public.import_batch_status
        else 'mapping_required'::public.import_batch_status
      end,
      valid_rows = additions + updates + unchanged,
      error_rows = blocked + unresolved,
      excluded_rows = exclusions,
      lifecycle_effective_date = selected_date,
      preview_hash = evidence_hash,
      preview_summary = evidence_payload,
      previewed_by = auth.uid(),
      previewed_at = now()
  where id = batch.id
  returning * into batch;

  perform app_private.append_import_activity(
    batch,
    'preview_evidence_sealed',
    jsonb_build_object(
      'batchVersion', batch.version,
      'previewHash', evidence_hash,
      'effectiveDate', selected_date,
      'rowCount', jsonb_array_length(row_evidence),
      'blocked', blocked,
      'unresolved', unresolved
    )
  );

  return evidence_payload || jsonb_build_object(
    'version', batch.version,
    'status', batch.status,
    'previewHash', evidence_hash
  );
end;
$$;

create or replace function public.read_employee_import_preview(
  p_batch_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  batch public.import_batches%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  select * into batch
  from public.import_batches
  where id = p_batch_id;
  if batch.id is null then
    raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'P3000';
  end if;
  perform app_private.assert_active_property_import_manager(batch.property_id);
  if batch.preview_hash is null
    or batch.lifecycle_effective_date is null
    or batch.preview_summary = '{}'::jsonb then
    return null;
  end if;
  return batch.preview_summary || jsonb_build_object(
    'version', batch.version,
    'status', batch.status,
    'previewHash', batch.preview_hash
  );
end;
$$;

revoke all on function
  app_private.is_position_allowed_in_department(uuid,uuid,uuid),
  app_private.employee_preview_display_value(uuid,text,jsonb),
  app_private.employee_preview_changes(
    uuid,
    public.import_proposed_action,
    jsonb,
    jsonb
  )
from public, anon, authenticated;

revoke all on function
  public.read_employee_import_preview(uuid)
from public, anon;
grant execute on function
  public.read_employee_import_preview(uuid)
to authenticated;

create or replace function public.commit_employee_import(
  p_batch_id uuid,
  p_expected_version bigint,
  p_preview_hash text,
  p_confirmed boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.import_batches%rowtype;
  commit_record public.import_commits%rowtype;
  commit_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  select * into batch
  from public.import_batches
  where id = p_batch_id
  for update;
  if batch.id is null then
    raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode = 'P3000';
  end if;
  perform app_private.assert_active_property_import_manager(batch.property_id);

  select * into commit_record
  from public.import_commits import_commit
  where import_commit.import_batch_id = batch.id;
  if commit_record.id is not null
    and batch.status in ('completed','completed_with_warnings') then
    if p_confirmed
      and commit_record.approved_preview_hash = p_preview_hash then
      return commit_record.id;
    end if;
    raise exception 'IMPORT_APPROVAL_EVIDENCE_MISMATCH'
      using errcode = 'P3001';
  end if;

  if not coalesce(p_confirmed, false) then
    raise exception 'IMPORT_EXPLICIT_CONFIRMATION_REQUIRED'
      using errcode = 'P3020';
  end if;
  if batch.version <> p_expected_version then
    raise exception 'IMPORT_STALE_VERSION' using errcode = 'P3001';
  end if;
  if batch.status <> 'ready_for_review'
    or batch.preview_hash is null
    or batch.lifecycle_effective_date is null then
    raise exception 'IMPORT_NOT_READY' using errcode = 'P3002';
  end if;
  if nullif(btrim(p_preview_hash), '') is null
    or p_preview_hash <> batch.preview_hash then
    raise exception 'IMPORT_APPROVAL_EVIDENCE_MISMATCH'
      using errcode = 'P3001';
  end if;
  if exists (
    select 1
    from public.import_source_rows source_row
    where source_row.import_batch_id = batch.id
      and source_row.proposed_action in ('insert','update')
      and not app_private.is_position_allowed_in_department(
        batch.property_id,
        (source_row.normalized_values->>'position_id')::uuid,
        (source_row.normalized_values->>'department_id')::uuid
      )
  ) then
    raise exception 'EMPLOYEE_POSITION_DEPARTMENT_MISMATCH'
      using errcode = '23514';
  end if;

  perform set_config('app.employee_change_source', 'import_commit', true);
  perform set_config(
    'app.employee_effective_date',
    batch.lifecycle_effective_date::text,
    true
  );
  perform set_config(
    'app.employee_change_reason',
    '经经理逐员工逐字段审批的员工资料更新',
    true
  );

  commit_id := app_private.commit_employee_import(
    batch.id,
    p_expected_version
  );

  update public.import_commits import_commit
  set approved_preview_version = p_expected_version,
      approved_preview_hash = batch.preview_hash,
      approved_at = now(),
      approval_evidence = jsonb_build_object(
        'previewVersion', p_expected_version,
        'previewHash', batch.preview_hash,
        'effectiveDate', batch.lifecycle_effective_date,
        'approvedBy', auth.uid(),
        'approvedAt', now(),
        'counts', batch.preview_summary - 'rows',
        'rowCount', jsonb_array_length(
          coalesce(batch.preview_summary->'rows', '[]'::jsonb)
        )
      )
  where import_commit.id = commit_id;

  select * into batch
  from public.import_batches
  where id = p_batch_id;
  perform app_private.append_import_activity(
    batch,
    'employee_update_approved_and_committed',
    jsonb_build_object(
      'commitId', commit_id,
      'approvedPreviewVersion', p_expected_version,
      'approvedPreviewHash', p_preview_hash,
      'effectiveDate', batch.lifecycle_effective_date
    )
  );
  return commit_id;
end;
$$;

-- The pre-D0 signature remains present only to return a clear failure for a
-- stale caller. It has no authenticated EXECUTE grant.
create or replace function public.commit_employee_import(
  p_batch_id uuid,
  p_expected_version bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Keep the retired signature intentionally callable only by privileged
  -- migration tooling while making both legacy arguments explicit evidence.
  perform p_batch_id, p_expected_version;
  raise exception 'IMPORT_APPROVAL_EVIDENCE_REQUIRED'
    using errcode = '42501';
end;
$$;

revoke all on function
  public.commit_employee_import(uuid,bigint),
  public.commit_employee_import(uuid,bigint,text,boolean)
from public, anon, authenticated;
grant execute on function
  public.commit_employee_import(uuid,bigint,text,boolean)
to authenticated;

-- -------------------------------------------------------------------------
-- Controlled current-master corrections, without restoring direct table DML
-- -------------------------------------------------------------------------

create or replace function public.correct_employee_master_fact(
  p_employee_id uuid,
  p_expected_version bigint,
  p_effective_date date,
  p_reason text,
  p_changes jsonb,
  p_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  employee public.employees%rowtype;
  updated_employee public.employees%rowtype;
  next_status public.employee_employment_status;
  next_active boolean;
  next_department_id uuid;
  next_operational_unit_id uuid;
  next_position_id uuid;
  next_position_family_id uuid;
  next_employee_number text;
  fact_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not coalesce(p_confirmed, false)
    or nullif(btrim(p_reason), '') is null then
    raise exception 'EMPLOYEE_CORRECTION_APPROVAL_REQUIRED'
      using errcode = 'P3020';
  end if;
  if p_effective_date is null or p_effective_date > current_date then
    raise exception 'EMPLOYEE_EFFECTIVE_DATE_INVALID'
      using errcode = 'P3020';
  end if;
  if jsonb_typeof(p_changes) <> 'object'
    or p_changes = '{}'::jsonb
    or exists (
      select 1
      from jsonb_object_keys(p_changes) key
      where key not in (
        'employee_number','name_zh','name_en','department_id',
        'operational_unit_id','position_id','position_family_id',
        'grade_or_band','hire_date','probation_or_confirmation_date',
        'employment_status','is_active'
      )
    ) then
    raise exception 'EMPLOYEE_CORRECTION_FIELDS_INVALID'
      using errcode = 'P3020';
  end if;

  select * into employee
  from public.employees
  where id = p_employee_id
  for update;
  if employee.id is null then
    raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P3000';
  end if;
  perform app_private.assert_active_property_import_manager(
    employee.property_id
  );
  if employee.version <> p_expected_version then
    raise exception 'EMPLOYEE_STALE_VERSION' using errcode = 'P3005';
  end if;
  if exists (
    select 1
    from public.employee_fact_versions fact
    where fact.employee_id = employee.id
      and fact.effective_date > p_effective_date
  ) then
    raise exception 'EMPLOYEE_EFFECTIVE_DATE_PRECEDES_KNOWN_HISTORY'
      using errcode = 'P3020';
  end if;

  begin
    next_employee_number := case when p_changes ? 'employee_number'
      then nullif(btrim(p_changes->>'employee_number'), '')
      else employee.employee_number
    end;
    next_department_id := case when p_changes ? 'department_id'
      then nullif(p_changes->>'department_id', '')::uuid
      else employee.department_id
    end;
    next_operational_unit_id := case when p_changes ? 'operational_unit_id'
      then nullif(p_changes->>'operational_unit_id', '')::uuid
      else employee.operational_unit_id
    end;
    next_position_id := case when p_changes ? 'position_id'
      then nullif(p_changes->>'position_id', '')::uuid
      else employee.position_id
    end;
    next_position_family_id := case when p_changes ? 'position_family_id'
      then nullif(p_changes->>'position_family_id', '')::uuid
      else employee.position_family_id
    end;
    next_status := case when p_changes ? 'employment_status'
      then (p_changes->>'employment_status')::public.employee_employment_status
      else employee.employment_status
    end;
  exception when invalid_text_representation then
    raise exception 'EMPLOYEE_CORRECTION_VALUE_INVALID'
      using errcode = 'P3020';
  end;
  if next_employee_number is null then
    raise exception 'EMPLOYEE_NUMBER_REQUIRED' using errcode = '23514';
  end if;
  next_active := case
    when p_changes ? 'employment_status'
      then next_status not in ('inactive','terminated')
    when p_changes ? 'is_active'
      then (p_changes->>'is_active')::boolean
    else employee.is_active
  end;
  if next_status in ('inactive','terminated') and next_active then
    raise exception 'EMPLOYEE_STATUS_ACTIVE_CONFLICT'
      using errcode = '23514';
  end if;

  if next_active and (
    next_department_id is null
    or next_position_id is null
    or not exists (
      select 1 from public.departments department
      where department.id = next_department_id
        and department.tenant_id = employee.tenant_id
        and department.property_id = employee.property_id
        and department.is_active
    )
    or not app_private.is_position_allowed_in_department(
      employee.property_id,
      next_position_id,
      next_department_id
    )
  ) then
    raise exception 'EMPLOYEE_ORGANIZATION_TARGET_INVALID'
      using errcode = '23514';
  end if;
  if next_operational_unit_id is not null and not exists (
    select 1 from public.operational_units unit
    where unit.id = next_operational_unit_id
      and unit.tenant_id = employee.tenant_id
      and unit.property_id = employee.property_id
      and unit.department_id = next_department_id
      and unit.is_active
  ) then
    raise exception 'EMPLOYEE_OPERATIONAL_UNIT_INVALID'
      using errcode = '23514';
  end if;
  if next_position_id is not null then
    select position.position_family_id into next_position_family_id
    from public.positions position
    where position.id = next_position_id
      and position.tenant_id = employee.tenant_id
      and position.property_id = employee.property_id;
  end if;

  perform set_config(
    'app.employee_change_source',
    'manual_correction',
    true
  );
  perform set_config(
    'app.employee_effective_date',
    p_effective_date::text,
    true
  );
  perform set_config(
    'app.employee_change_reason',
    btrim(p_reason),
    true
  );

  update public.employees
  set employee_number = next_employee_number,
      name_zh = case when p_changes ? 'name_zh'
        then nullif(btrim(p_changes->>'name_zh'), '') else employee.name_zh end,
      name_en = case when p_changes ? 'name_en'
        then nullif(btrim(p_changes->>'name_en'), '') else employee.name_en end,
      department_id = next_department_id,
      operational_unit_id = next_operational_unit_id,
      position_id = next_position_id,
      position_family_id = next_position_family_id,
      grade_or_band = case when p_changes ? 'grade_or_band'
        then nullif(btrim(p_changes->>'grade_or_band'), '')
        else employee.grade_or_band end,
      hire_date = case when p_changes ? 'hire_date'
        then nullif(p_changes->>'hire_date', '')::date else employee.hire_date end,
      probation_or_confirmation_date = case
        when p_changes ? 'probation_or_confirmation_date'
          then nullif(p_changes->>'probation_or_confirmation_date', '')::date
        else employee.probation_or_confirmation_date end,
      employment_status = next_status,
      is_active = next_active,
      is_new_employee = case
        when coalesce(
          case when p_changes ? 'hire_date'
            then nullif(p_changes->>'hire_date', '')::date
            else employee.hire_date end,
          date '0001-01-01'
        ) between current_date - (
          select settings.new_employee_days - 1
          from public.property_settings settings
          where settings.property_id = employee.property_id
        ) and current_date then true
        else false
      end,
      source_system = 'authorized_correction',
      source_batch_id = null
  where id = employee.id
    and version = p_expected_version
  returning * into updated_employee;
  if updated_employee.id is null then
    raise exception 'EMPLOYEE_STALE_VERSION' using errcode = 'P3005';
  end if;

  if employee.employee_number is distinct from updated_employee.employee_number then
    update public.employee_external_identifiers identifier
    set identifier_value = updated_employee.employee_number,
        source_system = 'authorized_correction',
        source_batch_id = null
    where identifier.employee_id = employee.id
      and identifier.identifier_type = 'local_employee_number'
      and identifier.is_primary
      and identifier.is_active;
  end if;

  select fact.id into fact_id
  from public.employee_fact_versions fact
  where fact.employee_id = employee.id
    and fact.employee_version = updated_employee.version;
  return jsonb_build_object(
    'employeeId', updated_employee.id,
    'employeeVersion', updated_employee.version,
    'factVersionId', fact_id,
    'effectiveDate', p_effective_date,
    'reason', btrim(p_reason)
  );
exception
  when unique_violation then
    raise exception 'EMPLOYEE_IDENTIFIER_CONFLICT' using errcode = 'P3006';
  when invalid_datetime_format or datetime_field_overflow then
    raise exception 'EMPLOYEE_CORRECTION_DATE_INVALID' using errcode = 'P3020';
end;
$$;

revoke all on function public.correct_employee_master_fact(
  uuid,bigint,date,text,jsonb,boolean
) from public, anon, authenticated;
grant execute on function public.correct_employee_master_fact(
  uuid,bigint,date,text,jsonb,boolean
) to authenticated;

create or replace function public.preview_employee_import_revert(
  p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  dependency_count bigint;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  result := app_private.preview_employee_import_revert(p_batch_id);
  select count(*) into dependency_count
  from public.employee_fact_dependencies dependency
  where dependency.employee_id in (
    select item.employee_id
    from public.import_commit_items item
    join public.import_commits import_commit
      on import_commit.id = item.import_commit_id
    where import_commit.import_batch_id = p_batch_id
      and item.employee_id is not null
  );
  if dependency_count > 0 then
    update public.import_commits
    set revert_preview_token_hash = null,
        revert_preview_expires_at = null,
        revert_preview_batch_version = null,
        revert_preview_snapshot = null
    where import_batch_id = p_batch_id;
    return result || jsonb_build_object(
      'safe', false,
      'conflicts', coalesce((result->>'conflicts')::bigint, 0)
        + dependency_count,
      'token', null,
      'expiresAt', null,
      'strategy', '已有后续事实引用，不能撤销；请使用前向更正'
    );
  end if;
  return result;
end;
$$;

create or replace function public.revert_employee_import(
  p_batch_id uuid,
  p_preview_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.employee_fact_dependencies dependency
    where dependency.employee_id in (
      select item.employee_id
      from public.import_commit_items item
      join public.import_commits import_commit
        on import_commit.id = item.import_commit_id
      where import_commit.import_batch_id = p_batch_id
        and item.employee_id is not null
    )
  ) then
    raise exception 'IMPORT_REVERT_DOWNSTREAM_FACTS'
      using errcode = 'P3011';
  end if;
  perform set_config('app.employee_change_source', 'revert', true);
  perform set_config('app.employee_effective_date', current_date::text, true);
  perform set_config(
    'app.employee_change_reason',
    '经预览、冲突检查与短效令牌确认的员工资料撤销',
    true
  );
  perform app_private.revert_employee_import(
    p_batch_id,
    p_preview_token
  );
end;
$$;

revoke all on function
  public.prepare_employee_import_preview(uuid,bigint,jsonb),
  public.preview_employee_import_revert(uuid),
  public.revert_employee_import(uuid,text)
from public, anon, authenticated;
grant execute on function
  public.prepare_employee_import_preview(uuid,bigint,jsonb),
  public.preview_employee_import_revert(uuid),
  public.revert_employee_import(uuid,text)
to authenticated;
