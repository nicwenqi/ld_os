create or replace function app_private.prevent_employee_scope_change() returns trigger language plpgsql set search_path='' as $$
begin
  if new.tenant_id <> old.tenant_id or new.property_id <> old.property_id or new.employee_number <> old.employee_number then
    raise exception 'EMPLOYEE_IDENTITY_IMMUTABLE: tenant, property and employee number cannot change' using errcode='23514';
  end if; return new;
end $$;
create or replace function app_private.prevent_import_batch_scope_change() returns trigger language plpgsql set search_path='' as $$
begin
  if new.tenant_id <> old.tenant_id or new.property_id <> old.property_id or new.id <> old.id
    or new.original_filename <> old.original_filename or new.sanitized_filename <> old.sanitized_filename
    or new.storage_object_path <> old.storage_object_path or new.file_checksum <> old.file_checksum then
    raise exception 'IMPORT_BATCH_SCOPE_IMMUTABLE: batch ownership cannot change' using errcode='23514';
  end if; return new;
end $$;
create or replace function app_private.prevent_import_row_identity_change() returns trigger language plpgsql set search_path='' as $$
begin
  if new.tenant_id <> old.tenant_id or new.property_id <> old.property_id or new.import_batch_id <> old.import_batch_id or new.import_sheet_id <> old.import_sheet_id or new.source_row_number <> old.source_row_number or new.raw_values <> old.raw_values then
    raise exception 'IMPORT_ROW_EVIDENCE_IMMUTABLE: source evidence cannot move or be overwritten' using errcode='23514';
  end if; return new;
end $$;
create or replace function app_private.prevent_scoped_row_move() returns trigger language plpgsql set search_path='' as $$
begin
  if (to_jsonb(new)->>'tenant_id') <> (to_jsonb(old)->>'tenant_id') or (to_jsonb(new)->>'property_id') <> (to_jsonb(old)->>'property_id') then
    raise exception 'ROW_SCOPE_IMMUTABLE: tenant and property cannot change' using errcode='23514';
  end if; return new;
end $$;

create trigger employees_scope_immutable before update on public.employees for each row execute function app_private.prevent_employee_scope_change();
create trigger import_batches_scope_immutable before update on public.import_batches for each row execute function app_private.prevent_import_batch_scope_change();
create trigger import_source_rows_identity_immutable before update on public.import_source_rows for each row execute function app_private.prevent_import_row_identity_change();
create trigger employee_identifiers_scope_immutable before update on public.employee_external_identifiers for each row execute function app_private.prevent_scoped_row_move();
create trigger import_sheets_scope_immutable before update on public.import_sheets for each row execute function app_private.prevent_scoped_row_move();
create trigger import_field_mappings_scope_immutable before update on public.import_field_mappings for each row execute function app_private.prevent_scoped_row_move();
create trigger import_issues_scope_immutable before update on public.import_issues for each row execute function app_private.prevent_scoped_row_move();
create trigger import_resolution_rules_scope_immutable before update on public.import_resolution_rules for each row execute function app_private.prevent_scoped_row_move();
create trigger import_commits_scope_immutable before update on public.import_commits for each row execute function app_private.prevent_scoped_row_move();
create trigger import_commit_items_scope_immutable before update on public.import_commit_items for each row execute function app_private.prevent_scoped_row_move();

alter table public.employees enable row level security; alter table public.employees force row level security;
alter table public.employee_external_identifiers enable row level security; alter table public.employee_external_identifiers force row level security;
alter table public.import_batches enable row level security; alter table public.import_batches force row level security;
alter table public.import_sheets enable row level security; alter table public.import_sheets force row level security;
alter table public.import_source_rows enable row level security; alter table public.import_source_rows force row level security;
alter table public.import_field_mappings enable row level security; alter table public.import_field_mappings force row level security;
alter table public.import_issues enable row level security; alter table public.import_issues force row level security;
alter table public.import_resolution_rules enable row level security; alter table public.import_resolution_rules force row level security;
alter table public.import_commits enable row level security; alter table public.import_commits force row level security;
alter table public.import_commit_items enable row level security; alter table public.import_commit_items force row level security;

create policy employees_manager_select on public.employees for select to authenticated using ((select app_private.can_manage_property(property_id)));
create policy employees_manager_insert on public.employees for insert to authenticated with check ((select app_private.can_manage_property(property_id)));
create policy employees_manager_update on public.employees for update to authenticated using ((select app_private.can_manage_property(property_id))) with check ((select app_private.can_manage_property(property_id)));
create policy employee_identifiers_manager_select on public.employee_external_identifiers for select to authenticated using ((select app_private.can_manage_property(property_id)));
create policy employee_identifiers_manager_insert on public.employee_external_identifiers for insert to authenticated with check ((select app_private.can_manage_property(property_id)));
create policy employee_identifiers_manager_update on public.employee_external_identifiers for update to authenticated using ((select app_private.can_manage_property(property_id))) with check ((select app_private.can_manage_property(property_id)));
create policy import_batches_manager_select on public.import_batches for select to authenticated using ((select app_private.can_manage_property(property_id)));
create policy import_batches_manager_insert on public.import_batches for insert to authenticated with check ((select app_private.can_manage_property(property_id)));
create policy import_batches_manager_update on public.import_batches for update to authenticated using ((select app_private.can_manage_property(property_id))) with check ((select app_private.can_manage_property(property_id)));
create policy import_sheets_manager_select on public.import_sheets for select to authenticated using ((select app_private.can_manage_property(property_id)));
create policy import_sheets_manager_insert on public.import_sheets for insert to authenticated with check ((select app_private.can_manage_property(property_id)));
create policy import_sheets_manager_update on public.import_sheets for update to authenticated using ((select app_private.can_manage_property(property_id))) with check ((select app_private.can_manage_property(property_id)));
create policy import_rows_manager_select on public.import_source_rows for select to authenticated using ((select app_private.can_manage_property(property_id)));
create policy import_rows_manager_insert on public.import_source_rows for insert to authenticated with check ((select app_private.can_manage_property(property_id)));
create policy import_rows_manager_update on public.import_source_rows for update to authenticated using ((select app_private.can_manage_property(property_id))) with check ((select app_private.can_manage_property(property_id)));
create policy import_mappings_manager_select on public.import_field_mappings for select to authenticated using ((select app_private.can_manage_property(property_id)));
create policy import_mappings_manager_insert on public.import_field_mappings for insert to authenticated with check ((select app_private.can_manage_property(property_id)));
create policy import_mappings_manager_update on public.import_field_mappings for update to authenticated using ((select app_private.can_manage_property(property_id))) with check ((select app_private.can_manage_property(property_id)));
create policy import_issues_manager_select on public.import_issues for select to authenticated using ((select app_private.can_manage_property(property_id)));
create policy import_issues_manager_insert on public.import_issues for insert to authenticated with check ((select app_private.can_manage_property(property_id)));
create policy import_issues_manager_update on public.import_issues for update to authenticated using ((select app_private.can_manage_property(property_id))) with check ((select app_private.can_manage_property(property_id)));
create policy import_rules_manager_select on public.import_resolution_rules for select to authenticated using ((select app_private.can_manage_property(property_id)));
create policy import_rules_manager_insert on public.import_resolution_rules for insert to authenticated with check ((select app_private.can_manage_property(property_id)));
create policy import_rules_manager_update on public.import_resolution_rules for update to authenticated using ((select app_private.can_manage_property(property_id))) with check ((select app_private.can_manage_property(property_id)));
create policy import_commits_manager_select on public.import_commits for select to authenticated using ((select app_private.can_manage_property(property_id)));
create policy import_commits_manager_insert on public.import_commits for insert to authenticated with check ((select app_private.can_manage_property(property_id)));
create policy import_commits_manager_update on public.import_commits for update to authenticated using ((select app_private.can_manage_property(property_id))) with check ((select app_private.can_manage_property(property_id)));
create policy import_items_manager_select on public.import_commit_items for select to authenticated using ((select app_private.can_manage_property(property_id)));
create policy import_items_manager_insert on public.import_commit_items for insert to authenticated with check ((select app_private.can_manage_property(property_id)));
create policy import_items_manager_update on public.import_commit_items for update to authenticated using ((select app_private.can_manage_property(property_id))) with check ((select app_private.can_manage_property(property_id)));

grant select,insert,update on public.employees,public.employee_external_identifiers,public.import_batches,public.import_sheets,public.import_source_rows,public.import_field_mappings,public.import_issues,public.import_resolution_rules,public.import_commits,public.import_commit_items to authenticated;

create or replace function app_private.validate_import_resolution_target() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.target_entity_id is null then return new; end if;
  if new.target_entity_type='department' and not exists(select 1 from public.departments d where d.id=new.target_entity_id and d.tenant_id=new.tenant_id and d.property_id=new.property_id) then raise exception 'IMPORT_TARGET_SCOPE: department outside property' using errcode='23514';
  elsif new.target_entity_type='position' and not exists(select 1 from public.positions p where p.id=new.target_entity_id and p.tenant_id=new.tenant_id and p.property_id=new.property_id) then raise exception 'IMPORT_TARGET_SCOPE: position outside property' using errcode='23514';
  elsif new.target_entity_type='position_family' and not exists(select 1 from public.position_families f where f.id=new.target_entity_id and f.tenant_id=new.tenant_id and f.property_id=new.property_id) then raise exception 'IMPORT_TARGET_SCOPE: family outside property' using errcode='23514';
  elsif new.target_entity_type='operational_unit' and not exists(select 1 from public.operational_units u where u.id=new.target_entity_id and u.tenant_id=new.tenant_id and u.property_id=new.property_id) then raise exception 'IMPORT_TARGET_SCOPE: unit outside property' using errcode='23514'; end if;
  return new;
end $$;
create trigger import_resolution_target_scope before insert or update on public.import_resolution_rules for each row execute function app_private.validate_import_resolution_target();

create or replace function app_private.commit_employee_import(p_batch_id uuid, p_expected_version bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare b public.import_batches; r public.import_source_rows; c_id uuid; e public.employees; a public.import_proposed_action; ins int:=0; upd int:=0; same int:=0; exc int:=0; unresolved int;
begin
  select * into b from public.import_batches where id=p_batch_id for update;
  if not found then raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode='P3000'; end if;
  if not app_private.can_manage_property(b.property_id) then raise exception 'IMPORT_FORBIDDEN' using errcode='42501'; end if;
  if b.version<>p_expected_version then raise exception 'IMPORT_STALE_VERSION' using errcode='P3001'; end if;
  if b.status<>'ready_for_review' then raise exception 'IMPORT_NOT_READY' using errcode='P3002'; end if;
  select count(*) into unresolved from public.import_source_rows x where x.import_batch_id=b.id and x.proposed_action='unresolved';
  if unresolved>0 or exists(select 1 from public.import_issues i where i.import_batch_id=b.id and i.severity='error' and i.resolution_status='unresolved') then raise exception 'IMPORT_UNRESOLVED_ROWS' using errcode='P3003'; end if;
  if exists(select 1 from public.import_source_rows x where x.import_batch_id=b.id and x.proposed_action<>'excluded' group by x.normalized_values->>'employee_number' having count(*)>1) then raise exception 'IMPORT_DUPLICATE_EMPLOYEE_NUMBER' using errcode='P3004'; end if;
  insert into public.import_commits(tenant_id,property_id,import_batch_id,committed_by) values(b.tenant_id,b.property_id,b.id,auth.uid()) returning id into c_id;
  for r in select * from public.import_source_rows where import_batch_id=b.id order by source_row_number loop
    a:=r.proposed_action;
    if a='insert' then
      insert into public.employees(tenant_id,property_id,employee_number,name_zh,name_en,department_id,operational_unit_id,position_id,position_family_id,grade_or_band,hire_date,probation_or_confirmation_date,employment_status,is_new_employee,is_active,source_system,source_batch_id,created_by,updated_by)
      values(b.tenant_id,b.property_id,r.normalized_values->>'employee_number',nullif(r.normalized_values->>'name_zh',''),nullif(r.normalized_values->>'name_en',''),(r.normalized_values->>'department_id')::uuid,nullif(r.normalized_values->>'operational_unit_id','')::uuid,(r.normalized_values->>'position_id')::uuid,nullif(r.normalized_values->>'position_family_id','')::uuid,nullif(r.normalized_values->>'grade_or_band',''),nullif(r.normalized_values->>'hire_date','')::date,nullif(r.normalized_values->>'probation_or_confirmation_date','')::date,coalesce(nullif(r.normalized_values->>'employment_status','')::public.employee_employment_status,'active'),coalesce((r.normalized_values->>'is_new_employee')::boolean,false),true,b.source_system,b.id,auth.uid(),auth.uid()) returning * into e;
      ins:=ins+1;
      insert into public.import_commit_items(tenant_id,property_id,import_commit_id,import_source_row_id,employee_id,action,after_snapshot) values(b.tenant_id,b.property_id,c_id,r.id,e.id,'insert',to_jsonb(e));
    elsif a='update' then
      select * into e from public.employees where id=r.matched_employee_id for update;
      if e.version<>coalesce((r.validation_summary->>'expected_employee_version')::bigint,-1) then raise exception 'IMPORT_EMPLOYEE_STALE_VERSION' using errcode='P3005'; end if;
      insert into public.import_commit_items(tenant_id,property_id,import_commit_id,import_source_row_id,employee_id,action,before_snapshot) values(b.tenant_id,b.property_id,c_id,r.id,e.id,'update',to_jsonb(e));
      update public.employees set name_zh=coalesce(nullif(r.normalized_values->>'name_zh',''),name_zh),name_en=nullif(r.normalized_values->>'name_en',''),department_id=coalesce(nullif(r.normalized_values->>'department_id','')::uuid,department_id),position_id=coalesce(nullif(r.normalized_values->>'position_id','')::uuid,position_id),grade_or_band=coalesce(nullif(r.normalized_values->>'grade_or_band',''),grade_or_band),source_batch_id=b.id,updated_at=now(),updated_by=auth.uid(),version=version+1 where id=e.id returning * into e;
      update public.import_commit_items set after_snapshot=to_jsonb(e) where import_commit_id=c_id and import_source_row_id=r.id; upd:=upd+1;
    elsif a='unchanged' then same:=same+1; insert into public.import_commit_items(tenant_id,property_id,import_commit_id,import_source_row_id,employee_id,action,before_snapshot,after_snapshot) values(b.tenant_id,b.property_id,c_id,r.id,r.matched_employee_id,'unchanged',r.validation_summary->'current_snapshot',r.validation_summary->'current_snapshot');
    else exc:=exc+1; insert into public.import_commit_items(tenant_id,property_id,import_commit_id,import_source_row_id,action) values(b.tenant_id,b.property_id,c_id,r.id,'excluded'); end if;
    if a in ('insert','update') then
      if exists(select 1 from public.employee_external_identifiers x where x.property_id=b.property_id and x.source_system=b.source_system and x.identifier_value in (r.normalized_values->>'lms_employee_id',r.normalized_values->>'merlin_id') and x.employee_id<>e.id) then raise exception 'IMPORT_EXTERNAL_IDENTIFIER_CONFLICT' using errcode='P3006'; end if;
      insert into public.employee_external_identifiers(tenant_id,property_id,employee_id,source_system,identifier_type,identifier_value,is_primary,is_active,source_batch_id)
      select b.tenant_id,b.property_id,e.id,b.source_system,v.kind::public.employee_identifier_type,v.value,v.kind='local_employee_number',true,b.id
      from (values ('local_employee_number',e.employee_number),('lms_employee_id',nullif(r.normalized_values->>'lms_employee_id','')),('merlin_id',nullif(r.normalized_values->>'merlin_id',''))) v(kind,value)
      where v.value is not null
      on conflict(property_id,source_system,identifier_value) do update set is_active=true,updated_at=now(),source_batch_id=b.id where public.employee_external_identifiers.employee_id=e.id;
    end if;
    update public.import_source_rows set processing_status=case when a='excluded' then 'excluded'::public.import_row_status else 'committed'::public.import_row_status end where id=r.id;
  end loop;
  update public.import_commits set inserted_employee_count=ins,updated_employee_count=upd,unchanged_employee_count=same,excluded_row_count=exc,commit_summary=jsonb_build_object('training_history_imported',false,'ctc_gtc_imported',false) where id=c_id;
  update public.import_batches set status=case when warning_rows>0 then 'completed_with_warnings'::public.import_batch_status else 'completed'::public.import_batch_status end,completed_at=now(),version=version+1 where id=b.id;
  return c_id;
end $$;

create or replace function public.commit_employee_import(p_batch_id uuid,p_expected_version bigint) returns uuid language sql security definer set search_path='' as $$ select app_private.commit_employee_import(p_batch_id,p_expected_version) $$;

create or replace function app_private.preview_employee_import_revert(p_batch_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.import_batches; conflicts bigint; begin
 select * into b from public.import_batches where id=p_batch_id; if not found then raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode='P3000'; end if;
 if not app_private.can_manage_property(b.property_id) then raise exception 'IMPORT_FORBIDDEN' using errcode='42501'; end if;
 select count(*) into conflicts from public.import_commit_items i join public.employees e on e.id=i.employee_id where i.import_commit_id=(select id from public.import_commits where import_batch_id=p_batch_id) and i.action in ('insert','update') and (e.source_batch_id is distinct from p_batch_id or e.version <> coalesce((i.after_snapshot->>'version')::bigint,e.version));
 return jsonb_build_object('safe',conflicts=0,'conflicts',conflicts,'strategy','inserted employees deactivate; updates restore audited snapshot');
end $$;
create or replace function public.preview_employee_import_revert(p_batch_id uuid) returns jsonb language sql security definer set search_path='' as $$ select app_private.preview_employee_import_revert(p_batch_id) $$;

create or replace function app_private.revert_employee_import(p_batch_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare b public.import_batches; c public.import_commits; item public.import_commit_items; preview jsonb;
begin
  select * into b from public.import_batches where id=p_batch_id for update;
  if not found then raise exception 'IMPORT_BATCH_NOT_FOUND' using errcode='P3000'; end if;
  if not app_private.can_manage_property(b.property_id) then raise exception 'IMPORT_FORBIDDEN' using errcode='42501'; end if;
  select * into c from public.import_commits where import_batch_id=p_batch_id for update;
  if not found or c.reverted_at is not null or b.status not in ('completed','completed_with_warnings') then raise exception 'IMPORT_REVERT_NOT_ALLOWED' using errcode='P3010'; end if;
  preview:=app_private.preview_employee_import_revert(p_batch_id);
  if not (preview->>'safe')::boolean then raise exception 'IMPORT_REVERT_CONFLICT: later changes must be resolved first' using errcode='P3011'; end if;
  for item in select * from public.import_commit_items where import_commit_id=c.id order by created_at desc loop
    if item.action='insert' and item.employee_id is not null then
      update public.employees set is_active=false,employment_status='inactive',updated_at=now(),updated_by=auth.uid(),version=version+1 where id=item.employee_id;
      update public.employee_external_identifiers set is_active=false,updated_at=now() where employee_id=item.employee_id and source_batch_id=p_batch_id;
    elsif item.action='update' and item.employee_id is not null then
      update public.employees set name_zh=item.before_snapshot->>'name_zh',name_en=item.before_snapshot->>'name_en',department_id=(item.before_snapshot->>'department_id')::uuid,operational_unit_id=nullif(item.before_snapshot->>'operational_unit_id','')::uuid,position_id=nullif(item.before_snapshot->>'position_id','')::uuid,position_family_id=nullif(item.before_snapshot->>'position_family_id','')::uuid,grade_or_band=item.before_snapshot->>'grade_or_band',hire_date=nullif(item.before_snapshot->>'hire_date','')::date,probation_or_confirmation_date=nullif(item.before_snapshot->>'probation_or_confirmation_date','')::date,employment_status=(item.before_snapshot->>'employment_status')::public.employee_employment_status,is_new_employee=(item.before_snapshot->>'is_new_employee')::boolean,is_active=(item.before_snapshot->>'is_active')::boolean,source_system=item.before_snapshot->>'source_system',source_batch_id=nullif(item.before_snapshot->>'source_batch_id','')::uuid,updated_at=now(),updated_by=auth.uid(),version=version+1 where id=item.employee_id;
      update public.employee_external_identifiers set is_active=false,updated_at=now() where employee_id=item.employee_id and source_batch_id=p_batch_id;
    end if;
  end loop;
  update public.import_commits set reverted_at=now(),reverted_by=auth.uid() where id=c.id;
  update public.import_batches set status='reverted',reverted_at=now(),version=version+1 where id=b.id;
end $$;
create or replace function public.revert_employee_import(p_batch_id uuid) returns void language sql security definer set search_path='' as $$ select app_private.revert_employee_import(p_batch_id) $$;

revoke execute on function app_private.commit_employee_import(uuid,bigint), app_private.preview_employee_import_revert(uuid), app_private.revert_employee_import(uuid) from public,anon,authenticated;
grant execute on function public.commit_employee_import(uuid,bigint), public.preview_employee_import_revert(uuid), public.revert_employee_import(uuid) to authenticated;
revoke all on function public.commit_employee_import(uuid,bigint), public.preview_employee_import_revert(uuid), public.revert_employee_import(uuid) from anon;
revoke all on all tables in schema public from anon;
