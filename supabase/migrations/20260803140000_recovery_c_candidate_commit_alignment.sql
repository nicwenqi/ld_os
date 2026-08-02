-- Recovery C follow-up: preserve department-scoped Position decisions during
-- the existing employee preview. The legacy source-label resolution is
-- intentionally global by label; candidate initialization is scoped by
-- Department and therefore may contain same-name Positions in multiple
-- departments. Temporary per-row resolutions let the immutable preview path
-- consume the explicit position_id without changing source evidence or the
-- historical resolution model.

create or replace function app_private.prepare_employee_import_preview(
  p_batch_id uuid,
  p_expected_version bigint,
  p_options jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  source_row record;
  restore_row record;
  temporary_label text;
  restore_payload jsonb := '[]'::jsonb;
begin
  perform set_config('recovery_c.employee_import_preview', 'on', true);

  for source_row in
    select id, normalized_values
    from public.import_source_rows
    where import_batch_id = p_batch_id
      and nullif(normalized_values->>'position_id', '') is not null
      and nullif(btrim(normalized_values->>'position_source_label'), '') is not null
    for update
  loop
    temporary_label := '__candidate_position_' || source_row.id::text;
    restore_payload := restore_payload || jsonb_build_array(jsonb_build_object(
      'sourceRowId', source_row.id,
      'originalLabel', source_row.normalized_values->>'position_source_label'
    ));
    update public.import_source_rows
    set normalized_values = jsonb_set(
      normalized_values,
      '{position_source_label}',
      to_jsonb(temporary_label),
      true
    )
    where id = source_row.id;
    insert into public.import_source_label_resolutions(
      tenant_id, property_id, import_batch_id, resolution_type,
      source_label, normalized_source_label, affected_row_count,
      decision, decision_mode, target_entity_type, target_entity_id,
      approved_by, decided_at
    )
    select batch.tenant_id, batch.property_id, batch.id, 'position',
      temporary_label, temporary_label, 1,
      'mapped', 'map', 'position',
      (source_row.normalized_values->>'position_id')::uuid,
      auth.uid(), now()
    from public.import_batches batch
    where batch.id = p_batch_id;
  end loop;

  result := app_private.prepare_employee_import_preview_base(
    p_batch_id, p_expected_version, p_options
  );

  for restore_row in
    select (value->>'sourceRowId')::uuid as source_row_id,
      value->>'originalLabel' as original_label
    from jsonb_array_elements(restore_payload) value
  loop
    update public.import_source_rows
    set normalized_values = jsonb_set(
      normalized_values,
      '{position_source_label}',
      to_jsonb(restore_row.original_label),
      true
    )
    where id = restore_row.source_row_id;
  end loop;
  delete from public.import_source_label_resolutions
  where import_batch_id = p_batch_id
    and source_label like '__candidate_position_%';
  perform set_config('recovery_c.employee_import_preview', 'off', true);
  return result;
exception
  when others then
    delete from public.import_source_label_resolutions
    where import_batch_id = p_batch_id
      and source_label like '__candidate_position_%';
    for restore_row in
      select (value->>'sourceRowId')::uuid as source_row_id,
        value->>'originalLabel' as original_label
      from jsonb_array_elements(restore_payload) value
    loop
      update public.import_source_rows
      set normalized_values = jsonb_set(
        normalized_values,
        '{position_source_label}',
        to_jsonb(restore_row.original_label),
        true
      )
      where id = restore_row.source_row_id;
    end loop;
    perform set_config('recovery_c.employee_import_preview', 'off', true);
    raise;
end;
$$;

revoke all on function app_private.prepare_employee_import_preview(uuid,bigint,jsonb)
from public, anon, authenticated;
