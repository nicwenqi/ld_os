begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

reset role;
insert into public.user_accounts (
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values (
  '70000000-0000-0000-0000-000000000144',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000103',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'recovery-c-integrity-manager',
  'active',
  false
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.import_batches',
    'INSERT'
  ),
  'authenticated clients have no direct import-batch INSERT privilege'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.import_batches',
    'UPDATE'
  ),
  'authenticated clients have no direct import-batch UPDATE privilege'
);
select results_eq(
  $$select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'import_batches'
      and cmd = 'UPDATE'$$,
  array[0::bigint],
  'import batches expose no authenticated UPDATE policy'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$insert into public.import_batches(
      id, tenant_id, property_id, source_system, original_filename,
      sanitized_filename, storage_object_path, file_checksum,
      file_size_bytes, mime_type, status, version, created_by
    ) values (
      '81000000-0000-0000-0000-00000000c101',
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000011',
      'recovery-c-followup-state',
      'state-bypass.csv',
      'state-bypass.csv',
      '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-00000000c101/state-bypass.csv',
      'recovery-c-followup-state',
      128,
      'text/csv',
      'mapping_required',
      1,
      auth.uid()
    )$$,
  '42501',
  null,
  'manager must use the guarded staging RPC instead of raw batch INSERT'
);
select throws_ok(
  $$update public.import_batches
    set status = 'validating'
    where id = '81000000-0000-0000-0000-00000000c101'$$,
  '42501',
  null,
  'manager cannot directly advance the import transaction state'
);

reset role;
insert into public.employees (
  id, tenant_id, property_id, employee_number, name_zh, name_en,
  department_id, position_id, position_family_id, grade_or_band,
  hire_date, probation_or_confirmation_date, employment_status,
  is_new_employee, is_active, source_system, updated_at,
  created_by, updated_by, version
) values (
  '90000000-0000-0000-0000-00000000c101',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'VERSION-1',
  '版本员工',
  'Version Employee',
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
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000103',
  7
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select lives_ok(
  $$select public.correct_employee_master_fact(
    '90000000-0000-0000-0000-00000000c101',
    1,
    current_date,
    '验证受控员工更正与版本审计',
    '{"name_en":"Authoritative Version Edit"}'::jsonb,
    true
  )$$,
  'manager edits an employee only through the authorized correction boundary'
);
select results_eq(
  $$select version, updated_by,
      updated_at > timestamptz '2001-01-01 00:00:00+00'
    from public.employees
    where id = '90000000-0000-0000-0000-00000000c101'$$,
  $$values (
      2::bigint,
      '00000000-0000-0000-0000-000000000103'::uuid,
      true
    )$$,
  'controlled correction versions, timestamps, and actor are database-authored'
);

reset role;
insert into public.import_batches (
  id, tenant_id, property_id, source_system, original_filename,
  sanitized_filename, storage_object_path, file_checksum, file_size_bytes,
  mime_type, status, version, created_by
) values
  (
    '81000000-0000-0000-0000-00000000c102',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'recovery-c-followup-identifiers',
    'identifier-only.csv',
    'identifier-only.csv',
    '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-00000000c102/identifier-only.csv',
    'recovery-c-followup-identifiers',
    128,
    'text/csv',
    'mapping_required',
    1,
    '00000000-0000-0000-0000-000000000103'
  ),
  (
    '81000000-0000-0000-0000-00000000c103',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'recovery-c-followup-targets',
    'inactive-target.csv',
    'inactive-target.csv',
    '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-00000000c103/inactive-target.csv',
    'recovery-c-followup-targets',
    128,
    'text/csv',
    'mapping_required',
    1,
    '00000000-0000-0000-0000-000000000103'
  );

insert into public.import_sheets (
  id, tenant_id, property_id, import_batch_id, sheet_name, sheet_index,
  detected_header_row, source_row_count, selected_for_import
) values
  (
    '82000000-0000-0000-0000-00000000c102',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-00000000c102',
    'Employee Master',
    0,
    1,
    1,
    true
  ),
  (
    '82000000-0000-0000-0000-00000000c103',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-00000000c103',
    'Employee Master',
    0,
    1,
    1,
    true
  );

insert into public.employees (
  id, tenant_id, property_id, employee_number, name_zh, name_en,
  department_id, operational_unit_id, position_id, position_family_id,
  grade_or_band, hire_date, probation_or_confirmation_date,
  employment_status, is_new_employee, is_active, source_system,
  created_by, updated_by, version
) values
  (
    '90000000-0000-0000-0000-00000000c102',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'IDENTIFIER-1',
    '标识员工',
    'Identifier Employee',
    '61000000-0000-0000-0000-000000000013',
    null,
    '65000000-0000-0000-0000-000000000012',
    '64000000-0000-0000-0000-000000000012',
    'F1',
    date '2020-01-01',
    date '2020-04-01',
    'active',
    false,
    true,
    'manual',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000103',
    1
  ),
  (
    '90000000-0000-0000-0000-00000000c103',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'TARGET-1',
    '目标员工',
    'Target Employee',
    '61000000-0000-0000-0000-000000000019',
    '63000000-0000-0000-0000-000000000011',
    '65000000-0000-0000-0000-000000000015',
    '64000000-0000-0000-0000-000000000014',
    'C2',
    date '2020-01-01',
    date '2020-04-01',
    'active',
    false,
    true,
    'manual',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000103',
    1
  );

insert into public.employee_external_identifiers (
  id, tenant_id, property_id, employee_id, source_system,
  identifier_type, identifier_value, is_primary, is_active, version
) values (
  '91000000-0000-0000-0000-00000000c102',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '90000000-0000-0000-0000-00000000c102',
  'recovery-c-followup-identifiers',
  'lms_employee_id',
  'LMS-OLD',
  false,
  true,
  1
);

insert into public.import_source_rows (
  id, tenant_id, property_id, import_batch_id, import_sheet_id,
  source_row_number, raw_values, normalized_values, row_fingerprint,
  processing_status, proposed_action
) values
  (
    '83000000-0000-0000-0000-00000000c102',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-00000000c102',
    '82000000-0000-0000-0000-00000000c102',
    2,
    '{"Empid":"IDENTIFIER-1"}',
    '{
      "employee_number":"IDENTIFIER-1",
      "name_zh":"标识员工",
      "name_en":"Identifier Employee",
      "department_id":"61000000-0000-0000-0000-000000000013",
      "position_id":"65000000-0000-0000-0000-000000000012",
      "position_family_id":"64000000-0000-0000-0000-000000000012",
      "grade_or_band":"F1",
      "hire_date":"2020-01-01",
      "probation_or_confirmation_date":"2020-04-01",
      "lms_employee_id":"LMS-NEW"
    }',
    'recovery-c-followup-identifier-row',
    'staged',
    'unresolved'
  ),
  (
    '83000000-0000-0000-0000-00000000c103',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-00000000c103',
    '82000000-0000-0000-0000-00000000c103',
    2,
    '{"Empid":"TARGET-1"}',
    '{
      "employee_number":"TARGET-1",
      "name_zh":"目标员工",
      "name_en":"Target Employee Updated",
      "department_id":"61000000-0000-0000-0000-000000000019",
      "operational_unit_id":"63000000-0000-0000-0000-000000000011",
      "position_id":"65000000-0000-0000-0000-000000000015",
      "position_family_id":"64000000-0000-0000-0000-000000000014",
      "grade_or_band":"C2",
      "hire_date":"2020-01-01",
      "probation_or_confirmation_date":"2020-04-01"
    }',
    'recovery-c-followup-target-row',
    'staged',
    'unresolved'
  );

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
create temporary table recovery_c_identifier_only_preview on commit drop as
select public.prepare_employee_import_preview(
  '81000000-0000-0000-0000-00000000c102',
  1,
  jsonb_build_object('statusTreatment','retain_existing_set_additions_active','effectiveDate',current_date)
) result;
select results_eq(
  $$select
      (result->>'updates')::integer,
      (result->>'unchanged')::integer,
      result->>'status'
    from recovery_c_identifier_only_preview$$,
  $$values (1, 0, 'ready_for_review'::text)$$,
  'a new or different LMS identifier classifies the employee as an update'
);
select results_eq(
  $$select proposed_action::text
    from public.import_source_rows
    where id = '83000000-0000-0000-0000-00000000c102'$$,
  $$values ('update'::text)$$,
  'identifier-only changes persist as update staging evidence'
);
select lives_ok(
  $$select public.commit_employee_import(
    '81000000-0000-0000-0000-00000000c102',
    2,
    (select result->>'previewHash' from recovery_c_identifier_only_preview),
    true
  )$$,
  'identifier-only update commits through the guarded transaction'
);
select results_eq(
  $$select count(*)
    from public.employee_external_identifiers
    where employee_id = '90000000-0000-0000-0000-00000000c102'
      and source_system = 'recovery-c-followup-identifiers'
      and identifier_type = 'lms_employee_id'
      and identifier_value = 'LMS-NEW'
      and is_active$$,
  array[1::bigint],
  'commit applies the identifier-only update'
);

reset role;
update public.departments
set is_active = false
where id = '61000000-0000-0000-0000-000000000019';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$update public.employees
    set name_en = name_en
    where id = '90000000-0000-0000-0000-00000000c103'$$,
  '42501',
  null,
  'direct employee writes remain blocked even when a department becomes inactive'
);
reset role;
update public.departments
set is_active = true
where id = '61000000-0000-0000-0000-000000000019';
update public.operational_units
set is_active = false
where id = '63000000-0000-0000-0000-000000000011';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$update public.employees
    set name_en = name_en
    where id = '90000000-0000-0000-0000-00000000c103'$$,
  '42501',
  null,
  'direct employee writes remain blocked even when an operational unit becomes inactive'
);
reset role;
update public.operational_units
set is_active = true
where id = '63000000-0000-0000-0000-000000000011';
update public.positions
set is_active = false
where id = '65000000-0000-0000-0000-000000000015';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$update public.employees
    set name_en = name_en
    where id = '90000000-0000-0000-0000-00000000c103'$$,
  '42501',
  null,
  'direct employee writes remain blocked even when a position becomes inactive'
);
reset role;
update public.positions
set is_active = true
where id = '65000000-0000-0000-0000-000000000015';
update public.position_families
set is_active = false
where id = '64000000-0000-0000-0000-000000000014';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$update public.employees
    set name_en = name_en
    where id = '90000000-0000-0000-0000-00000000c103'$$,
  '42501',
  null,
  'direct employee writes remain blocked even when a position family becomes inactive'
);
reset role;
update public.position_families
set is_active = true
where id = '64000000-0000-0000-0000-000000000014';

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
create temporary table recovery_c_active_target_preview on commit drop as
select public.prepare_employee_import_preview(
  '81000000-0000-0000-0000-00000000c103',
  1,
  jsonb_build_object('statusTreatment','retain_existing_set_additions_active','effectiveDate',current_date)
) result;
select results_eq(
  $$select result->>'status' from recovery_c_active_target_preview$$,
  $$values ('ready_for_review'::text)$$,
  'preview accepts organization targets while they remain active'
);
reset role;
update public.positions
set is_active = false
where id = '65000000-0000-0000-0000-000000000015';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$select public.commit_employee_import(
    '81000000-0000-0000-0000-00000000c103',
    2,
    (select result->>'previewHash' from recovery_c_active_target_preview),
    true
  )$$,
  '23514',
  'EMPLOYEE_ORGANIZATION_TARGET_INACTIVE',
  'commit rejects an organization target deactivated after preview'
);
select results_eq(
  $$select count(*)
    from public.import_commits
    where import_batch_id = '81000000-0000-0000-0000-00000000c103'$$,
  array[0::bigint],
  'inactive-target commit failure leaves no partial commit evidence'
);
reset role;
update public.positions
set is_active = true
where id = '65000000-0000-0000-0000-000000000015';

select * from finish();
rollback;
