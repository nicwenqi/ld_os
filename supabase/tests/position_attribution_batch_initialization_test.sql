begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_column(
  'public', 'import_source_label_resolutions', 'decision_mode',
  'source position attribution preserves a business decision mode'
);
select has_table(
  'public', 'import_position_attribution_batch_previews',
  'batch attribution preview evidence has an isolated server-side store'
);
select has_table(
  'public', 'import_position_attribution_decision_events',
  'each confirmed source-position decision has an append-only audit detail record'
);
select has_function(
  'public', 'preview_employee_import_position_attribution_batch', array['uuid','bigint','jsonb'],
  'manager must obtain batch attribution evidence before confirming'
);
select has_function(
  'public', 'confirm_employee_import_position_attribution_batch', array['uuid','bigint','text'],
  'manager confirmation is a separate optimistic-lock operation'
);
select ok(
  has_function_privilege('authenticated', 'public.preview_employee_import_position_attribution_batch(uuid,bigint,jsonb)', 'EXECUTE'),
  'authenticated users can call the guarded preview boundary'
);
select ok(
  not has_function_privilege('anon', 'public.preview_employee_import_position_attribution_batch(uuid,bigint,jsonb)', 'EXECUTE'),
  'anonymous callers cannot preview attribution decisions'
);
select ok(
  not has_table_privilege('authenticated', 'public.import_position_attribution_batch_previews', 'SELECT'),
  'the browser cannot read server-side attribution previews directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.import_position_attribution_batch_previews', 'INSERT'),
  'the browser cannot forge attribution preview evidence'
);

reset role;
insert into public.user_accounts(
  id, user_id, auth_user_id, tenant_id, property_id, login_id, account_status, must_change_password
) values (
  '79000000-0000-0000-0000-00000000d801',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000103',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'position-batch-manager', 'active', false
) on conflict (user_id, property_id) do nothing;
insert into public.import_batches(
  id, tenant_id, property_id, source_system, original_filename, sanitized_filename,
  storage_object_path, file_checksum, file_size_bytes, mime_type, status, created_by
) values (
  '81000000-0000-0000-0000-00000000d801',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'test', 'positions.csv', 'positions.csv',
  '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-00000000d801/positions.csv',
  repeat('d',64), 10, 'text/csv', 'mapping_required', '00000000-0000-0000-0000-000000000103'
);
insert into public.import_source_label_resolutions(
  tenant_id, property_id, import_batch_id, resolution_type, source_label, normalized_source_label,
  affected_row_count, decision, decision_mode
) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '81000000-0000-0000-0000-00000000d801', 'position', 'Bell Attendant', 'bell attendant',
  6, 'pending', 'pending'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select throws_ok(
  $$select public.preview_employee_import_position_attribution_batch(
    '81000000-0000-0000-0000-00000000d801', 1,
    '[{"sourceValue":"Bell Attendant","action":"create","createDistinct":true}]'::jsonb
  )$$,
  '42501', 'IMPORT_MANAGER_REQUIRED',
  'platform identity cannot preview hotel position attribution'
);
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select throws_ok(
  $$select public.preview_employee_import_position_attribution_batch(
    '81000000-0000-0000-0000-00000000d801', 1,
    '[{"sourceValue":"Bell Attendant","action":"create","createDistinct":true}]'::jsonb
  )$$,
  '42501', 'IMPORT_MANAGER_REQUIRED',
  'department identity cannot batch-manage employee baseline attribution'
);
reset role;
insert into public.import_source_label_resolutions(
  tenant_id, property_id, import_batch_id, resolution_type, source_label, normalized_source_label,
  affected_row_count, decision, decision_mode
) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '81000000-0000-0000-0000-00000000d801', 'position', '前厅部经理',
  '前厅部经理', 2, 'pending', 'pending'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
create temporary table same_name_preview on commit drop as
select public.preview_employee_import_position_attribution_batch(
  '81000000-0000-0000-0000-00000000d801', 1,
  '[{"sourceValue":"前厅部经理","action":"create"}]'::jsonb
) result;
select results_eq(
  $$select result->'decisions'->0->>'status' from same_name_preview$$,
  $$values ('same_name_requires_choice'::text)$$,
  'same-name official positions require a manager choice instead of silent matching'
);
create temporary table position_batch_preview on commit drop as
select public.preview_employee_import_position_attribution_batch(
  '81000000-0000-0000-0000-00000000d801', 1,
  '[{"sourceValue":"Bell Attendant","action":"create","createDistinct":true}]'::jsonb
) result;
select results_eq(
  $$select count(*) from public.positions where property_id='20000000-0000-0000-0000-000000000011' and name_zh='Bell Attendant'$$,
  array[0::bigint],
  'preview is zero-write: it creates no official position'
);
select lives_ok(
  $$select public.confirm_employee_import_position_attribution_batch(
    '81000000-0000-0000-0000-00000000d801', 1,
    (select result->>'previewHash' from position_batch_preview)
  )$$,
  'manager can confirm the reviewed source-position creation decision'
);
reset role;
select results_eq(
  $$select decision, decision_mode, target_entity_type, target_entity_id is not null
      from public.import_source_label_resolutions
      where import_batch_id='81000000-0000-0000-0000-00000000d801' and source_label='Bell Attendant'$$,
  $$values ('mapped'::text,'create'::text,'position'::text,true)$$,
  'confirmation preserves mapped fact plus create decision mode'
);
select results_eq(
  $$select count(*) from public.import_position_attribution_decision_events
      where import_batch_id='81000000-0000-0000-0000-00000000d801' and decision_mode='create'$$,
  array[1::bigint],
  'confirmation writes an append-only detail audit record'
);
select results_eq(
  $$select count(*) from public.employee_fact_versions where source_batch_id='81000000-0000-0000-0000-00000000d801'$$,
  array[0::bigint],
  'batch attribution never creates an Employee Fact Version'
);
select * from finish();
rollback;
