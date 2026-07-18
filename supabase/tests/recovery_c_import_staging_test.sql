begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_function(
  'public',
  'stage_employee_import',
  array['uuid','uuid','jsonb'],
  'atomic actor-scoped employee staging RPC exists'
);
select function_privs_are(
  'public',
  'stage_employee_import',
  array['uuid','uuid','jsonb'],
  'authenticated',
  array['EXECUTE']
);
select results_eq(
  $$select count(*)
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name = 'stage_employee_import'
      and grantee in ('PUBLIC','anon')$$,
  array[0::bigint],
  'anonymous and PUBLIC cannot execute employee staging'
);

reset role;
insert into public.user_accounts (
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values (
  '70000000-0000-0000-0000-000000000143',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000103',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'recovery-c-staging-manager',
  'active',
  false
);

set local role anon;
select throws_ok(
  $$select public.stage_employee_import(
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-000000000141',
    '{}'::jsonb
  )$$,
  '42501',
  null,
  'anonymous staging has no execute privilege'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select throws_ok(
  $$select public.stage_employee_import(
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-000000000141',
    '{}'::jsonb
  )$$,
  '42501',
  'IMPORT_MANAGER_REQUIRED',
  'a non-manager cannot stage employee evidence'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select lives_ok(
  $$insert into storage.objects(bucket_id, name, owner_id)
    values (
      'property-import-files',
      '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-000000000141/synthetic-staging.xlsx',
      auth.uid()
    )$$,
  'the exact active manager may upload the private object before atomic staging'
);
select throws_ok(
  $$insert into storage.objects(bucket_id, name, owner_id)
    values (
      'property-import-files',
      '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000012/imports/81000000-0000-0000-0000-000000000142/forged.xlsx',
      auth.uid()
    )$$,
  '42501',
  null,
  'pre-staging Storage access cannot cross the authenticated property'
);

select lives_ok(
  $$select public.stage_employee_import(
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-000000000141',
    '{
      "batch": {
        "originalFilename": "synthetic-staging.xlsx",
        "sanitizedFilename": "synthetic-staging.xlsx",
        "storageObjectPath": "10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-000000000141/synthetic-staging.xlsx",
        "fileChecksum": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "fileSizeBytes": 256,
        "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "detectedSheetCount": 1,
        "totalSourceRows": 1,
        "validRows": 1,
        "warningRows": 1,
        "errorRows": 0
      },
      "sheets": [{
        "id": "82000000-0000-0000-0000-000000000141",
        "name": "Sheet1",
        "index": 0,
        "headerRow": 3,
        "rowCount": 4,
        "selected": true,
        "purpose": "employee_master"
      }],
      "fieldMappings": [{
        "sheetId": "82000000-0000-0000-0000-000000000141",
        "sourceColumnName": "Empid",
        "sourceColumnIndex": 0,
        "targetField": "employee_number",
        "transformationRule": {"preserveLeadingZeros": true},
        "isRequired": true
      }, {
        "sheetId": "82000000-0000-0000-0000-000000000141",
        "sourceColumnName": "CName",
        "sourceColumnIndex": 1,
        "targetField": "name_zh",
        "transformationRule": {"trim": true},
        "isRequired": false
      }],
      "rows": [{
        "id": "83000000-0000-0000-0000-000000000141",
        "sheetId": "82000000-0000-0000-0000-000000000141",
        "sourceRowNumber": 4,
        "rawValues": {"Empid": "0007", "CName": "示例员工"},
        "normalizedValues": {"employee_number": "0007", "name_zh": "示例员工"},
        "rowFingerprint": "synthetic-row-fingerprint",
        "processingStatus": "warning",
        "proposedAction": "unresolved",
        "validationSummary": {"blockingIssues": [], "warningIssues": ["invalid_date"]}
      }],
      "issues": [{
        "sourceRowId": "83000000-0000-0000-0000-000000000141",
        "issueType": "invalid_date",
        "severity": "warning",
        "message": "日期值需要人工确认"
      }],
      "sourceLabels": [{
        "resolutionType": "department",
        "sourceLabel": "Front Office",
        "normalizedSourceLabel": "front office",
        "affectedRowCount": 1
      }, {
        "resolutionType": "position",
        "sourceLabel": "Guest Service Associate",
        "normalizedSourceLabel": "guest service associate",
        "affectedRowCount": 1
      }]
    }'::jsonb
  )$$,
  'active manager stages the full batch through one transaction'
);
select results_eq(
  $$select
      batch.status::text,
      count(distinct sheet.id),
      count(distinct source_row.id),
      count(distinct issue.id),
      count(distinct resolution.id)
    from public.import_batches batch
    left join public.import_sheets sheet
      on sheet.import_batch_id = batch.id
    left join public.import_source_rows source_row
      on source_row.import_batch_id = batch.id
    left join public.import_issues issue
      on issue.import_batch_id = batch.id
    left join public.import_source_label_resolutions resolution
      on resolution.import_batch_id = batch.id
    where batch.id = '81000000-0000-0000-0000-000000000141'
    group by batch.status$$,
  $$values ('mapping_required'::text, 1::bigint, 1::bigint, 1::bigint, 2::bigint)$$,
  'atomic staging persists the complete resumable evidence graph'
);
select results_eq(
  $$select created_by
    from public.import_batches
    where id = '81000000-0000-0000-0000-000000000141'$$,
  $$values ('00000000-0000-0000-0000-000000000103'::uuid)$$,
  'staging actor is always derived from auth.uid()'
);
select results_eq(
  $$select app_private.can_stage_property_import_object(
    '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-000000000141/synthetic-staging.xlsx'
  )$$,
  array[false],
  'a successfully linked workbook is no longer eligible for cleanup deletion'
);

select lives_ok(
  $$insert into storage.objects(bucket_id, name, owner_id)
    values (
      'property-import-files',
      '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-000000000149/atomic-failure.xlsx',
      auth.uid()
    )$$,
  'the manager uploads the exact failure-case object before staging'
);
select results_eq(
  $$select app_private.can_stage_property_import_object(
    '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-000000000149/atomic-failure.xlsx'
  )$$,
  array[true],
  'an unlinked failure-case object remains eligible for exact-path cleanup'
);
select throws_ok(
  $$select public.stage_employee_import(
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-000000000149',
    '{
      "batch": {
        "originalFilename": "atomic-failure.xlsx",
        "sanitizedFilename": "atomic-failure.xlsx",
        "storageObjectPath": "10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-000000000149/atomic-failure.xlsx",
        "fileChecksum": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "fileSizeBytes": 128,
        "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "detectedSheetCount": 1,
        "totalSourceRows": 1,
        "validRows": 0,
        "warningRows": 0,
        "errorRows": 1
      },
      "sheets": [{
        "id": "82000000-0000-0000-0000-000000000149",
        "name": "Sheet1",
        "index": 0,
        "headerRow": 3,
        "rowCount": 4,
        "selected": true,
        "purpose": "employee_master"
      }],
      "fieldMappings": [{
        "sheetId": "82000000-0000-0000-0000-000000000149",
        "sourceColumnName": "Empid",
        "sourceColumnIndex": 0,
        "targetField": "employee_number",
        "transformationRule": {"preserveLeadingZeros": true},
        "isRequired": true
      }],
      "rows": [{
        "id": "83000000-0000-0000-0000-000000000149",
        "sheetId": "82000000-0000-0000-0000-000000000149",
        "sourceRowNumber": 4,
        "rawValues": {"Empid": ""},
        "normalizedValues": {},
        "rowFingerprint": "atomic-failure-row",
        "processingStatus": "error",
        "proposedAction": "unresolved",
        "validationSummary": {"blockingIssues": ["not_an_allowed_issue"], "warningIssues": []}
      }],
      "issues": [{
        "sourceRowId": "83000000-0000-0000-0000-000000000149",
        "issueType": "not_an_allowed_issue",
        "severity": "error",
        "message": "synthetic invalid issue"
      }],
      "sourceLabels": []
    }'::jsonb
  )$$,
  '23514',
  null,
  'a late child-row validation failure aborts the staging transaction'
);
select results_eq(
  $$select
      (select count(*) from public.import_batches
        where id = '81000000-0000-0000-0000-000000000149'),
      (select count(*) from public.import_sheets
        where import_batch_id = '81000000-0000-0000-0000-000000000149'),
      (select count(*) from public.import_source_rows
        where import_batch_id = '81000000-0000-0000-0000-000000000149'),
      (select count(*) from public.import_issues
        where import_batch_id = '81000000-0000-0000-0000-000000000149')$$,
  $$values (0::bigint, 0::bigint, 0::bigint, 0::bigint)$$,
  'failed staging leaves no partial database evidence'
);
select results_eq(
  $$select count(*)
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'import_files_staging_cleanup_delete'
      and cmd = 'DELETE'$$,
  array[1::bigint],
  'a narrow Storage delete policy supports API cleanup after staging failure'
);
select results_eq(
  $$select count(*)
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'import_files_manager_select'
      and cmd = 'SELECT'
      and qual like '%can_stage_property_import_object%'
      and qual like '%owner_id%'
      and qual like '%auth.uid%'$$,
  array[1::bigint],
  'pre-staging SELECT is narrowly bound to the authenticated object owner'
);
select results_eq(
  $$select count(*)
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'import_files_staging_cleanup_delete'
      and cmd = 'DELETE'
      and qual like '%can_stage_property_import_object%'
      and qual like '%owner_id%'
      and qual like '%auth.uid%'$$,
  array[1::bigint],
  'pre-staging cleanup DELETE is narrowly bound to the authenticated owner'
);

create function pg_temp.employee_staging_payload(
  p_batch_id uuid,
  p_filename text
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'batch', jsonb_build_object(
      'originalFilename', p_filename,
      'sanitizedFilename', p_filename,
      'storageObjectPath',
        '10000000-0000-0000-0000-000000000001/' ||
        '20000000-0000-0000-0000-000000000011/imports/' ||
        p_batch_id::text || '/' || p_filename,
      'fileChecksum',
        'cccccccccccccccccccccccccccccccc' ||
        'cccccccccccccccccccccccccccccccc',
      'fileSizeBytes', 128,
      'mimeType',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'detectedSheetCount', 1,
      'totalSourceRows', 1,
      'validRows', 1,
      'warningRows', 0,
      'errorRows', 0
    ),
    'sheets', jsonb_build_array(jsonb_build_object(
      'id', p_batch_id,
      'name', 'Employee Master',
      'index', 0,
      'headerRow', 1,
      'rowCount', 2,
      'selected', true,
      'purpose', 'employee_master'
    )),
    'fieldMappings', jsonb_build_array(jsonb_build_object(
      'sheetId', p_batch_id,
      'sourceColumnName', 'Empid',
      'sourceColumnIndex', 0,
      'targetField', 'employee_number',
      'transformationRule', jsonb_build_object(
        'preserveLeadingZeros', true
      ),
      'isRequired', true
    )),
    'rows', jsonb_build_array(jsonb_build_object(
      'id', p_batch_id,
      'sheetId', p_batch_id,
      'sourceRowNumber', 2,
      'rawValues', jsonb_build_object('Empid', '0007'),
      'normalizedValues',
        jsonb_build_object('employee_number', '0007'),
      'rowFingerprint', 'allowlist-row',
      'processingStatus', 'staged',
      'proposedAction', 'unresolved',
      'validationSummary', jsonb_build_object(
        'blockingIssues', jsonb_build_array(),
        'warningIssues', jsonb_build_array()
      )
    )),
    'issues', jsonb_build_array(),
    'sourceLabels', jsonb_build_array()
  );
$$;

insert into storage.objects(bucket_id, name, owner_id)
select
  'property-import-files',
  '10000000-0000-0000-0000-000000000001/' ||
    '20000000-0000-0000-0000-000000000011/imports/' ||
    fixture.batch_id::text || '/' || fixture.filename,
  auth.uid()
from (values
  (
    '81000000-0000-0000-0000-000000000151'::uuid,
    'forbidden-source.xlsx'
  ),
  (
    '81000000-0000-0000-0000-000000000152'::uuid,
    'forbidden-target.xlsx'
  ),
  (
    '81000000-0000-0000-0000-000000000153'::uuid,
    'forbidden-normalized.xlsx'
  ),
  (
    '81000000-0000-0000-0000-000000000154'::uuid,
    'unmapped-raw.xlsx'
  )
) as fixture(batch_id, filename);

select throws_ok(
  $$select public.stage_employee_import(
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-000000000151',
    jsonb_set(
      pg_temp.employee_staging_payload(
        '81000000-0000-0000-0000-000000000151',
        'forbidden-source.xlsx'
      ),
      '{fieldMappings,0,sourceColumnName}',
      '"CTC Completion"'::jsonb
    )
  )$$,
  'P3220',
  'IMPORT_STAGING_EXCLUDED_FIELD',
  'CTC/GTC and completion source keys are rejected at the RPC boundary'
);

select throws_ok(
  $$select public.stage_employee_import(
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-000000000152',
    jsonb_set(
      pg_temp.employee_staging_payload(
        '81000000-0000-0000-0000-000000000152',
        'forbidden-target.xlsx'
      ),
      '{fieldMappings,0,targetField}',
      '"training_history"'::jsonb
    )
  )$$,
  'P3220',
  'IMPORT_STAGING_EXCLUDED_FIELD',
  'training-history mapping targets are rejected before persistence'
);

select throws_ok(
  $$select public.stage_employee_import(
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-000000000153',
    jsonb_set(
      pg_temp.employee_staging_payload(
        '81000000-0000-0000-0000-000000000153',
        'forbidden-normalized.xlsx'
      ),
      '{rows,0,normalizedValues}',
      '{
        "employee_number": "0007",
        "gtc_completion": true,
        "attendance": 1,
        "feedback": "synthetic",
        "risk": "synthetic",
        "kpi_score": 99
      }'::jsonb
    )
  )$$,
  'P3220',
  'IMPORT_STAGING_EXCLUDED_FIELD',
  'completion attendance feedback risk and KPI normalized keys are rejected'
);

select throws_ok(
  $$select public.stage_employee_import(
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-000000000154',
    jsonb_set(
      pg_temp.employee_staging_payload(
        '81000000-0000-0000-0000-000000000154',
        'unmapped-raw.xlsx'
      ),
      '{rows,0,rawValues}',
      '{"Empid": "0007", "Unmapped Note": "synthetic"}'::jsonb
    )
  )$$,
  'P3220',
  'IMPORT_STAGING_FIELD_ALLOWLIST_INVALID',
  'raw row keys must be allowlisted by the submitted field mappings'
);

select results_eq(
  $$select
      (select count(*)
       from public.import_batches
       where id in (
         '81000000-0000-0000-0000-000000000151',
         '81000000-0000-0000-0000-000000000152',
         '81000000-0000-0000-0000-000000000153',
         '81000000-0000-0000-0000-000000000154'
       )),
      (select count(*)
       from public.import_sheets
       where import_batch_id in (
         '81000000-0000-0000-0000-000000000151',
         '81000000-0000-0000-0000-000000000152',
         '81000000-0000-0000-0000-000000000153',
         '81000000-0000-0000-0000-000000000154'
       )),
      (select count(*)
       from public.import_source_rows
       where import_batch_id in (
         '81000000-0000-0000-0000-000000000151',
         '81000000-0000-0000-0000-000000000152',
         '81000000-0000-0000-0000-000000000153',
         '81000000-0000-0000-0000-000000000154'
       )),
      (select count(*)
       from public.import_activity_events
       where import_batch_id in (
         '81000000-0000-0000-0000-000000000151',
         '81000000-0000-0000-0000-000000000152',
         '81000000-0000-0000-0000-000000000153',
         '81000000-0000-0000-0000-000000000154'
       ))$$,
  $$values (0::bigint, 0::bigint, 0::bigint, 0::bigint)$$,
  'every rejected excluded or unallowlisted payload is atomic'
);

create temporary table excluded_employee_key_cases (
  test_case text primary key,
  forbidden_key text not null,
  batch_id uuid not null default gen_random_uuid()
) on commit drop;

insert into excluded_employee_key_cases(test_case, forbidden_key)
values
  ('gender-en', 'Gender'),
  ('gender-zh', '性别'),
  ('ctc', 'CTC'),
  ('gtc', 'GTC'),
  ('course-en', 'Course'),
  ('course-zh', '课程'),
  ('training-en', 'Training'),
  ('training-zh', '培训'),
  ('completion-en', 'Completion'),
  ('completion-zh', '完成'),
  ('orientation-en', 'Orientation'),
  ('orientation-zh', '入职引导'),
  ('onboarding-en', 'Onboarding'),
  ('checklist-en', 'Checklist'),
  ('checklist-zh', '清单'),
  ('journey-en', 'Journey'),
  ('journey-zh', '旅程'),
  ('first-aid-en', 'First Aid'),
  ('first-aid-zh', '急救'),
  ('problem-handling-en', 'Problem Handling'),
  ('problem-handling-zh', '问题处理'),
  ('attendance-en', 'Attendance'),
  ('attendance-zh', '出勤'),
  ('attendance-alt-zh', '考勤'),
  ('feedback-en', 'Feedback'),
  ('feedback-zh', '反馈'),
  ('risk-en', 'Risk'),
  ('risk-zh', '风险'),
  ('kpi-en', 'KPI'),
  ('kpi-zh', '绩效');

insert into storage.objects(bucket_id, name, owner_id)
select
  'property-import-files',
  '10000000-0000-0000-0000-000000000001/' ||
    '20000000-0000-0000-0000-000000000011/imports/' ||
    batch_id::text || '/excluded-taxonomy.xlsx',
  auth.uid()
from excluded_employee_key_cases;

select throws_ok(
  format(
    $statement$
      select public.stage_employee_import(
        %L::uuid,
        %L::uuid,
        jsonb_set(
          jsonb_set(
            pg_temp.employee_staging_payload(
              %L::uuid,
              'excluded-taxonomy.xlsx'
            ),
            '{fieldMappings,0,sourceColumnName}',
            to_jsonb(%L::text)
          ),
          '{rows,0,rawValues}',
          jsonb_build_object(%L::text, '0007')
        )
      )
    $statement$,
    '20000000-0000-0000-0000-000000000011',
    batch_id,
    batch_id,
    forbidden_key,
    forbidden_key
  ),
  'P3220',
  'IMPORT_STAGING_EXCLUDED_FIELD',
  'excluded employee taxonomy rejects ' || test_case
)
from excluded_employee_key_cases
order by test_case;

select results_eq(
  $$select
      fixture.test_case,
      (select count(*)
       from public.import_batches batch
       where batch.id = fixture.batch_id),
      (select count(*)
       from public.import_sheets sheet
       where sheet.import_batch_id = fixture.batch_id),
      (select count(*)
       from public.import_source_rows source_row
       where source_row.import_batch_id = fixture.batch_id),
      (select count(*)
       from public.import_activity_events activity
       where activity.import_batch_id = fixture.batch_id)
    from excluded_employee_key_cases fixture
    order by fixture.test_case$$,
  $$select
      fixture.test_case,
      0::bigint,
      0::bigint,
      0::bigint,
      0::bigint
    from excluded_employee_key_cases fixture
    order by fixture.test_case$$,
  'every excluded taxonomy payload leaves zero batch sheet row or activity evidence'
);

select * from finish();
rollback;
