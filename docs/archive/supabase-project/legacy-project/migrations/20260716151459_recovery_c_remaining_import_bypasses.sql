-- Recovery C follow-up: make guarded RPCs the only import-staging mutation
-- path, author employee concurrency fields on insert, and revalidate every
-- inserted/updated row's organization targets inside commit.

drop policy if exists import_batches_manager_insert
  on public.import_batches;
drop policy if exists import_sheets_manager_insert
  on public.import_sheets;
drop policy if exists import_sheets_manager_update
  on public.import_sheets;
drop policy if exists import_rows_manager_insert
  on public.import_source_rows;
drop policy if exists import_rows_manager_update
  on public.import_source_rows;
drop policy if exists import_mappings_manager_insert
  on public.import_field_mappings;
drop policy if exists import_mappings_manager_update
  on public.import_field_mappings;
drop policy if exists import_issues_manager_insert
  on public.import_issues;
drop policy if exists import_issues_manager_update
  on public.import_issues;
drop policy if exists import_source_label_resolutions_manager_stage
  on public.import_source_label_resolutions;

revoke all privileges on
  public.import_batches,
  public.import_sheets,
  public.import_source_rows,
  public.import_field_mappings,
  public.import_issues,
  public.import_source_label_resolutions
from public, anon, authenticated;

grant select on
  public.import_batches,
  public.import_sheets,
  public.import_source_rows,
  public.import_field_mappings,
  public.import_issues,
  public.import_source_label_resolutions
to authenticated;

create or replace function app_private.author_employee_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  authored_at timestamptz := now();
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := authored_at;
    new.updated_at := authored_at;
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
  else
    new.version := old.version + 1;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := authored_at;
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists employees_authoritative_update
  on public.employees;
create trigger employees_authoritative_update
before insert or update on public.employees
for each row execute function app_private.author_employee_update();

revoke all on function app_private.author_employee_update()
from public, anon, authenticated;

create or replace function
  app_private.assert_employee_import_commit_targets(
    p_batch public.import_batches
  )
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform department.id
  from public.departments department
  where department.id in (
    select nullif(
      source_row.normalized_values->>'department_id',
      ''
    )::uuid
    from public.import_source_rows source_row
    where source_row.import_batch_id = p_batch.id
      and source_row.proposed_action in ('insert','update')
  )
  order by department.id
  for share;

  perform unit.id
  from public.operational_units unit
  where unit.id in (
    select nullif(
      source_row.normalized_values->>'operational_unit_id',
      ''
    )::uuid
    from public.import_source_rows source_row
    where source_row.import_batch_id = p_batch.id
      and source_row.proposed_action in ('insert','update')
  )
  order by unit.id
  for share;

  perform position.id
  from public.positions position
  where position.id in (
    select nullif(
      source_row.normalized_values->>'position_id',
      ''
    )::uuid
    from public.import_source_rows source_row
    where source_row.import_batch_id = p_batch.id
      and source_row.proposed_action in ('insert','update')
  )
  order by position.id
  for share;

  perform family.id
  from public.position_families family
  where family.id in (
    select nullif(
      source_row.normalized_values->>'position_family_id',
      ''
    )::uuid
    from public.import_source_rows source_row
    where source_row.import_batch_id = p_batch.id
      and source_row.proposed_action in ('insert','update')
  )
  order by family.id
  for share;

  if exists (
    select 1
    from public.import_source_rows source_row
    where source_row.import_batch_id = p_batch.id
      and source_row.proposed_action in ('insert','update')
      and (
        nullif(
          source_row.normalized_values->>'department_id',
          ''
        ) is null
        or not exists (
          select 1
          from public.departments department
          where department.id = (
              source_row.normalized_values->>'department_id'
            )::uuid
            and department.tenant_id = p_batch.tenant_id
            and department.property_id = p_batch.property_id
            and department.is_active
        )
        or (
          nullif(
            source_row.normalized_values->>'operational_unit_id',
            ''
          ) is not null
          and not exists (
            select 1
            from public.operational_units unit
            where unit.id = (
                source_row.normalized_values->>'operational_unit_id'
              )::uuid
              and unit.tenant_id = p_batch.tenant_id
              and unit.property_id = p_batch.property_id
              and unit.department_id = (
                source_row.normalized_values->>'department_id'
              )::uuid
              and unit.is_active
          )
        )
        or nullif(
          source_row.normalized_values->>'position_id',
          ''
        ) is null
        or not exists (
          select 1
          from public.positions position
          where position.id = (
              source_row.normalized_values->>'position_id'
            )::uuid
            and position.tenant_id = p_batch.tenant_id
            and position.property_id = p_batch.property_id
            and position.position_family_id is not distinct from
              nullif(
                source_row.normalized_values->>'position_family_id',
                ''
              )::uuid
            and position.is_active
        )
        or (
          nullif(
            source_row.normalized_values->>'position_family_id',
            ''
          ) is not null
          and not exists (
            select 1
            from public.position_families family
            where family.id = (
                source_row.normalized_values->>'position_family_id'
              )::uuid
              and family.tenant_id = p_batch.tenant_id
              and family.property_id = p_batch.property_id
              and family.is_active
          )
        )
      )
  ) then
    raise exception 'EMPLOYEE_ORGANIZATION_TARGET_INACTIVE'
      using errcode = '23514';
  end if;
end;
$$;

alter function app_private.commit_employee_import(uuid,bigint)
rename to commit_employee_import_base;

create or replace function app_private.commit_employee_import(
  p_batch_id uuid,
  p_expected_version bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.import_batches%rowtype;
  existing_commit_id uuid;
begin
  select * into batch
  from public.import_batches
  where id = p_batch_id
  for update;
  if batch.id is null then
    return app_private.commit_employee_import_base(
      p_batch_id,
      p_expected_version
    );
  end if;

  perform app_private.assert_active_property_import_manager(
    batch.property_id
  );

  select commit.id
  into existing_commit_id
  from public.import_commits commit
  where commit.import_batch_id = batch.id;
  if existing_commit_id is not null
    and batch.status in ('completed','completed_with_warnings') then
    return app_private.commit_employee_import_base(
      p_batch_id,
      p_expected_version
    );
  end if;

  if batch.version <> p_expected_version then
    raise exception 'IMPORT_STALE_VERSION' using errcode = 'P3001';
  end if;
  if batch.status <> 'ready_for_review' then
    raise exception 'IMPORT_NOT_READY' using errcode = 'P3002';
  end if;

  perform app_private.assert_employee_import_commit_targets(batch);
  return app_private.commit_employee_import_base(
    p_batch_id,
    p_expected_version
  );
end;
$$;

revoke all on function
  app_private.assert_employee_import_commit_targets(
    public.import_batches
  ),
  app_private.commit_employee_import_base(uuid,bigint),
  app_private.commit_employee_import(uuid,bigint)
from public, anon, authenticated;
