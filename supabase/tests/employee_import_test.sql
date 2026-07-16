begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

select results_eq($$select count(*) from pg_class where relnamespace='public'::regnamespace and relname in ('employees','employee_external_identifiers','import_batches','import_sheets','import_source_rows','import_field_mappings','import_issues','import_resolution_rules','import_commits','import_commit_items','import_source_label_resolutions','import_activity_events') and relrowsecurity and relforcerowsecurity$$,array[12::bigint],'all employee/import tables force RLS');
select results_eq($$select public from storage.buckets where id='property-import-files'$$,array[false],'workbook bucket is private');
select results_eq($$select file_size_limit from storage.buckets where id='property-import-files'$$,array[26214400::bigint],'workbook bucket limit is 25 MB');

reset role;
insert into public.user_accounts (
  id,user_id,auth_user_id,tenant_id,property_id,login_id,
  account_status,must_change_password
) values (
  '70000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000103',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'employee-import-manager',
  'active',
  false
);

set local role anon;
select throws_ok('select * from public.employees','42501',null,'anonymous cannot read employees');
select throws_ok('select * from public.import_batches','42501',null,'anonymous cannot read batches');
select throws_ok('select * from public.import_source_rows','42501',null,'anonymous cannot read raw staging');

set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000104';
select is_empty('select * from public.employees','ordinary member has no employee-master access yet');
select throws_ok($$insert into public.import_batches(id,tenant_id,property_id,source_system,original_filename,sanitized_filename,storage_object_path,file_checksum,file_size_bytes,mime_type) values('81000000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','synthetic','x.csv','x.csv','10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-000000000099/x.csv','x',10,'text/csv')$$,'42501',null,'ordinary member cannot create import');

set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000103';
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id) values('property-import-files','10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-000000000011/employees.csv',auth.uid())$$,'property manager writes only the approved private batch path');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id) values('property-import-files','10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000012/imports/81000000-0000-0000-0000-000000000011/employees.csv',auth.uid())$$,'42501',null,'property manager cannot forge another property Storage prefix');
select lives_ok(
  $$select public.stage_employee_import(
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-000000000011',
    '{
      "batch": {
        "originalFilename": "employees.csv",
        "sanitizedFilename": "employees.csv",
        "storageObjectPath": "10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-000000000011/employees.csv",
        "fileChecksum": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "fileSizeBytes": 100,
        "mimeType": "text/csv",
        "detectedSheetCount": 1,
        "totalSourceRows": 1,
        "validRows": 1,
        "warningRows": 0,
        "errorRows": 0
      },
      "sheets": [{
        "id": "82000000-0000-0000-0000-000000000011",
        "name": "Employee Master",
        "index": 0,
        "headerRow": 1,
        "rowCount": 2,
        "selected": true,
        "purpose": "employee_master"
      }],
      "fieldMappings": [{
        "sheetId": "82000000-0000-0000-0000-000000000011",
        "sourceColumnName": "Employee No",
        "sourceColumnIndex": 0,
        "targetField": "employee_number",
        "transformationRule": {"preserveLeadingZeros": true},
        "isRequired": true
      }, {
        "sheetId": "82000000-0000-0000-0000-000000000011",
        "sourceColumnName": "Chinese Name",
        "sourceColumnIndex": 1,
        "targetField": "name_zh",
        "transformationRule": {"trim": true},
        "isRequired": true
      }, {
        "sheetId": "82000000-0000-0000-0000-000000000011",
        "sourceColumnName": "English Name",
        "sourceColumnIndex": 2,
        "targetField": "name_en",
        "transformationRule": {"trim": true},
        "isRequired": false
      }, {
        "sheetId": "82000000-0000-0000-0000-000000000011",
        "sourceColumnName": "Department",
        "sourceColumnIndex": 3,
        "targetField": "department_source_label",
        "transformationRule": {},
        "isRequired": true
      }, {
        "sheetId": "82000000-0000-0000-0000-000000000011",
        "sourceColumnName": "Position",
        "sourceColumnIndex": 4,
        "targetField": "position_source_label",
        "transformationRule": {},
        "isRequired": true
      }, {
        "sheetId": "82000000-0000-0000-0000-000000000011",
        "sourceColumnName": "Hire Date",
        "sourceColumnIndex": 5,
        "targetField": "hire_date",
        "transformationRule": {},
        "isRequired": true
      }],
      "rows": [{
        "id": "83000000-0000-0000-0000-000000000011",
        "sheetId": "82000000-0000-0000-0000-000000000011",
        "sourceRowNumber": 2,
        "rawValues": {
          "Employee No": "0007",
          "Chinese Name": "示例员工甲",
          "English Name": "Synthetic Associate A",
          "Department": "Concierge",
          "Position": "Guest Service Agent",
          "Hire Date": "2026-06-01"
        },
        "normalizedValues": {
          "employee_number": "0007",
          "name_zh": "示例员工甲",
          "name_en": "Synthetic Associate A",
          "department_source_label": "Concierge",
          "position_source_label": "Guest Service Agent",
          "hire_date": "2026-06-01"
        },
        "rowFingerprint": "r1",
        "processingStatus": "valid",
        "proposedAction": "insert",
        "validationSummary": {}
      }],
      "issues": [],
      "sourceLabels": [{
        "resolutionType": "department",
        "sourceLabel": "Concierge",
        "normalizedSourceLabel": "concierge",
        "affectedRowCount": 1
      }, {
        "resolutionType": "position",
        "sourceLabel": "Guest Service Agent",
        "normalizedSourceLabel": "guest service agent",
        "affectedRowCount": 1
      }]
    }'::jsonb
  )$$,
  'property manager stages employee evidence through the guarded RPC'
);
select results_eq(
  $$select count(*) from public.import_sheets
    where import_batch_id='81000000-0000-0000-0000-000000000011'$$,
  array[1::bigint],
  'guarded staging persists the selected sheet'
);
select results_eq(
  $$select raw_values->>'Employee No' from public.import_source_rows
    where id='83000000-0000-0000-0000-000000000011'$$,
  array['0007'::text],
  'guarded staging preserves leading-zero source evidence'
);
select lives_ok(
  $$select public.resolve_employee_import_source_label(
    '81000000-0000-0000-0000-000000000011',
    1,
    'department',
    'Concierge',
    '61000000-0000-0000-0000-000000000013',
    'mapped'
  )$$,
  'manager resolves the staged department label through the guarded RPC'
);
select lives_ok(
  $$select public.resolve_employee_import_source_label(
    '81000000-0000-0000-0000-000000000011',
    2,
    'position',
    'Guest Service Agent',
    '65000000-0000-0000-0000-000000000013',
    'mapped'
  )$$,
  'manager resolves the staged position label through the guarded RPC'
);
select lives_ok($$select public.prepare_employee_import_preview('81000000-0000-0000-0000-000000000011',3,'{"statusTreatment":"retain_existing_set_additions_active"}')$$,'authorized preview classifies staging without employee writes');
select lives_ok($$select public.commit_employee_import('81000000-0000-0000-0000-000000000011',4)$$,'authorized commit RPC completes');
select results_eq($$select employee_number from public.employees where source_batch_id='81000000-0000-0000-0000-000000000011'$$,array['0007'::text],'leading zeros survive commit');
select results_eq($$select count(*) from public.import_commit_items where action='insert' and before_snapshot is null and after_snapshot is not null$$,array[1::bigint],'insert audit captures after snapshot');
select results_eq($$select inserted_employee_count from public.import_commits where import_batch_id='81000000-0000-0000-0000-000000000011'$$,array[1],'commit summary counts insert');
select results_eq($$select count(*) from public.employees where property_id='20000000-0000-0000-0000-000000000012'$$,array[0::bigint],'cross-property employee data is isolated');
select throws_ok($$update public.employees set property_id='20000000-0000-0000-0000-000000000012' where employee_number='0007'$$,'23514','EMPLOYEE_IDENTITY_IMMUTABLE: tenant, property and employee number cannot change','employee ownership is immutable');
select throws_ok($$update public.import_source_rows set raw_values='{}' where id='83000000-0000-0000-0000-000000000011'$$,'42501',null,'raw evidence mutation is revoked from the browser role');
select throws_ok($$insert into public.employees(tenant_id,property_id,employee_number,name_zh,department_id,position_id,source_system) values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','0007','另一示例','61000000-0000-0000-0000-000000000013','65000000-0000-0000-0000-000000000013','synthetic')$$,'23505',null,'employee number is unique in property');
select throws_ok($$insert into public.employees(tenant_id,property_id,employee_number,name_zh,department_id,position_id,source_system) values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000011','0099','错误范围','61000000-0000-0000-0000-000000000021','65000000-0000-0000-0000-000000000013','synthetic')$$,'23514','EMPLOYEE_ORGANIZATION_TARGET_INACTIVE','cross-property department is rejected by the authoritative organization guard');
select lives_ok($$insert into public.employee_external_identifiers(tenant_id,property_id,employee_id,source_system,identifier_type,identifier_value,is_primary) select tenant_id,property_id,id,'synthetic-lms','lms_employee_id','LMS-0007',true from public.employees where employee_number='0007'$$,'secondary identifier can be linked');
select throws_ok($$insert into public.employee_external_identifiers(tenant_id,property_id,employee_id,source_system,identifier_type,identifier_value) select tenant_id,property_id,id,'synthetic-lms','merlin_id','LMS-0007' from public.employees where employee_number='0007'$$,'23505',null,'external identifier uniqueness is enforced');
create temporary table employee_import_first_revert_preview on commit drop as
select public.preview_employee_import_revert('81000000-0000-0000-0000-000000000011') result;
select results_eq($$select (result->>'safe')::boolean from employee_import_first_revert_preview$$,array[true],'fresh completed batch has safe revert preview');
select results_eq($$select count(*) from public.employees where employee_number='0007' and is_active$$,array[1::bigint],'missing employee is not automatically deactivated');
select results_eq($$select identifier_value from public.employee_external_identifiers where identifier_type='local_employee_number' and employee_id=(select id from public.employees where employee_number='0007')$$,array['0007'::text],'local employee number is retained as an external audit identifier');
savepoint employee_import_unsafe_revert;
update public.employees set name_en='Later synthetic edit',version=version+1 where employee_number='0007';
select results_eq($$select (public.preview_employee_import_revert('81000000-0000-0000-0000-000000000011')->>'safe')::boolean$$,array[false],'later employee version change makes revert unsafe');
select throws_ok($$select public.revert_employee_import('81000000-0000-0000-0000-000000000011',(select result->>'token' from employee_import_first_revert_preview))$$,'P3011','IMPORT_REVERT_CONFLICT: later changes must be resolved first','unsafe revert is explicitly refused');
rollback to savepoint employee_import_unsafe_revert;
create temporary table employee_import_safe_revert_preview on commit drop as
select public.preview_employee_import_revert('81000000-0000-0000-0000-000000000011') result;
select lives_ok($$select public.revert_employee_import('81000000-0000-0000-0000-000000000011',(select result->>'token' from employee_import_safe_revert_preview))$$,'safe completed batch can be reverted');
select results_eq($$select count(*) from public.employees where employee_number='0007' and not is_active$$,array[1::bigint],'reverted insert is deactivated without erasing audit');
select throws_ok($$select public.revert_employee_import('81000000-0000-0000-0000-000000000011',(select result->>'token' from employee_import_safe_revert_preview))$$,'P3010','IMPORT_REVERT_NOT_ALLOWED','already reverted batch is rejected');
select throws_ok($$delete from public.employees where employee_number='0007'$$,'42501',null,'employee audit records cannot be destructively deleted through Data API');

reset role;
select results_eq($$select count(*) from pg_policies where schemaname='public' and tablename in ('employees','employee_external_identifiers','import_batches','import_sheets','import_source_rows','import_field_mappings','import_issues','import_resolution_rules','import_commits','import_commit_items') and (qual='true' or with_check='true')$$,array[0::bigint],'no broad private-data RLS policy');
select results_eq($$select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'import_files_manager_%'$$,array[2::bigint],'private storage allows manager read and first-write only');
select results_eq($$select count(*) from information_schema.routine_privileges where routine_schema='app_private' and routine_name in ('commit_employee_import','preview_employee_import_revert','revert_employee_import') and grantee in ('anon','authenticated')$$,array[0::bigint],'private commit functions are not directly executable');
select results_eq($$select count(*) from information_schema.routine_privileges where routine_schema='public' and routine_name in ('commit_employee_import','preview_employee_import_revert','revert_employee_import') and grantee in ('anon','PUBLIC')$$,array[0::bigint],'anonymous and PUBLIC cannot execute import commit or revert wrappers');
select results_eq($$select count(*) from public.import_commit_items where action='unchanged'$$,array[0::bigint],'unchanged rows do not mutate employees');
select results_eq($$select (commit_summary->>'training_history_imported')::boolean from public.import_commits limit 1$$,array[false],'training history is explicitly excluded');
select results_eq($$select (commit_summary->>'ctc_gtc_imported')::boolean from public.import_commits limit 1$$,array[false],'CTC and GTC facts are explicitly excluded');

select * from finish();
rollback;
