begin;
set local role hotel_ld_migration_owner;
set local check_function_bodies = off;

create function app_private.assert_neon_import_mapping_batch(p_hostname text, p_batch_id uuid)
returns table (
  tenant_id uuid,
  property_id uuid,
  auth_user_id uuid,
  actor_user_id uuid,
  request_id uuid,
  batch_version bigint,
  evidence_hash text
)
language plpgsql stable security invoker set search_path = ''
as $function$
declare
  authorization record;
  batch public.import_batches;
begin
  select * into authorization from app_private.assert_neon_import_manager(p_hostname);
  select current_batch.* into batch
  from public.import_batches current_batch
  where current_batch.id = p_batch_id
    and current_batch.tenant_id = authorization.resolved_tenant_id
    and current_batch.property_id = authorization.resolved_property_id
    and current_batch.storage_lifecycle = 'linked'
    and current_batch.workbook_lifecycle = 'mapping_required'
    and current_batch.verification_status = 'passed'
    and current_batch.sealed_evidence_sha256 is not null;
  if not found then
    raise exception using errcode = 'P0002', message = 'NEON_IMPORT_MAPPING_BATCH_NOT_FOUND';
  end if;
  return query select authorization.resolved_tenant_id, authorization.resolved_property_id,
    authorization.resolved_auth_user_id, authorization.resolved_actor_user_id,
    authorization.resolved_request_id, batch.version, batch.sealed_evidence_sha256;
end
$function$;

create function app_private.neon_import_mapping_decision_version(p_batch_id uuid)
returns bigint language sql stable security invoker set search_path = ''
as $function$
  select coalesce((select version from public.import_decision_versions where batch_id = p_batch_id), 1::bigint)
$function$;

create function app_private.neon_import_mapping_canonical_preview(p_batch_id uuid, p_decision_version bigint)
returns jsonb language sql stable security invoker set search_path = ''
as $function$
  with batch as (
    select b.id, b.version as batch_version, b.sealed_evidence_sha256 as evidence_hash
    from public.import_batches b
    where b.id = p_batch_id and b.property_id = app_private.current_actor_property_id()
  ), mapping_items as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'mappingId', mapping.id,
      'sourceColumnName', mapping.source_column_name,
      'sourceColumnIndex', mapping.source_column_index,
      'targetField', coalesce(decision.target_field, mapping.target_field),
      'mappingStatus', coalesce(decision.mapping_status::text, 'pending'),
      'transformationRule', coalesce(decision.transformation_rule, mapping.transformation_rule),
      'isRequired', mapping.is_required
    ) order by mapping.sheet_id, mapping.source_column_index, mapping.id), '[]'::jsonb) as items,
    count(*) filter (where decision.id is null) as pending_count,
    count(*) filter (where decision.mapping_status = 'confirmed') as confirmed_count,
    count(*) filter (where decision.mapping_status = 'excluded') as excluded_count
    from public.import_field_mappings mapping
    left join public.import_field_mapping_decisions decision
      on decision.mapping_id = mapping.id and decision.batch_id = mapping.batch_id
    where mapping.batch_id = p_batch_id and mapping.property_id = app_private.current_actor_property_id()
      and mapping.sheet_id = (select selected_sheet_id from public.import_batches where id = p_batch_id)
  ), label_items as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'sourceLabelId', label.id,
      'resolutionType', label.resolution_type,
      'sourceLabel', label.source_label,
      'normalizedSourceLabel', label.normalized_source_label,
      'affectedRowCount', label.affected_row_count,
      'action', coalesce(decision.action::text, 'pending'),
      'targetDepartmentId', decision.target_department_id,
      'targetOperationalUnitId', decision.target_operational_unit_id,
      'targetPositionId', decision.target_position_id,
      'targetPositionFamilyId', decision.target_position_family_id,
      'externalRoleCode', decision.external_role_code,
      'externalRoleName', decision.external_role_name
    ) order by label.resolution_type, label.normalized_source_label, label.id), '[]'::jsonb) as items,
    count(*) filter (where decision.id is null) as pending_count,
    count(*) filter (where decision.id is not null) as resolved_count
    from public.import_source_label_resolutions label
    left join public.import_source_label_decisions decision
      on decision.source_label_id = label.id and decision.batch_id = label.batch_id
    where label.batch_id = p_batch_id and label.property_id = app_private.current_actor_property_id()
  ), issue_items as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'issueId', issue.id,
      'issueType', issue.issue_type,
      'severity', issue.severity,
      'sourceField', issue.source_field,
      'sourceValueProjection', issue.source_value_projection,
      'message', issue.message,
      'status', coalesce(resolution.status::text, 'open'),
      'correction', coalesce(resolution.correction, '{}'::jsonb),
      'resolutionNote', resolution.resolution_note
    ) order by issue.severity desc, issue.id), '[]'::jsonb) as items,
    count(*) filter (where resolution.id is null) as open_count,
    count(*) filter (where issue.severity = 'error' and resolution.id is null) as blocking_count
    from public.import_issues issue
    left join public.import_issue_resolutions resolution
      on resolution.issue_id = issue.id and resolution.batch_id = issue.batch_id
    where issue.batch_id = p_batch_id and issue.property_id = app_private.current_actor_property_id()
  ), projection as (
    select batch.id, batch.batch_version, batch.evidence_hash,
      p_decision_version as decision_version,
      mapping_items.items as mappings, mapping_items.pending_count as mapping_pending,
      mapping_items.confirmed_count as mapping_confirmed, mapping_items.excluded_count as mapping_excluded,
      label_items.items as source_labels, label_items.pending_count as source_label_pending,
      label_items.resolved_count as source_label_resolved,
      issue_items.items as issues, issue_items.open_count as issue_open,
      issue_items.blocking_count as issue_blocking
    from batch cross join mapping_items cross join label_items cross join issue_items
  ), canonical as (
    select projection.*,
      pg_catalog.jsonb_build_object(
        'batchId', id,
        'batchVersion', batch_version,
        'decisionVersion', decision_version,
        'evidenceHash', evidence_hash,
        'mappings', mappings,
        'sourceLabels', source_labels,
        'issues', issues,
        'impact', pg_catalog.jsonb_build_object('state', 'unavailable', 'reason', 'employee_commit_not_migrated')
      ) as canonical_value
    from projection
  )
  select jsonb_build_object(
    'batchId', id,
    'batchVersion', batch_version,
    'decisionVersion', decision_version,
    'evidenceHash', evidence_hash,
    'previewHash', encode(pg_catalog.sha256(pg_catalog.convert_to(canonical_value::text, 'UTF8')), 'hex'),
    'state', case when mapping_pending > 0 or source_label_pending > 0 or issue_blocking > 0 then 'blocked' else 'ready' end,
    'mappings', jsonb_build_object('items', mappings, 'pendingCount', mapping_pending, 'confirmedCount', mapping_confirmed, 'excludedCount', mapping_excluded),
    'sourceLabels', jsonb_build_object('items', source_labels, 'pendingCount', source_label_pending, 'resolvedCount', source_label_resolved),
    'issues', jsonb_build_object('items', issues, 'openCount', issue_open, 'blockingCount', issue_blocking),
    'impact', jsonb_build_object('state', 'unavailable', 'reason', 'employee_commit_not_migrated')
  )
  from canonical
$function$;

create function app_private.neon_import_mapping_audit(
  p_request_id uuid, p_auth_user_id uuid, p_actor_user_id uuid,
  p_tenant_id uuid, p_property_id uuid, p_batch_id uuid,
  p_kind text, p_decision_id uuid, p_operation text,
  p_previous jsonb, p_next jsonb, p_version bigint
)
returns void language sql volatile security invoker set search_path = ''
as $function$
  insert into app_private.import_decision_audit_events(
    request_id, auth_user_id, actor_user_id, tenant_id, property_id, batch_id,
    decision_kind, decision_id, operation, previous_decision, next_decision, decision_version
  ) values (
    p_request_id, p_auth_user_id, p_actor_user_id, p_tenant_id, p_property_id, p_batch_id,
    p_kind, p_decision_id, p_operation, coalesce(p_previous, '{}'::jsonb), coalesce(p_next, '{}'::jsonb), p_version
  )
$function$;

create function public.read_neon_import_mapping_workflow(p_hostname text, p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare authorization record; decision_version bigint;
begin
  select * into authorization from app_private.assert_neon_import_mapping_batch(p_hostname, p_batch_id);
  decision_version := app_private.neon_import_mapping_decision_version(p_batch_id);
  return app_private.neon_import_mapping_canonical_preview(p_batch_id, decision_version);
end
$function$;

create function public.preview_neon_import_batch(p_hostname text, p_batch_id uuid, p_expected_decision_version bigint)
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare authorization record; decision_version bigint;
begin
  select * into authorization from app_private.assert_neon_import_mapping_batch(p_hostname, p_batch_id);
  decision_version := app_private.neon_import_mapping_decision_version(p_batch_id);
  if p_expected_decision_version is null or decision_version <> p_expected_decision_version then
    raise exception using errcode = '40001', message = 'NEON_IMPORT_MAPPING_VERSION_CONFLICT';
  end if;
  return app_private.neon_import_mapping_canonical_preview(p_batch_id, decision_version);
end
$function$;

create function public.save_neon_import_field_mapping_decisions(p_hostname text, p_batch_id uuid, p_expected_decision_version bigint, p_decisions jsonb)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare authorization record; state public.import_decision_versions; value jsonb; mapping public.import_field_mappings; current public.import_field_mapping_decisions; next_version bigint; decision_id uuid; operation text; next_value jsonb; previous_value jsonb;
begin
  select * into authorization from app_private.assert_neon_import_mapping_batch(p_hostname, p_batch_id);
  if pg_catalog.jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) not between 1 and 250 then raise exception using errcode='22023',message='NEON_IMPORT_MAPPING_DECISIONS_INVALID'; end if;
  insert into public.import_decision_versions(batch_id,tenant_id,property_id) values(p_batch_id,authorization.tenant_id,authorization.property_id) on conflict (batch_id) do nothing;
  select * into state from public.import_decision_versions where batch_id=p_batch_id for update;
  if state.version <> p_expected_decision_version then raise exception using errcode='40001',message='NEON_IMPORT_MAPPING_VERSION_CONFLICT'; end if;
  next_version := state.version + 1;
  for value in select * from pg_catalog.jsonb_array_elements(p_decisions) loop
    if not (value ?& array['mappingId','mappingStatus','targetField','transformationRule']) or exists(select 1 from pg_catalog.jsonb_object_keys(value) key where key <> all(array['mappingId','mappingStatus','targetField','transformationRule'])) then raise exception using errcode='22023',message='NEON_IMPORT_MAPPING_DECISION_SHAPE_INVALID'; end if;
    select * into strict mapping from public.import_field_mappings where id=(value->>'mappingId')::uuid and batch_id=p_batch_id and tenant_id=authorization.tenant_id and property_id=authorization.property_id for key share;
    if value->>'mappingStatus' not in ('confirmed','excluded') or pg_catalog.jsonb_typeof(value->'transformationRule') <> 'object' then raise exception using errcode='22023',message='NEON_IMPORT_MAPPING_DECISION_INVALID'; end if;
    if value->>'mappingStatus'='confirmed' and nullif(pg_catalog.btrim(value->>'targetField'),'') is null then raise exception using errcode='22023',message='NEON_IMPORT_MAPPING_TARGET_REQUIRED'; end if;
    if value->>'mappingStatus'='excluded' and value->>'targetField' is not null then raise exception using errcode='22023',message='NEON_IMPORT_MAPPING_TARGET_INVALID'; end if;
    select id, pg_catalog.jsonb_build_object('mappingId',mapping_id,'mappingStatus',mapping_status,'targetField',target_field,'transformationRule',transformation_rule) into decision_id,previous_value from public.import_field_mapping_decisions where batch_id=p_batch_id and mapping_id=mapping.id for update;
    decision_id := coalesce(decision_id, pg_catalog.gen_random_uuid()); operation := case when previous_value is null then 'create' else 'replace' end;
    next_value := pg_catalog.jsonb_build_object('mappingId',mapping.id,'mappingStatus',value->>'mappingStatus','targetField',nullif(value->>'targetField',''),'transformationRule',value->'transformationRule');
    insert into public.import_field_mapping_decisions(id,tenant_id,property_id,batch_id,mapping_id,mapping_status,target_field,transformation_rule,decided_by)
      values(decision_id,authorization.tenant_id,authorization.property_id,p_batch_id,mapping.id,(value->>'mappingStatus')::public.import_e5c_mapping_status,nullif(value->>'targetField',''),value->'transformationRule',authorization.actor_user_id)
      on conflict (batch_id,mapping_id) do update set mapping_status=excluded.mapping_status,target_field=excluded.target_field,transformation_rule=excluded.transformation_rule,decided_by=excluded.decided_by,decided_at=pg_catalog.transaction_timestamp();
    perform app_private.neon_import_mapping_audit(authorization.request_id,authorization.auth_user_id,authorization.actor_user_id,authorization.tenant_id,authorization.property_id,p_batch_id,'field_mapping',decision_id,operation,previous_value,next_value,next_version);
  end loop;
  update public.import_decision_versions set version=next_version,updated_at=pg_catalog.transaction_timestamp() where batch_id=p_batch_id;
  return app_private.neon_import_mapping_canonical_preview(p_batch_id,next_version);
end
$function$;

create function public.save_neon_import_source_label_decisions(p_hostname text, p_batch_id uuid, p_expected_decision_version bigint, p_decisions jsonb)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare authorization record; state public.import_decision_versions; value jsonb; label public.import_source_label_resolutions; current public.import_source_label_decisions; next_version bigint; decision_id uuid; operation text; previous_value jsonb; next_value jsonb; action text;
begin
  select * into authorization from app_private.assert_neon_import_mapping_batch(p_hostname,p_batch_id);
  if pg_catalog.jsonb_typeof(p_decisions)<>'array' or jsonb_array_length(p_decisions) not between 1 and 250 then raise exception using errcode='22023',message='NEON_IMPORT_SOURCE_LABEL_DECISIONS_INVALID'; end if;
  insert into public.import_decision_versions(batch_id,tenant_id,property_id) values(p_batch_id,authorization.tenant_id,authorization.property_id) on conflict(batch_id) do nothing;
  select * into state from public.import_decision_versions where batch_id=p_batch_id for update;
  if state.version<>p_expected_decision_version then raise exception using errcode='40001',message='NEON_IMPORT_MAPPING_VERSION_CONFLICT'; end if;
  next_version:=state.version+1;
  for value in select * from pg_catalog.jsonb_array_elements(p_decisions) loop
    if not(value ? 'sourceLabelId' and value ? 'action') or exists(select 1 from pg_catalog.jsonb_object_keys(value) key where key <> all(array['sourceLabelId','action','targetDepartmentId','targetOperationalUnitId','targetPositionId','targetPositionFamilyId','externalRoleCode','externalRoleName'])) then raise exception using errcode='22023',message='NEON_IMPORT_SOURCE_LABEL_DECISION_SHAPE_INVALID'; end if;
    select * into strict label from public.import_source_label_resolutions where id=(value->>'sourceLabelId')::uuid and batch_id=p_batch_id and tenant_id=authorization.tenant_id and property_id=authorization.property_id for key share;
    action:=value->>'action';
    if label.resolution_type='department' and action not in ('department','operational_unit','ignore','defer') then raise exception using errcode='22023',message='NEON_IMPORT_SOURCE_LABEL_ACTION_INVALID'; end if;
    if label.resolution_type='position' and action not in ('position','family','external','ignore','defer') then raise exception using errcode='22023',message='NEON_IMPORT_SOURCE_LABEL_ACTION_INVALID'; end if;
    select id,pg_catalog.jsonb_build_object('sourceLabelId',source_label_id,'action',action,'targetDepartmentId',target_department_id,'targetOperationalUnitId',target_operational_unit_id,'targetPositionId',target_position_id,'targetPositionFamilyId',target_position_family_id,'externalRoleCode',external_role_code,'externalRoleName',external_role_name) into decision_id,previous_value from public.import_source_label_decisions where batch_id=p_batch_id and source_label_id=label.id for update;
    decision_id:=coalesce(decision_id,pg_catalog.gen_random_uuid()); operation:=case when previous_value is null then 'create' else 'replace' end;
    if action='department' then perform 1 from public.departments target where target.id=(value->>'targetDepartmentId')::uuid and target.tenant_id=authorization.tenant_id and target.property_id=authorization.property_id and target.is_active; if not found then raise exception using errcode='22023',message='NEON_IMPORT_SOURCE_LABEL_TARGET_INVALID'; end if;
    elsif action='operational_unit' then perform 1 from public.operational_units target where target.id=(value->>'targetOperationalUnitId')::uuid and target.tenant_id=authorization.tenant_id and target.property_id=authorization.property_id and target.is_active; if not found then raise exception using errcode='22023',message='NEON_IMPORT_SOURCE_LABEL_TARGET_INVALID'; end if;
    elsif action='position' then perform 1 from public.positions target where target.id=(value->>'targetPositionId')::uuid and target.tenant_id=authorization.tenant_id and target.property_id=authorization.property_id and target.is_active; if not found then raise exception using errcode='22023',message='NEON_IMPORT_SOURCE_LABEL_TARGET_INVALID'; end if;
    elsif action='family' then perform 1 from public.position_families target where target.id=(value->>'targetPositionFamilyId')::uuid and target.tenant_id=authorization.tenant_id and target.property_id=authorization.property_id and target.is_active; if not found then raise exception using errcode='22023',message='NEON_IMPORT_SOURCE_LABEL_TARGET_INVALID'; end if;
    elsif action='external' and (nullif(pg_catalog.btrim(value->>'externalRoleCode'),'') is null or nullif(pg_catalog.btrim(value->>'externalRoleName'),'') is null) then raise exception using errcode='22023',message='NEON_IMPORT_SOURCE_LABEL_EXTERNAL_REQUIRED'; end if;
    next_value:=pg_catalog.jsonb_build_object('sourceLabelId',label.id,'action',action,'targetDepartmentId',nullif(value->>'targetDepartmentId','')::uuid,'targetOperationalUnitId',nullif(value->>'targetOperationalUnitId','')::uuid,'targetPositionId',nullif(value->>'targetPositionId','')::uuid,'targetPositionFamilyId',nullif(value->>'targetPositionFamilyId','')::uuid,'externalRoleCode',nullif(pg_catalog.btrim(value->>'externalRoleCode'),''),'externalRoleName',nullif(pg_catalog.btrim(value->>'externalRoleName'),''));
    insert into public.import_source_label_decisions(id,tenant_id,property_id,batch_id,source_label_id,action,target_department_id,target_operational_unit_id,target_position_id,target_position_family_id,external_role_code,external_role_name,decided_by)
      values(decision_id,authorization.tenant_id,authorization.property_id,p_batch_id,label.id,action::public.import_e5c_source_label_action,(value->>'targetDepartmentId')::uuid,(value->>'targetOperationalUnitId')::uuid,(value->>'targetPositionId')::uuid,(value->>'targetPositionFamilyId')::uuid,nullif(pg_catalog.btrim(value->>'externalRoleCode'),''),nullif(pg_catalog.btrim(value->>'externalRoleName'),''),authorization.actor_user_id)
      on conflict(batch_id,source_label_id) do update set action=excluded.action,target_department_id=excluded.target_department_id,target_operational_unit_id=excluded.target_operational_unit_id,target_position_id=excluded.target_position_id,target_position_family_id=excluded.target_position_family_id,external_role_code=excluded.external_role_code,external_role_name=excluded.external_role_name,decided_by=excluded.decided_by,decided_at=pg_catalog.transaction_timestamp();
    perform app_private.neon_import_mapping_audit(authorization.request_id,authorization.auth_user_id,authorization.actor_user_id,authorization.tenant_id,authorization.property_id,p_batch_id,'source_label',decision_id,operation,previous_value,next_value,next_version);
  end loop;
  update public.import_decision_versions set version=next_version,updated_at=pg_catalog.transaction_timestamp() where batch_id=p_batch_id;
  return app_private.neon_import_mapping_canonical_preview(p_batch_id,next_version);
end
$function$;

create function public.save_neon_import_issue_resolutions(p_hostname text, p_batch_id uuid, p_expected_decision_version bigint, p_decisions jsonb)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare authorization record; state public.import_decision_versions; value jsonb; issue public.import_issues; current public.import_issue_resolutions; next_version bigint; decision_id uuid; operation text; previous_value jsonb; next_value jsonb; status text;
begin
  select * into authorization from app_private.assert_neon_import_mapping_batch(p_hostname,p_batch_id);
  if pg_catalog.jsonb_typeof(p_decisions)<>'array' or jsonb_array_length(p_decisions) not between 1 and 250 then raise exception using errcode='22023',message='NEON_IMPORT_ISSUE_DECISIONS_INVALID'; end if;
  insert into public.import_decision_versions(batch_id,tenant_id,property_id) values(p_batch_id,authorization.tenant_id,authorization.property_id) on conflict(batch_id) do nothing;
  select * into state from public.import_decision_versions where batch_id=p_batch_id for update;
  if state.version<>p_expected_decision_version then raise exception using errcode='40001',message='NEON_IMPORT_MAPPING_VERSION_CONFLICT'; end if;
  next_version:=state.version+1;
  for value in select * from pg_catalog.jsonb_array_elements(p_decisions) loop
    if not(value ? 'issueId' and value ? 'status' and value ? 'correction' and value ? 'resolutionNote') or exists(select 1 from pg_catalog.jsonb_object_keys(value) key where key <> all(array['issueId','status','correction','resolutionNote'])) then raise exception using errcode='22023',message='NEON_IMPORT_ISSUE_DECISION_SHAPE_INVALID'; end if;
    select * into strict issue from public.import_issues where id=(value->>'issueId')::uuid and batch_id=p_batch_id and tenant_id=authorization.tenant_id and property_id=authorization.property_id for key share;
    status:=value->>'status';
    if status not in ('accepted','corrected','excluded','ignored','deferred') or pg_catalog.jsonb_typeof(value->'correction')<>'object' then raise exception using errcode='22023',message='NEON_IMPORT_ISSUE_DECISION_INVALID'; end if;
    if status='corrected' and not (value->'correction' ? issue.source_field) then raise exception using errcode='22023',message='NEON_IMPORT_ISSUE_CORRECTION_INVALID'; end if;
    select id,pg_catalog.jsonb_build_object('issueId',issue_id,'status',status,'correction',correction,'resolutionNote',resolution_note) into decision_id,previous_value from public.import_issue_resolutions where batch_id=p_batch_id and issue_id=issue.id for update;
    decision_id:=coalesce(decision_id,pg_catalog.gen_random_uuid()); operation:=case when previous_value is null then 'create' else 'replace' end;
    next_value:=pg_catalog.jsonb_build_object('issueId',issue.id,'status',status,'correction',value->'correction','resolutionNote',nullif(value->>'resolutionNote',''));
    insert into public.import_issue_resolutions(id,tenant_id,property_id,batch_id,issue_id,status,correction,resolution_note,decided_by)
      values(decision_id,authorization.tenant_id,authorization.property_id,p_batch_id,issue.id,status::public.import_e5c_issue_status,value->'correction',nullif(value->>'resolutionNote',''),authorization.actor_user_id)
      on conflict(batch_id,issue_id) do update set status=excluded.status,correction=excluded.correction,resolution_note=excluded.resolution_note,decided_by=excluded.decided_by,decided_at=pg_catalog.transaction_timestamp();
    perform app_private.neon_import_mapping_audit(authorization.request_id,authorization.auth_user_id,authorization.actor_user_id,authorization.tenant_id,authorization.property_id,p_batch_id,'issue',decision_id,operation,previous_value,next_value,next_version);
  end loop;
  update public.import_decision_versions set version=next_version,updated_at=pg_catalog.transaction_timestamp() where batch_id=p_batch_id;
  return app_private.neon_import_mapping_canonical_preview(p_batch_id,next_version);
end
$function$;

alter function app_private.assert_neon_import_mapping_batch(text,uuid) owner to hotel_ld_migration_owner;
alter function app_private.neon_import_mapping_decision_version(uuid) owner to hotel_ld_migration_owner;
alter function app_private.neon_import_mapping_canonical_preview(uuid,bigint) owner to hotel_ld_migration_owner;
alter function app_private.neon_import_mapping_audit(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,jsonb,bigint) owner to hotel_ld_migration_owner;
alter function public.read_neon_import_mapping_workflow(text,uuid) owner to hotel_ld_migration_owner;
alter function public.preview_neon_import_batch(text,uuid,bigint) owner to hotel_ld_migration_owner;
alter function public.save_neon_import_field_mapping_decisions(text,uuid,bigint,jsonb) owner to hotel_ld_migration_owner;
alter function public.save_neon_import_source_label_decisions(text,uuid,bigint,jsonb) owner to hotel_ld_migration_owner;
alter function public.save_neon_import_issue_resolutions(text,uuid,bigint,jsonb) owner to hotel_ld_migration_owner;

revoke all on function app_private.assert_neon_import_mapping_batch(text,uuid) from public;
revoke all on function app_private.neon_import_mapping_decision_version(uuid) from public;
revoke all on function app_private.neon_import_mapping_canonical_preview(uuid,bigint) from public;
revoke all on function app_private.neon_import_mapping_audit(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,jsonb,bigint) from public;
revoke all on function public.read_neon_import_mapping_workflow(text,uuid) from public;
revoke all on function public.preview_neon_import_batch(text,uuid,bigint) from public;
revoke all on function public.save_neon_import_field_mapping_decisions(text,uuid,bigint,jsonb) from public;
revoke all on function public.save_neon_import_source_label_decisions(text,uuid,bigint,jsonb) from public;
revoke all on function public.save_neon_import_issue_resolutions(text,uuid,bigint,jsonb) from public;
grant execute on function public.read_neon_import_mapping_workflow(text,uuid) to hotel_ld_application;
grant execute on function public.preview_neon_import_batch(text,uuid,bigint) to hotel_ld_application;
grant execute on function public.save_neon_import_field_mapping_decisions(text,uuid,bigint,jsonb) to hotel_ld_application;
grant execute on function public.save_neon_import_source_label_decisions(text,uuid,bigint,jsonb) to hotel_ld_application;
grant execute on function public.save_neon_import_issue_resolutions(text,uuid,bigint,jsonb) to hotel_ld_application;

set local check_function_bodies = on;
commit;
