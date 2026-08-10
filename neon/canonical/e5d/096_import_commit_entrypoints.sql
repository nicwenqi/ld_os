begin;
set local role hotel_ld_migration_owner;
set local check_function_bodies = off;

create function app_private.assert_neon_import_commit_batch(p_hostname text, p_batch_id uuid)
returns table (
  tenant_id uuid,
  property_id uuid,
  auth_user_id uuid,
  actor_user_id uuid,
  request_id uuid,
  batch_version bigint,
  decision_version bigint,
  preview jsonb
)
language plpgsql stable security invoker set search_path = ''
as $function$
declare authorization record; current_decision_version bigint; current_preview jsonb;
begin
  select * into authorization from app_private.assert_neon_import_mapping_batch(p_hostname, p_batch_id);
  current_decision_version := app_private.neon_import_mapping_decision_version(p_batch_id);
  current_preview := app_private.neon_import_mapping_canonical_preview(p_batch_id, current_decision_version);
  return query select authorization.tenant_id, authorization.property_id,
    authorization.auth_user_id, authorization.actor_user_id, authorization.request_id,
    authorization.batch_version, current_decision_version, current_preview;
end
$function$;

create function app_private.neon_import_employee_mutation_core(
  p_hostname text, p_tenant uuid, p_property uuid, p_id uuid, p_expected_version bigint,
  p_employee_number text, p_name_zh text, p_name_en text, p_department uuid, p_unit uuid,
  p_position uuid, p_family uuid, p_grade text, p_hire_date date,
  p_confirmation_date date, p_status text, p_active boolean, p_identifiers jsonb
)
returns jsonb language plpgsql volatile security invoker set search_path = ''
as $function$
begin
  return public.save_neon_employee_with_identifiers(
    p_hostname, p_tenant, p_property, p_id, p_expected_version,
    p_employee_number, p_name_zh, p_name_en, p_department, p_unit, p_position,
    p_family, p_grade, p_hire_date, p_confirmation_date, p_status, p_active, p_identifiers
  );
end
$function$;

create function app_private.neon_import_commit_identifiers(p_employee_id uuid, p_source_system text, p_identifier_type text, p_identifier_value text)
returns jsonb language sql stable security invoker set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'source_system', identifier.source_system,
    'identifier_type', identifier.identifier_type,
    'identifier_value', identifier.identifier_value,
    'is_primary', identifier.is_primary,
    'is_active', identifier.is_active
  ) order by identifier.source_system, identifier.identifier_type, identifier.identifier_value, identifier.id), '[]'::jsonb)
  || case when exists(
    select 1 from public.employee_external_identifiers identifier
    where identifier.employee_id = p_employee_id
      and identifier.source_system = p_source_system
      and identifier.identifier_type::text = p_identifier_type
      and identifier.identifier_value = p_identifier_value
  ) then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
    'source_system', p_source_system,
    'identifier_type', p_identifier_type,
    'identifier_value', p_identifier_value,
    'is_primary', true,
    'is_active', true
  )) end
  from public.employee_external_identifiers identifier
  where identifier.employee_id = p_employee_id
$function$;

create function app_private.neon_import_commit_audit(
  p_request_id uuid, p_auth_user_id uuid, p_actor_user_id uuid,
  p_tenant_id uuid, p_property_id uuid, p_batch_id uuid, p_commit_id uuid,
  p_event_type text, p_details jsonb
)
returns void language sql volatile security invoker set search_path = ''
as $function$
  insert into app_private.import_commit_audit_events(
    request_id, auth_user_id, actor_user_id, tenant_id, property_id,
    batch_id, commit_id, event_type, details
  ) values (
    p_request_id, p_auth_user_id, p_actor_user_id, p_tenant_id, p_property_id,
    p_batch_id, p_commit_id, p_event_type, coalesce(p_details, '{}'::jsonb)
  )
$function$;

create function public.commit_neon_import_batch(
  p_hostname text, p_batch_id uuid, p_expected_batch_version bigint,
  p_expected_decision_version bigint, p_preview_hash text, p_confirmed boolean
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  authz record; batch public.import_batches; commit_row public.import_commits; source_row record; employee_row public.employees;
  department_decision record; position_decision record; department_id uuid; unit_id uuid; position_id uuid; family_id uuid;
  employee_id uuid; expected_employee_version bigint; before_employee jsonb; before_identifiers jsonb; after_employee jsonb; after_identifiers jsonb; identifiers jsonb;
  employee_number text; status text; active boolean; current_decision_version bigint; item_action public.import_commit_item_action;
  v_inserted_count integer := 0; v_updated_count integer := 0; v_unchanged_count integer := 0; v_excluded_count integer := 0;
begin
  if p_confirmed is not true then raise exception using errcode = '42501', message = 'NEON_IMPORT_COMMIT_CONFIRMATION_REQUIRED'; end if;
  if p_preview_hash is null or p_preview_hash !~ '^[0-9a-f]{64}$' then raise exception using errcode = '22023', message = 'NEON_IMPORT_COMMIT_PREVIEW_HASH_INVALID'; end if;
  select * into authz from app_private.assert_neon_import_commit_batch(p_hostname, p_batch_id);
  select * into batch from public.import_batches where id=p_batch_id and tenant_id=authz.tenant_id and property_id=authz.property_id for update;
  if not found or batch.version <> p_expected_batch_version then raise exception using errcode = '40001', message = 'NEON_IMPORT_COMMIT_BATCH_VERSION_CONFLICT'; end if;
  if batch.storage_lifecycle <> 'linked' or batch.workbook_lifecycle <> 'mapping_required' or batch.verification_status <> 'passed' then raise exception using errcode = '42201', message = 'NEON_IMPORT_COMMIT_BATCH_STATE_INVALID'; end if;
  insert into public.import_decision_versions(batch_id,tenant_id,property_id) values(p_batch_id,authz.tenant_id,authz.property_id) on conflict(batch_id) do nothing;
  select version into current_decision_version from public.import_decision_versions where batch_id=p_batch_id for update;
  authz.preview := app_private.neon_import_mapping_canonical_preview(p_batch_id, current_decision_version);
  if current_decision_version <> p_expected_decision_version then raise exception using errcode = '40001', message = 'NEON_IMPORT_COMMIT_MAPPING_VERSION_CONFLICT'; end if;
  if authz.preview->>'previewHash' <> p_preview_hash then raise exception using errcode = '40001', message = 'NEON_IMPORT_COMMIT_PREVIEW_HASH_CONFLICT'; end if;
  if authz.preview->>'state' <> 'ready' then raise exception using errcode = '42201', message = 'NEON_IMPORT_COMMIT_PREVIEW_BLOCKED'; end if;
  if exists(select 1 from public.import_source_rows where batch_id = p_batch_id and processing_status = 'error') then raise exception using errcode = '42201', message = 'NEON_IMPORT_COMMIT_BLOCKED_ROWS'; end if;
  if exists(
    select 1 from public.import_issues issue
    left join public.import_issue_resolutions resolution on resolution.issue_id = issue.id and resolution.batch_id = issue.batch_id
    where issue.batch_id = p_batch_id and issue.severity = 'error'
      and (resolution.id is null or resolution.status = 'deferred')
  ) then raise exception using errcode = '42201', message = 'NEON_IMPORT_COMMIT_BLOCKED_ISSUES'; end if;
  if exists(
    select 1 from public.import_source_rows row
    where row.batch_id = p_batch_id and row.processing_status in ('staged','warning')
    group by row.normalized_values->>'employee_number' having count(*) > 1
  ) then raise exception using errcode = '40001', message = 'NEON_IMPORT_COMMIT_DUPLICATE_EMPLOYEE_NUMBER'; end if;
  if exists(select 1 from public.import_commits where batch_id = p_batch_id for update) then raise exception using errcode = '40901', message = 'NEON_IMPORT_COMMIT_ALREADY_EXISTS'; end if;

  commit_row.id := pg_catalog.gen_random_uuid();
  commit_row.tenant_id := authz.tenant_id; commit_row.property_id := authz.property_id; commit_row.batch_id := p_batch_id;
  commit_row.preview_hash := p_preview_hash; commit_row.batch_version := p_expected_batch_version; commit_row.decision_version := p_expected_decision_version;
  commit_row.committed_by := authz.actor_user_id;
  insert into public.import_commits(id, tenant_id, property_id, batch_id, preview_hash, batch_version, decision_version, committed_by)
    values(commit_row.id, commit_row.tenant_id, commit_row.property_id, commit_row.batch_id, commit_row.preview_hash, commit_row.batch_version, commit_row.decision_version, commit_row.committed_by);

  for source_row in
    select row.*,
      ddecision.action as department_action, ddecision.target_department_id,
      ddecision.target_operational_unit_id,
      pdecision.action as position_action, pdecision.target_position_id, pdecision.target_position_family_id
    from public.import_source_rows row
    left join public.import_source_label_resolutions dlabel
      on dlabel.batch_id = row.batch_id and dlabel.sheet_id = row.sheet_id and dlabel.resolution_type = 'department'
      and dlabel.normalized_source_label = app_private.neon_import_normalize_source_label(row.normalized_values->>'department_source_label')
    left join public.import_source_label_decisions ddecision
      on ddecision.batch_id = row.batch_id and ddecision.source_label_id = dlabel.id
    left join public.import_source_label_resolutions plabel
      on plabel.batch_id = row.batch_id and plabel.sheet_id = row.sheet_id and plabel.resolution_type = 'position'
      and plabel.normalized_source_label = app_private.neon_import_normalize_source_label(row.normalized_values->>'position_source_label')
    left join public.import_source_label_decisions pdecision
      on pdecision.batch_id = row.batch_id and pdecision.source_label_id = plabel.id
    where row.batch_id = p_batch_id and row.processing_status in ('staged','warning')
    order by row.source_row_number, row.id
  loop
    department_id := null;
    unit_id := null;
    position_id := null;
    family_id := null;
    employee_number := nullif(pg_catalog.btrim(source_row.normalized_values->>'employee_number'), '');
    if employee_number is null or (nullif(pg_catalog.btrim(source_row.normalized_values->>'name_zh'), '') is null and nullif(pg_catalog.btrim(source_row.normalized_values->>'name_en'), '') is null) then
      raise exception using errcode = '42201', message = 'NEON_IMPORT_COMMIT_ROW_INVALID';
    end if;
    if nullif(pg_catalog.btrim(source_row.normalized_values->>'department_source_label'), '') is not null and source_row.department_action is null then
      raise exception using errcode = '42201', message = 'NEON_IMPORT_COMMIT_DEPARTMENT_MAPPING_MISSING';
    end if;
    if nullif(pg_catalog.btrim(source_row.normalized_values->>'position_source_label'), '') is not null and source_row.position_action is null then
      raise exception using errcode = '42201', message = 'NEON_IMPORT_COMMIT_POSITION_MAPPING_MISSING';
    end if;
    if source_row.department_action in ('ignore','defer') or source_row.position_action in ('external','ignore','defer') then
      item_action := 'excluded'; v_excluded_count := v_excluded_count + 1;
      insert into public.import_commit_items(tenant_id,property_id,batch_id,commit_id,source_row_id,row_fingerprint,action)
        values(authz.tenant_id,authz.property_id,p_batch_id,commit_row.id,source_row.id,source_row.row_fingerprint,item_action);
      continue;
    end if;

    department_id := source_row.target_department_id;
    unit_id := source_row.target_operational_unit_id;
    if source_row.department_action = 'operational_unit' then
      select unit.department_id into department_id from public.operational_units unit
      where unit.id = unit_id and unit.tenant_id = authz.tenant_id and unit.property_id = authz.property_id and unit.is_active for key share;
      if not found then raise exception using errcode = '42201', message = 'NEON_IMPORT_COMMIT_DEPARTMENT_TARGET_INVALID'; end if;
    elsif source_row.department_action = 'department' then
      perform 1 from public.departments department where department.id = department_id and department.tenant_id = authz.tenant_id and department.property_id = authz.property_id and department.is_active for key share;
      if not found then raise exception using errcode = '42201', message = 'NEON_IMPORT_COMMIT_DEPARTMENT_TARGET_INVALID'; end if;
    end if;
    position_id := source_row.target_position_id;
    family_id := source_row.target_position_family_id;
    if source_row.position_action = 'family' then
      perform 1 from public.position_families family where family.id = family_id and family.tenant_id = authz.tenant_id and family.property_id = authz.property_id and family.is_active for key share;
      if not found then raise exception using errcode = '42201', message = 'NEON_IMPORT_COMMIT_POSITION_TARGET_INVALID'; end if;
    elsif source_row.position_action = 'position' then
      perform 1 from public.positions position where position.id = position_id and position.tenant_id = authz.tenant_id and position.property_id = authz.property_id and position.is_active for key share;
      if not found then raise exception using errcode = '42201', message = 'NEON_IMPORT_COMMIT_POSITION_TARGET_INVALID'; end if;
    end if;
    status := coalesce(nullif(source_row.normalized_values->>'employment_status',''), 'unknown');
    active := status = 'active';
    if active and (department_id is null or position_id is null) then raise exception using errcode = '42201', message = 'NEON_IMPORT_COMMIT_ACTIVE_TARGETS_REQUIRED'; end if;

    employee_id := null; expected_employee_version := 0; before_employee := null; before_identifiers := '[]'::jsonb;
    select employee.* into employee_row from public.employees employee
    where employee.tenant_id = authz.tenant_id and employee.property_id = authz.property_id and employee.employee_number = employee_number for update;
    if found then
      employee_id := employee_row.id; expected_employee_version := employee_row.version;
      before_employee := app_private.neon_employee_authoritative_snapshot(employee_id);
      before_identifiers := app_private.neon_employee_identifier_snapshot(employee_id);
      identifiers := app_private.neon_import_commit_identifiers(employee_id,'import','local_employee_number',employee_number);
    else
      identifiers := jsonb_build_array(jsonb_build_object('source_system','import','identifier_type','local_employee_number','identifier_value',employee_number,'is_primary',true,'is_active',true));
    end if;
    after_employee := app_private.neon_import_employee_mutation_core(
      p_hostname, authz.tenant_id, authz.property_id, employee_id, expected_employee_version,
      employee_number, nullif(pg_catalog.btrim(source_row.normalized_values->>'name_zh'),''), nullif(pg_catalog.btrim(source_row.normalized_values->>'name_en'),''),
      department_id, unit_id, position_id, family_id, nullif(pg_catalog.btrim(source_row.normalized_values->>'grade_or_band'),''),
      nullif(source_row.normalized_values->>'hire_date','')::date, nullif(source_row.normalized_values->>'probation_or_confirmation_date','')::date,
      status, active, identifiers
    );
    after_identifiers := coalesce(after_employee->'identifiers','[]'::jsonb);
    item_action := case when employee_id is null then 'insert' else 'update' end;
    if item_action = 'insert' then v_inserted_count := v_inserted_count + 1; else v_updated_count := v_updated_count + 1; end if;
    insert into public.import_commit_items(tenant_id,property_id,batch_id,commit_id,source_row_id,row_fingerprint,employee_id,action,employee_version_before,employee_version_after,before_employee,after_employee,before_identifiers,after_identifiers)
      values(authz.tenant_id,authz.property_id,p_batch_id,commit_row.id,source_row.id,source_row.row_fingerprint,(after_employee->>'id')::uuid,item_action,nullif(expected_employee_version,0),(after_employee->>'version')::bigint,coalesce(before_employee,'{}'::jsonb),after_employee,coalesce(before_identifiers,'[]'::jsonb),after_identifiers);
  end loop;
  update public.import_commits set inserted_count=v_inserted_count, updated_count=v_updated_count, unchanged_count=v_unchanged_count, excluded_count=v_excluded_count where id=commit_row.id;
  perform app_private.neon_import_commit_audit(authz.request_id,authz.auth_user_id,authz.actor_user_id,authz.tenant_id,authz.property_id,p_batch_id,commit_row.id,'commit',jsonb_build_object('previewHash',p_preview_hash,'batchVersion',p_expected_batch_version,'decisionVersion',p_expected_decision_version,'inserted',v_inserted_count,'updated',v_updated_count,'excluded',v_excluded_count));
  return jsonb_build_object('commitId',commit_row.id,'batchId',p_batch_id,'status','committed','version',1,'previewHash',p_preview_hash,'batchVersion',p_expected_batch_version,'decisionVersion',p_expected_decision_version,'inserted',v_inserted_count,'updated',v_updated_count,'unchanged',v_unchanged_count,'excluded',v_excluded_count);
end
$function$;

create function public.preview_neon_import_revert(p_hostname text, p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare authorization record; commit_row public.import_commits; conflicts integer;
begin
  select * into authorization from app_private.assert_neon_import_commit_batch(p_hostname,p_batch_id);
  select * into commit_row from public.import_commits where batch_id=p_batch_id and tenant_id=authorization.tenant_id and property_id=authorization.property_id;
  if not found then raise exception using errcode='P0002',message='NEON_IMPORT_REVERT_COMMIT_NOT_FOUND'; end if;
  if commit_row.status <> 'committed' then raise exception using errcode='40901',message='NEON_IMPORT_REVERT_ALREADY_REVERTED'; end if;
  select count(*)::integer into conflicts from public.import_commit_items item
  left join public.employees employee on employee.id=item.employee_id and employee.tenant_id=item.tenant_id and employee.property_id=item.property_id
  where item.commit_id=commit_row.id and item.action in ('insert','update')
    and (employee.id is null or employee.version <> item.employee_version_after);
  return jsonb_build_object('safe',conflicts=0,'conflicts',conflicts,'strategy','compensating_employee_mutation_no_delete','commitVersion',commit_row.version,'dependencyChecks',jsonb_build_object('currentEmployeeVersions',case when conflicts=0 then 'pass' else 'conflict' end,'destructiveDelete','never'));
end
$function$;

create function public.revert_neon_import_batch(p_hostname text, p_batch_id uuid, p_expected_commit_version bigint, p_confirmed boolean)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare authorization record; commit_row public.import_commits; item record; current_employee jsonb; current_ids jsonb; restored jsonb; conflict_count integer;
begin
  if p_confirmed is not true then raise exception using errcode='42501',message='NEON_IMPORT_REVERT_CONFIRMATION_REQUIRED'; end if;
  select * into authorization from app_private.assert_neon_import_commit_batch(p_hostname,p_batch_id);
  select * into commit_row from public.import_commits where batch_id=p_batch_id and tenant_id=authorization.tenant_id and property_id=authorization.property_id for update;
  if not found then raise exception using errcode='P0002',message='NEON_IMPORT_REVERT_COMMIT_NOT_FOUND'; end if;
  if commit_row.status <> 'committed' then raise exception using errcode='40901',message='NEON_IMPORT_REVERT_ALREADY_REVERTED'; end if;
  if commit_row.version <> p_expected_commit_version then raise exception using errcode='40001',message='NEON_IMPORT_REVERT_VERSION_CONFLICT'; end if;
  select count(*)::integer into conflict_count from public.import_commit_items item left join public.employees employee on employee.id=item.employee_id and employee.tenant_id=item.tenant_id and employee.property_id=item.property_id where item.commit_id=commit_row.id and item.action in ('insert','update') and (employee.id is null or employee.version <> item.employee_version_after);
  if conflict_count > 0 then raise exception using errcode='40001',message='NEON_IMPORT_REVERT_EMPLOYEE_CONFLICT'; end if;
  for item in select * from public.import_commit_items where commit_id=commit_row.id and action in ('insert','update') order by created_at,id loop
    current_employee := app_private.neon_employee_authoritative_snapshot(item.employee_id);
    current_ids := app_private.neon_employee_identifier_snapshot(item.employee_id);
    if item.action = 'insert' then
      restored := app_private.neon_import_employee_mutation_core(p_hostname,authorization.tenant_id,authorization.property_id,item.employee_id,(current_employee->>'version')::bigint,current_employee->>'employee_number',current_employee->>'name_zh',current_employee->>'name_en',(current_employee->>'department_id')::uuid,(current_employee->>'operational_unit_id')::uuid,(current_employee->>'position_id')::uuid,(current_employee->>'position_family_id')::uuid,current_employee->>'grade_or_band',(current_employee->>'hire_date')::date,(current_employee->>'probation_or_confirmation_date')::date,'inactive',false,current_ids);
    else
      restored := app_private.neon_import_employee_mutation_core(p_hostname,authorization.tenant_id,authorization.property_id,item.employee_id,(current_employee->>'version')::bigint,item.before_employee->>'employee_number',item.before_employee->>'name_zh',item.before_employee->>'name_en',(item.before_employee->>'department_id')::uuid,(item.before_employee->>'operational_unit_id')::uuid,(item.before_employee->>'position_id')::uuid,(item.before_employee->>'position_family_id')::uuid,item.before_employee->>'grade_or_band',(item.before_employee->>'hire_date')::date,(item.before_employee->>'probation_or_confirmation_date')::date,item.before_employee->>'employment_status',(item.before_employee->>'is_active')::boolean,item.before_identifiers);
    end if;
  end loop;
  update public.import_commits set status='reverted',version=version+1,reverted_by=authorization.actor_user_id,reverted_at=pg_catalog.transaction_timestamp() where id=commit_row.id;
  perform app_private.neon_import_commit_audit(authorization.request_id,authorization.auth_user_id,authorization.actor_user_id,authorization.tenant_id,authorization.property_id,p_batch_id,commit_row.id,'revert',jsonb_build_object('previousVersion',commit_row.version,'nextVersion',commit_row.version+1,'destructiveDelete',false));
  return jsonb_build_object('commitId',commit_row.id,'batchId',p_batch_id,'status','reverted','version',commit_row.version+1,'destructiveDelete',false);
end
$function$;

alter function app_private.assert_neon_import_commit_batch(text,uuid) owner to hotel_ld_migration_owner;
alter function app_private.neon_import_employee_mutation_core(text,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,text,date,date,text,boolean,jsonb) owner to hotel_ld_migration_owner;
alter function app_private.neon_import_commit_identifiers(uuid,text,text,text) owner to hotel_ld_migration_owner;
alter function app_private.neon_import_commit_audit(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) owner to hotel_ld_migration_owner;
alter function public.commit_neon_import_batch(text,uuid,bigint,bigint,text,boolean) owner to hotel_ld_migration_owner;
alter function public.preview_neon_import_revert(text,uuid) owner to hotel_ld_migration_owner;
alter function public.revert_neon_import_batch(text,uuid,bigint,boolean) owner to hotel_ld_migration_owner;

revoke all on function app_private.assert_neon_import_commit_batch(text,uuid) from public;
revoke all on function app_private.neon_import_employee_mutation_core(text,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,text,date,date,text,boolean,jsonb) from public;
revoke all on function app_private.neon_import_commit_identifiers(uuid,text,text,text) from public;
revoke all on function app_private.neon_import_commit_audit(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb) from public;
revoke all on function public.commit_neon_import_batch(text,uuid,bigint,bigint,text,boolean) from public;
revoke all on function public.preview_neon_import_revert(text,uuid) from public;
revoke all on function public.revert_neon_import_batch(text,uuid,bigint,boolean) from public;
grant execute on function public.commit_neon_import_batch(text,uuid,bigint,bigint,text,boolean) to hotel_ld_application;
grant execute on function public.preview_neon_import_revert(text,uuid) to hotel_ld_application;
grant execute on function public.revert_neon_import_batch(text,uuid,bigint,boolean) to hotel_ld_application;

set local check_function_bodies = on;
commit;
