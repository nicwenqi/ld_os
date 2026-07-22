begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table(
  'public',
  'employee_fact_versions',
  'D0 stores append-only point-in-time employee facts'
);

select has_table(
  'public',
  'employee_fact_dependencies',
  'D0 exposes a downstream-fact dependency gate for safe correction and revert'
);

select has_function(
  'app_private',
  'resolve_employee_fact_at',
  array['uuid', 'date'],
  'D0 resolves the employee fact version effective at an event date'
);

select has_function(
  'app_private',
  'is_authorized_property_role',
  array['uuid', 'text'],
  'D0 centralizes active-account, membership, role, and property authorization'
);

select has_function(
  'app_private',
  'has_authorized_department_scope',
  array['uuid', 'uuid'],
  'D0 centralizes active-account and descendant-aware department scope'
);

select has_function(
  'public',
  'read_employee_import_preview',
  array['uuid'],
  'D0 provides an authoritative re-readable approval preview'
);

select has_function(
  'public',
  'commit_employee_import',
  array['uuid', 'bigint', 'text', 'boolean'],
  'D0 commit requires preview hash and explicit confirmation'
);

select ok(
  not has_table_privilege('authenticated', 'public.employees', 'INSERT'),
  'authenticated clients cannot bypass the controlled employee write path with INSERT'
);

select ok(
  not has_table_privilege('authenticated', 'public.employees', 'UPDATE'),
  'authenticated clients cannot bypass the controlled employee write path with UPDATE'
);

select ok(
  not has_table_privilege('authenticated', 'public.employees', 'DELETE'),
  'authenticated clients cannot bypass the controlled employee write path with DELETE'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.employee_external_identifiers',
    'INSERT'
  ),
  'authenticated clients cannot bypass identifier audit with INSERT'
);

select results_eq(
  $$select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'employees'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')$$,
  array[0::bigint],
  'employees exposes no direct authenticated mutation policies'
);

select results_eq(
  $$select count(*)
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'public'
      and table_name in ('employee_fact_versions', 'employee_fact_dependencies')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')$$,
  array[0::bigint],
  'employee fact and dependency evidence have no client mutation grants'
);

reset role;
insert into public.user_accounts(
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values
  (
    '79000000-0000-0000-0000-00000000d001',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000103',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'd0-manager',
    'active',
    false
  ),
  (
    '79000000-0000-0000-0000-00000000d002',
    '00000000-0000-0000-0000-000000000104',
    '00000000-0000-0000-0000-000000000104',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'd0-department',
    'active',
    false
  );

insert into public.role_assignments(
  id, user_id, role_id, tenant_id, property_id, status, granted_at
)
select
  '70000000-0000-0000-0000-00000000d002',
  '00000000-0000-0000-0000-000000000104',
  role.id,
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'active',
  now()
from public.roles role
where role.code = 'department_training_admin';

insert into public.trainer_scopes(
  id, role_assignment_id, tenant_id, property_id, department_id,
  include_descendants, is_active
) values (
  '71000000-0000-0000-0000-00000000d002',
  '70000000-0000-0000-0000-00000000d002',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '61000000-0000-0000-0000-000000000012',
  true,
  true
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select ok(
  app_private.is_authorized_property_role(
    '20000000-0000-0000-0000-000000000011',
    'property_ld_manager'
  ),
  'active manager account, memberships, and role produce property authority'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select ok(
  app_private.has_authorized_department_scope(
    '20000000-0000-0000-0000-000000000011',
    '61000000-0000-0000-0000-000000000013'
  ),
  'department authority includes an explicitly configured descendant'
);
select ok(
  not app_private.has_authorized_department_scope(
    '20000000-0000-0000-0000-000000000011',
    '61000000-0000-0000-0000-000000000019'
  ),
  'department authority excludes unrelated official branches'
);

reset role;
update public.user_accounts
set account_status = 'suspended'
where id = '79000000-0000-0000-0000-00000000d002';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select ok(
  not app_private.has_authorized_department_scope(
    '20000000-0000-0000-0000-000000000011',
    '61000000-0000-0000-0000-000000000013'
  ),
  'suspended account immediately loses descendant-aware department authority'
);
reset role;
update public.user_accounts
set account_status = 'active'
where id = '79000000-0000-0000-0000-00000000d002';

insert into public.import_batches(
  id, tenant_id, property_id, source_system, original_filename,
  sanitized_filename, storage_object_path, file_checksum, file_size_bytes,
  mime_type, status, version, created_by
) values (
  '81000000-0000-0000-0000-00000000d001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'd0-trust-fixture',
  'd0-trust.xlsx',
  'd0-trust.xlsx',
  '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-00000000d001/d0-trust.xlsx',
  'd0-trust-fixture-checksum',
  512,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'mapping_required',
  1,
  '00000000-0000-0000-0000-000000000103'
);
insert into public.import_sheets(
  id, tenant_id, property_id, import_batch_id, sheet_name, sheet_index,
  detected_header_row, source_row_count, selected_for_import
) values (
  '82000000-0000-0000-0000-00000000d001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '81000000-0000-0000-0000-00000000d001',
  'Employee Master',
  0,
  1,
  1,
  true
);
insert into public.import_field_mappings(
  id, tenant_id, property_id, import_batch_id, import_sheet_id,
  source_column_name, source_column_index, target_field,
  transformation_rule, is_required, mapping_status
) values
  ('84000000-0000-0000-0000-00000000d001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','81000000-0000-0000-0000-00000000d001','82000000-0000-0000-0000-00000000d001','EmpNo',0,'employee_number','{}',true,'suggested'),
  ('84000000-0000-0000-0000-00000000d002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','81000000-0000-0000-0000-00000000d001','82000000-0000-0000-0000-00000000d001','FullName',1,'name_zh','{}',true,'suggested'),
  ('84000000-0000-0000-0000-00000000d003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','81000000-0000-0000-0000-00000000d001','82000000-0000-0000-0000-00000000d001','Department',2,'department_source_label','{}',true,'suggested'),
  ('84000000-0000-0000-0000-00000000d004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','81000000-0000-0000-0000-00000000d001','82000000-0000-0000-0000-00000000d001','Position',3,'position_source_label','{}',true,'suggested'),
  ('84000000-0000-0000-0000-00000000d005','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','81000000-0000-0000-0000-00000000d001','82000000-0000-0000-0000-00000000d001','HireDate',4,'hire_date','{}',true,'suggested'),
  ('84000000-0000-0000-0000-00000000d006','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','81000000-0000-0000-0000-00000000d001','82000000-0000-0000-0000-00000000d001','EmployeeState',5,'employment_status','{}',false,'suggested');
insert into public.import_source_rows(
  id, tenant_id, property_id, import_batch_id, import_sheet_id,
  source_row_number, raw_values, normalized_values, row_fingerprint,
  processing_status, proposed_action
) values (
  '83000000-0000-0000-0000-00000000d001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '81000000-0000-0000-0000-00000000d001',
  '82000000-0000-0000-0000-00000000d001',
  2,
  jsonb_build_object(
    'EmpNo','D0-0001',
    'FullName','可信员工',
    'Department','Concierge',
    'Position','Concierge Supervisor',
    'HireDate',(current_date - 12)::text,
    'EmployeeState','在职'
  ),
  '{"employee_number":"WRONG","department_source_label":"WRONG"}',
  'd0-immutable-raw-values',
  'staged',
  'unresolved'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select lives_ok(
  $$select public.confirm_employee_import_field_mapping(
    '81000000-0000-0000-0000-00000000d001',
    1,
    '[
      {"mappingId":"84000000-0000-0000-0000-00000000d001","mappingStatus":"confirmed"},
      {"mappingId":"84000000-0000-0000-0000-00000000d002","mappingStatus":"confirmed"},
      {"mappingId":"84000000-0000-0000-0000-00000000d003","mappingStatus":"confirmed"},
      {"mappingId":"84000000-0000-0000-0000-00000000d004","mappingStatus":"confirmed"},
      {"mappingId":"84000000-0000-0000-0000-00000000d005","mappingStatus":"confirmed"},
      {"mappingId":"84000000-0000-0000-0000-00000000d006","mappingStatus":"confirmed"}
    ]'::jsonb
  )$$,
  'confirmed field recognition re-projects immutable raw workbook values'
);
select results_eq(
  $$select
      normalized_values->>'employee_number',
      normalized_values->>'department_source_label',
      normalized_values->>'employment_status'
    from public.import_source_rows
    where id = '83000000-0000-0000-0000-00000000d001'$$,
  $$values ('D0-0001'::text,'Concierge'::text,'active'::text)$$,
  'field recognition, not stale browser-normalized values, controls later data'
);
select lives_ok(
  $$select public.resolve_employee_import_source_label(
    '81000000-0000-0000-0000-00000000d001',2,'department','Concierge',
    '61000000-0000-0000-0000-000000000013','mapped'
  )$$,
  'manager confirms the official department attribution'
);
select lives_ok(
  $$select public.resolve_employee_import_source_label(
    '81000000-0000-0000-0000-00000000d001',3,'position','Concierge Supervisor',
    '65000000-0000-0000-0000-000000000012','mapped'
  )$$,
  'manager confirms a position valid for the selected department'
);

create temporary table d0_employee_preview on commit drop as
select public.prepare_employee_import_preview(
  '81000000-0000-0000-0000-00000000d001',
  4,
  jsonb_build_object(
    'statusTreatment','use_recognized_status',
    'effectiveDate',current_date
  )
) result;
select results_eq(
  $$select
      result->>'status',
      (result->>'additions')::integer,
      jsonb_array_length(result->'rows'),
      jsonb_array_length(result->'rows'->0->'changes') > 0,
      char_length(result->>'previewHash')
    from d0_employee_preview$$,
  $$values ('ready_for_review'::text,1,1,true,64)$$,
  'zero-write preview contains exact row changes and a server content hash'
);
select results_eq(
  $$select count(*) from public.employees
    where employee_number = 'D0-0001'$$,
  array[0::bigint],
  'no employee is written before explicit approval'
);
select results_eq(
  $$select
      public.read_employee_import_preview(
        '81000000-0000-0000-0000-00000000d001'
      )->>'previewHash'$$,
  $$select result->>'previewHash' from d0_employee_preview$$,
  'the approval preview is authoritatively re-readable after preparation'
);
select throws_ok(
  $$select public.commit_employee_import(
    '81000000-0000-0000-0000-00000000d001',5,repeat('0',64),true
  )$$,
  'P3001',
  'IMPORT_APPROVAL_EVIDENCE_MISMATCH',
  'commit refuses approval that is not bound to the exact preview hash'
);
select results_eq(
  $$select count(*) from public.employees
    where employee_number = 'D0-0001'$$,
  array[0::bigint],
  'failed approval evidence leaves employee master unchanged'
);
select lives_ok(
  $$select public.commit_employee_import(
    '81000000-0000-0000-0000-00000000d001',
    5,
    (select result->>'previewHash' from d0_employee_preview),
    true
  )$$,
  'exact approved preview commits atomically'
);
select results_eq(
  $$select
      commit_record.approved_preview_version,
      commit_record.approved_preview_hash = batch.preview_hash,
      commit_record.approved_at is not null,
      commit_record.approval_evidence->>'approvedBy'
    from public.import_commits commit_record
    join public.import_batches batch
      on batch.id = commit_record.import_batch_id
    where commit_record.import_batch_id =
      '81000000-0000-0000-0000-00000000d001'$$,
  $$values (
    5::bigint,
    true,
    true,
    '00000000-0000-0000-0000-000000000103'::text
  )$$,
  'approval version, hash, actor, and time remain in the audit chain'
);
select results_eq(
  $$select
      fact.employee_number,
      fact.effective_date,
      fact.source_type,
      'import' = any(fact.change_kinds)
    from public.employee_fact_versions fact
    join public.employees employee on employee.id = fact.employee_id
    where employee.employee_number = 'D0-0001'$$,
  $$values ('D0-0001'::text,current_date,'import_commit'::text,true)$$,
  'approved import creates a point-in-time employee fact version'
);
select results_eq(
  $$select count(*) from public.user_accounts$$,
  array[2::bigint],
  'employee update creates no backend account or employee login'
);

reset role;
select set_config('app.employee_change_source','baseline',true);
select set_config(
  'app.employee_effective_date',
  (current_date - 10)::text,
  true
);
select set_config(
  'app.employee_change_reason',
  'D0 历史语义测试的已知初始事实',
  true
);
insert into public.employees(
  id, tenant_id, property_id, employee_number, name_zh,
  department_id, position_id, position_family_id, hire_date,
  employment_status, is_new_employee, is_active, source_system
) values (
  '90000000-0000-0000-0000-00000000d010',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'H-001',
  '历史员工',
  '61000000-0000-0000-0000-000000000013',
  '65000000-0000-0000-0000-000000000012',
  '64000000-0000-0000-0000-000000000012',
  current_date - 20,
  'active',
  true,
  true,
  'd0-baseline'
);
insert into public.employee_external_identifiers(
  tenant_id, property_id, employee_id, source_system,
  identifier_type, identifier_value, is_primary, is_active
) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '90000000-0000-0000-0000-00000000d010',
  'd0-baseline',
  'local_employee_number',
  'H-001',
  true,
  true
);
select set_config('app.employee_change_source','',true);
select set_config('app.employee_effective_date','',true);
select set_config('app.employee_change_reason','',true);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select lives_ok(
  $$select public.correct_employee_master_fact(
    '90000000-0000-0000-0000-00000000d010',
    1,
    current_date - 5,
    '已核实的员工编号变更、跨部门调动、转岗与休假状态',
    jsonb_build_object(
      'employee_number','H-002',
      'department_id','61000000-0000-0000-0000-000000000019',
      'position_id','65000000-0000-0000-0000-000000000015',
      'employment_status','leave'
    ),
    true
  )$$,
  'authorized correction records a versioned effective-dated lifecycle event'
);
reset role;
select results_eq(
  $$select employee_number, department_id
    from app_private.resolve_employee_fact_at(
      '90000000-0000-0000-0000-00000000d010',
      current_date - 7
    )$$,
  $$values (
    'H-001'::text,
    '61000000-0000-0000-0000-000000000013'::uuid
  )$$,
  'point-in-time resolution preserves the department and number before transfer'
);
select results_eq(
  $$select
      employee_number,
      department_id,
      position_id,
      employment_status::text,
      is_new_employee_at_event
    from app_private.resolve_employee_fact_at(
      '90000000-0000-0000-0000-00000000d010',
      current_date - 2
    )$$,
  $$values (
    'H-002'::text,
    '61000000-0000-0000-0000-000000000019'::uuid,
    '65000000-0000-0000-0000-000000000015'::uuid,
    'leave'::text,
    true
  )$$,
  'point-in-time resolution returns the transferred position and status after its effective date'
);
select ok(
  (
    select change_kinds @> array[
      'employee_number_change','department_transfer',
      'position_change','status_change'
    ]::text[]
    from public.employee_fact_versions
    where employee_id = '90000000-0000-0000-0000-00000000d010'
      and employee_version = 2
  ),
  'history explicitly records number, department, position, and status semantics'
);
select results_eq(
  $$select identifier_value
    from public.employee_external_identifiers
    where employee_id = '90000000-0000-0000-0000-00000000d010'
      and identifier_type = 'local_employee_number'
      and is_primary and is_active$$,
  $$values ('H-002'::text)$$,
  'controlled employee-number change keeps the primary local identifier aligned'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$select public.correct_employee_master_fact(
    '90000000-0000-0000-0000-00000000d010',
    2,
    current_date - 6,
    '试图覆盖已经记录的更晚历史',
    '{"name_en":"Backdated overwrite"}'::jsonb,
    true
  )$$,
  'P3020',
  'EMPLOYEE_EFFECTIVE_DATE_PRECEDES_KNOWN_HISTORY',
  'a late correction cannot silently rewrite already-known history'
);

select * from finish();
rollback;
