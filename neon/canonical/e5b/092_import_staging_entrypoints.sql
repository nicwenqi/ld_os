begin;
set local role hotel_ld_migration_owner;
set local check_function_bodies = off;

-- E5B evidence is sealed with SHA-256. pgcrypto is an infrastructure
-- extension, not a Supabase compatibility schema, and is required by the
-- canonical empty-database bootstrap before any staging function can run.
create extension if not exists pgcrypto with schema public;

create function app_private.neon_import_staging_lock_key(p_batch_id uuid)
returns bigint language sql immutable security invoker set search_path = ''
as $function$
  select pg_catalog.hashtextextended(p_batch_id::text, 905);
$function$;

create function app_private.assert_neon_import_staging_guard(p_batch_id uuid)
returns void language plpgsql volatile security invoker set search_path = ''
as $function$
declare
  v_guard text;
begin
  v_guard := pg_catalog.current_setting('app.e5b_import_staging_batch_id', true);
  if v_guard is distinct from p_batch_id::text
    or not pg_catalog.pg_try_advisory_xact_lock(app_private.neon_import_staging_lock_key(p_batch_id)) then
    raise exception using errcode = '42501', message = 'NEON_IMPORT_STAGING_TRANSACTION_REQUIRED';
  end if;
  if not exists (
    select 1 from public.import_batches batch
    where batch.id = p_batch_id
      and batch.property_id = app_private.current_actor_property_id()
      and batch.workbook_lifecycle = 'inspecting'
      and batch.storage_lifecycle = 'verified'
      and batch.verification_status = 'passed'
  ) then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_STAGING_STATE_INVALID';
  end if;
end
$function$;

create function app_private.assert_neon_import_json_array(
  p_payload jsonb,
  p_max_records integer,
  p_max_bytes integer
)
returns void language plpgsql immutable security invoker set search_path = ''
as $function$
begin
  if p_payload is null
    or pg_catalog.jsonb_typeof(p_payload) <> 'array'
    or pg_catalog.jsonb_array_length(p_payload) not between 1 and p_max_records
    or pg_catalog.pg_column_size(p_payload) > p_max_bytes
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_payload) value
      where pg_catalog.jsonb_typeof(value) <> 'object'
    ) then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_STAGING_CHUNK_INVALID';
  end if;
end
$function$;

create function app_private.neon_import_json_keys_allowed(
  p_object jsonb,
  p_allowed text[]
)
returns boolean language sql immutable security invoker set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_object) = 'object'
    and not exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_object) key
      where not (key = any(p_allowed))
    );
$function$;

create function app_private.neon_import_sha256(p_value text)
returns text language sql immutable security invoker set search_path = ''
as $function$
  select pg_catalog.encode(public.digest(pg_catalog.convert_to(p_value, 'UTF8'), 'sha256'), 'hex');
$function$;

create function app_private.neon_import_source_row_fingerprint(p_raw_values jsonb)
returns text language sql immutable security invoker set search_path = ''
as $function$
  select app_private.neon_import_sha256(
    pg_catalog.coalesce((
      select pg_catalog.jsonb_agg(value order by value->>'sourceColumnName', value->>'targetField')::text
      from pg_catalog.jsonb_array_elements(p_raw_values) value
    ), '[]')
  );
$function$;

create function app_private.neon_import_staging_manifest(p_batch_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'algorithm', 'e5b-canonical-json-sha256-v1',
    'batch', pg_catalog.jsonb_build_object(
      'id', batch.id,
      'detectedSheetCount', batch.detected_sheet_count,
      'totalSourceRows', batch.total_source_rows,
      'validRows', batch.valid_rows,
      'warningRows', batch.warning_rows,
      'errorRows', batch.error_rows,
      'selectedSheetId', batch.selected_sheet_id
    ),
    'sheets', pg_catalog.coalesce((
      select pg_catalog.jsonb_agg(app_private.neon_import_sha256(
        pg_catalog.jsonb_build_object(
          'id', sheet.id, 'name', sheet.sheet_name, 'index', sheet.sheet_index,
          'headerRow', sheet.header_row, 'rowCount', sheet.row_count,
          'columnCount', sheet.column_count, 'hidden', sheet.is_hidden,
          'selected', sheet.is_selected, 'purpose', sheet.purpose
        )::text
      ) order by sheet.sheet_index, sheet.id)
      from public.import_sheets sheet where sheet.batch_id = batch.id
    ), '[]'::jsonb),
    'fieldMappings', pg_catalog.coalesce((
      select pg_catalog.jsonb_agg(app_private.neon_import_sha256(
        pg_catalog.jsonb_build_object(
          'sheetId', mapping.sheet_id, 'sourceColumnName', mapping.source_column_name,
          'sourceColumnIndex', mapping.source_column_index, 'targetField', mapping.target_field,
          'transformationRule', mapping.transformation_rule, 'isRequired', mapping.is_required,
          'mappingStatus', mapping.mapping_status
        )::text
      ) order by mapping.sheet_id, mapping.source_column_index, mapping.id)
      from public.import_field_mappings mapping where mapping.batch_id = batch.id
    ), '[]'::jsonb),
    'sourceRows', pg_catalog.coalesce((
      select pg_catalog.jsonb_agg(app_private.neon_import_sha256(
        pg_catalog.jsonb_build_object(
          'id', row.id, 'sheetId', row.sheet_id, 'sourceRowNumber', row.source_row_number,
          'rawValues', row.raw_values, 'normalizedValues', row.normalized_values,
          'rowFingerprint', row.row_fingerprint, 'processingStatus', row.processing_status,
          'proposedAction', row.proposed_action, 'validationSummary', row.validation_summary
        )::text
      ) order by row.sheet_id, row.source_row_number, row.id)
      from public.import_source_rows row where row.batch_id = batch.id
    ), '[]'::jsonb),
    'issues', pg_catalog.coalesce((
      select pg_catalog.jsonb_agg(app_private.neon_import_sha256(
        pg_catalog.jsonb_build_object(
          'sourceRowId', issue.source_row_id, 'issueType', issue.issue_type,
          'severity', issue.severity, 'sourceField', issue.source_field,
          'sourceValueProjection', issue.source_value_projection, 'message', issue.message,
          'resolutionStatus', issue.resolution_status
        )::text
      ) order by issue.source_row_id nulls first, issue.issue_type, issue.id)
      from public.import_issues issue where issue.batch_id = batch.id
    ), '[]'::jsonb),
    'sourceLabels', pg_catalog.coalesce((
      select pg_catalog.jsonb_agg(app_private.neon_import_sha256(
        pg_catalog.jsonb_build_object(
          'sheetId', label.sheet_id, 'resolutionType', label.resolution_type,
          'sourceLabel', label.source_label, 'normalizedSourceLabel', label.normalized_source_label,
          'affectedRowCount', label.affected_row_count, 'resolutionStatus', label.resolution_status
        )::text
      ) order by label.resolution_type, label.sheet_id, label.normalized_source_label, label.id)
      from public.import_source_label_resolutions label where label.batch_id = batch.id
    ), '[]'::jsonb)
  )
  from public.import_batches batch
  where batch.id = p_batch_id
    and batch.property_id = app_private.current_actor_property_id();
$function$;

create function app_private.neon_import_staging_manifest_sha256(p_batch_id uuid)
returns text language sql stable security invoker set search_path = ''
as $function$
  select app_private.neon_import_sha256(app_private.neon_import_staging_manifest(p_batch_id)::text);
$function$;

create function public.begin_neon_import_staging(
  p_hostname text,
  p_batch_id uuid,
  p_expected_version bigint,
  p_batch_evidence jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_batch public.import_batches%rowtype;
  v_selected_sheet_id uuid;
begin
  perform 1 from app_private.assert_neon_import_manager(p_hostname);
  if p_expected_version is null
    or p_batch_evidence is null
    or not app_private.neon_import_json_keys_allowed(p_batch_evidence, array[
      'detectedSheetCount', 'totalSourceRows', 'validRows', 'warningRows', 'errorRows', 'selectedSheetId'
    ])
    or not (p_batch_evidence ?& array[
      'detectedSheetCount', 'totalSourceRows', 'validRows', 'warningRows', 'errorRows', 'selectedSheetId'
    ])
    or pg_catalog.jsonb_typeof(p_batch_evidence->'detectedSheetCount') <> 'number'
    or pg_catalog.jsonb_typeof(p_batch_evidence->'totalSourceRows') <> 'number'
    or pg_catalog.jsonb_typeof(p_batch_evidence->'validRows') <> 'number'
    or pg_catalog.jsonb_typeof(p_batch_evidence->'warningRows') <> 'number'
    or pg_catalog.jsonb_typeof(p_batch_evidence->'errorRows') <> 'number'
    or pg_catalog.jsonb_typeof(p_batch_evidence->'selectedSheetId') <> 'string' then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_STAGING_BATCH_EVIDENCE_INVALID';
  end if;
  begin
    v_selected_sheet_id := (p_batch_evidence->>'selectedSheetId')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_STAGING_BATCH_EVIDENCE_INVALID';
  end;
  if (p_batch_evidence->>'detectedSheetCount')::integer < 1
    or (p_batch_evidence->>'totalSourceRows')::integer < 0
    or (p_batch_evidence->>'validRows')::integer < 0
    or (p_batch_evidence->>'warningRows')::integer < 0
    or (p_batch_evidence->>'errorRows')::integer < 0
    or (p_batch_evidence->>'validRows')::integer
      + (p_batch_evidence->>'warningRows')::integer
      + (p_batch_evidence->>'errorRows')::integer <> (p_batch_evidence->>'totalSourceRows')::integer then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_STAGING_BATCH_EVIDENCE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(app_private.neon_import_staging_lock_key(p_batch_id));
  select batch.* into v_batch from public.import_batches batch
  where batch.id = p_batch_id and batch.property_id = app_private.current_actor_property_id()
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'NEON_IMPORT_BATCH_NOT_FOUND'; end if;
  if v_batch.version <> p_expected_version then raise exception using errcode = '40001', message = 'NEON_IMPORT_BATCH_STALE'; end if;
  if v_batch.storage_lifecycle <> 'verified'
    or v_batch.verification_status <> 'passed'
    or v_batch.workbook_lifecycle <> 'intent_created' then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_STAGING_STATE_INVALID';
  end if;
  if exists (select 1 from public.import_sheets sheet where sheet.batch_id = p_batch_id) then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_STAGING_EVIDENCE_ALREADY_EXISTS';
  end if;

  perform pg_catalog.set_config('app.e5b_import_staging_batch_id', p_batch_id::text, true);
  update public.import_batches
  set detected_sheet_count = (p_batch_evidence->>'detectedSheetCount')::integer,
      total_source_rows = (p_batch_evidence->>'totalSourceRows')::integer,
      valid_rows = (p_batch_evidence->>'validRows')::integer,
      warning_rows = (p_batch_evidence->>'warningRows')::integer,
      error_rows = (p_batch_evidence->>'errorRows')::integer,
      selected_sheet_id = v_selected_sheet_id,
      workbook_lifecycle = 'inspecting'
  where id = p_batch_id and property_id = app_private.current_actor_property_id();
  perform app_private.append_neon_import_activity(p_batch_id, 'staging_started', v_batch.storage_lifecycle, v_batch.workbook_lifecycle, pg_catalog.jsonb_build_object('expected_version', p_expected_version));
  return app_private.neon_import_saga_state(p_batch_id);
end
$function$;

create function public.append_neon_import_sheets(p_hostname text, p_batch_id uuid, p_chunk jsonb)
returns void language plpgsql volatile security definer set search_path = ''
as $function$
declare v_count integer; v_distinct integer;
begin
  perform 1 from app_private.assert_neon_import_manager(p_hostname);
  perform app_private.assert_neon_import_staging_guard(p_batch_id);
  perform app_private.assert_neon_import_json_array(p_chunk, 250, 524288);
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_chunk) value where not app_private.neon_import_json_keys_allowed(value, array['id','name','index','headerRow','rowCount','columnCount','hidden','selected','purpose']) or not (value ?& array['id','name','index','headerRow','rowCount','columnCount','hidden','selected','purpose'])) then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_STAGING_CHUNK_INVALID';
  end if;
  select count(*), count(distinct value->>'id') into v_count, v_distinct from pg_catalog.jsonb_array_elements(p_chunk) value;
  if v_count <> v_distinct or exists (select 1 from public.import_sheets sheet join pg_catalog.jsonb_array_elements(p_chunk) value on value->>'id' = sheet.id::text where sheet.batch_id <> p_batch_id) then raise exception using errcode = '22023', message = 'NEON_IMPORT_STAGING_CHUNK_INVALID'; end if;
  insert into public.import_sheets(id,tenant_id,property_id,batch_id,sheet_name,sheet_index,header_row,row_count,column_count,is_hidden,is_selected,purpose)
  select (value->>'id')::uuid, batch.tenant_id,batch.property_id,batch.id,pg_catalog.btrim(value->>'name'),(value->>'index')::integer,nullif(value->>'headerRow','')::integer,(value->>'rowCount')::integer,(value->>'columnCount')::integer,(value->>'hidden')::boolean,(value->>'selected')::boolean,(value->>'purpose')::public.import_sheet_purpose
  from pg_catalog.jsonb_array_elements(p_chunk) value join public.import_batches batch on batch.id=p_batch_id and batch.property_id=app_private.current_actor_property_id();
end
$function$;

create function public.append_neon_import_field_mappings(p_hostname text, p_batch_id uuid, p_chunk jsonb)
returns void language plpgsql volatile security definer set search_path = ''
as $function$
declare v_count integer; v_distinct integer; v_allowed text[]:=array['employee_number','name_zh','name_en','department_source_label','position_source_label','grade_or_band','hire_date','probation_or_confirmation_date','employment_status'];
begin
  perform 1 from app_private.assert_neon_import_manager(p_hostname); perform app_private.assert_neon_import_staging_guard(p_batch_id); perform app_private.assert_neon_import_json_array(p_chunk,250,524288);
  if exists(select 1 from public.import_source_rows row where row.batch_id=p_batch_id) or exists(select 1 from pg_catalog.jsonb_array_elements(p_chunk) value where not app_private.neon_import_json_keys_allowed(value,array['id','sheetId','sourceColumnName','sourceColumnIndex','targetField','transformationRule','isRequired','mappingStatus']) or not (value ?& array['id','sheetId','sourceColumnName','sourceColumnIndex','targetField','transformationRule','isRequired','mappingStatus']) or pg_catalog.jsonb_typeof(value->'transformationRule')<>'object' or pg_catalog.jsonb_typeof(value->'isRequired')<>'boolean' or pg_catalog.jsonb_typeof(value->'mappingStatus')<>'string' or value->>'mappingStatus' not in ('suggested','excluded') or (value->>'targetField' is not null and value->>'targetField' <> all(v_allowed))) then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_CHUNK_INVALID'; end if;
  select count(*),count(distinct value->>'id') into v_count,v_distinct from pg_catalog.jsonb_array_elements(p_chunk) value; if v_count<>v_distinct then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_CHUNK_INVALID';end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_chunk) value left join public.import_sheets sheet on sheet.id=(value->>'sheetId')::uuid and sheet.batch_id=p_batch_id and sheet.property_id=app_private.current_actor_property_id() where sheet.id is null) then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_SHEET_SCOPE_INVALID';end if;
  insert into public.import_field_mappings(id,tenant_id,property_id,batch_id,sheet_id,source_column_name,source_column_index,target_field,transformation_rule,is_required,mapping_status)
  select (value->>'id')::uuid,batch.tenant_id,batch.property_id,batch.id,(value->>'sheetId')::uuid,pg_catalog.btrim(value->>'sourceColumnName'),(value->>'sourceColumnIndex')::integer,nullif(value->>'targetField',''),value->'transformationRule',(value->>'isRequired')::boolean,(value->>'mappingStatus')::public.import_field_mapping_status from pg_catalog.jsonb_array_elements(p_chunk)value join public.import_batches batch on batch.id=p_batch_id and batch.property_id=app_private.current_actor_property_id();
end
$function$;

create function public.append_neon_import_source_rows(p_hostname text, p_batch_id uuid, p_chunk jsonb)
returns void language plpgsql volatile security definer set search_path = ''
as $function$
declare v_count integer; v_distinct integer; v_allowed text[]:=array['employee_number','name_zh','name_en','department_source_label','position_source_label','grade_or_band','hire_date','probation_or_confirmation_date','employment_status'];
begin
  perform 1 from app_private.assert_neon_import_manager(p_hostname); perform app_private.assert_neon_import_staging_guard(p_batch_id); perform app_private.assert_neon_import_json_array(p_chunk,250,1048576);
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_chunk)value where not app_private.neon_import_json_keys_allowed(value,array['id','sheetId','sourceRowNumber','rawValues','normalizedValues','rowFingerprint','processingStatus','proposedAction','validationSummary']) or not (value ?& array['id','sheetId','sourceRowNumber','rawValues','normalizedValues','rowFingerprint','processingStatus','proposedAction','validationSummary']) or pg_catalog.jsonb_typeof(value->'rawValues')<>'array' or pg_catalog.jsonb_typeof(value->'normalizedValues')<>'object' or pg_catalog.jsonb_typeof(value->'validationSummary')<>'object' or value->>'processingStatus' not in ('staged','warning','error') or value->>'proposedAction'<>'unresolved' or value->>'rowFingerprint' !~ '^[0-9a-f]{64}$' or exists(select 1 from pg_catalog.jsonb_object_keys(value->'normalizedValues') key where key <> all(v_allowed)) or exists(select 1 from pg_catalog.jsonb_array_elements(value->'rawValues') cell where not app_private.neon_import_json_keys_allowed(cell,array['sourceColumnName','targetField','value']) or not(cell ?& array['sourceColumnName','targetField','value']) or cell->>'targetField' <> all(v_allowed))) then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_CHUNK_INVALID';end if;
  select count(*),count(distinct value->>'id') into v_count,v_distinct from pg_catalog.jsonb_array_elements(p_chunk)value; if v_count<>v_distinct then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_CHUNK_INVALID';end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_chunk)value left join public.import_sheets sheet on sheet.id=(value->>'sheetId')::uuid and sheet.batch_id=p_batch_id and sheet.property_id=app_private.current_actor_property_id() left join public.import_field_mappings mapping on mapping.batch_id=p_batch_id and mapping.sheet_id=(value->>'sheetId')::uuid where sheet.id is null or not sheet.is_selected or mapping.id is null) then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_SHEET_SCOPE_INVALID';end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_chunk)value where value->>'rowFingerprint' <> app_private.neon_import_source_row_fingerprint(value->'rawValues')) then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_ROW_FINGERPRINT_INVALID';end if;
  insert into public.import_source_rows(id,tenant_id,property_id,batch_id,sheet_id,source_row_number,raw_values,normalized_values,row_fingerprint,processing_status,proposed_action,validation_summary)
  select (value->>'id')::uuid,batch.tenant_id,batch.property_id,batch.id,(value->>'sheetId')::uuid,(value->>'sourceRowNumber')::integer,value->'rawValues',value->'normalizedValues',value->>'rowFingerprint',(value->>'processingStatus')::public.import_source_row_status,'unresolved',value->'validationSummary' from pg_catalog.jsonb_array_elements(p_chunk)value join public.import_batches batch on batch.id=p_batch_id and batch.property_id=app_private.current_actor_property_id();
end
$function$;

create function public.append_neon_import_issues(p_hostname text,p_batch_id uuid,p_chunk jsonb)
returns void language plpgsql volatile security definer set search_path = ''
as $function$
declare v_count integer; v_distinct integer;
begin
  perform 1 from app_private.assert_neon_import_manager(p_hostname); perform app_private.assert_neon_import_staging_guard(p_batch_id); perform app_private.assert_neon_import_json_array(p_chunk,250,524288);
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_chunk)value where not app_private.neon_import_json_keys_allowed(value,array['id','sourceRowId','issueType','severity','message']) or not(value ?& array['id','sourceRowId','issueType','severity','message']) or value->>'severity' not in ('warning','error')) then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_CHUNK_INVALID';end if;
  select count(*),count(distinct value->>'id') into v_count,v_distinct from pg_catalog.jsonb_array_elements(p_chunk)value; if v_count<>v_distinct then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_CHUNK_INVALID';end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_chunk)value left join public.import_source_rows row on row.id=(value->>'sourceRowId')::uuid and row.batch_id=p_batch_id and row.property_id=app_private.current_actor_property_id() where row.id is null) then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_ROW_SCOPE_INVALID';end if;
  insert into public.import_issues(id,tenant_id,property_id,batch_id,source_row_id,issue_type,severity,message)
  select (value->>'id')::uuid,batch.tenant_id,batch.property_id,batch.id,(value->>'sourceRowId')::uuid,pg_catalog.btrim(value->>'issueType'),(value->>'severity')::public.import_issue_severity,pg_catalog.btrim(value->>'message') from pg_catalog.jsonb_array_elements(p_chunk)value join public.import_batches batch on batch.id=p_batch_id and batch.property_id=app_private.current_actor_property_id();
end
$function$;

create function public.append_neon_import_source_labels(p_hostname text,p_batch_id uuid,p_chunk jsonb)
returns void language plpgsql volatile security definer set search_path = ''
as $function$
declare v_count integer; v_distinct integer;
begin
  perform 1 from app_private.assert_neon_import_manager(p_hostname); perform app_private.assert_neon_import_staging_guard(p_batch_id); perform app_private.assert_neon_import_json_array(p_chunk,250,524288);
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_chunk)value where not app_private.neon_import_json_keys_allowed(value,array['resolutionType','sourceLabel','normalizedSourceLabel','sourceSheet','affectedRowCount']) or not(value ?& array['resolutionType','sourceLabel','normalizedSourceLabel','sourceSheet','affectedRowCount']) or value->>'resolutionType' not in ('department','position')) then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_CHUNK_INVALID';end if;
  select count(*),count(distinct (value->>'resolutionType'||'|'||value->>'sourceSheet'||'|'||value->>'normalizedSourceLabel')) into v_count,v_distinct from pg_catalog.jsonb_array_elements(p_chunk)value; if v_count<>v_distinct then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_CHUNK_INVALID';end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_chunk)value left join public.import_sheets sheet on sheet.sheet_name=value->>'sourceSheet' and sheet.batch_id=p_batch_id and sheet.property_id=app_private.current_actor_property_id() where sheet.id is null) then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_SHEET_SCOPE_INVALID';end if;
  insert into public.import_source_label_resolutions(id,tenant_id,property_id,batch_id,sheet_id,resolution_type,source_label,normalized_source_label,affected_row_count,resolution_status)
  select pg_catalog.gen_random_uuid(),batch.tenant_id,batch.property_id,batch.id,sheet.id,(value->>'resolutionType')::public.import_source_label_type,pg_catalog.btrim(value->>'sourceLabel'),pg_catalog.btrim(value->>'normalizedSourceLabel'),(value->>'affectedRowCount')::integer,'pending' from pg_catalog.jsonb_array_elements(p_chunk)value join public.import_batches batch on batch.id=p_batch_id and batch.property_id=app_private.current_actor_property_id() join public.import_sheets sheet on sheet.batch_id=batch.id and sheet.sheet_name=value->>'sourceSheet';
end
$function$;

create function public.finalize_neon_import_staging(p_hostname text,p_batch_id uuid,p_expected_version bigint,p_evidence_manifest jsonb,p_evidence_sha256 text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_batch public.import_batches%rowtype; v_manifest jsonb; v_evidence_sha256 text; v_total integer; v_valid integer; v_warning integer; v_error integer; v_labels integer;
begin
  perform 1 from app_private.assert_neon_import_manager(p_hostname); perform app_private.assert_neon_import_staging_guard(p_batch_id);
  select batch.* into v_batch from public.import_batches batch where batch.id=p_batch_id and batch.property_id=app_private.current_actor_property_id() for update;
  if not found then raise exception using errcode='P0002',message='NEON_IMPORT_BATCH_NOT_FOUND';end if;
  if p_expected_version is null or v_batch.version <> p_expected_version then raise exception using errcode='40001',message='NEON_IMPORT_BATCH_STALE';end if;
  if v_batch.storage_lifecycle<>'verified' or v_batch.verification_status<>'passed' or v_batch.workbook_lifecycle<>'inspecting' or p_evidence_sha256 !~ '^[0-9a-f]{64}$' or pg_catalog.jsonb_typeof(p_evidence_manifest)<>'object' then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_FINALIZE_INVALID';end if;
  select count(*),count(*)filter(where processing_status='staged'),count(*)filter(where processing_status='warning'),count(*)filter(where processing_status='error') into v_total,v_valid,v_warning,v_error from public.import_source_rows where batch_id=p_batch_id;
  if v_total<>v_batch.total_source_rows or v_valid<>v_batch.valid_rows or v_warning<>v_batch.warning_rows or v_error<>v_batch.error_rows or (select count(*) from public.import_sheets where batch_id=p_batch_id)<>v_batch.detected_sheet_count or (select count(*) from public.import_sheets where batch_id=p_batch_id and id=v_batch.selected_sheet_id and is_selected and purpose='employee_master')<>1 then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_COUNT_OR_SELECTION_INVALID';end if;
  if exists(select 1 from public.import_source_rows row where row.batch_id=p_batch_id and row.row_fingerprint<>app_private.neon_import_source_row_fingerprint(row.raw_values)) then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_ROW_FINGERPRINT_INVALID';end if;
  if exists(select 1 from public.import_source_rows row left join public.import_field_mappings mapping on mapping.batch_id=row.batch_id and mapping.sheet_id=row.sheet_id where row.batch_id=p_batch_id and mapping.id is null)
    or exists(select 1 from public.import_source_rows row cross join lateral pg_catalog.jsonb_array_elements(row.raw_values) cell left join public.import_field_mappings mapping on mapping.batch_id=row.batch_id and mapping.sheet_id=row.sheet_id and mapping.source_column_name=cell->>'sourceColumnName' and mapping.target_field=cell->>'targetField' where row.batch_id=p_batch_id and mapping.id is null) then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_MAPPING_ROW_DRIFT';end if;
  if exists(select 1 from public.import_source_label_resolutions label where label.batch_id=p_batch_id and label.resolution_status<>'pending') then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_SOURCE_LABEL_SCOPE_INVALID';end if;
  if exists(select 1 from public.import_source_label_resolutions label join public.import_sheets sheet on sheet.id=label.sheet_id where label.batch_id=p_batch_id and label.affected_row_count<>(select count(*) from public.import_source_rows row where row.batch_id=p_batch_id and row.sheet_id=label.sheet_id and pg_catalog.lower(pg_catalog.btrim(row.normalized_values->>case label.resolution_type when 'department' then 'department_source_label' else 'position_source_label' end))=label.normalized_source_label)) then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_SOURCE_LABEL_FINGERPRINT_INVALID';end if;
  if exists(select 1 from public.import_source_rows row cross join lateral (values ('department'::public.import_source_label_type,'department_source_label'),('position'::public.import_source_label_type,'position_source_label')) expected(resolution_type,field_name) where row.batch_id=p_batch_id and nullif(pg_catalog.btrim(row.normalized_values->>expected.field_name),'') is not null and not exists(select 1 from public.import_source_label_resolutions label where label.batch_id=p_batch_id and label.sheet_id=row.sheet_id and label.resolution_type=expected.resolution_type and label.normalized_source_label=pg_catalog.lower(pg_catalog.btrim(row.normalized_values->>expected.field_name))) then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_SOURCE_LABEL_FINGERPRINT_INVALID';end if;
  v_manifest:=app_private.neon_import_staging_manifest(p_batch_id); v_evidence_sha256:=app_private.neon_import_staging_manifest_sha256(p_batch_id);
  if p_evidence_manifest <> v_manifest or p_evidence_sha256 <> v_evidence_sha256 then raise exception using errcode='22023',message='NEON_IMPORT_STAGING_EVIDENCE_MANIFEST_MISMATCH';end if;
  update public.import_batches set storage_lifecycle='linked',workbook_lifecycle='mapping_required',sealed_evidence_sha256=v_evidence_sha256,linked_at=pg_catalog.transaction_timestamp(),version=v_batch.version+1 where id=p_batch_id and property_id=app_private.current_actor_property_id();
  perform app_private.append_neon_import_activity(p_batch_id,'staging_finalized',v_batch.storage_lifecycle,v_batch.workbook_lifecycle,pg_catalog.jsonb_build_object('evidence_sha256',v_evidence_sha256,'total_rows',v_total));
  perform pg_catalog.set_config('app.e5b_import_staging_batch_id','',true);
  return app_private.neon_import_saga_state(p_batch_id);
end
$function$;

alter function app_private.neon_import_staging_lock_key(uuid) owner to hotel_ld_migration_owner;
alter function app_private.assert_neon_import_staging_guard(uuid) owner to hotel_ld_migration_owner;
alter function app_private.assert_neon_import_json_array(jsonb,integer,integer) owner to hotel_ld_migration_owner;
alter function app_private.neon_import_json_keys_allowed(jsonb,text[]) owner to hotel_ld_migration_owner;
alter function app_private.neon_import_sha256(text) owner to hotel_ld_migration_owner;
alter function app_private.neon_import_source_row_fingerprint(jsonb) owner to hotel_ld_migration_owner;
alter function app_private.neon_import_staging_manifest(uuid) owner to hotel_ld_migration_owner;
alter function app_private.neon_import_staging_manifest_sha256(uuid) owner to hotel_ld_migration_owner;
alter function public.begin_neon_import_staging(text,uuid,bigint,jsonb) owner to hotel_ld_migration_owner;
alter function public.append_neon_import_sheets(text,uuid,jsonb) owner to hotel_ld_migration_owner;
alter function public.append_neon_import_field_mappings(text,uuid,jsonb) owner to hotel_ld_migration_owner;
alter function public.append_neon_import_source_rows(text,uuid,jsonb) owner to hotel_ld_migration_owner;
alter function public.append_neon_import_issues(text,uuid,jsonb) owner to hotel_ld_migration_owner;
alter function public.append_neon_import_source_labels(text,uuid,jsonb) owner to hotel_ld_migration_owner;
alter function public.finalize_neon_import_staging(text,uuid,bigint,jsonb,text) owner to hotel_ld_migration_owner;

revoke all on function app_private.neon_import_staging_lock_key(uuid) from public;
revoke all on function app_private.assert_neon_import_staging_guard(uuid) from public;
revoke all on function app_private.assert_neon_import_json_array(jsonb,integer,integer) from public;
revoke all on function app_private.neon_import_json_keys_allowed(jsonb,text[]) from public;
revoke all on function app_private.neon_import_sha256(text) from public;
revoke all on function app_private.neon_import_source_row_fingerprint(jsonb) from public;
revoke all on function app_private.neon_import_staging_manifest(uuid) from public;
revoke all on function app_private.neon_import_staging_manifest_sha256(uuid) from public;
revoke all on function public.begin_neon_import_staging(text,uuid,bigint,jsonb) from public;
revoke all on function public.append_neon_import_sheets(text,uuid,jsonb) from public;
revoke all on function public.append_neon_import_field_mappings(text,uuid,jsonb) from public;
revoke all on function public.append_neon_import_source_rows(text,uuid,jsonb) from public;
revoke all on function public.append_neon_import_issues(text,uuid,jsonb) from public;
revoke all on function public.append_neon_import_source_labels(text,uuid,jsonb) from public;
revoke all on function public.finalize_neon_import_staging(text,uuid,bigint,jsonb,text) from public;
grant execute on function public.begin_neon_import_staging(text,uuid,bigint,jsonb) to hotel_ld_application;
grant execute on function public.append_neon_import_sheets(text,uuid,jsonb) to hotel_ld_application;
grant execute on function public.append_neon_import_field_mappings(text,uuid,jsonb) to hotel_ld_application;
grant execute on function public.append_neon_import_source_rows(text,uuid,jsonb) to hotel_ld_application;
grant execute on function public.append_neon_import_issues(text,uuid,jsonb) to hotel_ld_application;
grant execute on function public.append_neon_import_source_labels(text,uuid,jsonb) to hotel_ld_application;
grant execute on function public.finalize_neon_import_staging(text,uuid,bigint,jsonb,text) to hotel_ld_application;

set local check_function_bodies = on;
commit;
