begin;
set local role hotel_ld_migration_owner;

create type public.position_resolution_status as enum ('mapped','family_only','external_only','ignored','deferred');

create table public.position_families (
  id uuid primary key default pg_catalog.gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  code text not null, name_zh text not null, name_en text, description text, sort_order integer not null default 0,
  is_active boolean not null default true, version bigint not null default 1 check (version > 0),
  foreign key (tenant_id,property_id) references public.properties(tenant_id,id),
  unique(property_id,id), unique(tenant_id,property_id,id), unique(property_id,code)
);
create table public.positions (
  id uuid primary key default pg_catalog.gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  position_family_id uuid, code text not null, name_zh text not null,
  name_en text, grade_or_band text, is_active boolean not null default true, version bigint not null default 1 check(version>0),
  foreign key (tenant_id,property_id) references public.properties(tenant_id,id),
  foreign key (tenant_id,property_id,position_family_id) references public.position_families(tenant_id,property_id,id),
  unique(property_id,id), unique(tenant_id,property_id,id), unique(property_id,code)
);
create table public.position_department_assignments (
  id uuid primary key default pg_catalog.gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  position_id uuid not null, department_id uuid not null,
  is_active boolean not null default true, foreign key (tenant_id,property_id) references public.properties(tenant_id,id),
  foreign key (tenant_id,property_id,position_id) references public.positions(tenant_id,property_id,id),
  foreign key (tenant_id,property_id,department_id) references public.departments(tenant_id,property_id,id),
  unique(position_id,department_id)
);
create table public.position_aliases (
  id uuid primary key default pg_catalog.gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  source_system text not null, source_sheet text not null, source_value text not null, normalized_source_value text not null,
  source_row_count integer not null default 0 check(source_row_count>=0), suggested_position_id uuid,
  suggested_family_id uuid, confidence integer not null default 0 check(confidence between 0 and 100),
  suggestion_reason text not null default '', target_position_id uuid,
  target_position_family_id uuid, external_role_code text, external_role_name text,
  resolution_status public.position_resolution_status not null default 'deferred', is_active boolean not null default true,
  resolved_by uuid, resolved_at timestamptz, version bigint not null default 1,
  foreign key (tenant_id,property_id) references public.properties(tenant_id,id),
  foreign key (tenant_id,property_id,suggested_position_id) references public.positions(tenant_id,property_id,id),
  foreign key (tenant_id,property_id,suggested_family_id) references public.position_families(tenant_id,property_id,id),
  foreign key (tenant_id,property_id,target_position_id) references public.positions(tenant_id,property_id,id),
  foreign key (tenant_id,property_id,target_position_family_id) references public.position_families(tenant_id,property_id,id),
  unique(property_id,source_system,source_sheet,normalized_source_value)
);

create table app_private.position_read_audit_events (like app_private.organization_read_audit_events including all);
create table app_private.position_write_audit_events (like app_private.organization_read_audit_events including all);
create table app_private.position_mapping_audit_events (like app_private.organization_read_audit_events including all);

create function app_private.reject_position_read_audit_mutation() returns trigger language plpgsql volatile security invoker set search_path='' as $f$ begin raise exception using errcode='42501',message='POSITION_READ_AUDIT_APPEND_ONLY'; end $f$;
create function app_private.reject_position_write_audit_mutation() returns trigger language plpgsql volatile security invoker set search_path='' as $f$ begin raise exception using errcode='42501',message='POSITION_WRITE_AUDIT_APPEND_ONLY'; end $f$;
create function app_private.reject_position_mapping_audit_mutation() returns trigger language plpgsql volatile security invoker set search_path='' as $f$ begin raise exception using errcode='42501',message='POSITION_MAPPING_AUDIT_APPEND_ONLY'; end $f$;
create trigger position_read_audit_append_only before update or delete on app_private.position_read_audit_events for each row execute function app_private.reject_position_read_audit_mutation();
create trigger e4_position_write_audit_append_only before update or delete on app_private.position_write_audit_events for each row execute function app_private.reject_position_write_audit_mutation();
create trigger e4c_position_mapping_audit_append_only before update or delete on app_private.position_mapping_audit_events for each row execute function app_private.reject_position_mapping_audit_mutation();

create function app_private.neon_position_actor_can_read_position(p_id uuid) returns boolean language sql stable security invoker set search_path='' as $f$
  select app_private.neon_organization_actor_has_role('property_ld_manager') or exists(select 1 from public.position_department_assignments a where a.position_id=p_id and a.property_id=app_private.current_actor_property_id() and a.is_active and app_private.neon_organization_actor_has_department_scope(a.department_id))
$f$;
create function app_private.neon_position_alias_payload(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $f$
  select pg_catalog.jsonb_build_object('id',a.id,'property_id',a.property_id,'source_system',a.source_system,'source_sheet',a.source_sheet,'source_value',a.source_value,'normalized_source_value',a.normalized_source_value,'source_row_count',a.source_row_count,'suggested_position_id',a.suggested_position_id,'suggested_family_id',a.suggested_family_id,'confidence',a.confidence,'suggestion_reason',a.suggestion_reason,'target_position_id',a.target_position_id,'target_position_family_id',a.target_position_family_id,'external_role_code',a.external_role_code,'external_role_name',a.external_role_name,'resolution_status',a.resolution_status) from public.position_aliases a where a.id=p_id
$f$;
create function app_private.append_neon_position_read_audit(p_operation text,p_count integer) returns void language plpgsql volatile security invoker set search_path='' as $f$
declare a uuid; t uuid; begin a:=app_private.current_neon_organization_actor_user_id(); select tenant_id into t from public.properties where id=app_private.current_actor_property_id(); insert into app_private.position_read_audit_events(request_id,auth_user_id,actor_user_id,tenant_id,property_id,operation,details) values(app_private.current_actor_request_id(),app_private.current_actor_auth_user_id(),a,t,app_private.current_actor_property_id(),p_operation,pg_catalog.jsonb_build_object('count',p_count)); end $f$;
create function app_private.append_neon_position_write_audit(p_type text,p_id uuid,p_operation text,p_before bigint,p_after bigint,p_before_count integer,p_after_count integer,p_fields text[]) returns void language plpgsql volatile security invoker set search_path='' as $f$
declare a uuid; t uuid; begin a:=app_private.current_neon_organization_actor_user_id(); select tenant_id into t from public.properties where id=app_private.current_actor_property_id(); insert into app_private.position_write_audit_events(request_id,auth_user_id,actor_user_id,tenant_id,property_id,operation,target_id,details) values(app_private.current_actor_request_id(),app_private.current_actor_auth_user_id(),a,t,app_private.current_actor_property_id(),p_operation,p_id,pg_catalog.jsonb_build_object('type',p_type,'previous_version',p_before,'result_version',p_after,'previous_assignment_count',p_before_count,'result_assignment_count',p_after_count,'changed_fields',p_fields)); end $f$;

create function public.read_neon_position_families(p_hostname text) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare r jsonb; c integer; begin perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_reader(); select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'tenant_id',tenant_id,'property_id',property_id,'code',code,'name_zh',name_zh,'name_en',name_en,'description',description,'sort_order',sort_order,'is_active',is_active,'version',version) order by sort_order,name_zh),'[]'::jsonb),count(*)::integer into r,c from public.position_families where property_id=app_private.current_actor_property_id(); perform app_private.append_neon_position_read_audit('position_families',c); return pg_catalog.jsonb_build_object('rows',r); end $f$;
create function public.read_neon_positions(p_hostname text) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare r jsonb; c integer; begin perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_reader(); select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',p.id,'tenant_id',p.tenant_id,'property_id',p.property_id,'position_family_id',p.position_family_id,'code',p.code,'name_zh',p.name_zh,'name_en',p.name_en,'grade_or_band',p.grade_or_band,'is_active',p.is_active,'version',p.version,'department_ids',coalesce((select pg_catalog.jsonb_agg(a.department_id order by a.department_id) from public.position_department_assignments a where a.position_id=p.id and a.is_active),'[]'::jsonb)) order by p.name_zh),'[]'::jsonb),count(*)::integer into r,c from public.positions p where p.property_id=app_private.current_actor_property_id() and app_private.neon_position_actor_can_read_position(p.id); perform app_private.append_neon_position_read_audit('positions',c); return pg_catalog.jsonb_build_object('rows',r); end $f$;

create function public.save_neon_position_family(p_hostname text,p_tenant uuid,p_property uuid,p_id uuid,p_version bigint,p_code text,p_zh text,p_en text,p_description text,p_sort integer,p_active boolean) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare i uuid:=coalesce(p_id,pg_catalog.gen_random_uuid()); v bigint; begin perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_manager(); if p_property<>app_private.current_actor_property_id() then raise exception using errcode='42501',message='NEON_POSITION_SCOPE_DENIED'; end if; if p_id is null then insert into public.position_families(id,tenant_id,property_id,code,name_zh,name_en,description,sort_order,is_active) values(i,p_tenant,p_property,pg_catalog.btrim(p_code),pg_catalog.btrim(p_zh),nullif(pg_catalog.btrim(p_en),''),nullif(pg_catalog.btrim(p_description),''),p_sort,p_active) returning version into v; else update public.position_families set code=pg_catalog.btrim(p_code),name_zh=pg_catalog.btrim(p_zh),name_en=nullif(pg_catalog.btrim(p_en),''),description=nullif(pg_catalog.btrim(p_description),''),sort_order=p_sort,is_active=p_active,version=version+1 where id=p_id and property_id=p_property and version=p_version returning version into v; if not found then raise exception using errcode='40001',message='NEON_POSITION_VERSION_CONFLICT'; end if; end if; perform app_private.append_neon_position_write_audit('position_family',i,case when p_id is null then 'create' else 'update' end,case when p_id is null then null else p_version end,v,null,null,array['code','name_zh','name_en','description','sort_order','is_active']); return (select pg_catalog.jsonb_build_object('id',id,'tenant_id',tenant_id,'property_id',property_id,'code',code,'name_zh',name_zh,'name_en',name_en,'description',description,'sort_order',sort_order,'is_active',is_active,'version',version) from public.position_families where id=i); end $f$;

create function public.save_neon_position_with_departments(p_hostname text,p_tenant uuid,p_property uuid,p_id uuid,p_version bigint,p_family uuid,p_code text,p_zh text,p_en text,p_grade text,p_active boolean,p_departments uuid[]) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare i uuid:=coalesce(p_id,pg_catalog.gen_random_uuid()); v bigint; before_count integer:=0; after_count integer; begin perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_manager(); if p_property<>app_private.current_actor_property_id() or pg_catalog.cardinality(p_departments)<>pg_catalog.cardinality(array(select distinct x from pg_catalog.unnest(p_departments) x)) or exists(select 1 from pg_catalog.unnest(p_departments) x left join public.departments d on d.id=x and d.property_id=p_property where d.id is null) then raise exception using errcode='22023',message='NEON_POSITION_DEPARTMENT_SCOPE_INVALID'; end if; if p_id is null then insert into public.positions(id,tenant_id,property_id,position_family_id,code,name_zh,name_en,grade_or_band,is_active) values(i,p_tenant,p_property,p_family,pg_catalog.btrim(p_code),pg_catalog.btrim(p_zh),nullif(pg_catalog.btrim(p_en),''),nullif(pg_catalog.btrim(p_grade),''),p_active) returning version into v; else select count(*) into before_count from public.position_department_assignments where position_id=i and is_active; update public.positions set position_family_id=p_family,code=pg_catalog.btrim(p_code),name_zh=pg_catalog.btrim(p_zh),name_en=nullif(pg_catalog.btrim(p_en),''),grade_or_band=nullif(pg_catalog.btrim(p_grade),''),is_active=p_active,version=version+1 where id=i and property_id=p_property and version=p_version returning version into v; if not found then raise exception using errcode='40001',message='NEON_POSITION_VERSION_CONFLICT'; end if; delete from public.position_department_assignments where position_id=i; end if; insert into public.position_department_assignments(tenant_id,property_id,position_id,department_id) select p_tenant,p_property,i,x from pg_catalog.unnest(coalesce(p_departments,'{}'::uuid[])) x; after_count:=coalesce(pg_catalog.cardinality(p_departments),0); perform app_private.append_neon_position_write_audit('position',i,case when p_id is null then 'create' else 'update' end,case when p_id is null then null else p_version end,v,before_count,after_count,array['position_family_id','code','name_zh','name_en','grade_or_band','is_active','department_assignments']); return (select pg_catalog.jsonb_build_object('id',p.id,'tenant_id',p.tenant_id,'property_id',p.property_id,'position_family_id',p.position_family_id,'code',p.code,'name_zh',p.name_zh,'name_en',p.name_en,'grade_or_band',p.grade_or_band,'is_active',p.is_active,'version',p.version,'department_ids',coalesce((select pg_catalog.jsonb_agg(a.department_id order by a.department_id) from public.position_department_assignments a where a.position_id=p.id and a.is_active),'[]'::jsonb)) from public.positions p where p.id=i); end $f$;

create function public.read_neon_position_source_labels(p_hostname text) returns jsonb language plpgsql volatile security definer set search_path='' as $f$ declare r jsonb; begin perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_manager(); select coalesce(pg_catalog.jsonb_agg(app_private.neon_position_alias_payload(id) order by source_value),'[]'::jsonb) into r from public.position_aliases where property_id=app_private.current_actor_property_id() and is_active; perform app_private.append_neon_position_read_audit('position_source_labels',pg_catalog.jsonb_array_length(r)); return pg_catalog.jsonb_build_object('rows',r); end $f$;
create function public.preview_neon_position_source_impact(p_hostname text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $f$ declare a public.position_aliases; begin perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_manager(); select * into strict a from public.position_aliases where id=p_id and property_id=app_private.current_actor_property_id(); return pg_catalog.jsonb_build_object('source_label_id',a.id,'source_evidence',pg_catalog.jsonb_build_object('source_system',a.source_system,'source_sheet',a.source_sheet,'source_row_count',a.source_row_count),'employee_impact',pg_catalog.jsonb_build_object('state','unavailable','reason','import_source_rows_not_migrated'),'department_impact',pg_catalog.jsonb_build_object('state','unavailable','reason','import_source_rows_not_migrated')); end $f$;
create function public.resolve_neon_position_alias(p_hostname text,p_id uuid,p_action text,p_target uuid,p_external_code text,p_external_name text) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare alias_row public.position_aliases; position public.positions; family public.position_families; status public.position_resolution_status; authoritative_family uuid;
begin
  perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_manager();
  select * into strict alias_row from public.position_aliases where id=p_id and property_id=app_private.current_actor_property_id() and is_active for update;
  status:=case p_action when 'position' then 'mapped'::public.position_resolution_status when 'family' then 'family_only'::public.position_resolution_status when 'external' then 'external_only'::public.position_resolution_status when 'ignore' then 'ignored'::public.position_resolution_status when 'defer' then 'deferred'::public.position_resolution_status else null end;
  if status is null then raise exception using errcode='22023',message='NEON_POSITION_ALIAS_ACTION_INVALID'; end if;
  if p_action='position' then
    if p_target is null or p_external_code is not null or p_external_name is not null then raise exception using errcode='22023',message='NEON_POSITION_ALIAS_TARGET_INVALID'; end if;
    select * into strict position from public.positions where id=p_target and tenant_id=alias_row.tenant_id and property_id=alias_row.property_id and is_active for key share;
    authoritative_family:=position.position_family_id;
    if authoritative_family is not null then select * into strict family from public.position_families where id=authoritative_family and tenant_id=alias_row.tenant_id and property_id=alias_row.property_id and is_active for key share; end if;
  elsif p_action='family' then
    if p_target is null or p_external_code is not null or p_external_name is not null then raise exception using errcode='22023',message='NEON_POSITION_ALIAS_TARGET_INVALID'; end if;
    select * into strict family from public.position_families where id=p_target and tenant_id=alias_row.tenant_id and property_id=alias_row.property_id and is_active for key share; authoritative_family:=family.id;
  elsif p_action='external' then
    if p_target is not null then raise exception using errcode='22023',message='NEON_POSITION_ALIAS_TARGET_INVALID'; end if;
    if nullif(pg_catalog.btrim(coalesce(p_external_code,'')),'') is null then raise exception using errcode='22023',message='NEON_POSITION_ALIAS_EXTERNAL_ROLE_CODE_REQUIRED'; end if;
    if nullif(pg_catalog.btrim(coalesce(p_external_name,'')),'') is null then raise exception using errcode='22023',message='NEON_POSITION_ALIAS_EXTERNAL_ROLE_NAME_REQUIRED'; end if;
  elsif p_target is not null or p_external_code is not null or p_external_name is not null then raise exception using errcode='22023',message='NEON_POSITION_ALIAS_TARGET_INVALID';
  end if;
  update public.position_aliases set target_position_id=case when p_action='position' then p_target else null end,target_position_family_id=case when p_action in ('position','family') then authoritative_family else null end,external_role_code=case when p_action='external' then pg_catalog.lower(pg_catalog.btrim(p_external_code)) else null end,external_role_name=case when p_action='external' then pg_catalog.btrim(p_external_name) else null end,resolution_status=status,resolved_by=app_private.current_neon_organization_actor_user_id(),resolved_at=pg_catalog.transaction_timestamp(),version=version+1 where id=p_id and tenant_id=alias_row.tenant_id and property_id=alias_row.property_id;
  insert into app_private.position_mapping_audit_events(request_id,auth_user_id,actor_user_id,tenant_id,property_id,operation,target_id,details) values(app_private.current_actor_request_id(),app_private.current_actor_auth_user_id(),app_private.current_neon_organization_actor_user_id(),alias_row.tenant_id,alias_row.property_id,p_action,p_id,pg_catalog.jsonb_build_object('target',p_target,'family',authoritative_family,'external_code',p_external_code,'external_name',p_external_name)); return app_private.neon_position_alias_payload(p_id);
end $f$;

revoke all on function app_private.reject_position_read_audit_mutation() from public;
revoke all on function app_private.reject_position_write_audit_mutation() from public;
revoke all on function app_private.reject_position_mapping_audit_mutation() from public;
revoke all on function app_private.neon_position_actor_can_read_position(uuid) from public;
revoke all on function app_private.neon_position_alias_payload(uuid) from public;
revoke all on function app_private.append_neon_position_read_audit(text,integer) from public;
revoke all on function app_private.append_neon_position_write_audit(text,uuid,text,bigint,bigint,integer,integer,text[]) from public;
revoke all on function public.read_neon_position_families(text) from public;
revoke all on function public.read_neon_positions(text) from public;
revoke all on function public.save_neon_position_family(text,uuid,uuid,uuid,bigint,text,text,text,text,integer,boolean) from public;
revoke all on function public.save_neon_position_with_departments(text,uuid,uuid,uuid,bigint,uuid,text,text,text,text,boolean,uuid[]) from public;
revoke all on function public.read_neon_position_source_labels(text) from public;
revoke all on function public.preview_neon_position_source_impact(text,uuid) from public;
revoke all on function public.resolve_neon_position_alias(text,uuid,text,uuid,text,text) from public;

grant execute on function public.read_neon_position_families(text) to hotel_ld_application;
grant execute on function public.read_neon_positions(text) to hotel_ld_application;
grant execute on function public.save_neon_position_family(text,uuid,uuid,uuid,bigint,text,text,text,text,integer,boolean) to hotel_ld_application;
grant execute on function public.save_neon_position_with_departments(text,uuid,uuid,uuid,bigint,uuid,text,text,text,text,boolean,uuid[]) to hotel_ld_application;
grant execute on function public.read_neon_position_source_labels(text) to hotel_ld_application;
grant execute on function public.preview_neon_position_source_impact(text,uuid) to hotel_ld_application;
grant execute on function public.resolve_neon_position_alias(text,uuid,text,uuid,text,text) to hotel_ld_application;

commit;
