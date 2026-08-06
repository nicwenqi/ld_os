/* E4B Position write. Child branch only; no aliases, mapping, registry, or UI activation. */
begin;

do $e4_preflight$ begin
  if current_database() <> 'neondb' or current_user <> 'neondb_owner' or session_user <> 'neondb_owner' then
    raise exception using errcode='42501',message='E4_POSITION_WRITE_BOOTSTRAP_IDENTITY_MISMATCH';
  end if;
  if not pg_catalog.pg_has_role(current_user,'hotel_ld_migration_owner','SET') then
    raise exception using errcode='42501',message='E4_POSITION_WRITE_MIGRATION_OWNER_REQUIRED';
  end if;
  if pg_catalog.to_regclass('app_private.position_write_audit_events') is not null
     or pg_catalog.to_regprocedure('public.save_neon_position_family(text,uuid,uuid,uuid,bigint,text,text,text,text,integer,boolean)') is not null
     or pg_catalog.to_regprocedure('public.save_neon_position_with_departments(text,uuid,uuid,uuid,bigint,uuid,text,text,text,text,boolean,uuid[])') is not null then
    raise exception using errcode='42710',message='E4_POSITION_WRITE_OBJECT_EXISTS';
  end if;
end $e4_preflight$;

grant select,insert,update on public.position_families to hotel_ld_migration_owner;
grant select,insert,update on public.positions to hotel_ld_migration_owner;
grant select,insert,delete on public.position_department_assignments to hotel_ld_migration_owner;

create policy e4_position_families_insert on public.position_families for insert to hotel_ld_migration_owner
with check(session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id() and app_private.neon_organization_actor_has_role('property_ld_manager'));
create policy e4_position_families_update on public.position_families for update to hotel_ld_migration_owner
using(session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id() and app_private.neon_organization_actor_has_role('property_ld_manager'))
with check(session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id() and app_private.neon_organization_actor_has_role('property_ld_manager'));
create policy e4_positions_insert on public.positions for insert to hotel_ld_migration_owner
with check(session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id() and app_private.neon_organization_actor_has_role('property_ld_manager'));
create policy e4_positions_update on public.positions for update to hotel_ld_migration_owner
using(session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id() and app_private.neon_organization_actor_has_role('property_ld_manager'))
with check(session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id() and app_private.neon_organization_actor_has_role('property_ld_manager'));
create policy e4_assignments_insert on public.position_department_assignments for insert to hotel_ld_migration_owner
with check(session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id() and app_private.neon_organization_actor_has_role('property_ld_manager'));
create policy e4_assignments_delete on public.position_department_assignments for delete to hotel_ld_migration_owner
using(session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id() and app_private.neon_organization_actor_has_role('property_ld_manager'));

set local role hotel_ld_migration_owner;
create table app_private.position_write_audit_events(
 id bigint generated always as identity primary key, request_id uuid not null, auth_user_id uuid not null, actor_user_id uuid not null, tenant_id uuid not null, property_id uuid not null, target_type text not null check(target_type in ('position_family','position')), target_id uuid not null, operation text not null check(operation in ('create','update')), previous_version bigint, result_version bigint not null check(result_version>0), previous_assignment_count integer, result_assignment_count integer, changed_fields text[] not null, occurred_at timestamptz not null default pg_catalog.transaction_timestamp()
);
alter table app_private.position_write_audit_events enable row level security;
alter table app_private.position_write_audit_events force row level security;
create policy e4_position_write_audit_insert on app_private.position_write_audit_events for insert to hotel_ld_migration_owner
with check(session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id());
create function app_private.reject_position_write_audit_mutation() returns trigger language plpgsql security invoker set search_path='' as $f$
begin raise exception using errcode='42501',message='POSITION_WRITE_AUDIT_APPEND_ONLY'; end $f$;
create trigger e4_position_write_audit_append_only before update or delete on app_private.position_write_audit_events for each row execute function app_private.reject_position_write_audit_mutation();
create function app_private.append_neon_position_write_audit(p_type text,p_id uuid,p_op text,p_before bigint,p_after bigint,p_before_count integer,p_after_count integer,p_fields text[]) returns void language plpgsql volatile security invoker set search_path='' as $f$
declare v_actor uuid; v_tenant uuid;
begin
 perform app_private.assert_neon_organization_manager(); v_actor:=app_private.current_neon_organization_actor_user_id();
 select tenant_id into v_tenant from public.properties where id=app_private.current_actor_property_id() and status::text='active';
 if v_actor is null or v_tenant is null then raise exception using errcode='42501',message='NEON_POSITION_WRITE_PROPERTY_FORBIDDEN'; end if;
 insert into app_private.position_write_audit_events(request_id,auth_user_id,actor_user_id,tenant_id,property_id,target_type,target_id,operation,previous_version,result_version,previous_assignment_count,result_assignment_count,changed_fields) values(app_private.current_actor_request_id(),app_private.current_actor_auth_user_id(),v_actor,v_tenant,app_private.current_actor_property_id(),p_type,p_id,p_op,p_before,p_after,p_before_count,p_after_count,p_fields);
end $f$;

create function public.save_neon_position_family(p_host text,p_tenant uuid,p_property uuid,p_id uuid,p_expected bigint,p_code text,p_name text,p_name_en text,p_description text,p_sort integer,p_active boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare v public.position_families%rowtype; v_id uuid; v_before bigint;
begin
 perform app_private.assert_neon_organization_runtime_session(); perform app_private.assert_actor_context(); perform app_private.assert_neon_organization_hostname(p_host); perform app_private.assert_neon_organization_manager();
 if p_property<>app_private.current_actor_property_id() or nullif(btrim(p_code),'') is null or nullif(btrim(p_name),'') is null then raise exception using errcode='P2006',message='NEON_POSITION_FAMILY_INPUT_INVALID'; end if;
 perform 1 from public.properties where id=p_property and tenant_id=p_tenant and status::text='active' for key share; if not found then raise exception using errcode='42501',message='NEON_POSITION_PROPERTY_FORBIDDEN'; end if;
 if p_id is null then
  if coalesce(p_expected,0)<>0 then raise exception using errcode='P2002',message='NEON_POSITION_FAMILY_STALE'; end if;
  insert into public.position_families(tenant_id,property_id,code,name_zh,name_en,description,sort_order,is_active,created_by,updated_by) values(p_tenant,p_property,lower(btrim(p_code)),btrim(p_name),nullif(btrim(p_name_en),''),nullif(btrim(p_description),''),coalesce(p_sort,0),coalesce(p_active,true),app_private.current_actor_auth_user_id(),app_private.current_actor_auth_user_id()) returning * into v; v_id:=v.id;
  perform app_private.append_neon_position_write_audit('position_family',v_id,'create',null,v.version,null,null,array['code','name_zh','name_en','description','sort_order','is_active']);
 else
  select * into v from public.position_families where id=p_id and property_id=p_property for update; if not found then raise exception using errcode='P2000',message='NEON_POSITION_FAMILY_NOT_FOUND'; end if; if v.version<>p_expected then raise exception using errcode='P2002',message='NEON_POSITION_FAMILY_STALE'; end if; v_before:=v.version;
  update public.position_families set code=lower(btrim(p_code)),name_zh=btrim(p_name),name_en=nullif(btrim(p_name_en),''),description=nullif(btrim(p_description),''),sort_order=coalesce(p_sort,0),is_active=coalesce(p_active,true),updated_by=app_private.current_actor_auth_user_id(),version=version+1 where id=p_id returning * into v; v_id:=p_id;
  perform app_private.append_neon_position_write_audit('position_family',v_id,'update',v_before,v.version,null,null,array['code','name_zh','name_en','description','sort_order','is_active']);
 end if;
 return jsonb_build_object('id',v.id,'tenant_id',v.tenant_id,'property_id',v.property_id,'code',v.code,'name_zh',v.name_zh,'name_en',v.name_en,'description',v.description,'sort_order',v.sort_order,'is_active',v.is_active,'version',v.version);
exception when unique_violation then raise exception using errcode='P2006',message='NEON_POSITION_FAMILY_CODE_CONFLICT'; end $f$;

create function public.save_neon_position_with_departments(p_host text,p_tenant uuid,p_property uuid,p_id uuid,p_expected bigint,p_family uuid,p_code text,p_name text,p_name_en text,p_grade text,p_active boolean,p_departments uuid[])
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare v public.positions%rowtype; v_id uuid; v_before bigint; v_count integer:=0; v_ids uuid[]:=coalesce(p_departments,'{}'::uuid[]);
begin
 perform app_private.assert_neon_organization_runtime_session(); perform app_private.assert_actor_context(); perform app_private.assert_neon_organization_hostname(p_host); perform app_private.assert_neon_organization_manager();
 if p_property<>app_private.current_actor_property_id() or nullif(btrim(p_code),'') is null or nullif(btrim(p_name),'') is null then raise exception using errcode='P2006',message='NEON_POSITION_INPUT_INVALID'; end if;
 perform 1 from public.properties where id=p_property and tenant_id=p_tenant and status::text='active' for key share; if not found then raise exception using errcode='42501',message='NEON_POSITION_PROPERTY_FORBIDDEN'; end if;
 if cardinality(v_ids)<>cardinality(array(select distinct x from unnest(v_ids) x)) then raise exception using errcode='P2006',message='NEON_POSITION_DUPLICATE_DEPARTMENTS'; end if;
 if p_family is not null then perform 1 from public.position_families where id=p_family and tenant_id=p_tenant and property_id=p_property and is_active for key share; if not found then raise exception using errcode='P2006',message='NEON_POSITION_FAMILY_INVALID'; end if; end if;
 perform 1 from public.departments where id=any(v_ids) and tenant_id=p_tenant and property_id=p_property and is_active order by id for key share; if (select count(*) from public.departments where id=any(v_ids) and tenant_id=p_tenant and property_id=p_property and is_active)<>cardinality(v_ids) then raise exception using errcode='P2006',message='NEON_POSITION_DEPARTMENT_INVALID'; end if;
 if p_id is null then
  if coalesce(p_expected,0)<>0 then raise exception using errcode='P2002',message='NEON_POSITION_STALE'; end if;
  insert into public.positions(tenant_id,property_id,position_family_id,code,name_zh,name_en,grade_or_band,is_active,created_by,updated_by) values(p_tenant,p_property,p_family,lower(btrim(p_code)),btrim(p_name),nullif(btrim(p_name_en),''),nullif(btrim(p_grade),''),coalesce(p_active,true),app_private.current_actor_auth_user_id(),app_private.current_actor_auth_user_id()) returning * into v; v_id:=v.id;
 else
  select * into v from public.positions where id=p_id and property_id=p_property for update; if not found then raise exception using errcode='P2000',message='NEON_POSITION_NOT_FOUND'; end if; if v.version<>p_expected then raise exception using errcode='P2002',message='NEON_POSITION_STALE'; end if; v_before:=v.version; v_id:=v.id;
  perform 1 from public.position_department_assignments where position_id=v_id order by department_id for update; select count(*) into v_count from public.position_department_assignments where position_id=v_id;
  update public.positions set position_family_id=p_family,code=lower(btrim(p_code)),name_zh=btrim(p_name),name_en=nullif(btrim(p_name_en),''),grade_or_band=nullif(btrim(p_grade),''),is_active=coalesce(p_active,true),updated_by=app_private.current_actor_auth_user_id() where id=v_id returning * into v;
 end if;
 delete from public.position_department_assignments where position_id=v_id; insert into public.position_department_assignments(tenant_id,property_id,position_id,department_id,is_primary) select p_tenant,p_property,v_id,x,n=1 from unnest(v_ids) with ordinality d(x,n);
 perform app_private.append_neon_position_write_audit('position',v_id,case when p_id is null then 'create' else 'update' end,v_before,v.version,case when p_id is null then 0 else v_count end,cardinality(v_ids),array['position_family_id','code','name_zh','name_en','grade_or_band','is_active','department_assignments']);
 return jsonb_build_object('id',v.id,'tenant_id',v.tenant_id,'property_id',v.property_id,'position_family_id',v.position_family_id,'code',v.code,'name_zh',v.name_zh,'name_en',v.name_en,'grade_or_band',v.grade_or_band,'is_active',v.is_active,'version',v.version,'department_ids',coalesce((select jsonb_agg(a.department_id order by a.is_primary desc,a.department_id) from public.position_department_assignments a where a.position_id=v.id),'[]'::jsonb));
exception when unique_violation then raise exception using errcode='P2006',message='NEON_POSITION_CODE_CONFLICT'; end $f$;

revoke all on table app_private.position_write_audit_events from public,authenticated,neondb_owner,hotel_ld_people_read,hotel_ld_application,hotel_ld_readonly;
revoke all on function app_private.reject_position_write_audit_mutation(),app_private.append_neon_position_write_audit(text,uuid,text,bigint,bigint,integer,integer,text[]),public.save_neon_position_family(text,uuid,uuid,uuid,bigint,text,text,text,text,integer,boolean),public.save_neon_position_with_departments(text,uuid,uuid,uuid,bigint,uuid,text,text,text,text,boolean,uuid[]) from public,authenticated,neondb_owner,hotel_ld_people_read,hotel_ld_application,hotel_ld_readonly;
grant execute on function public.save_neon_position_family(text,uuid,uuid,uuid,bigint,text,text,text,text,integer,boolean),public.save_neon_position_with_departments(text,uuid,uuid,uuid,bigint,uuid,text,text,text,text,boolean,uuid[]) to hotel_ld_application;
reset role;
revoke all on table public.position_families,public.positions,public.position_department_assignments from hotel_ld_application,hotel_ld_people_read,hotel_ld_readonly;
do $e4_postflight$ begin
  if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner where p.oid=any(array[pg_catalog.to_regprocedure('public.save_neon_position_family(text,uuid,uuid,uuid,bigint,text,text,text,text,integer,boolean)'),pg_catalog.to_regprocedure('public.save_neon_position_with_departments(text,uuid,uuid,uuid,bigint,uuid,text,text,text,text,boolean,uuid[])')]::regprocedure[]) and r.rolname='hotel_ld_migration_owner' and p.prosecdef and p.proconfig=array['search_path=""']::text[] and not pg_catalog.has_function_privilege('public',p.oid,'EXECUTE') and pg_catalog.has_function_privilege('hotel_ld_application',p.oid,'EXECUTE'))<>2 then raise exception using errcode='42501',message='E4_POSITION_WRITE_ACL_DRIFT'; end if;
end $e4_postflight$;
commit;
