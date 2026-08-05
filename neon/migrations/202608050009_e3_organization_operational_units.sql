/* E3 Phase 4B — child-only Operational Unit boundary. */
begin;

do $preflight$
begin
  if current_database() <> 'neondb' or current_user <> 'neondb_owner'
     or session_user <> 'neondb_owner' then
    raise exception using errcode = '42501', message = 'E3_PHASE4B_BOOTSTRAP_IDENTITY_MISMATCH';
  end if;
  if not pg_catalog.pg_has_role(current_user, 'hotel_ld_migration_owner', 'SET') then
    raise exception using errcode = '42501', message = 'E3_PHASE4B_MIGRATION_OWNER_SET_ROLE_REQUIRED';
  end if;
  if pg_catalog.to_regprocedure('public.resolve_neon_organization_department_alias(text,uuid,text,uuid)') is null
     or pg_catalog.to_regprocedure('public.read_neon_organization_operational_units(text)') is not null
     or pg_catalog.to_regclass('app_private.organization_operational_unit_audit_events') is not null then
    raise exception using errcode = '42501', message = 'E3_PHASE4B_BASELINE_DRIFT';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid='public.operational_units'::regclass)
     or exists (select 1 from pg_catalog.pg_roles where rolname='hotel_ld_application' and rolbypassrls)
     or pg_catalog.has_table_privilege('hotel_ld_application','public.operational_units','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
    raise exception using errcode = '42501', message = 'E3_PHASE4B_RUNTIME_TOPOLOGY_DRIFT';
  end if;
end
$preflight$;

grant select (id,tenant_id,property_id,department_id,parent_operational_unit_id,unit_type,code,name_zh,name_en,sort_order,is_active,version,created_at)
  on public.operational_units to hotel_ld_migration_owner;
grant insert (tenant_id,property_id,department_id,parent_operational_unit_id,unit_type,code,name_zh,name_en,sort_order,is_active,created_by,updated_by)
  on public.operational_units to hotel_ld_migration_owner;
grant update (department_id,parent_operational_unit_id,unit_type,code,name_zh,name_en,sort_order,is_active,updated_by,version)
  on public.operational_units to hotel_ld_migration_owner;
grant select (id,tenant_id,property_id,is_active) on public.departments to hotel_ld_migration_owner;

set local role hotel_ld_migration_owner;

create function app_private.neon_organization_actor_can_read_operational_unit(p_department_id uuid)
returns boolean language sql stable security invoker set search_path=''
as $f$
  select session_user='hotel_ld_application'
    and app_private.neon_organization_actor_is_active()
    and app_private.neon_organization_actor_can_read_department(p_department_id);
$f$;

create function app_private.neon_organization_actor_can_mutate_operational_units()
returns boolean language sql stable security invoker set search_path=''
as $f$
  select session_user='hotel_ld_application'
    and app_private.neon_organization_actor_is_active()
    and app_private.neon_organization_actor_has_role('property_ld_manager');
$f$;

create table app_private.organization_operational_unit_audit_events (
  id bigint generated always as identity primary key,
  request_id text not null,
  auth_user_id uuid not null,
  actor_user_id uuid not null,
  tenant_id uuid not null,
  property_id uuid not null,
  operational_unit_id uuid not null,
  operation text not null check (operation in ('operational_unit_create','operational_unit_update')),
  previous_version bigint,
  result_version bigint not null check (result_version > 0),
  previous_department_id uuid,
  result_department_id uuid not null,
  previous_parent_operational_unit_id uuid,
  result_parent_operational_unit_id uuid,
  occurred_at timestamptz not null default pg_catalog.transaction_timestamp(),
  check ((operation='operational_unit_create' and previous_version is null) or (operation='operational_unit_update' and previous_version is not null))
);
alter table app_private.organization_operational_unit_audit_events enable row level security;
alter table app_private.organization_operational_unit_audit_events force row level security;

create function app_private.reject_organization_operational_unit_audit_mutation()
returns trigger language plpgsql security invoker set search_path=''
as $f$ begin raise exception using errcode='42501', message='NEON_ORGANIZATION_OPERATIONAL_UNIT_AUDIT_APPEND_ONLY'; end $f$;
create trigger organization_operational_unit_audit_append_only before update or delete
on app_private.organization_operational_unit_audit_events for each row
execute function app_private.reject_organization_operational_unit_audit_mutation();

create function app_private.neon_organization_operational_unit_payload(p_id uuid)
returns jsonb language sql stable security invoker set search_path=''
as $f$
  select jsonb_build_object(
    'id',u.id,'tenant_id',u.tenant_id,'property_id',u.property_id,
    'department_id',u.department_id,'parent_operational_unit_id',u.parent_operational_unit_id,
    'unit_type',u.unit_type::text,'code',u.code,'name_zh',u.name_zh,'name_en',u.name_en,
    'sort_order',u.sort_order,'is_active',u.is_active,'version',u.version
  ) from public.operational_units u
  where u.id=p_id and u.property_id=app_private.current_actor_property_id();
$f$;
reset role;

create policy e3_phase4b_operational_units_read on public.operational_units for select to hotel_ld_migration_owner
using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id() and app_private.neon_organization_actor_can_read_operational_unit(department_id));
create policy e3_phase4b_operational_units_insert on public.operational_units for insert to hotel_ld_migration_owner
with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id() and app_private.neon_organization_actor_can_mutate_operational_units());
create policy e3_phase4b_operational_units_update on public.operational_units for update to hotel_ld_migration_owner
using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id() and app_private.neon_organization_actor_can_mutate_operational_units())
with check (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id() and app_private.neon_organization_actor_can_mutate_operational_units());
create policy e3_phase4b_departments_target_read on public.departments for select to hotel_ld_migration_owner
using (session_user='hotel_ld_application' and property_id=app_private.current_actor_property_id() and app_private.neon_organization_actor_can_mutate_operational_units());
create policy e3_phase4b_operational_unit_audit_insert on app_private.organization_operational_unit_audit_events for insert to hotel_ld_migration_owner
with check (session_user='hotel_ld_application' and auth_user_id=app_private.current_actor_auth_user_id() and actor_user_id=app_private.current_neon_organization_actor_user_id() and property_id=app_private.current_actor_property_id() and app_private.neon_organization_actor_can_mutate_operational_units());
grant insert (request_id,auth_user_id,actor_user_id,tenant_id,property_id,operational_unit_id,operation,previous_version,result_version,previous_department_id,result_department_id,previous_parent_operational_unit_id,result_parent_operational_unit_id)
on app_private.organization_operational_unit_audit_events to hotel_ld_migration_owner;

set local role hotel_ld_migration_owner;

create function public.read_neon_organization_operational_units(p_hostname text)
returns jsonb language plpgsql stable security definer set search_path=''
as $f$
begin
  perform app_private.assert_neon_runtime_session(); perform app_private.assert_actor_context();
  perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_reader();
  return (select jsonb_build_object('rows',coalesce(jsonb_agg(app_private.neon_organization_operational_unit_payload(u.id) order by u.sort_order,u.name_zh,u.id),'[]'::jsonb)) from public.operational_units u where u.property_id=app_private.current_actor_property_id());
end $f$;

create function public.create_neon_organization_operational_unit(p_hostname text,p_tenant_id uuid,p_property_id uuid,p_department_id uuid,p_parent_id uuid,p_unit_type text,p_code text,p_name_zh text,p_name_en text,p_sort_order integer,p_is_active boolean)
returns jsonb language plpgsql volatile security definer set search_path=''
as $f$
declare v_parent public.operational_units%rowtype; v_id uuid; v_tenant uuid;
begin
  perform app_private.assert_neon_runtime_session(); perform app_private.assert_actor_context(); perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_manager();
  if not app_private.neon_organization_actor_can_mutate_operational_units() or p_property_id<>app_private.current_actor_property_id() or nullif(btrim(p_name_zh),'') is null then raise exception using errcode='P2006',message='NEON_ORGANIZATION_OPERATIONAL_UNIT_INPUT_INVALID'; end if;
  select tenant_id into v_tenant from public.properties where id=p_property_id and tenant_id=p_tenant_id and status::text='active';
  if v_tenant is null or not exists(select 1 from public.departments d where d.id=p_department_id and d.tenant_id=p_tenant_id and d.property_id=p_property_id and d.is_active) then raise exception using errcode='P2006',message='NEON_ORGANIZATION_OPERATIONAL_UNIT_DEPARTMENT_INVALID'; end if;
  if p_parent_id is not null then select * into v_parent from public.operational_units where id=p_parent_id and tenant_id=p_tenant_id and property_id=p_property_id and department_id=p_department_id and is_active for key share; if not found then raise exception using errcode='P2006',message='NEON_ORGANIZATION_OPERATIONAL_UNIT_PARENT_INVALID'; end if; end if;
  insert into public.operational_units(tenant_id,property_id,department_id,parent_operational_unit_id,unit_type,code,name_zh,name_en,sort_order,is_active,created_by,updated_by)
  values(p_tenant_id,p_property_id,p_department_id,p_parent_id,p_unit_type::public.operational_unit_type,nullif(lower(btrim(p_code)),''),btrim(p_name_zh),nullif(btrim(p_name_en),''),coalesce(p_sort_order,0),coalesce(p_is_active,true),app_private.current_actor_auth_user_id(),app_private.current_actor_auth_user_id()) returning id into v_id;
  insert into app_private.organization_operational_unit_audit_events(request_id,auth_user_id,actor_user_id,tenant_id,property_id,operational_unit_id,operation,previous_version,result_version,previous_department_id,result_department_id,previous_parent_operational_unit_id,result_parent_operational_unit_id)
  select app_private.current_actor_request_id(),app_private.current_actor_auth_user_id(),app_private.current_neon_organization_actor_user_id(),tenant_id,property_id,id,'operational_unit_create',null,version,null,department_id,null,parent_operational_unit_id from public.operational_units where id=v_id;
  return app_private.neon_organization_operational_unit_payload(v_id);
exception when invalid_text_representation then raise exception using errcode='P2006',message='NEON_ORGANIZATION_OPERATIONAL_UNIT_INPUT_INVALID'; end $f$;

create function public.update_neon_organization_operational_unit(p_hostname text,p_id uuid,p_expected_version bigint,p_department_id uuid,p_parent_id uuid,p_unit_type text,p_code text,p_name_zh text,p_name_en text,p_sort_order integer,p_is_active boolean)
returns jsonb language plpgsql volatile security definer set search_path=''
as $f$
declare v_current public.operational_units%rowtype; v_parent public.operational_units%rowtype; v_has_children boolean; v_previous_department uuid; v_previous_parent uuid;
begin
  perform app_private.assert_neon_runtime_session(); perform app_private.assert_actor_context(); perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_manager();
  if not app_private.neon_organization_actor_can_mutate_operational_units() or nullif(btrim(p_name_zh),'') is null then raise exception using errcode='P2006',message='NEON_ORGANIZATION_OPERATIONAL_UNIT_INPUT_INVALID'; end if;
  select * into v_current from public.operational_units where id=p_id and property_id=app_private.current_actor_property_id() for update;
  if not found then raise exception using errcode='P2000',message='NEON_ORGANIZATION_OPERATIONAL_UNIT_NOT_FOUND'; end if;
  if v_current.version<>p_expected_version then raise exception using errcode='P2002',message='NEON_ORGANIZATION_OPERATIONAL_UNIT_STALE'; end if;
  v_previous_department:=v_current.department_id; v_previous_parent:=v_current.parent_operational_unit_id;
  if not exists(select 1 from public.departments d where d.id=p_department_id and d.tenant_id=v_current.tenant_id and d.property_id=v_current.property_id and d.is_active) then raise exception using errcode='P2006',message='NEON_ORGANIZATION_OPERATIONAL_UNIT_DEPARTMENT_INVALID'; end if;
  select exists(select 1 from public.operational_units where parent_operational_unit_id=v_current.id) into v_has_children;
  if v_current.department_id<>p_department_id and v_has_children then raise exception using errcode='P2006',message='NEON_ORGANIZATION_OPERATIONAL_UNIT_DEPARTMENT_MOVE_BLOCKED'; end if;
  if p_parent_id=v_current.id or (p_parent_id is not null and exists(with recursive d(id) as (select id from public.operational_units where parent_operational_unit_id=v_current.id union all select u.id from public.operational_units u join d on u.parent_operational_unit_id=d.id) select 1 from d where id=p_parent_id)) then raise exception using errcode='P2006',message='NEON_ORGANIZATION_OPERATIONAL_UNIT_CYCLE'; end if;
  if p_parent_id is not null then select * into v_parent from public.operational_units where id=p_parent_id and tenant_id=v_current.tenant_id and property_id=v_current.property_id and department_id=p_department_id and is_active for key share; if not found then raise exception using errcode='P2006',message='NEON_ORGANIZATION_OPERATIONAL_UNIT_PARENT_INVALID'; end if; end if;
  update public.operational_units set department_id=p_department_id,parent_operational_unit_id=p_parent_id,unit_type=p_unit_type::public.operational_unit_type,code=nullif(lower(btrim(p_code)),''),name_zh=btrim(p_name_zh),name_en=nullif(btrim(p_name_en),''),sort_order=coalesce(p_sort_order,0),is_active=coalesce(p_is_active,true),updated_by=app_private.current_actor_auth_user_id(),version=version+1 where id=v_current.id returning * into v_current;
  insert into app_private.organization_operational_unit_audit_events(request_id,auth_user_id,actor_user_id,tenant_id,property_id,operational_unit_id,operation,previous_version,result_version,previous_department_id,result_department_id,previous_parent_operational_unit_id,result_parent_operational_unit_id)
  values(app_private.current_actor_request_id(),app_private.current_actor_auth_user_id(),app_private.current_neon_organization_actor_user_id(),v_current.tenant_id,v_current.property_id,v_current.id,'operational_unit_update',p_expected_version,v_current.version,v_previous_department,v_current.department_id,v_previous_parent,v_current.parent_operational_unit_id);
  return app_private.neon_organization_operational_unit_payload(v_current.id);
exception when invalid_text_representation then raise exception using errcode='P2006',message='NEON_ORGANIZATION_OPERATIONAL_UNIT_INPUT_INVALID'; end $f$;

revoke all on function app_private.neon_organization_actor_can_read_operational_unit(uuid),app_private.neon_organization_actor_can_mutate_operational_units(),app_private.neon_organization_operational_unit_payload(uuid),app_private.reject_organization_operational_unit_audit_mutation(),public.read_neon_organization_operational_units(text),public.create_neon_organization_operational_unit(text,uuid,uuid,uuid,uuid,text,text,text,text,integer,boolean),public.update_neon_organization_operational_unit(text,uuid,bigint,uuid,uuid,text,text,text,text,integer,boolean) from public,authenticated,neondb_owner,hotel_ld_people_read,hotel_ld_application,hotel_ld_readonly;
grant execute on function public.read_neon_organization_operational_units(text),public.create_neon_organization_operational_unit(text,uuid,uuid,uuid,uuid,text,text,text,text,integer,boolean),public.update_neon_organization_operational_unit(text,uuid,bigint,uuid,uuid,text,text,text,text,integer,boolean) to hotel_ld_application;
revoke all on table app_private.organization_operational_unit_audit_events from public,authenticated,neondb_owner,hotel_ld_people_read,hotel_ld_application,hotel_ld_readonly;
reset role;

do $postflight$
begin
  if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner where p.oid=any(array[pg_catalog.to_regprocedure('public.read_neon_organization_operational_units(text)'),pg_catalog.to_regprocedure('public.create_neon_organization_operational_unit(text,uuid,uuid,uuid,uuid,text,text,text,text,integer,boolean)'),pg_catalog.to_regprocedure('public.update_neon_organization_operational_unit(text,uuid,bigint,uuid,uuid,text,text,text,text,integer,boolean)')]::regprocedure[]) and r.rolname='hotel_ld_migration_owner' and p.prosecdef and p.proconfig=array['search_path=""']::text[] and not pg_catalog.has_function_privilege('public',p.oid,'EXECUTE') and pg_catalog.has_function_privilege('hotel_ld_application',p.oid,'EXECUTE'))<>3
    or pg_catalog.has_table_privilege('hotel_ld_application','public.operational_units','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception using errcode='42501',message='E3_PHASE4B_POSTFLIGHT_DRIFT'; end if;
end $postflight$;
commit;
