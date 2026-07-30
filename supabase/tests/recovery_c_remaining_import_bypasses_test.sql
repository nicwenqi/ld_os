begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

reset role;
insert into public.user_accounts (
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values (
  '70000000-0000-0000-0000-000000000145',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000103',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'recovery-c-remaining-bypass-manager',
  'active',
  false
);

select results_eq(
  $$select count(*)
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name in (
        'import_batches',
        'import_sheets',
        'import_source_rows',
        'import_field_mappings',
        'import_issues',
        'import_source_label_resolutions'
      )
      and privilege_type <> 'SELECT'$$,
  array[0::bigint],
  'authenticated retains no raw mutation or ownership-like staging privilege'
);
select results_eq(
  $$select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'import_batches',
        'import_sheets',
        'import_source_rows',
        'import_field_mappings',
        'import_issues',
        'import_source_label_resolutions'
      )
      and cmd <> 'SELECT'$$,
  array[0::bigint],
  'staging tables expose only authenticated read policies'
);
select results_eq(
  $$select count(*)
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name in (
        'import_batches',
        'import_sheets',
        'import_source_rows',
        'import_field_mappings',
        'import_issues',
        'import_source_label_resolutions'
      )
      and privilege_type = 'SELECT'$$,
  array[6::bigint],
  'authenticated retains RLS-filtered staging reads'
);
select function_privs_are(
  'public',
  'stage_employee_import',
  array['uuid','uuid','jsonb'],
  'authenticated',
  array['EXECUTE']
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';

savepoint forged_completed_batch;
select throws_ok(
  $$insert into public.import_batches(
      id, tenant_id, property_id, source_system, original_filename,
      sanitized_filename, storage_object_path, file_checksum,
      file_size_bytes, mime_type, status, version, created_by,
      completed_at
    ) values (
      '81000000-0000-0000-0000-00000000c201',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000011',
      'forged-completed',
      'forged-completed.csv',
      'forged-completed.csv',
      '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-00000000c201/forged-completed.csv',
      'forged-completed',
      128,
      'text/csv',
      'completed',
      900,
      '00000000-0000-0000-0000-000000000104',
      now()
    )$$,
  '42501',
  null,
  'authenticated manager cannot forge a completed batch'
);
rollback to savepoint forged_completed_batch;

savepoint forged_reverted_batch;
select throws_ok(
  $$insert into public.import_batches(
      id, tenant_id, property_id, source_system, original_filename,
      sanitized_filename, storage_object_path, file_checksum,
      file_size_bytes, mime_type, status, version, created_by,
      reverted_at
    ) values (
      '81000000-0000-0000-0000-00000000c202',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000011',
      'forged-reverted',
      'forged-reverted.csv',
      'forged-reverted.csv',
      '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-00000000c202/forged-reverted.csv',
      'forged-reverted',
      128,
      'text/csv',
      'reverted',
      901,
      '00000000-0000-0000-0000-000000000104',
      now()
    )$$,
  '42501',
  null,
  'authenticated manager cannot forge a reverted batch'
);
rollback to savepoint forged_reverted_batch;

savepoint forged_ready_commit;
select throws_ok(
  $sql$
  do $block$
  begin
    insert into public.import_batches(
      id, tenant_id, property_id, source_system, original_filename,
      sanitized_filename, storage_object_path, file_checksum,
      file_size_bytes, mime_type, status, version, created_by,
      previewed_by, previewed_at, preview_summary
    ) values (
      '81000000-0000-0000-0000-00000000c203',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000011',
      'forged-ready',
      'forged-ready.csv',
      'forged-ready.csv',
      '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-00000000c203/forged-ready.csv',
      'forged-ready',
      128,
      'text/csv',
      'ready_for_review',
      777,
      '00000000-0000-0000-0000-000000000104',
      '00000000-0000-0000-0000-000000000104',
      now(),
      '{
        "additions":0,
        "updates":0,
        "unchanged":0,
        "exclusions":0,
        "blocked":0,
        "unresolved":0
      }'::jsonb
    );
    perform public.commit_employee_import(
      '81000000-0000-0000-0000-00000000c203',
      777
    );
  end;
  $block$
  $sql$,
  '42501',
  null,
  'raw forged-ready evidence cannot reach the commit transaction'
);
rollback to savepoint forged_ready_commit;

reset role;
insert into public.import_batches(
  id, tenant_id, property_id, source_system, original_filename,
  sanitized_filename, storage_object_path, file_checksum, file_size_bytes,
  mime_type, status, version, created_by
) values (
  '81000000-0000-0000-0000-00000000c204',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'raw-child-fixture',
  'raw-child.csv',
  'raw-child.csv',
  '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-00000000c204/raw-child.csv',
  'raw-child-fixture',
  128,
  'text/csv',
  'mapping_required',
  1,
  '00000000-0000-0000-0000-000000000103'
);
insert into public.import_sheets(
  id, tenant_id, property_id, import_batch_id, sheet_name, sheet_index,
  detected_header_row, source_row_count, selected_for_import
) values (
  '82000000-0000-0000-0000-00000000c204',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '81000000-0000-0000-0000-00000000c204',
  'Employee Master',
  0,
  1,
  1,
  true
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
savepoint forged_source_row;
select throws_ok(
  $$insert into public.import_source_rows(
      id, tenant_id, property_id, import_batch_id, import_sheet_id,
      source_row_number, raw_values, normalized_values, row_fingerprint,
      processing_status, proposed_action
    ) values (
      '83000000-0000-0000-0000-00000000c204',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000011',
      '81000000-0000-0000-0000-00000000c204',
      '82000000-0000-0000-0000-00000000c204',
      2,
      '{"Empid":"FORGED-ROW"}',
      '{"employee_number":"FORGED-ROW"}',
      'forged-source-row',
      'valid',
      'insert'
    )$$,
  '42501',
  null,
  'authenticated manager cannot forge raw source-row evidence'
);
rollback to savepoint forged_source_row;

select throws_ok(
  $$insert into public.employees(
      id, tenant_id, property_id, employee_number, name_zh, name_en,
      department_id, position_id, position_family_id, grade_or_band,
      hire_date, probation_or_confirmation_date, employment_status,
      is_new_employee, is_active, source_system, created_at, updated_at,
      created_by, updated_by, version
    ) values (
      '90000000-0000-0000-0000-00000000c201',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000011',
      'INSERT-AUTHOR-1',
      '新增权威字段',
      'Insert Authored Fields',
      '61000000-0000-0000-0000-000000000013',
      '65000000-0000-0000-0000-000000000012',
      '64000000-0000-0000-0000-000000000012',
      'F1',
      date '2020-01-01',
      date '2020-04-01',
      'active',
      false,
      true,
      'manual',
      timestamptz '2000-01-01 00:00:00+00',
      timestamptz '2000-01-01 00:00:00+00',
      '00000000-0000-0000-0000-000000000104',
      '00000000-0000-0000-0000-000000000104',
      99
    )$$,
  '42501',
  null,
  'authenticated manager cannot bypass preview, approval, commit, and audit'
);
select results_eq(
  $$select count(*) from public.employees
    where id = '90000000-0000-0000-0000-00000000c201'$$,
  array[0::bigint],
  'rejected direct employee insert leaves no employee fact'
);

reset role;
insert into public.import_batches(
  id, tenant_id, property_id, source_system, original_filename,
  sanitized_filename, storage_object_path, file_checksum, file_size_bytes,
  mime_type, status, version, created_by
) values (
  '81000000-0000-0000-0000-00000000c205',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'inactive-target-followup',
  'inactive-target-followup.csv',
  'inactive-target-followup.csv',
  '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-00000000c205/inactive-target-followup.csv',
  'inactive-target-followup',
  128,
  'text/csv',
  'mapping_required',
  1,
  '00000000-0000-0000-0000-000000000103'
);
insert into public.import_sheets(
  id, tenant_id, property_id, import_batch_id, sheet_name, sheet_index,
  detected_header_row, source_row_count, selected_for_import
) values (
  '82000000-0000-0000-0000-00000000c205',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '81000000-0000-0000-0000-00000000c205',
  'Employee Master',
  0,
  1,
  1,
  true
);
insert into public.employees(
  id, tenant_id, property_id, employee_number, name_zh, name_en,
  department_id, operational_unit_id, position_id, position_family_id,
  grade_or_band, hire_date, probation_or_confirmation_date,
  employment_status, is_new_employee, is_active, source_system,
  created_by, updated_by, version
) values (
  '90000000-0000-0000-0000-00000000c205',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'INACTIVE-TARGET-1',
  '离职员工',
  'Inactive Target Employee',
  '61000000-0000-0000-0000-000000000019',
  '63000000-0000-0000-0000-000000000011',
  '65000000-0000-0000-0000-000000000015',
  '64000000-0000-0000-0000-000000000014',
  'C2',
  date '2020-01-01',
  date '2020-04-01',
  'terminated',
  false,
  false,
  'manual',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000103',
  1
);
insert into public.import_source_rows(
  id, tenant_id, property_id, import_batch_id, import_sheet_id,
  source_row_number, raw_values, normalized_values, row_fingerprint,
  processing_status, proposed_action
) values (
  '83000000-0000-0000-0000-00000000c205',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '81000000-0000-0000-0000-00000000c205',
  '82000000-0000-0000-0000-00000000c205',
  2,
  '{"Empid":"INACTIVE-TARGET-1"}',
  '{
    "employee_number":"INACTIVE-TARGET-1",
    "name_zh":"离职员工",
    "name_en":"Inactive Target Employee Updated",
    "department_id":"61000000-0000-0000-0000-000000000019",
    "operational_unit_id":"63000000-0000-0000-0000-000000000011",
    "position_id":"65000000-0000-0000-0000-000000000015",
    "position_family_id":"64000000-0000-0000-0000-000000000014",
    "grade_or_band":"C2",
    "hire_date":"2020-01-01",
    "probation_or_confirmation_date":"2020-04-01"
  }',
  'inactive-target-followup-row',
  'staged',
  'unresolved'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
create temporary table recovery_c_inactive_target_preview on commit drop as
select public.prepare_employee_import_preview(
  '81000000-0000-0000-0000-00000000c205',
  1,
  jsonb_build_object('statusTreatment','retain_existing_set_additions_active','effectiveDate',current_date)
) result;
select results_eq(
  $$select
      result->>'status',
      (result->>'updates')::integer,
      normalized_values->>'is_active',
      normalized_values->>'employment_status'
    from recovery_c_inactive_target_preview
    cross join public.import_source_rows
    where id = '83000000-0000-0000-0000-00000000c205'$$,
  $$values ('ready_for_review'::text, 1, 'false'::text, 'terminated'::text)$$,
  'preview preserves the inactive result before organization targets change'
);

reset role;
update public.positions
set is_active = false
where id = '65000000-0000-0000-0000-000000000015';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$select public.commit_employee_import(
    '81000000-0000-0000-0000-00000000c205',
    2,
    (select result->>'previewHash' from recovery_c_inactive_target_preview),
    true,
    'full', null, false, ''
  )$$,
  '23514',
  'EMPLOYEE_ORGANIZATION_TARGET_INACTIVE',
  'commit revalidates stale organization targets for inactive results'
);
select results_eq(
  $$select count(*)
    from public.import_commits
    where import_batch_id = '81000000-0000-0000-0000-00000000c205'$$,
  array[0::bigint],
  'inactive stale-target rejection leaves no partial commit evidence'
);

select * from finish();
rollback;
