-- Recovery E0-C3: records the manager's explicit employee-baseline boundary
-- inside the existing import approval evidence. It does not create a new fact
-- type, and employee writes remain delegated to the existing D0 transaction.

create or replace function public.commit_employee_import(
  p_batch_id uuid,
  p_expected_version bigint,
  p_preview_hash text,
  p_confirmed boolean,
  p_baseline_state text,
  p_baseline_department_id uuid,
  p_baseline_include_descendants boolean,
  p_baseline_limitations text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch public.import_batches%rowtype;
  commit_record public.import_commits%rowtype;
  baseline_department public.departments%rowtype;
  commit_id uuid;
  baseline_state text := lower(coalesce(nullif(btrim(p_baseline_state), ''), ''));
  baseline_limitations text := nullif(btrim(p_baseline_limitations), '');
  baseline_comparison jsonb;
  baseline_evidence jsonb;
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

  if baseline_state not in ('full', 'restricted', 'pilot_limited') then
    raise exception 'EMPLOYEE_BASELINE_CLASSIFICATION_INVALID'
      using errcode = 'P3020';
  end if;
  if p_baseline_include_descendants is null then
    raise exception 'EMPLOYEE_BASELINE_DESCENDANT_RULE_REQUIRED'
      using errcode = 'P3020';
  end if;
  if baseline_state = 'full' and (
    p_baseline_department_id is not null
    or p_baseline_include_descendants
    or baseline_limitations is not null
  ) then
    raise exception 'EMPLOYEE_BASELINE_FULL_MUST_NOT_BE_LIMITED'
      using errcode = 'P3020';
  end if;
  if baseline_state in ('restricted', 'pilot_limited') and baseline_limitations is null then
    raise exception 'EMPLOYEE_BASELINE_LIMITATIONS_REQUIRED'
      using errcode = 'P3020';
  end if;
  if baseline_state = 'pilot_limited' and p_baseline_department_id is null then
    raise exception 'EMPLOYEE_BASELINE_PILOT_SCOPE_REQUIRED'
      using errcode = 'P3020';
  end if;
  if p_baseline_department_id is null and p_baseline_include_descendants then
    raise exception 'EMPLOYEE_BASELINE_DESCENDANT_SCOPE_REQUIRED'
      using errcode = 'P3020';
  end if;
  if p_baseline_department_id is not null then
    select * into baseline_department
    from public.departments
    where id = p_baseline_department_id
      and tenant_id = batch.tenant_id
      and property_id = batch.property_id
      and is_active;
    if baseline_department.id is null then
      raise exception 'EMPLOYEE_BASELINE_DEPARTMENT_INVALID'
        using errcode = 'P3203';
    end if;
  end if;

  baseline_comparison := jsonb_build_object(
    'state', baseline_state,
    'departmentId', p_baseline_department_id,
    'includeDescendants', p_baseline_include_descendants,
    'limitations', coalesce(baseline_limitations, '')
  );

  select * into commit_record
  from public.import_commits import_commit
  where import_commit.import_batch_id = batch.id;
  if commit_record.id is not null
    and batch.status in ('completed', 'completed_with_warnings') then
    if p_confirmed
      and commit_record.approved_preview_hash = p_preview_hash
      and ((commit_record.approval_evidence->'baseline') - 'approvedAt'::text) = baseline_comparison then
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

  commit_id := app_private.commit_employee_import(batch.id, p_expected_version);
  baseline_evidence := baseline_comparison || jsonb_build_object('approvedAt', now());

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
        ),
        'baseline', baseline_evidence
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
      'effectiveDate', batch.lifecycle_effective_date,
      'baseline', baseline_comparison
    )
  );
  return commit_id;
end;
$$;

-- A prior browser-capable signature cannot be a bypass once every employee
-- baseline needs a declared manager-approved boundary.
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
begin
  perform p_batch_id, p_expected_version, p_preview_hash, p_confirmed;
  raise exception 'IMPORT_BASELINE_CLASSIFICATION_REQUIRED'
    using errcode = '42501';
end;
$$;

revoke all on function
  public.commit_employee_import(uuid,bigint,text,boolean),
  public.commit_employee_import(uuid,bigint,text,boolean,text,uuid,boolean,text)
from public, anon, authenticated;
grant execute on function
  public.commit_employee_import(uuid,bigint,text,boolean,text,uuid,boolean,text)
to authenticated;
