create or replace function app_private.can_stage_property_import_object(
  p_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  parts text[];
  tenant_id uuid;
  property_id uuid;
  batch_id uuid;
  file_name text;
begin
  parts := storage.foldername(p_name);
  file_name := storage.filename(p_name);
  if cardinality(parts) <> 4
    or parts[3] <> 'imports'
    or nullif(parts[4], '') is null
    or nullif(file_name, '') is null
    or file_name in ('.', '..')
    or file_name !~* '\.(xls|xlsx|csv)$' then
    return false;
  end if;

  begin
    tenant_id := parts[1]::uuid;
    property_id := parts[2]::uuid;
    batch_id := parts[4]::uuid;
  exception
    when others then
      return false;
  end;

  return batch_id is not null
    and app_private.is_active_property_import_manager(property_id)
    and exists (
      select 1
      from public.properties property
      where property.id = property_id
        and property.tenant_id = tenant_id
        and property.status = 'active'
    )
    and not exists (
      select 1
      from public.import_batches batch
      where batch.id = batch_id
        and batch.tenant_id = tenant_id
        and batch.property_id = property_id
    );
end;
$$;

revoke all on function
  app_private.can_stage_property_import_object(text)
from public, anon;
grant execute on function
  app_private.can_stage_property_import_object(text)
to authenticated;

drop policy if exists import_files_manager_insert on storage.objects;
drop policy if exists import_files_manager_delete on storage.objects;
drop policy if exists import_files_staging_cleanup_delete on storage.objects;

create policy import_files_manager_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'property-import-files'
  and (
    (select app_private.can_manage_property_import_object(name))
    or (select app_private.can_stage_property_import_object(name))
  )
);

create policy import_files_staging_cleanup_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'property-import-files'
  and (select app_private.can_stage_property_import_object(name))
);

create or replace function app_private.stage_employee_import(
  p_property_id uuid,
  p_batch_id uuid,
  p_staging jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  property_tenant_id uuid;
  batch_payload jsonb;
  sheets_payload jsonb;
  mappings_payload jsonb;
  rows_payload jsonb;
  issues_payload jsonb;
  labels_payload jsonb;
  sheet_payload jsonb;
  mapping_payload jsonb;
  row_payload jsonb;
  issue_payload jsonb;
  label_payload jsonb;
  selected_sheet_count integer;
  sanitized_filename text;
  storage_object_path text;
  staged_batch public.import_batches%rowtype;
begin
  perform app_private.assert_active_property_import_manager(p_property_id);

  if p_batch_id is null
    or jsonb_typeof(p_staging) <> 'object'
    or jsonb_typeof(p_staging->'batch') <> 'object' then
    raise exception 'IMPORT_STAGING_PAYLOAD_INVALID'
      using errcode = 'P3220';
  end if;

  batch_payload := p_staging->'batch';
  sheets_payload := coalesce(p_staging->'sheets', '[]'::jsonb);
  mappings_payload := coalesce(p_staging->'fieldMappings', '[]'::jsonb);
  rows_payload := coalesce(p_staging->'rows', '[]'::jsonb);
  issues_payload := coalesce(p_staging->'issues', '[]'::jsonb);
  labels_payload := coalesce(p_staging->'sourceLabels', '[]'::jsonb);

  if jsonb_typeof(sheets_payload) <> 'array'
    or jsonb_typeof(mappings_payload) <> 'array'
    or jsonb_typeof(rows_payload) <> 'array'
    or jsonb_typeof(issues_payload) <> 'array'
    or jsonb_typeof(labels_payload) <> 'array' then
    raise exception 'IMPORT_STAGING_COLLECTION_INVALID'
      using errcode = 'P3220';
  end if;

  select property.tenant_id
  into property_tenant_id
  from public.properties property
  where property.id = p_property_id
    and property.status = 'active';
  if property_tenant_id is null then
    raise exception 'IMPORT_MANAGER_PROPERTY_INACTIVE'
      using errcode = '42501';
  end if;

  sanitized_filename := nullif(
    btrim(batch_payload->>'sanitizedFilename'),
    ''
  );
  storage_object_path := nullif(
    btrim(batch_payload->>'storageObjectPath'),
    ''
  );
  if sanitized_filename is null
    or sanitized_filename ~ '[/\\]'
    or sanitized_filename in ('.', '..')
    or storage_object_path is distinct from (
      property_tenant_id::text || '/' ||
      p_property_id::text || '/imports/' ||
      p_batch_id::text || '/' || sanitized_filename
    )
    or nullif(btrim(batch_payload->>'originalFilename'), '') is null
    or coalesce(batch_payload->>'fileChecksum', '') !~ '^[0-9a-f]{64}$'
    or coalesce((batch_payload->>'fileSizeBytes')::bigint, 0)
      not between 1 and 26214400
    or coalesce(batch_payload->>'mimeType', '') not in (
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/csv'
    ) then
    raise exception 'IMPORT_STAGING_BATCH_INVALID'
      using errcode = 'P3220';
  end if;

  if jsonb_array_length(sheets_payload) = 0
    or coalesce(
      (batch_payload->>'detectedSheetCount')::integer,
      -1
    ) <> jsonb_array_length(sheets_payload)
    or coalesce(
      (batch_payload->>'totalSourceRows')::integer,
      -1
    ) <> jsonb_array_length(rows_payload) then
    raise exception 'IMPORT_STAGING_COUNTS_INVALID'
      using errcode = 'P3220';
  end if;

  select count(*)::integer
  into selected_sheet_count
  from jsonb_array_elements(sheets_payload) sheet
  where coalesce((sheet->>'selected')::boolean, false);
  if selected_sheet_count <> 1 then
    raise exception 'IMPORT_STAGING_SELECTED_SHEET_INVALID'
      using errcode = 'P3220';
  end if;

  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'property-import-files'
      and object.name = storage_object_path
  ) then
    raise exception 'IMPORT_STAGING_OBJECT_MISSING'
      using errcode = 'P3220';
  end if;

  insert into public.import_batches(
    id,
    tenant_id,
    property_id,
    import_type,
    source_system,
    original_filename,
    sanitized_filename,
    storage_object_path,
    file_checksum,
    file_size_bytes,
    mime_type,
    status,
    detected_sheet_count,
    total_source_rows,
    valid_rows,
    warning_rows,
    error_rows,
    excluded_rows,
    created_by,
    started_at,
    version
  )
  values (
    p_batch_id,
    property_tenant_id,
    p_property_id,
    'employee_master',
    'hotel_workbook',
    btrim(batch_payload->>'originalFilename'),
    sanitized_filename,
    storage_object_path,
    batch_payload->>'fileChecksum',
    (batch_payload->>'fileSizeBytes')::bigint,
    batch_payload->>'mimeType',
    'mapping_required',
    (batch_payload->>'detectedSheetCount')::integer,
    (batch_payload->>'totalSourceRows')::integer,
    coalesce((batch_payload->>'validRows')::integer, 0),
    coalesce((batch_payload->>'warningRows')::integer, 0),
    coalesce((batch_payload->>'errorRows')::integer, 0),
    0,
    auth.uid(),
    now(),
    1
  )
  returning * into staged_batch;

  for sheet_payload in
    select value from jsonb_array_elements(sheets_payload)
  loop
    insert into public.import_sheets(
      id,
      tenant_id,
      property_id,
      import_batch_id,
      sheet_name,
      sheet_index,
      detected_header_row,
      source_row_count,
      selected_for_import,
      inferred_purpose
    )
    values (
      (sheet_payload->>'id')::uuid,
      property_tenant_id,
      p_property_id,
      p_batch_id,
      sheet_payload->>'name',
      (sheet_payload->>'index')::integer,
      nullif(sheet_payload->>'headerRow', '')::integer,
      coalesce((sheet_payload->>'rowCount')::integer, 0),
      coalesce((sheet_payload->>'selected')::boolean, false),
      nullif(sheet_payload->>'purpose', '')
    );
  end loop;

  for mapping_payload in
    select value from jsonb_array_elements(mappings_payload)
  loop
    insert into public.import_field_mappings(
      tenant_id,
      property_id,
      import_batch_id,
      import_sheet_id,
      source_column_name,
      source_column_index,
      target_field,
      transformation_rule,
      is_required,
      mapping_status
    )
    values (
      property_tenant_id,
      p_property_id,
      p_batch_id,
      (mapping_payload->>'sheetId')::uuid,
      mapping_payload->>'sourceColumnName',
      (mapping_payload->>'sourceColumnIndex')::integer,
      mapping_payload->>'targetField',
      coalesce(mapping_payload->'transformationRule', '{}'::jsonb),
      coalesce((mapping_payload->>'isRequired')::boolean, false),
      'suggested'
    );
  end loop;

  for row_payload in
    select value from jsonb_array_elements(rows_payload)
  loop
    insert into public.import_source_rows(
      id,
      tenant_id,
      property_id,
      import_batch_id,
      import_sheet_id,
      source_row_number,
      raw_values,
      normalized_values,
      row_fingerprint,
      processing_status,
      proposed_action,
      validation_summary
    )
    values (
      (row_payload->>'id')::uuid,
      property_tenant_id,
      p_property_id,
      p_batch_id,
      (row_payload->>'sheetId')::uuid,
      (row_payload->>'sourceRowNumber')::integer,
      row_payload->'rawValues',
      coalesce(row_payload->'normalizedValues', '{}'::jsonb),
      row_payload->>'rowFingerprint',
      coalesce(
        row_payload->>'processingStatus',
        'staged'
      )::public.import_row_status,
      coalesce(
        row_payload->>'proposedAction',
        'unresolved'
      )::public.import_proposed_action,
      coalesce(row_payload->'validationSummary', '{}'::jsonb)
    );
  end loop;

  for issue_payload in
    select value from jsonb_array_elements(issues_payload)
  loop
    insert into public.import_issues(
      tenant_id,
      property_id,
      import_batch_id,
      import_source_row_id,
      issue_type,
      severity,
      source_field,
      source_value,
      message,
      suggested_resolution,
      resolution_status
    )
    values (
      property_tenant_id,
      p_property_id,
      p_batch_id,
      nullif(issue_payload->>'sourceRowId', '')::uuid,
      issue_payload->>'issueType',
      (issue_payload->>'severity')::public.import_issue_severity,
      nullif(issue_payload->>'sourceField', ''),
      nullif(issue_payload->>'sourceValue', ''),
      issue_payload->>'message',
      null,
      'unresolved'
    );
  end loop;

  for label_payload in
    select value from jsonb_array_elements(labels_payload)
  loop
    insert into public.import_source_label_resolutions(
      tenant_id,
      property_id,
      import_batch_id,
      resolution_type,
      source_label,
      normalized_source_label,
      affected_row_count,
      decision
    )
    values (
      property_tenant_id,
      p_property_id,
      p_batch_id,
      label_payload->>'resolutionType',
      label_payload->>'sourceLabel',
      label_payload->>'normalizedSourceLabel',
      (label_payload->>'affectedRowCount')::integer,
      'pending'
    );
  end loop;

  perform app_private.append_import_activity(
    staged_batch,
    'batch_staged',
    jsonb_build_object(
      'sheetCount', jsonb_array_length(sheets_payload),
      'rowCount', jsonb_array_length(rows_payload),
      'mappingCount', jsonb_array_length(mappings_payload),
      'issueCount', jsonb_array_length(issues_payload),
      'sourceLabelCount', jsonb_array_length(labels_payload)
    )
  );

  return jsonb_build_object(
    'batchId', staged_batch.id,
    'status', staged_batch.status,
    'version', staged_batch.version
  );
exception
  when invalid_text_representation
    or numeric_value_out_of_range
    or null_value_not_allowed then
    raise exception 'IMPORT_STAGING_PAYLOAD_INVALID'
      using errcode = 'P3220';
end;
$$;

create or replace function public.stage_employee_import(
  p_property_id uuid,
  p_batch_id uuid,
  p_staging jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  return app_private.stage_employee_import(
    p_property_id,
    p_batch_id,
    p_staging
  );
end;
$$;

revoke all on function
  app_private.stage_employee_import(uuid, uuid, jsonb)
from public, anon, authenticated;
revoke all on function
  public.stage_employee_import(uuid, uuid, jsonb)
from public, anon;
grant execute on function
  public.stage_employee_import(uuid, uuid, jsonb)
to authenticated;
