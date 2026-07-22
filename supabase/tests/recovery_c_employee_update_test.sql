begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table(
  'public'::name,
  'import_source_label_resolutions'::name
);
select has_table(
  'public'::name,
  'import_activity_events'::name
);
select function_privs_are(
  'public', 'prepare_employee_import_preview', array['uuid','bigint','jsonb'],
  'authenticated', array['EXECUTE']
);
select has_function(
  'public', 'confirm_employee_import_field_mapping',
  array['uuid','bigint','jsonb'],
  'versioned field-mapping confirmation RPC exists'
);
select has_function(
  'public', 'resolve_employee_import_source_label',
  array['uuid','bigint','text','text','uuid','text'],
  'versioned source-label resolution RPC exists'
);
select has_function(
  'public', 'resolve_employee_import_issue',
  array['uuid','bigint','uuid','text','jsonb'],
  'versioned issue-resolution RPC exists'
);
select has_function(
  'public', 'prepare_employee_import_preview',
  array['uuid','bigint','jsonb'],
  'deterministic zero-write preview RPC exists'
);
select has_function(
  'public', 'commit_employee_import',
  array['uuid','bigint'],
  'versioned employee commit RPC remains available'
);
select has_function(
  'public', 'preview_employee_import_revert',
  array['uuid'],
  'guarded reversal preview RPC exists'
);
select has_function(
  'public', 'revert_employee_import',
  array['uuid','text'],
  'token-bound reversal RPC exists'
);
select has_function(
  'public', 'list_department_employee_directory',
  array['text','integer','integer'],
  'server-scoped department employee directory RPC exists'
);
select results_eq(
  $$select count(*) from pg_class
    where relnamespace = 'public'::regnamespace
      and relname in ('import_source_label_resolutions','import_activity_events')
      and relrowsecurity and relforcerowsecurity$$,
  array[2::bigint],
  'new import evidence tables force RLS'
);
select results_eq(
  $$select count(*) from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name in (
        'confirm_employee_import_field_mapping',
        'resolve_employee_import_source_label',
        'resolve_employee_import_issue',
        'prepare_employee_import_preview',
        'commit_employee_import',
        'preview_employee_import_revert',
        'revert_employee_import',
        'list_department_employee_directory'
      )
      and grantee in ('PUBLIC','anon')$$,
  array[0::bigint],
  'anonymous and PUBLIC cannot execute Recovery C RPCs'
);
select results_eq(
  $$select count(*) from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname in ('public','app_private')
      and proc.proname in (
        'confirm_employee_import_field_mapping',
        'resolve_employee_import_source_label',
        'resolve_employee_import_issue',
        'prepare_employee_import_preview',
        'commit_employee_import',
        'preview_employee_import_revert',
        'revert_employee_import',
        'list_department_employee_directory'
      )
      and proc.proconfig is distinct from array['search_path=""']::text[]$$,
  array[0::bigint],
  'all Recovery C privileged functions fix an empty search path'
);
select results_eq(
  $$select count(*) from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    cross join unnest(coalesce(proc.proargnames, '{}'::text[])) argument_name
    where namespace.nspname = 'public'
      and proc.proname in (
        'confirm_employee_import_field_mapping',
        'resolve_employee_import_source_label',
        'resolve_employee_import_issue',
        'prepare_employee_import_preview',
        'commit_employee_import',
        'preview_employee_import_revert',
        'revert_employee_import',
        'list_department_employee_directory'
      )
      and argument_name in (
        'p_actor_id','p_user_id','p_auth_user_id','p_created_by',
        'p_approved_by','p_resolved_by','p_committed_by','p_reverted_by'
      )$$,
  array[0::bigint],
  'Recovery C RPCs never accept a caller-supplied actor identity'
);
select results_eq(
  $$select count(*) from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname in (
        'confirm_employee_import_field_mapping',
        'resolve_employee_import_source_label',
        'resolve_employee_import_issue',
        'prepare_employee_import_preview',
        'commit_employee_import',
        'preview_employee_import_revert',
        'revert_employee_import',
        'list_department_employee_directory'
      )
      and position('AUTH_REQUIRED' in pg_get_functiondef(proc.oid)) > 0$$,
  array[8::bigint],
  'every Recovery C privileged RPC explicitly rejects a missing auth.uid()'
);
select results_eq(
  $$with statuses as (
      select unnest(enum_range(null::public.import_batch_status)) status
    ),
    expected(from_status, to_status) as (
      values
        ('uploaded'::public.import_batch_status, 'inspecting'::public.import_batch_status),
        ('uploaded', 'cancelled'),
        ('uploaded', 'failed'),
        ('inspecting', 'mapping_required'),
        ('inspecting', 'validating'),
        ('inspecting', 'cancelled'),
        ('inspecting', 'failed'),
        ('mapping_required', 'inspecting'),
        ('mapping_required', 'validating'),
        ('mapping_required', 'cancelled'),
        ('mapping_required', 'failed'),
        ('validating', 'mapping_required'),
        ('validating', 'ready_for_review'),
        ('validating', 'cancelled'),
        ('validating', 'failed'),
        ('ready_for_review', 'mapping_required'),
        ('ready_for_review', 'validating'),
        ('ready_for_review', 'importing'),
        ('ready_for_review', 'cancelled'),
        ('ready_for_review', 'failed'),
        ('importing', 'completed'),
        ('importing', 'completed_with_warnings'),
        ('importing', 'failed'),
        ('completed', 'reverted'),
        ('completed_with_warnings', 'reverted')
    )
    select count(*)
    from statuses old_status
    cross join statuses new_status
    where app_private.is_import_batch_transition_allowed(
      old_status.status,
      new_status.status
    ) is distinct from (
      old_status.status = new_status.status
      or exists (
        select 1
        from expected
        where expected.from_status = old_status.status
          and expected.to_status = new_status.status
      )
    )$$,
  array[0::bigint],
  'the complete import-batch transition matrix allows only approved edges and no others'
);
select results_eq(
  $$select count(*) from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'import_batches_property_type_status_idx',
        'import_source_label_resolutions_batch_type_status_idx',
        'import_activity_events_batch_type_created_idx',
        'employees_source_batch_idx',
        'employee_external_identifiers_employee_idx',
        'employee_external_identifiers_source_batch_idx',
        'employees_department_directory_idx',
        'trainer_scopes_directory_idx'
      )$$,
  array[8::bigint],
  'Recovery C query paths have explicit batch, identifier, and department indexes'
);

reset role;
insert into public.user_accounts (
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values (
  '70000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000103',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'recovery-c-manager',
  'active',
  false
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000110',
    'authenticated',
    'authenticated',
    'recovery-c-department@example.test',
    extensions.crypt('local-test-only', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000111',
    'authenticated',
    'authenticated',
    'recovery-c-suspended-manager@example.test',
    extensions.crypt('local-test-only', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    false
  );

insert into public.profiles(id, email, display_name) values
  (
    '00000000-0000-0000-0000-000000000110',
    'recovery-c-department@example.test',
    'Recovery C Department Responsible'
  ),
  (
    '00000000-0000-0000-0000-000000000111',
    'recovery-c-suspended-manager@example.test',
    'Recovery C Suspended Manager'
  );

insert into public.tenant_memberships(tenant_id, user_id, status) values
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000110',
    'active'
  ),
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000111',
    'active'
  );

insert into public.property_memberships(
  tenant_id, property_id, user_id, status
) values
  (
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '00000000-0000-0000-0000-000000000110',
    'active'
  ),
  (
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '00000000-0000-0000-0000-000000000111',
    'active'
  );

insert into public.role_assignments(
  id, user_id, role_id, tenant_id, property_id, status
)
select
  fixture.id,
  fixture.user_id,
  role.id,
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'active'
from (
  values
    (
      '71000000-0000-0000-0000-000000000110'::uuid,
      '00000000-0000-0000-0000-000000000110'::uuid,
      'department_training_admin'::text
    ),
    (
      '71000000-0000-0000-0000-000000000111'::uuid,
      '00000000-0000-0000-0000-000000000111'::uuid,
      'property_ld_manager'::text
    )
) fixture(id, user_id, role_code)
join public.roles role on role.code = fixture.role_code;

insert into public.trainer_scopes(
  id, role_assignment_id, tenant_id, property_id, department_id,
  include_descendants, is_active
) values (
  '72000000-0000-0000-0000-000000000110',
  '71000000-0000-0000-0000-000000000110',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '61000000-0000-0000-0000-000000000012',
  true,
  true
);

insert into public.user_accounts(
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values
  (
    '70000000-0000-0000-0000-000000000110',
    '00000000-0000-0000-0000-000000000110',
    '00000000-0000-0000-0000-000000000110',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'recovery-c-department',
    'active',
    false
  ),
  (
    '70000000-0000-0000-0000-000000000111',
    '00000000-0000-0000-0000-000000000111',
    '00000000-0000-0000-0000-000000000111',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'recovery-c-suspended-manager',
    'suspended',
    false
  );

insert into public.import_batches(
  id, tenant_id, property_id, source_system, original_filename,
  sanitized_filename, storage_object_path, file_checksum, file_size_bytes,
  mime_type, status, version, created_by
) values
  (
    '81000000-0000-0000-0000-00000000c001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'recovery-c-fixture',
    'employee-update.xlsx',
    'employee-update.xlsx',
    '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-00000000c001/employee-update.xlsx',
    'recovery-c-main',
    2048,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'mapping_required',
    1,
    '00000000-0000-0000-0000-000000000103'
  ),
  (
    '81000000-0000-0000-0000-00000000c002',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'recovery-c-conflict',
    'identifier-conflict.csv',
    'identifier-conflict.csv',
    '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-00000000c002/identifier-conflict.csv',
    'recovery-c-conflict',
    512,
    'text/csv',
    'mapping_required',
    1,
    '00000000-0000-0000-0000-000000000103'
  ),
  (
    '81000000-0000-0000-0000-00000000c003',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'recovery-c-stale',
    'stale-preview.csv',
    'stale-preview.csv',
    '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-00000000c003/stale-preview.csv',
    'recovery-c-stale',
    512,
    'text/csv',
    'mapping_required',
    1,
    '00000000-0000-0000-0000-000000000103'
  );

insert into public.import_sheets(
  id, tenant_id, property_id, import_batch_id, sheet_name, sheet_index,
  detected_header_row, source_row_count, selected_for_import
) values
  (
    '82000000-0000-0000-0000-00000000c001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-00000000c001',
    'Employee Master',
    0,
    3,
    4,
    true
  ),
  (
    '82000000-0000-0000-0000-00000000c002',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-00000000c002',
    'Employee Master',
    0,
    1,
    1,
    true
  ),
  (
    '82000000-0000-0000-0000-00000000c003',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-00000000c003',
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
  (
    '84000000-0000-0000-0000-00000000c001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-00000000c001',
    '82000000-0000-0000-0000-00000000c001',
    'Empid',
    0,
    'employee_number',
    '{}',
    true,
    'suggested'
  ),
  (
    '84000000-0000-0000-0000-00000000c002',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-00000000c001',
    '82000000-0000-0000-0000-00000000c001',
    'Status',
    1,
    'employment_status',
    '{}',
    false,
    'suggested'
  );

insert into public.import_field_mappings(
  id, tenant_id, property_id, import_batch_id, import_sheet_id,
  source_column_name, source_column_index, target_field,
  transformation_rule, is_required, mapping_status, approved_by, approved_at
) values
  ('84000000-0000-0000-0000-00000000c003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','81000000-0000-0000-0000-00000000c001','82000000-0000-0000-0000-00000000c001','NameZh',2,'name_zh','{}',true,'confirmed','00000000-0000-0000-0000-000000000103',now()),
  ('84000000-0000-0000-0000-00000000c004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','81000000-0000-0000-0000-00000000c001','82000000-0000-0000-0000-00000000c001','NameEn',3,'name_en','{}',false,'confirmed','00000000-0000-0000-0000-000000000103',now()),
  ('84000000-0000-0000-0000-00000000c005','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','81000000-0000-0000-0000-00000000c001','82000000-0000-0000-0000-00000000c001','Department',4,'department_source_label','{}',true,'confirmed','00000000-0000-0000-0000-000000000103',now()),
  ('84000000-0000-0000-0000-00000000c006','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','81000000-0000-0000-0000-00000000c001','82000000-0000-0000-0000-00000000c001','Position',5,'position_source_label','{}',true,'confirmed','00000000-0000-0000-0000-000000000103',now()),
  ('84000000-0000-0000-0000-00000000c007','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','81000000-0000-0000-0000-00000000c001','82000000-0000-0000-0000-00000000c001','Grade',6,'grade_or_band','{}',false,'confirmed','00000000-0000-0000-0000-000000000103',now()),
  ('84000000-0000-0000-0000-00000000c008','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','81000000-0000-0000-0000-00000000c001','82000000-0000-0000-0000-00000000c001','HireDate',7,'hire_date','{}',true,'confirmed','00000000-0000-0000-0000-000000000103',now()),
  ('84000000-0000-0000-0000-00000000c009','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','81000000-0000-0000-0000-00000000c001','82000000-0000-0000-0000-00000000c001','ProbationDate',8,'probation_or_confirmation_date','{}',false,'confirmed','00000000-0000-0000-0000-000000000103',now()),
  ('84000000-0000-0000-0000-00000000c010','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','81000000-0000-0000-0000-00000000c001','82000000-0000-0000-0000-00000000c001','LmsId',9,'lms_employee_id','{}',false,'confirmed','00000000-0000-0000-0000-000000000103',now()),
  ('84000000-0000-0000-0000-00000000c011','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','81000000-0000-0000-0000-00000000c001','82000000-0000-0000-0000-00000000c001','MerlinId',10,'merlin_id','{}',false,'confirmed','00000000-0000-0000-0000-000000000103',now());

insert into public.employees(
  id, tenant_id, property_id, employee_number, name_zh, name_en,
  department_id, operational_unit_id, position_id, position_family_id,
  grade_or_band, hire_date, probation_or_confirmation_date,
  employment_status, is_new_employee, is_active, source_system,
  created_by, updated_by, version
) values
  (
    '90000000-0000-0000-0000-00000000c001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'U-001',
    '更新前姓名',
    'Before Update',
    '61000000-0000-0000-0000-000000000013',
    null,
    '65000000-0000-0000-0000-000000000012',
    '64000000-0000-0000-0000-000000000012',
    'OLD',
    date '2020-01-01',
    date '2020-04-01',
    'active',
    false,
    true,
    'manual',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000103',
    3
  ),
  (
    '90000000-0000-0000-0000-00000000c002',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'SAME-1',
    '保持不变',
    'Unchanged Employee',
    '61000000-0000-0000-0000-000000000019',
    '63000000-0000-0000-0000-000000000011',
    '65000000-0000-0000-0000-000000000015',
    '64000000-0000-0000-0000-000000000014',
    'C2',
    current_date - 200,
    current_date - 100,
    'active',
    false,
    true,
    'recovery-c-fixture',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000103',
    1
  ),
  (
    '90000000-0000-0000-0000-00000000c010',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'CONFLICT-OWNER',
    '标识持有人',
    'Identifier Owner',
    '61000000-0000-0000-0000-000000000018',
    null,
    '65000000-0000-0000-0000-000000000014',
    '64000000-0000-0000-0000-000000000015',
    'T2',
    date '2024-01-01',
    date '2024-04-01',
    'active',
    false,
    true,
    'manual',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000103',
    1
  ),
  (
    '90000000-0000-0000-0000-00000000c020',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'STALE-1',
    '陈旧预览',
    'Stale Preview',
    '61000000-0000-0000-0000-000000000018',
    null,
    '65000000-0000-0000-0000-000000000014',
    '64000000-0000-0000-0000-000000000015',
    'T2',
    date '2024-01-01',
    date '2024-04-01',
    'active',
    false,
    true,
    'manual',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000103',
    1
  ),
  (
    '90000000-0000-0000-0000-00000000c101',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'DIR-EXACT',
    '前厅范围',
    'Exact Scope',
    '61000000-0000-0000-0000-000000000012',
    null,
    '65000000-0000-0000-0000-000000000011',
    '64000000-0000-0000-0000-000000000011',
    null,
    date '2024-01-01',
    date '2024-04-01',
    'active',
    false,
    true,
    'directory-fixture',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000103',
    1
  ),
  (
    '90000000-0000-0000-0000-00000000c102',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'DIR-DESC',
    '礼宾范围',
    'Descendant Scope',
    '61000000-0000-0000-0000-000000000013',
    null,
    '65000000-0000-0000-0000-000000000012',
    '64000000-0000-0000-0000-000000000012',
    null,
    date '2024-01-01',
    date '2024-04-01',
    'leave',
    false,
    true,
    'directory-fixture',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000103',
    1
  ),
  (
    '90000000-0000-0000-0000-00000000c103',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'DIR-OTHER',
    '财务范围',
    'Forbidden Scope',
    '61000000-0000-0000-0000-000000000017',
    null,
    '65000000-0000-0000-0000-000000000014',
    '64000000-0000-0000-0000-000000000015',
    null,
    date '2024-01-01',
    date '2024-04-01',
    'active',
    false,
    true,
    'directory-fixture',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000103',
    1
  );

insert into public.employee_external_identifiers(
  id, tenant_id, property_id, employee_id, source_system,
  identifier_type, identifier_value, is_primary, is_active,
  source_batch_id, version
) values
  (
    '91000000-0000-0000-0000-00000000c001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '90000000-0000-0000-0000-00000000c001',
    'recovery-c-fixture',
    'lms_employee_id',
    'L-NEW-U001',
    false,
    false,
    null,
    1
  ),
  (
    '91000000-0000-0000-0000-00000000c010',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '90000000-0000-0000-0000-00000000c010',
    'recovery-c-conflict',
    'lms_employee_id',
    'DUP-EXT',
    false,
    true,
    null,
    1
  );

insert into public.import_source_rows(
  id, tenant_id, property_id, import_batch_id, import_sheet_id,
  source_row_number, raw_values, normalized_values, row_fingerprint,
  processing_status, proposed_action
) values
  (
    '83000000-0000-0000-0000-00000000c001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-00000000c001',
    '82000000-0000-0000-0000-00000000c001',
    4,
    jsonb_build_object(
      'Empid','U-001','Status','leave','NameZh','更新后姓名',
      'NameEn','Draft Name','Department','Bar 168',
      'Position','Chef de Partie','Grade','C2',
      'HireDate',(current_date - 10)::text,
      'ProbationDate',(current_date + 80)::text,
      'LmsId','L-NEW-U001','MerlinId',null
    ),
    jsonb_build_object(
      'employee_number', 'U-001',
      'name_zh', '更新后姓名',
      'name_en', 'Draft Name',
      'department_source_label', 'Bar 168',
      'position_source_label', 'Chef de Partie',
      'grade_or_band', 'C2',
      'hire_date', (current_date - 10)::text,
      'probation_or_confirmation_date', (current_date + 80)::text,
      'employment_status', 'leave',
      'lms_employee_id', 'L-NEW-U001'
    ),
    'recovery-c-update',
    'staged',
    'unresolved'
  ),
  (
    '83000000-0000-0000-0000-00000000c002',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-00000000c001',
    '82000000-0000-0000-0000-00000000c001',
    5,
    jsonb_build_object(
      'Empid','0007','Status','active','NameZh','新增员工',
      'NameEn','New Employee','Department','Bar 168',
      'Position','Chef de Partie','Grade','C2',
      'HireDate',(current_date - 5)::text,
      'ProbationDate',(current_date + 85)::text,
      'LmsId',null,'MerlinId','M-0007'
    ),
    jsonb_build_object(
      'employee_number', '0007',
      'name_zh', '新增员工',
      'name_en', 'New Employee',
      'department_source_label', 'Bar 168',
      'position_source_label', 'Chef de Partie',
      'grade_or_band', 'C2',
      'hire_date', (current_date - 5)::text,
      'probation_or_confirmation_date', (current_date + 85)::text,
      'employment_status', 'active',
      'merlin_id', 'M-0007'
    ),
    'recovery-c-insert',
    'staged',
    'unresolved'
  ),
  (
    '83000000-0000-0000-0000-00000000c003',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-00000000c001',
    '82000000-0000-0000-0000-00000000c001',
    6,
    jsonb_build_object(
      'Empid','SAME-1','Status','active','NameZh','保持不变',
      'NameEn','Unchanged Employee','Department','Bar 168',
      'Position','Chef de Partie','Grade','C2',
      'HireDate',(current_date - 200)::text,
      'ProbationDate',(current_date - 100)::text,
      'LmsId',null,'MerlinId',null
    ),
    jsonb_build_object(
      'employee_number', 'SAME-1',
      'name_zh', '保持不变',
      'name_en', 'Unchanged Employee',
      'department_source_label', 'Bar 168',
      'position_source_label', 'Chef de Partie',
      'grade_or_band', 'C2',
      'hire_date', (current_date - 200)::text,
      'probation_or_confirmation_date', (current_date - 100)::text,
      'employment_status', 'active'
    ),
    'recovery-c-unchanged',
    'staged',
    'unresolved'
  ),
  (
    '83000000-0000-0000-0000-00000000c004',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-00000000c001',
    '82000000-0000-0000-0000-00000000c001',
    7,
    jsonb_build_object(
      'Empid','EXCLUDED-1','Status','active','NameZh','明确排除',
      'NameEn',null,'Department','Ignore Department',
      'Position','Chef de Partie','Grade',null,
      'HireDate',(current_date - 5)::text,
      'ProbationDate',null,'LmsId',null,'MerlinId',null
    ),
    jsonb_build_object(
      'employee_number', 'EXCLUDED-1',
      'name_zh', '明确排除',
      'department_source_label', 'Ignore Department',
      'position_source_label', 'Chef de Partie',
      'hire_date', (current_date - 5)::text,
      'employment_status', 'active'
    ),
    'recovery-c-excluded',
    'staged',
    'unresolved'
  ),
  (
    '83000000-0000-0000-0000-00000000c010',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-00000000c002',
    '82000000-0000-0000-0000-00000000c002',
    2,
    '{"Empid":"CONFLICT-NEW"}',
    jsonb_build_object(
      'employee_number', 'CONFLICT-NEW',
      'name_zh', '冲突员工',
      'department_id', '61000000-0000-0000-0000-000000000018',
      'position_id', '65000000-0000-0000-0000-000000000014',
      'hire_date', (current_date - 5)::text,
      'lms_employee_id', 'DUP-EXT'
    ),
    'recovery-c-identifier-conflict',
    'staged',
    'unresolved'
  ),
  (
    '83000000-0000-0000-0000-00000000c020',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-00000000c003',
    '82000000-0000-0000-0000-00000000c003',
    2,
    '{"Empid":"STALE-1"}',
    jsonb_build_object(
      'employee_number', 'STALE-1',
      'name_zh', '陈旧预览已更新',
      'name_en', 'Stale Preview Updated',
      'department_id', '61000000-0000-0000-0000-000000000018',
      'position_id', '65000000-0000-0000-0000-000000000014',
      'hire_date', '2024-01-01',
      'probation_or_confirmation_date', '2024-04-01'
    ),
    'recovery-c-stale-preview',
    'staged',
    'unresolved'
  );

insert into public.import_issues(
  id, tenant_id, property_id, import_batch_id, import_source_row_id,
  issue_type, severity, source_field, source_value, message,
  resolution_status
) values (
  '85000000-0000-0000-0000-00000000c001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '81000000-0000-0000-0000-00000000c001',
  '83000000-0000-0000-0000-00000000c001',
  'other',
  'warning',
  'name_en',
  'Draft Name',
  'Manager confirms the corrected English name',
  'unresolved'
);

set local role anon;
select throws_ok(
  $$select public.prepare_employee_import_preview(
    '81000000-0000-0000-0000-00000000c001',
    1,
    jsonb_build_object('statusTreatment','use_recognized_status','effectiveDate',current_date)
  )$$,
  '42501',
  null,
  'anonymous import preview has no executable API path'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select throws_ok(
  $$select public.prepare_employee_import_preview(
    '81000000-0000-0000-0000-00000000c001',
    1,
    jsonb_build_object('statusTreatment','use_recognized_status','effectiveDate',current_date)
  )$$,
  '42501',
  'IMPORT_MANAGER_REQUIRED',
  'property membership without the exact manager role cannot preview an import'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000111';
select throws_ok(
  $$select public.prepare_employee_import_preview(
    '81000000-0000-0000-0000-00000000c001',
    1,
    jsonb_build_object('statusTreatment','use_recognized_status','effectiveDate',current_date)
  )$$,
  '42501',
  'IMPORT_MANAGER_ACCOUNT_INACTIVE',
  'an exact manager assignment is insufficient when its account is suspended'
);

reset role;
update public.user_accounts
set locked_until = now() + interval '1 hour'
where id = '70000000-0000-0000-0000-000000000103';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$select public.confirm_employee_import_field_mapping(
    '81000000-0000-0000-0000-00000000c001',
    1,
    '[{"mappingId":"84000000-0000-0000-0000-00000000c001","mappingStatus":"confirmed"}]'::jsonb
  )$$,
  '42501',
  'IMPORT_MANAGER_ACCOUNT_INACTIVE',
  'a locked manager account cannot confirm import decisions'
);

reset role;
update public.user_accounts
set locked_until = null
where id = '70000000-0000-0000-0000-000000000103';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select lives_ok(
  $$select public.confirm_employee_import_field_mapping(
    '81000000-0000-0000-0000-00000000c001',
    1,
    '[
      {
        "mappingId":"84000000-0000-0000-0000-00000000c001",
        "mappingStatus":"confirmed",
        "approvedBy":"00000000-0000-0000-0000-000000000104"
      },
      {
        "mappingId":"84000000-0000-0000-0000-00000000c002",
        "mappingStatus":"confirmed"
      }
    ]'::jsonb
  )$$,
  'active manager confirms field mappings at the authoritative batch version'
);
select results_eq(
  $$select distinct approved_by
    from public.import_field_mappings
    where import_batch_id = '81000000-0000-0000-0000-00000000c001'
    order by approved_by$$,
  $$values ('00000000-0000-0000-0000-000000000103'::uuid)$$,
  'spoofed mapping actor data is ignored in favor of auth.uid()'
);
select throws_ok(
  $$select public.resolve_employee_import_source_label(
    '81000000-0000-0000-0000-00000000c001',
    2,
    'department',
    'Bar 168',
    '61000000-0000-0000-0000-000000000021',
    'mapped'
  )$$,
  '23514',
  'IMPORT_SOURCE_LABEL_TARGET_SCOPE',
  'a source label cannot map to another property'
);
select lives_ok(
  $$select public.resolve_employee_import_source_label(
    '81000000-0000-0000-0000-00000000c001',
    2,
    'department',
    'Bar 168',
    '63000000-0000-0000-0000-000000000011',
    'mapped'
  )$$,
  'department labels may map to an official operational unit in the batch property'
);
select lives_ok(
  $$select public.resolve_employee_import_source_label(
    '81000000-0000-0000-0000-00000000c001',
    3,
    'position',
    'Chef de Partie',
    '65000000-0000-0000-0000-000000000015',
    'mapped'
  )$$,
  'position labels map to an official position in the batch property'
);
select lives_ok(
  $$select public.resolve_employee_import_source_label(
    '81000000-0000-0000-0000-00000000c001',
    4,
    'department',
    'Ignore Department',
    null,
    'excluded'
  )$$,
  'manager may explicitly exclude every row carrying a source label'
);
select lives_ok(
  $$select public.resolve_employee_import_issue(
    '81000000-0000-0000-0000-00000000c001',
    5,
    '85000000-0000-0000-0000-00000000c001',
    'corrected',
    '{
      "corrections":{"name_en":"Updated Full Name"},
      "resolvedBy":"00000000-0000-0000-0000-000000000104"
    }'::jsonb
  )$$,
  'manager persists an approved row correction through the issue RPC'
);
select results_eq(
  $$select resolved_by
    from public.import_issues
    where id = '85000000-0000-0000-0000-00000000c001'$$,
  $$values ('00000000-0000-0000-0000-000000000103'::uuid)$$,
  'issue resolution actor is always auth.uid()'
);
select results_eq(
  $$select normalized_values->>'name_en'
    from public.import_source_rows
    where id = '83000000-0000-0000-0000-00000000c001'$$,
  $$values ('Updated Full Name'::text)$$,
  'approved issue correction updates only normalized staging evidence'
);
select results_eq(
  $$select count(*) from public.import_activity_events
    where import_batch_id = '81000000-0000-0000-0000-00000000c001'
      and actor_id = '00000000-0000-0000-0000-000000000103'
      and event_type in (
        'field_mapping_confirmed',
        'source_label_resolved',
        'issue_resolved'
      )$$,
  array[5::bigint],
  'manager decisions append actor-bound activity events'
);

reset role;
select results_eq(
  $$select count(*) from public.employees
    where source_batch_id = '81000000-0000-0000-0000-00000000c001'$$,
  array[0::bigint],
  'decision steps write no employee rows'
);
select results_eq(
  $$select count(*) from public.employee_external_identifiers
    where source_batch_id = '81000000-0000-0000-0000-00000000c001'$$,
  array[0::bigint],
  'decision steps write no employee identifiers'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
create temporary table recovery_c_main_preview on commit drop as
select public.prepare_employee_import_preview(
  '81000000-0000-0000-0000-00000000c001',
  6,
  jsonb_build_object('statusTreatment','use_recognized_status','effectiveDate',current_date)
) result;
select results_eq(
  $$select
      (result->>'additions')::integer,
      (result->>'updates')::integer,
      (result->>'unchanged')::integer,
      (result->>'exclusions')::integer,
      (result->>'blocked')::integer,
      (result->>'unresolved')::integer,
      (result->>'version')::bigint,
      result->>'status'
    from recovery_c_main_preview$$,
  $$values (1,1,1,1,0,0,7::bigint,'ready_for_review'::text)$$,
  'preview deterministically classifies addition, update, unchanged, and exclusion'
);
select results_eq(
  $$select normalized_values->>'employee_number'
    from public.import_source_rows
    where id = '83000000-0000-0000-0000-00000000c002'$$,
  $$values ('0007'::text)$$,
  'preview preserves a leading-zero employee number as text'
);
select results_eq(
  $$select proposed_action::text
    from public.import_source_rows
    where import_batch_id = '81000000-0000-0000-0000-00000000c001'
    order by source_row_number$$,
  $$values
    ('update'::text),
    ('insert'::text),
    ('unchanged'::text),
    ('excluded'::text)$$,
  'preview classifications persist only on staging rows'
);
select results_eq(
  $$select count(*) from public.employees
    where source_batch_id = '81000000-0000-0000-0000-00000000c001'
       or employee_number = '0007'$$,
  array[0::bigint],
  'preview performs zero employee writes'
);
select results_eq(
  $$select count(*) from public.employee_external_identifiers
    where source_batch_id = '81000000-0000-0000-0000-00000000c001'$$,
  array[0::bigint],
  'preview performs zero external-identifier writes'
);
select results_eq(
  $$select (validation_summary->>'expected_employee_version')::bigint
    from public.import_source_rows
    where id = '83000000-0000-0000-0000-00000000c001'$$,
  array[1::bigint],
  'preview records the matched employee version for commit concurrency control'
);

select throws_ok(
  $$update public.import_commit_items set after_snapshot = '{}'$$,
  '42501', null, 'commit evidence is append-only'
);
select throws_ok(
  $$update public.import_activity_events set payload = '{}'$$,
  '42501', null, 'activity evidence is append-only'
);
select throws_ok(
  $$delete from public.import_activity_events$$,
  '42501', null, 'activity evidence cannot be deleted by an authenticated client'
);

create temporary table recovery_c_main_commit on commit drop as
select public.commit_employee_import(
  '81000000-0000-0000-0000-00000000c001',
  7,
  (select result->>'previewHash' from recovery_c_main_preview),
  true
) commit_id;
select ok(
  (
    select
      employee.name_zh = '更新后姓名'
      and employee.name_en = 'Updated Full Name'
      and employee.department_id = '61000000-0000-0000-0000-000000000019'
      and employee.operational_unit_id = '63000000-0000-0000-0000-000000000011'
      and employee.position_id = '65000000-0000-0000-0000-000000000015'
      and employee.position_family_id = '64000000-0000-0000-0000-000000000014'
      and employee.grade_or_band = 'C2'
      and employee.hire_date = current_date - 10
      and employee.probation_or_confirmation_date = current_date + 80
      and employee.employment_status = 'leave'
      and employee.is_new_employee
      and employee.is_active
      and employee.source_batch_id = '81000000-0000-0000-0000-00000000c001'
      and employee.version = 2
    from public.employees employee
    where employee.employee_number = 'U-001'
  ),
  'commit updates every approved employee field and increments the version once'
);
select results_eq(
  $$select employee_number, is_new_employee, employment_status::text
    from public.employees
    where source_batch_id = '81000000-0000-0000-0000-00000000c001'
      and employee_number = '0007'$$,
  $$values ('0007'::text, true, 'active'::text)$$,
  'commit inserts a leading-zero employee with server-derived new-employee state'
);
select results_eq(
  $$select count(*) from public.employees
    where employee_number = 'DIR-OTHER' and is_active$$,
  array[1::bigint],
  'employees absent from the workbook remain active and untouched'
);
select results_eq(
  $$select count(*) from public.import_commit_items item
    join recovery_c_main_commit committed on committed.commit_id = item.import_commit_id
    where item.action = 'update'
      and item.before_snapshot is not null
      and item.after_snapshot is not null
      and jsonb_array_length(item.identifier_before_snapshots) = 1
      and jsonb_array_length(item.identifier_after_snapshots) >= 2$$,
  array[1::bigint],
  'commit stores immutable before/after employee and identifier evidence'
);
select results_eq(
  $$select
      inserted_employee_count,
      updated_employee_count,
      unchanged_employee_count,
      excluded_row_count,
      unresolved_row_count
    from public.import_commits
    where import_batch_id = '81000000-0000-0000-0000-00000000c001'$$,
  $$values (1,1,1,1,0)$$,
  'commit summary matches the deterministic preview'
);
select results_eq(
  $$select public.commit_employee_import(
      '81000000-0000-0000-0000-00000000c001',
      7,
      (select result->>'previewHash' from recovery_c_main_preview),
      true
    )$$,
  $$select commit_id from recovery_c_main_commit$$,
  'retrying a completed commit returns the original commit identity'
);
select results_eq(
  $$select count(*) from public.import_commits
    where import_batch_id = '81000000-0000-0000-0000-00000000c001'$$,
  array[1::bigint],
  'idempotent commit retry creates no duplicate commit record'
);

create temporary table recovery_c_conflict_preview on commit drop as
select public.prepare_employee_import_preview(
  '81000000-0000-0000-0000-00000000c002',
  1,
  jsonb_build_object('statusTreatment','retain_existing_set_additions_active','effectiveDate',current_date)
) result;
select results_eq(
  $$select
      (result->>'blocked')::integer,
      (result->>'unresolved')::integer,
      result->>'status'
    from recovery_c_conflict_preview$$,
  $$values (1,0,'mapping_required'::text)$$,
  'external identifier ownership conflict blocks the staged row'
);
select results_eq(
  $$select count(*) from public.employees
    where employee_number = 'CONFLICT-NEW'$$,
  array[0::bigint],
  'identifier-conflict preview writes no employee'
);

create temporary table recovery_c_stale_preview on commit drop as
select public.prepare_employee_import_preview(
  '81000000-0000-0000-0000-00000000c003',
  1,
  jsonb_build_object('statusTreatment','retain_existing_set_additions_active','effectiveDate',current_date)
) result;
select results_eq(
  $$select (result->>'version')::bigint, result->>'status'
    from recovery_c_stale_preview$$,
  $$values (2::bigint,'ready_for_review'::text)$$,
  'a valid update preview records an authoritative batch version'
);
reset role;
update public.employees
set name_en = 'Concurrent change',
    version = version + 1
where employee_number = 'STALE-1';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$select public.commit_employee_import(
    '81000000-0000-0000-0000-00000000c003',
    2,
    (select result->>'previewHash' from recovery_c_stale_preview),
    true
  )$$,
  'P3005',
  'IMPORT_EMPLOYEE_STALE_VERSION',
  'commit refuses a preview made stale by a later employee edit'
);
select results_eq(
  $$select count(*) from public.import_commits
    where import_batch_id = '81000000-0000-0000-0000-00000000c003'$$,
  array[0::bigint],
  'stale commit failure leaves no partial commit record'
);

create temporary table recovery_c_first_revert_preview on commit drop as
select public.preview_employee_import_revert(
  '81000000-0000-0000-0000-00000000c001'
) result;
select ok(
  (
    select
      (result->>'safe')::boolean
      and nullif(result->>'token', '') is not null
      and (result->>'expiresAt')::timestamptz > now()
      and (result->>'expiresAt')::timestamptz <= now() + interval '6 minutes'
    from recovery_c_first_revert_preview
  ),
  'safe reversal preview returns a short-lived opaque token'
);
savepoint recovery_c_unsafe_revert;
reset role;
update public.employees
set name_en = 'Later edit blocks reversal',
    version = version + 1
where employee_number = 'U-001';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$select public.revert_employee_import(
    '81000000-0000-0000-0000-00000000c001',
    (select result->>'token' from recovery_c_first_revert_preview)
  )$$,
  'P3011',
  'IMPORT_REVERT_CONFLICT: later changes must be resolved first',
  'reversal rechecks locked employee versions and refuses later edits'
);

rollback to savepoint recovery_c_unsafe_revert;
create temporary table recovery_c_safe_revert_preview on commit drop as
select public.preview_employee_import_revert(
  '81000000-0000-0000-0000-00000000c001'
) result;
select results_eq(
  $$select (result->>'safe')::boolean,
      (result->>'conflicts')::integer
    from recovery_c_safe_revert_preview$$,
  $$values (true,0)$$,
  'restored authoritative versions produce a safe reversal preview'
);
select throws_ok(
  $$select public.revert_employee_import(
    '81000000-0000-0000-0000-00000000c001',
    'not-the-preview-token'
  )$$,
  'P3012',
  'IMPORT_REVERT_TOKEN_INVALID',
  'reversal rejects a token not issued by the latest safe preview'
);
select lives_ok(
  $$select public.revert_employee_import(
    '81000000-0000-0000-0000-00000000c001',
    (select result->>'token' from recovery_c_safe_revert_preview)
  )$$,
  'safe token-bound reversal completes'
);
select results_eq(
  $$select employee_number, is_active, employment_status::text
    from public.employees
    where employee_number = '0007'$$,
  $$values ('0007'::text, false, 'inactive'::text)$$,
  'reversal deactivates inserted employees without deleting them'
);
select ok(
  (
    select
      employee.name_zh = '更新前姓名'
      and employee.name_en = 'Before Update'
      and employee.department_id = '61000000-0000-0000-0000-000000000013'
      and employee.operational_unit_id is null
      and employee.position_id = '65000000-0000-0000-0000-000000000012'
      and employee.position_family_id = '64000000-0000-0000-0000-000000000012'
      and employee.grade_or_band = 'OLD'
      and employee.hire_date = date '2020-01-01'
      and employee.probation_or_confirmation_date = date '2020-04-01'
      and employee.employment_status = 'active'
      and not employee.is_new_employee
      and employee.is_active
      and employee.source_batch_id is null
    from public.employees employee
    where employee.employee_number = 'U-001'
  ),
  'reversal restores every audited field for an updated employee'
);
select results_eq(
  $$select is_active, source_batch_id
    from public.employee_external_identifiers
    where id = '91000000-0000-0000-0000-00000000c001'$$,
  $$values (false,null::uuid)$$,
  'reversal restores an identifier that predated the batch'
);
select results_eq(
  $$select count(*) from public.employee_external_identifiers
    where source_batch_id = '81000000-0000-0000-0000-00000000c001'
      and is_active$$,
  array[0::bigint],
  'reversal deactivates identifiers created by the batch'
);
select results_eq(
  $$select batch.status::text, commit.reverted_by
    from public.import_batches batch
    join public.import_commits commit on commit.import_batch_id = batch.id
    where batch.id = '81000000-0000-0000-0000-00000000c001'$$,
  $$values ('reverted'::text,'00000000-0000-0000-0000-000000000103'::uuid)$$,
  'reversal records the terminal batch state and authenticated actor'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000110';
select results_eq(
  $$select employee_number
    from public.list_department_employee_directory('DIR-',100,0)
    order by employee_number$$,
  $$values ('DIR-DESC'::text),('DIR-EXACT'::text)$$,
  'department scope with descendants returns exact and descendant employees'
);
select is_empty(
  $$select employee_number
    from public.list_department_employee_directory('DIR-OTHER',100,0)$$,
  'department directory denies employees outside every active scope branch'
);
select results_eq(
  $$select array_agg(key order by key)
    from jsonb_object_keys(
      (
        select to_jsonb(directory_row)
        from public.list_department_employee_directory('DIR-EXACT',1,0)
          directory_row
        limit 1
      )
    ) key$$,
  $$values (array[
    'department_id',
    'department_name_en',
    'department_name_zh',
    'employee_number',
    'employment_status',
    'hire_date',
    'is_new_employee',
    'name_en',
    'name_zh',
    'operational_unit_id',
    'operational_unit_name_en',
    'operational_unit_name_zh',
    'position_family_id',
    'position_family_name_en',
    'position_family_name_zh',
    'position_id',
    'position_name_en',
    'position_name_zh',
    'probation_or_confirmation_date',
    'total_count'
  ]::text[])$$,
  'department directory returns only the approved employee projection and pagination count'
);
select is_empty(
  $$select employee_number from public.employees where employee_number like 'DIR-%'$$,
  'department role receives no employee base-table access'
);
select is_empty(
  $$select id from public.import_batches$$,
  'department role receives no workbook or import-history access'
);

reset role;
update public.trainer_scopes
set include_descendants = false
where id = '72000000-0000-0000-0000-000000000110';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000110';
select results_eq(
  $$select employee_number
    from public.list_department_employee_directory('DIR-',100,0)
    order by employee_number$$,
  $$values ('DIR-EXACT'::text)$$,
  'an exact-only department scope excludes descendant employees'
);

reset role;
select results_eq(
  $$select count(*) from public.user_accounts
    where employee_id in (
      select id from public.employees
      where source_batch_id = '81000000-0000-0000-0000-00000000c001'
    )$$,
  array[0::bigint],
  'employee import creates no application accounts'
);
select results_eq(
  $$select count(*) from public.role_assignments
    where user_id in (
      select auth_user_id from public.user_accounts
      where employee_id in (
        select id from public.employees
        where source_batch_id = '81000000-0000-0000-0000-00000000c001'
      )
    )$$,
  array[0::bigint],
  'employee import creates no role assignments'
);

select * from finish();
rollback;
