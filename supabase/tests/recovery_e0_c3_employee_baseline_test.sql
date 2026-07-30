begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_function(
  'public',
  'commit_employee_import',
  array['uuid', 'bigint', 'text', 'boolean', 'text', 'uuid', 'boolean', 'text'],
  'C3 exposes an explicit classified-baseline commit signature'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.commit_employee_import(uuid,bigint,text,boolean)',
    'EXECUTE'
  ),
  'the former unclassified commit signature cannot bypass baseline approval'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.commit_employee_import(uuid,bigint,text,boolean,text,uuid,boolean,text)',
    'EXECUTE'
  ),
  'the classified commit is available only through the guarded authenticated boundary'
);

reset role;
insert into public.user_accounts(
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values (
  '79000000-0000-0000-0000-00000000c301',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000103',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'c3-baseline-manager',
  'active', false
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select lives_ok(
  $$insert into storage.objects(bucket_id,name,owner_id) values(
    'property-import-files',
    '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-00000000c301/c3-baseline.csv',
    auth.uid()
  )$$,
  'manager places the source workbook only in the private property path'
);
select lives_ok(
  $$select public.stage_employee_import(
    '20000000-0000-0000-0000-000000000011',
    '81000000-0000-0000-0000-00000000c301',
    '{
      "batch":{"originalFilename":"c3-baseline.csv","sanitizedFilename":"c3-baseline.csv","storageObjectPath":"10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-00000000c301/c3-baseline.csv","fileChecksum":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","fileSizeBytes":125,"mimeType":"text/csv","detectedSheetCount":1,"totalSourceRows":1,"validRows":1,"warningRows":0,"errorRows":0},
      "sheets":[{"id":"82000000-0000-0000-0000-00000000c301","name":"Employee Master","index":0,"headerRow":1,"rowCount":2,"selected":true,"purpose":"employee_master"}],
      "fieldMappings":[
        {"sheetId":"82000000-0000-0000-0000-00000000c301","sourceColumnName":"Employee No","sourceColumnIndex":0,"targetField":"employee_number","transformationRule":{"preserveLeadingZeros":true},"isRequired":true},
        {"sheetId":"82000000-0000-0000-0000-00000000c301","sourceColumnName":"Chinese Name","sourceColumnIndex":1,"targetField":"name_zh","transformationRule":{},"isRequired":true},
        {"sheetId":"82000000-0000-0000-0000-00000000c301","sourceColumnName":"Department","sourceColumnIndex":2,"targetField":"department_source_label","transformationRule":{},"isRequired":true},
        {"sheetId":"82000000-0000-0000-0000-00000000c301","sourceColumnName":"Position","sourceColumnIndex":3,"targetField":"position_source_label","transformationRule":{},"isRequired":true},
        {"sheetId":"82000000-0000-0000-0000-00000000c301","sourceColumnName":"Hire Date","sourceColumnIndex":4,"targetField":"hire_date","transformationRule":{},"isRequired":true}
      ],
      "rows":[{"id":"83000000-0000-0000-0000-00000000c301","sheetId":"82000000-0000-0000-0000-00000000c301","sourceRowNumber":2,"rawValues":{"Employee No":"000301","Chinese Name":"基线员工","Department":"Concierge","Position":"Guest Service Agent","Hire Date":"2026-07-01"},"normalizedValues":{"employee_number":"000301","name_zh":"基线员工","department_source_label":"Concierge","position_source_label":"Guest Service Agent","hire_date":"2026-07-01"},"rowFingerprint":"c3-row-1","processingStatus":"valid","proposedAction":"insert","validationSummary":{}}],
      "issues":[],
      "sourceLabels":[
        {"resolutionType":"department","sourceLabel":"Concierge","normalizedSourceLabel":"concierge","affectedRowCount":1},
        {"resolutionType":"position","sourceLabel":"Guest Service Agent","normalizedSourceLabel":"guest service agent","affectedRowCount":1}
      ]
    }'::jsonb
  )$$,
  'manager stages a private employee baseline through the guarded RPC'
);
select lives_ok(
  $$select public.resolve_employee_import_source_label(
    '81000000-0000-0000-0000-00000000c301',1,'department','Concierge',
    '61000000-0000-0000-0000-000000000013','mapped'
  )$$,
  'manager explicitly resolves the baseline department'
);
select lives_ok(
  $$select public.resolve_employee_import_source_label(
    '81000000-0000-0000-0000-00000000c301',2,'position','Guest Service Agent',
    '65000000-0000-0000-0000-000000000012','mapped'
  )$$,
  'manager explicitly resolves the baseline position'
);
create temporary table c3_preview on commit drop as
select public.prepare_employee_import_preview(
  '81000000-0000-0000-0000-00000000c301',3,
  jsonb_build_object('statusTreatment','retain_existing_set_additions_active','effectiveDate','2026-07-30')
) result;
select results_eq(
  $$select (result->>'additions')::integer, result->>'previewHash' is not null from c3_preview$$,
  $$values (1::integer,true)$$,
  'zero-write preview binds the exact employee impact before baseline approval'
);
select results_eq(
  $$select count(*) from public.employees where source_batch_id='81000000-0000-0000-0000-00000000c301'$$,
  array[0::bigint],
  'no employee or Employee Fact Version is written before explicit baseline approval'
);
select throws_ok(
  $$select public.commit_employee_import(
    '81000000-0000-0000-0000-00000000c301',4,
    (select result->>'previewHash' from c3_preview),true,
    'full','61000000-0000-0000-0000-000000000013',true,'不能伪装为完整基线'
  )$$,
  'P3020','EMPLOYEE_BASELINE_FULL_MUST_NOT_BE_LIMITED',
  'Full baseline cannot hide a scope or limitation'
);
select results_eq(
  $$select count(*) from public.employees where source_batch_id='81000000-0000-0000-0000-00000000c301'$$,
  array[0::bigint],
  'invalid classification rolls back without an employee write'
);
create temporary table c3_commit on commit drop as
select public.commit_employee_import(
  '81000000-0000-0000-0000-00000000c301',4,
  (select result->>'previewHash' from c3_preview),true,
  'pilot_limited','61000000-0000-0000-0000-000000000013',true,'仅限已确认的 Concierge 试运行范围'
) commit_id;
select results_eq(
  $$select
      commit_record.approval_evidence->'baseline'->>'state',
      commit_record.approval_evidence->'baseline'->>'departmentId',
      (commit_record.approval_evidence->'baseline'->>'includeDescendants')::boolean,
      commit_record.approval_evidence->'baseline'->>'limitations',
      (commit_record.approval_evidence->'baseline'->>'approvedAt') is not null
    from public.import_commits commit_record
    where commit_record.import_batch_id='81000000-0000-0000-0000-00000000c301'$$,
  $$values ('pilot_limited'::text,'61000000-0000-0000-0000-000000000013'::text,true,'仅限已确认的 Concierge 试运行范围'::text,true)$$,
  'commit retains approved baseline boundary in immutable approval evidence'
);
select results_eq(
  $$select employee.employee_number, fact.source_type, fact.effective_date
    from public.employees employee
    join public.employee_fact_versions fact on fact.employee_id=employee.id
    where employee.source_batch_id='81000000-0000-0000-0000-00000000c301'$$,
  $$values ('000301'::text,'import_commit'::text,'2026-07-30'::date)$$,
  'classified commit creates the ordinary D0 Employee Fact Version without changing its meaning'
);
select results_eq(
  $$select count(*) from public.user_accounts where login_id='000301'$$,
  array[0::bigint],
  'employee baseline creates no employee backend account'
);
select results_eq(
  $$select public.commit_employee_import(
    '81000000-0000-0000-0000-00000000c301',4,
    (select result->>'previewHash' from c3_preview),true,
    'pilot_limited','61000000-0000-0000-0000-000000000013',true,'仅限已确认的 Concierge 试运行范围'
  )$$,
  $$select commit_id from c3_commit$$,
  'same approval evidence is safely idempotent'
);
select throws_ok(
  $$select public.commit_employee_import(
    '81000000-0000-0000-0000-00000000c301',4,
    (select result->>'previewHash' from c3_preview),true,
    'restricted',null,false,'改变已审批的基线说明'
  )$$,
  'P3001','IMPORT_APPROVAL_EVIDENCE_MISMATCH',
  'a retry cannot rewrite approved baseline evidence'
);

select * from finish();
rollback;
