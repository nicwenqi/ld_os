begin;
set local role hotel_ld_migration_owner;

create table public.employees (
  id uuid primary key default pg_catalog.gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  employee_number text not null, name_zh text, name_en text, department_id uuid,
  operational_unit_id uuid, position_id uuid,
  position_family_id uuid, grade_or_band text, hire_date date,
  probation_or_confirmation_date date, employment_status public.employee_employment_status not null default 'unknown',
  is_active boolean not null default true, version bigint not null default 1 check(version>0),
  created_at timestamptz not null default pg_catalog.transaction_timestamp(), updated_at timestamptz not null default pg_catalog.transaction_timestamp(),
  foreign key (tenant_id,property_id) references public.properties(tenant_id,id),
  foreign key (tenant_id,property_id,department_id) references public.departments(tenant_id,property_id,id),
  foreign key (tenant_id,property_id,operational_unit_id) references public.operational_units(tenant_id,property_id,id),
  foreign key (tenant_id,property_id,position_id) references public.positions(tenant_id,property_id,id),
  foreign key (tenant_id,property_id,position_family_id) references public.position_families(tenant_id,property_id,id),
  unique(property_id,id), unique(tenant_id,property_id,id), unique(property_id,employee_number)
);
create table public.employee_external_identifiers (
  id uuid primary key default pg_catalog.gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  employee_id uuid not null, source_system text not null,
  identifier_type public.employee_identifier_type not null, identifier_value text not null, is_primary boolean not null default false,
  is_active boolean not null default true, created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  foreign key (tenant_id,property_id) references public.properties(tenant_id,id),
  foreign key (tenant_id,property_id,employee_id) references public.employees(tenant_id,property_id,id) on delete cascade
);
create unique index canonical_employee_identifier_value
  on public.employee_external_identifiers(property_id,pg_catalog.lower(source_system),identifier_value);
create unique index canonical_employee_primary_identifier
  on public.employee_external_identifiers(employee_id,identifier_type) where is_active and is_primary;

create table app_private.employee_write_audit_events (like app_private.organization_read_audit_events including all);
create function app_private.reject_employee_write_audit_mutation() returns trigger language plpgsql volatile security invoker set search_path='' as $f$ begin raise exception using errcode='42501',message='EMPLOYEE_WRITE_AUDIT_APPEND_ONLY'; end $f$;
create trigger e5a_employee_write_audit_append_only before update or delete on app_private.employee_write_audit_events for each row execute function app_private.reject_employee_write_audit_mutation();

create function app_private.bump_neon_employee_version() returns trigger language plpgsql volatile security invoker set search_path='' as $f$
begin new.version:=old.version+1; new.updated_at:=pg_catalog.transaction_timestamp(); return new; end $f$;
create trigger canonical_employee_version before update on public.employees for each row execute function app_private.bump_neon_employee_version();

create function app_private.neon_employee_authoritative_snapshot(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $f$
  select pg_catalog.jsonb_build_object('id',e.id,'employee_number',e.employee_number,'name_zh',e.name_zh,'name_en',e.name_en,'department_id',e.department_id,'operational_unit_id',e.operational_unit_id,'position_id',e.position_id,'position_family_id',e.position_family_id,'grade_or_band',e.grade_or_band,'hire_date',e.hire_date,'probation_or_confirmation_date',e.probation_or_confirmation_date,'employment_status',e.employment_status,'is_active',e.is_active,'version',e.version) from public.employees e where e.id=p_id
$f$;
create function app_private.neon_employee_identifier_snapshot(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $f$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('source_system',i.source_system,'identifier_type',i.identifier_type,'identifier_value',i.identifier_value,'is_primary',i.is_primary,'is_active',i.is_active) order by i.identifier_type,i.source_system,i.identifier_value),'[]'::jsonb) from public.employee_external_identifiers i where i.employee_id=p_id
$f$;
create function app_private.append_neon_employee_write_audit(p_id uuid,p_operation text,p_before jsonb,p_after jsonb,p_before_identifiers jsonb,p_after_identifiers jsonb) returns void language plpgsql volatile security invoker set search_path='' as $f$
declare a uuid; t uuid; begin a:=app_private.current_neon_organization_actor_user_id(); select tenant_id into t from public.properties where id=app_private.current_actor_property_id(); insert into app_private.employee_write_audit_events(request_id,auth_user_id,actor_user_id,tenant_id,property_id,operation,target_id,details) values(app_private.current_actor_request_id(),app_private.current_actor_auth_user_id(),a,t,app_private.current_actor_property_id(),p_operation,p_id,pg_catalog.jsonb_build_object('before',p_before,'after',p_after,'before_identifiers',p_before_identifiers,'after_identifiers',p_after_identifiers)); end $f$;

create function public.save_neon_employee_with_identifiers(
  p_hostname text,p_tenant uuid,p_property uuid,p_id uuid,p_expected_version bigint,
  p_employee_number text,p_name_zh text,p_name_en text,p_department uuid,p_unit uuid,p_position uuid,
  p_family uuid,p_grade text,p_hire_date date,p_confirmation_date date,p_status text,p_active boolean,p_identifiers jsonb
)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare
  v_employee_id uuid; v_previous_version bigint; v_result_version bigint;
  before_row jsonb; after_row jsonb; before_ids jsonb; after_ids jsonb;
  v_authoritative_family_id uuid; v_identifier_count integer; v_target_active boolean; v_target_department_id uuid;
begin
  perform app_private.assert_neon_organization_hostname(p_hostname);
  perform app_private.assert_neon_organization_manager();
  if p_property<>app_private.current_actor_property_id() then
    raise exception using errcode='42501',message='NEON_EMPLOYEE_SCOPE_DENIED';
  end if;
  perform 1 from public.properties property where property.id=p_property and property.tenant_id=p_tenant and property.status='active' for key share;
  if not found then raise exception using errcode='42501',message='NEON_EMPLOYEE_SCOPE_DENIED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_property::text,510));
  if nullif(pg_catalog.btrim(coalesce(p_employee_number,'')),'') is null
     or (nullif(pg_catalog.btrim(coalesce(p_name_zh,'')),'') is null and nullif(pg_catalog.btrim(coalesce(p_name_en,'')),'') is null)
     or p_expected_version is null or p_expected_version<0
     or p_status not in ('active','inactive','leave','terminated','unknown')
     or p_active is null or p_identifiers is null or pg_catalog.jsonb_typeof(p_identifiers)<>'array' then
    raise exception using errcode='22023',message='NEON_EMPLOYEE_WRITE_INPUT_INVALID';
  end if;

  if p_id is null then
    if p_expected_version<>0 then raise exception using errcode='40001',message='NEON_EMPLOYEE_WRITE_STALE'; end if;
    v_employee_id:=pg_catalog.gen_random_uuid(); before_ids:='[]'::jsonb;
  else
    select employee.version into v_previous_version from public.employees employee where employee.id=p_id and employee.tenant_id=p_tenant and employee.property_id=p_property for update;
    if not found then raise exception using errcode='P0002',message='NEON_EMPLOYEE_WRITE_NOT_FOUND'; end if;
    if v_previous_version<>p_expected_version then raise exception using errcode='40001',message='NEON_EMPLOYEE_WRITE_STALE'; end if;
    v_employee_id:=p_id;
    perform identifier.id from public.employee_external_identifiers identifier where identifier.employee_id=v_employee_id and identifier.tenant_id=p_tenant and identifier.property_id=p_property order by identifier.source_system,identifier.identifier_type,identifier.identifier_value,identifier.id for update;
    before_row:=app_private.neon_employee_authoritative_snapshot(v_employee_id); before_ids:=app_private.neon_employee_identifier_snapshot(v_employee_id);
  end if;

  if p_department is not null then
    select department.is_active into v_target_active from public.departments department where department.id=p_department and department.tenant_id=p_tenant and department.property_id=p_property for key share;
    if not found then raise exception using errcode='P0002',message='NEON_EMPLOYEE_WRITE_DEPARTMENT_NOT_FOUND'; end if;
    if not v_target_active then raise exception using errcode='22023',message='NEON_EMPLOYEE_WRITE_DEPARTMENT_INACTIVE'; end if;
  end if;
  if p_unit is not null then
    select unit.is_active,unit.department_id into v_target_active,v_target_department_id from public.operational_units unit where unit.id=p_unit and unit.tenant_id=p_tenant and unit.property_id=p_property for key share;
    if not found then raise exception using errcode='P0002',message='NEON_EMPLOYEE_WRITE_OPERATIONAL_UNIT_NOT_FOUND'; end if;
    if not v_target_active or v_target_department_id is distinct from p_department then raise exception using errcode='22023',message='NEON_EMPLOYEE_WRITE_OPERATIONAL_UNIT_INVALID'; end if;
  end if;
  if p_position is not null then
    select position.position_family_id,position.is_active into v_authoritative_family_id,v_target_active from public.positions position where position.id=p_position and position.tenant_id=p_tenant and position.property_id=p_property for key share;
    if not found then raise exception using errcode='P0002',message='NEON_EMPLOYEE_WRITE_POSITION_NOT_FOUND'; end if;
    if not v_target_active then raise exception using errcode='22023',message='NEON_EMPLOYEE_WRITE_POSITION_INACTIVE'; end if;
    if v_authoritative_family_id is not null then
      select family.is_active into v_target_active from public.position_families family where family.id=v_authoritative_family_id and family.tenant_id=p_tenant and family.property_id=p_property for key share;
      if not found then raise exception using errcode='P0002',message='NEON_EMPLOYEE_WRITE_POSITION_FAMILY_NOT_FOUND'; end if;
      if not v_target_active then raise exception using errcode='22023',message='NEON_EMPLOYEE_WRITE_POSITION_FAMILY_INACTIVE'; end if;
    end if;
    if p_family is not null and p_family is distinct from v_authoritative_family_id then raise exception using errcode='22023',message='NEON_EMPLOYEE_WRITE_POSITION_FAMILY_MISMATCH'; end if;
  elsif p_family is not null then
    select family.is_active into v_target_active from public.position_families family where family.id=p_family and family.tenant_id=p_tenant and family.property_id=p_property for key share;
    if not found then raise exception using errcode='P0002',message='NEON_EMPLOYEE_WRITE_POSITION_FAMILY_NOT_FOUND'; end if;
    if not v_target_active then raise exception using errcode='22023',message='NEON_EMPLOYEE_WRITE_POSITION_FAMILY_INACTIVE'; end if;
    v_authoritative_family_id:=p_family;
  end if;

  if p_department is not null and p_position is not null then
    perform assignment.id from public.position_department_assignments assignment where assignment.tenant_id=p_tenant and assignment.property_id=p_property and assignment.department_id=p_department and assignment.position_id=p_position and assignment.is_active for key share;
    if not found then raise exception using errcode='22023',message='NEON_EMPLOYEE_WRITE_POSITION_DEPARTMENT_INVALID'; end if;
  end if;
  if p_active and (p_department is null or p_position is null) then raise exception using errcode='22023',message='NEON_EMPLOYEE_WRITE_ACTIVE_TARGETS_REQUIRED'; end if;

  select pg_catalog.count(*)::integer into v_identifier_count from pg_catalog.jsonb_to_recordset(p_identifiers) identifier(source_system text,identifier_type text,identifier_value text,is_primary boolean,is_active boolean);
  if v_identifier_count > 100 then raise exception using errcode='22023',message='NEON_EMPLOYEE_WRITE_IDENTIFIER_LIMIT_EXCEEDED'; end if;
  if exists(select 1 from pg_catalog.jsonb_to_recordset(p_identifiers) identifier(source_system text,identifier_type text,identifier_value text,is_primary boolean,is_active boolean) where nullif(pg_catalog.btrim(coalesce(identifier.source_system,'')),'') is null or nullif(pg_catalog.btrim(coalesce(identifier.identifier_value,'')),'') is null or identifier.identifier_type not in ('local_employee_number','lms_employee_id','merlin_id','hris_id','other') or identifier.is_primary is null or identifier.is_active is null)
     or exists(select 1 from (select pg_catalog.lower(pg_catalog.btrim(identifier.source_system)),pg_catalog.btrim(identifier.identifier_value) from pg_catalog.jsonb_to_recordset(p_identifiers) identifier(source_system text,identifier_type text,identifier_value text,is_primary boolean,is_active boolean) group by pg_catalog.lower(pg_catalog.btrim(identifier.source_system)),pg_catalog.btrim(identifier.identifier_value) having pg_catalog.count(*)>1) duplicate_identifier) then
    raise exception using errcode='22023',message='NEON_EMPLOYEE_WRITE_IDENTIFIER_INVALID';
  end if;

  perform existing_identifier.id from public.employee_external_identifiers existing_identifier join pg_catalog.jsonb_to_recordset(p_identifiers) requested_identifier(source_system text,identifier_type text,identifier_value text,is_primary boolean,is_active boolean) on existing_identifier.property_id=p_property and existing_identifier.source_system=pg_catalog.lower(pg_catalog.btrim(requested_identifier.source_system)) and existing_identifier.identifier_value=pg_catalog.btrim(requested_identifier.identifier_value) where existing_identifier.employee_id is distinct from v_employee_id order by existing_identifier.source_system,existing_identifier.identifier_value,existing_identifier.id for update;
  if exists(select 1 from public.employee_external_identifiers existing_identifier join pg_catalog.jsonb_to_recordset(p_identifiers) requested_identifier(source_system text,identifier_type text,identifier_value text,is_primary boolean,is_active boolean) on existing_identifier.property_id=p_property and existing_identifier.source_system=pg_catalog.lower(pg_catalog.btrim(requested_identifier.source_system)) and existing_identifier.identifier_value=pg_catalog.btrim(requested_identifier.identifier_value) where existing_identifier.employee_id is distinct from v_employee_id) then raise exception using errcode='40001',message='NEON_EMPLOYEE_WRITE_IDENTIFIER_CONFLICT'; end if;

  if p_id is null then
    insert into public.employees(id,tenant_id,property_id,employee_number,name_zh,name_en,department_id,operational_unit_id,position_id,position_family_id,grade_or_band,hire_date,probation_or_confirmation_date,employment_status,is_active) values(v_employee_id,p_tenant,p_property,pg_catalog.btrim(p_employee_number),nullif(pg_catalog.btrim(p_name_zh),''),nullif(pg_catalog.btrim(p_name_en),''),p_department,p_unit,p_position,v_authoritative_family_id,nullif(pg_catalog.btrim(p_grade),''),p_hire_date,p_confirmation_date,p_status::public.employee_employment_status,p_active) returning version into v_result_version;
  else
    update public.employees employee set employee_number=pg_catalog.btrim(p_employee_number),name_zh=nullif(pg_catalog.btrim(p_name_zh),''),name_en=nullif(pg_catalog.btrim(p_name_en),''),department_id=p_department,operational_unit_id=p_unit,position_id=p_position,position_family_id=v_authoritative_family_id,grade_or_band=nullif(pg_catalog.btrim(p_grade),''),hire_date=p_hire_date,probation_or_confirmation_date=p_confirmation_date,employment_status=p_status::public.employee_employment_status,is_active=p_active where employee.id=v_employee_id and employee.tenant_id=p_tenant and employee.property_id=p_property returning employee.version into v_result_version;
  end if;

  delete from public.employee_external_identifiers identifier where identifier.employee_id=v_employee_id and identifier.tenant_id=p_tenant and identifier.property_id=p_property;
  insert into public.employee_external_identifiers(tenant_id,property_id,employee_id,source_system,identifier_type,identifier_value,is_primary,is_active)
  select p_tenant,p_property,v_employee_id,pg_catalog.lower(pg_catalog.btrim(identifier.source_system)),identifier.identifier_type::public.employee_identifier_type,pg_catalog.btrim(identifier.identifier_value),identifier.is_primary,identifier.is_active from pg_catalog.jsonb_to_recordset(p_identifiers) identifier(source_system text,identifier_type text,identifier_value text,is_primary boolean,is_active boolean);
  after_row:=app_private.neon_employee_authoritative_snapshot(v_employee_id); after_ids:=app_private.neon_employee_identifier_snapshot(v_employee_id);
  perform app_private.append_neon_employee_write_audit(v_employee_id,case when p_id is null then 'create' else 'update' end,before_row,after_row,before_ids,after_ids);
  return after_row||pg_catalog.jsonb_build_object('identifiers',after_ids);
exception
  when unique_violation then raise exception using errcode='40001',message='NEON_EMPLOYEE_WRITE_CONFLICT';
end $f$;

revoke all on function app_private.reject_employee_write_audit_mutation() from public;
revoke all on function app_private.bump_neon_employee_version() from public;
revoke all on function app_private.neon_employee_authoritative_snapshot(uuid) from public;
revoke all on function app_private.neon_employee_identifier_snapshot(uuid) from public;
revoke all on function app_private.append_neon_employee_write_audit(uuid,text,jsonb,jsonb,jsonb,jsonb) from public;
revoke all on function public.save_neon_employee_with_identifiers(text,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,text,date,date,text,boolean,jsonb) from public;
grant execute on function public.save_neon_employee_with_identifiers(text,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,text,date,date,text,boolean,jsonb) to hotel_ld_application;

commit;
