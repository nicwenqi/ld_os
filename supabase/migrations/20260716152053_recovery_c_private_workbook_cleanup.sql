drop policy if exists import_files_manager_select on storage.objects;
drop policy if exists import_files_staging_cleanup_delete on storage.objects;

create policy import_files_manager_select
on storage.objects for select to authenticated
using (
  bucket_id = 'property-import-files'
  and (
    (select app_private.can_manage_property_import_object(name))
    or (
      (select app_private.can_stage_property_import_object(name))
      and owner_id = (select auth.uid())::text
    )
  )
);

create policy import_files_staging_cleanup_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'property-import-files'
  and (select app_private.can_stage_property_import_object(name))
  and owner_id = (select auth.uid())::text
);

create or replace function app_private.is_employee_import_excluded_key(
  p_key text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_key, '') ~* (
    'ctc|gtc|kpi|training|course|completion|attendance|' ||
    'feedback|risk|培训|课程|完成|出勤|考勤|反馈|风险|绩效'
  );
$$;

create or replace function
  app_private.assert_employee_import_staging_payload_allowed(
    p_staging jsonb
  )
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  mappings_payload jsonb;
  rows_payload jsonb;
  mapping_payload jsonb;
  row_payload jsonb;
  mapping_sheet_id text;
  row_sheet_id text;
  mapping_source text;
  mapping_target text;
  source_key text;
  normalized_key text;
  source_token text;
  target_token text;
  mapping_source_tokens text[] := array[]::text[];
  mapping_target_tokens text[] := array[]::text[];
  allowed_targets constant text[] := array[
    'employee_number',
    'name_zh',
    'name_en',
    'department_source_label',
    'position_source_label',
    'grade_or_band',
    'hire_date',
    'probation_or_confirmation_date',
    'employment_status',
    'lms_employee_id',
    'merlin_id'
  ]::text[];
begin
  if jsonb_typeof(p_staging) <> 'object' then
    return;
  end if;

  mappings_payload := coalesce(
    p_staging->'fieldMappings',
    '[]'::jsonb
  );
  rows_payload := coalesce(p_staging->'rows', '[]'::jsonb);
  if jsonb_typeof(mappings_payload) <> 'array'
    or jsonb_typeof(rows_payload) <> 'array' then
    return;
  end if;

  for mapping_payload in
    select value
    from jsonb_array_elements(mappings_payload)
  loop
    if jsonb_typeof(mapping_payload) <> 'object' then
      raise exception 'IMPORT_STAGING_FIELD_ALLOWLIST_INVALID'
        using errcode = 'P3220';
    end if;

    mapping_sheet_id := nullif(
      btrim(mapping_payload->>'sheetId'),
      ''
    );
    mapping_source := nullif(
      btrim(mapping_payload->>'sourceColumnName'),
      ''
    );
    mapping_target := nullif(
      btrim(mapping_payload->>'targetField'),
      ''
    );
    if mapping_sheet_id is null
      or mapping_source is null
      or mapping_target is null then
      raise exception 'IMPORT_STAGING_FIELD_ALLOWLIST_INVALID'
        using errcode = 'P3220';
    end if;

    if app_private.is_employee_import_excluded_key(mapping_source)
      or app_private.is_employee_import_excluded_key(mapping_target) then
      raise exception 'IMPORT_STAGING_EXCLUDED_FIELD'
        using errcode = 'P3220';
    end if;
    if not (mapping_target = any(allowed_targets)) then
      raise exception 'IMPORT_STAGING_FIELD_ALLOWLIST_INVALID'
        using errcode = 'P3220';
    end if;

    source_token := mapping_sheet_id || chr(31) || mapping_source;
    target_token := mapping_sheet_id || chr(31) || mapping_target;
    if source_token = any(mapping_source_tokens)
      or target_token = any(mapping_target_tokens) then
      raise exception 'IMPORT_STAGING_FIELD_ALLOWLIST_INVALID'
        using errcode = 'P3220';
    end if;
    mapping_source_tokens := array_append(
      mapping_source_tokens,
      source_token
    );
    mapping_target_tokens := array_append(
      mapping_target_tokens,
      target_token
    );
  end loop;

  for row_payload in
    select value
    from jsonb_array_elements(rows_payload)
  loop
    if jsonb_typeof(row_payload) <> 'object'
      or jsonb_typeof(row_payload->'rawValues') <> 'object'
      or jsonb_typeof(
        coalesce(row_payload->'normalizedValues', '{}'::jsonb)
      ) <> 'object' then
      raise exception 'IMPORT_STAGING_FIELD_ALLOWLIST_INVALID'
        using errcode = 'P3220';
    end if;

    row_sheet_id := nullif(btrim(row_payload->>'sheetId'), '');
    if row_sheet_id is null then
      raise exception 'IMPORT_STAGING_FIELD_ALLOWLIST_INVALID'
        using errcode = 'P3220';
    end if;

    for source_key in
      select key
      from jsonb_object_keys(row_payload->'rawValues') key
    loop
      if app_private.is_employee_import_excluded_key(source_key) then
        raise exception 'IMPORT_STAGING_EXCLUDED_FIELD'
          using errcode = 'P3220';
      end if;
      if not (
        row_sheet_id || chr(31) || source_key =
        any(mapping_source_tokens)
      ) then
        raise exception 'IMPORT_STAGING_FIELD_ALLOWLIST_INVALID'
          using errcode = 'P3220';
      end if;
    end loop;

    for normalized_key in
      select key
      from jsonb_object_keys(
        coalesce(row_payload->'normalizedValues', '{}'::jsonb)
      ) key
    loop
      if app_private.is_employee_import_excluded_key(normalized_key) then
        raise exception 'IMPORT_STAGING_EXCLUDED_FIELD'
          using errcode = 'P3220';
      end if;
      if not (normalized_key = any(allowed_targets))
        or not (
          row_sheet_id || chr(31) || normalized_key =
          any(mapping_target_tokens)
        ) then
        raise exception 'IMPORT_STAGING_FIELD_ALLOWLIST_INVALID'
          using errcode = 'P3220';
      end if;
    end loop;
  end loop;
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
  perform
    app_private.assert_employee_import_staging_payload_allowed(
      p_staging
    );
  return app_private.stage_employee_import(
    p_property_id,
    p_batch_id,
    p_staging
  );
end;
$$;

revoke all on function
  app_private.is_employee_import_excluded_key(text),
  app_private.assert_employee_import_staging_payload_allowed(jsonb)
from public, anon, authenticated;
revoke all on function
  public.stage_employee_import(uuid, uuid, jsonb)
from public, anon;
grant execute on function
  public.stage_employee_import(uuid, uuid, jsonb)
to authenticated;
