-- Recovery C follow-up: close browser transaction bypasses and make employee
-- concurrency, identifiers, and organization targets database-authoritative.

drop policy if exists import_batches_manager_update
  on public.import_batches;
revoke update on public.import_batches from authenticated;

create or replace function app_private.author_employee_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create or replace function app_private.validate_employee_organization_targets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  authoritative_position_family_id uuid;
begin
  if not new.is_active then
    return new;
  end if;

  select position.position_family_id
  into authoritative_position_family_id
  from public.positions position
  where position.id = new.position_id
    and position.tenant_id = new.tenant_id
    and position.property_id = new.property_id
    and position.is_active;
  if not found then
    raise exception 'EMPLOYEE_ORGANIZATION_TARGET_INACTIVE'
      using errcode = '23514';
  end if;
  new.position_family_id := authoritative_position_family_id;

  if new.department_id is null
    or not exists (
      select 1
      from public.departments department
      where department.id = new.department_id
        and department.tenant_id = new.tenant_id
        and department.property_id = new.property_id
        and department.is_active
    )
    or (
      new.operational_unit_id is not null
      and not exists (
        select 1
        from public.operational_units unit
        where unit.id = new.operational_unit_id
          and unit.tenant_id = new.tenant_id
          and unit.property_id = new.property_id
          and unit.department_id = new.department_id
          and unit.is_active
      )
    )
    or (
      new.position_family_id is not null
      and not exists (
        select 1
        from public.position_families family
        where family.id = new.position_family_id
          and family.tenant_id = new.tenant_id
          and family.property_id = new.property_id
          and family.is_active
      )
    ) then
    raise exception 'EMPLOYEE_ORGANIZATION_TARGET_INACTIVE'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists employees_authoritative_update
  on public.employees;
create trigger employees_authoritative_update
before update on public.employees
for each row execute function app_private.author_employee_update();

drop trigger if exists employees_validate_organization_targets
  on public.employees;
create trigger employees_validate_organization_targets
before insert or update on public.employees
for each row execute function
  app_private.validate_employee_organization_targets();

revoke all on function
  app_private.author_employee_update(),
  app_private.validate_employee_organization_targets()
from public, anon, authenticated;

create or replace function
  app_private.promote_employee_identifier_preview_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_source_system text;
  staged_lms_identifier text;
  staged_merlin_identifier text;
begin
  if current_setting(
      'recovery_c.employee_import_preview',
      true
    ) is distinct from 'on'
    or new.proposed_action <> 'unchanged'
    or new.matched_employee_id is null then
    return new;
  end if;

  select batch.source_system
  into batch_source_system
  from public.import_batches batch
  where batch.id = new.import_batch_id
    and batch.tenant_id = new.tenant_id
    and batch.property_id = new.property_id;

  staged_lms_identifier := nullif(
    btrim(new.normalized_values->>'lms_employee_id'),
    ''
  );
  staged_merlin_identifier := nullif(
    btrim(new.normalized_values->>'merlin_id'),
    ''
  );

  if (
    staged_lms_identifier is not null
    and not exists (
      select 1
      from public.employee_external_identifiers identifier
      where identifier.employee_id = new.matched_employee_id
        and identifier.tenant_id = new.tenant_id
        and identifier.property_id = new.property_id
        and identifier.source_system = batch_source_system
        and identifier.identifier_type = 'lms_employee_id'
        and identifier.identifier_value = staged_lms_identifier
        and identifier.is_active
    )
  ) or (
    staged_merlin_identifier is not null
    and not exists (
      select 1
      from public.employee_external_identifiers identifier
      where identifier.employee_id = new.matched_employee_id
        and identifier.tenant_id = new.tenant_id
        and identifier.property_id = new.property_id
        and identifier.source_system = batch_source_system
        and identifier.identifier_type = 'merlin_id'
        and identifier.identifier_value = staged_merlin_identifier
        and identifier.is_active
    )
  ) then
    new.proposed_action := 'update';
    new.validation_summary := jsonb_set(
      coalesce(new.validation_summary, '{}'::jsonb),
      '{preview_classification}',
      '"update"'::jsonb,
      true
    );
  end if;

  return new;
end;
$$;

create or replace function app_private.recount_employee_import_preview()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  additions integer;
  updates integer;
  unchanged integer;
  exclusions integer;
  blocked integer;
  unresolved integer;
  total_rows integer;
begin
  if current_setting(
      'recovery_c.employee_import_preview',
      true
    ) is distinct from 'on'
    or new.previewed_at is null
    or new.previewed_at is not distinct from old.previewed_at then
    return new;
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where source_row.proposed_action = 'insert'
    )::integer,
    count(*) filter (
      where source_row.proposed_action = 'update'
    )::integer,
    count(*) filter (
      where source_row.proposed_action = 'unchanged'
    )::integer,
    count(*) filter (
      where source_row.proposed_action = 'excluded'
    )::integer,
    count(*) filter (
      where source_row.validation_summary->>'preview_classification'
        = 'blocked'
    )::integer,
    count(*) filter (
      where source_row.validation_summary->>'preview_classification'
        = 'unresolved'
    )::integer
  into
    total_rows,
    additions,
    updates,
    unchanged,
    exclusions,
    blocked,
    unresolved
  from public.import_source_rows source_row
  where source_row.import_batch_id = new.id;

  new.total_source_rows := total_rows;
  new.valid_rows := additions + updates + unchanged;
  new.warning_rows := 0;
  new.error_rows := blocked + unresolved;
  new.excluded_rows := exclusions;
  new.preview_summary := jsonb_build_object(
    'additions', additions,
    'updates', updates,
    'unchanged', unchanged,
    'exclusions', exclusions,
    'blocked', blocked,
    'unresolved', unresolved,
    'trainingHistoryImported', false,
    'ctcGtcImported', false
  );
  return new;
end;
$$;

drop trigger if exists import_source_rows_promote_identifier_change
  on public.import_source_rows;
create trigger import_source_rows_promote_identifier_change
before update on public.import_source_rows
for each row execute function
  app_private.promote_employee_identifier_preview_change();

drop trigger if exists import_batches_recount_employee_preview
  on public.import_batches;
create trigger import_batches_recount_employee_preview
before update on public.import_batches
for each row execute function app_private.recount_employee_import_preview();

alter function app_private.prepare_employee_import_preview(
  uuid,
  bigint,
  jsonb
)
rename to prepare_employee_import_preview_base;

create or replace function app_private.prepare_employee_import_preview(
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
  result jsonb;
begin
  perform set_config(
    'recovery_c.employee_import_preview',
    'on',
    true
  );
  result := app_private.prepare_employee_import_preview_base(
    p_batch_id,
    p_expected_version,
    p_options
  );
  perform set_config(
    'recovery_c.employee_import_preview',
    'off',
    true
  );
  return result;
exception
  when others then
    perform set_config(
      'recovery_c.employee_import_preview',
      'off',
      true
    );
    raise;
end;
$$;

revoke all on function
  app_private.promote_employee_identifier_preview_change(),
  app_private.recount_employee_import_preview(),
  app_private.prepare_employee_import_preview_base(uuid,bigint,jsonb),
  app_private.prepare_employee_import_preview(uuid,bigint,jsonb)
from public, anon, authenticated;
