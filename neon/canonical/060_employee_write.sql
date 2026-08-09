begin;
set local role hotel_ld_migration_owner;

create table public.employees (
  id uuid primary key default pg_catalog.gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  employee_number text not null, name_zh text, name_en text, department_id uuid not null references public.departments(id),
  operational_unit_id uuid references public.operational_units(id), position_id uuid references public.positions(id),
  position_family_id uuid references public.position_families(id), grade_or_band text, hire_date date,
  probation_or_confirmation_date date, employment_status public.employee_employment_status not null default 'unknown',
  is_active boolean not null default true, version bigint not null default 1 check(version>0),
  created_at timestamptz not null default pg_catalog.transaction_timestamp(), updated_at timestamptz not null default pg_catalog.transaction_timestamp(),
  foreign key (tenant_id,property_id) references public.properties(tenant_id,id), unique(property_id,id), unique(property_id,employee_number)
);
create table public.employee_external_identifiers (
  id uuid primary key default pg_catalog.gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  employee_id uuid not null references public.employees(id) on delete cascade, source_system text not null,
  identifier_type public.employee_identifier_type not null, identifier_value text not null, is_primary boolean not null default false,
  is_active boolean not null default true, created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  foreign key (tenant_id,property_id) references public.properties(tenant_id,id)
);
create unique index canonical_employee_identifier_value
  on public.employee_external_identifiers(property_id,identifier_type,pg_catalog.lower(identifier_value)) where is_active;
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
  i uuid:=coalesce(p_id,pg_catalog.gen_random_uuid()); before_row jsonb; after_row jsonb;
  before_ids jsonb; after_ids jsonb; exists_row boolean;
begin
  perform app_private.assert_neon_organization_hostname(p_hostname);
  perform app_private.assert_neon_organization_manager();
  if p_property<>app_private.current_actor_property_id() or p_tenant<>(select tenant_id from public.properties where id=p_property) then
    raise exception using errcode='42501',message='NEON_EMPLOYEE_SCOPE_DENIED';
  end if;
  if p_identifiers is null or pg_catalog.jsonb_typeof(p_identifiers)<>'array' then
    raise exception using errcode='22023',message='NEON_EMPLOYEE_IDENTIFIERS_INVALID';
  end if;
  if exists(select 1 from pg_catalog.jsonb_to_recordset(p_identifiers) as x(source_system text,identifier_type text,identifier_value text,is_primary boolean,is_active boolean)
            where nullif(pg_catalog.btrim(x.source_system),'') is null or nullif(pg_catalog.btrim(x.identifier_value),'') is null
              or x.identifier_type not in ('local_employee_number','lms_employee_id','merlin_id','hris_id','other')) then
    raise exception using errcode='22023',message='NEON_EMPLOYEE_IDENTIFIERS_INVALID';
  end if;
  if exists(select 1 from pg_catalog.jsonb_to_recordset(p_identifiers) as x(source_system text,identifier_type text,identifier_value text,is_primary boolean,is_active boolean)
            group by x.identifier_type,pg_catalog.lower(pg_catalog.btrim(x.identifier_value)) having count(*)>1) then
    raise exception using errcode='22023',message='NEON_EMPLOYEE_IDENTIFIER_DUPLICATE';
  end if;
  if not exists(select 1 from public.departments d where d.id=p_department and d.tenant_id=p_tenant and d.property_id=p_property)
     or (p_unit is not null and not exists(select 1 from public.operational_units u where u.id=p_unit and u.department_id=p_department and u.property_id=p_property))
     or (p_position is not null and not exists(select 1 from public.positions p where p.id=p_position and p.property_id=p_property))
     or (p_family is not null and not exists(select 1 from public.position_families f where f.id=p_family and f.property_id=p_property)) then
    raise exception using errcode='23503',message='NEON_EMPLOYEE_REFERENCE_SCOPE_INVALID';
  end if;
  select exists(select 1 from public.employees where id=i),app_private.neon_employee_authoritative_snapshot(i),app_private.neon_employee_identifier_snapshot(i)
    into exists_row,before_row,before_ids;
  if exists_row then
    update public.employees set employee_number=pg_catalog.btrim(p_employee_number),name_zh=nullif(pg_catalog.btrim(p_name_zh),''),name_en=nullif(pg_catalog.btrim(p_name_en),''),department_id=p_department,operational_unit_id=p_unit,position_id=p_position,position_family_id=p_family,grade_or_band=nullif(pg_catalog.btrim(p_grade),''),hire_date=p_hire_date,probation_or_confirmation_date=p_confirmation_date,employment_status=p_status::public.employee_employment_status,is_active=p_active
      where id=i and tenant_id=p_tenant and property_id=p_property and version=p_expected_version;
    if not found then raise exception using errcode='40001',message='NEON_EMPLOYEE_VERSION_CONFLICT'; end if;
    delete from public.employee_external_identifiers where employee_id=i;
  else
    if coalesce(p_expected_version,0)<>0 then raise exception using errcode='40001',message='NEON_EMPLOYEE_VERSION_CONFLICT'; end if;
    insert into public.employees(id,tenant_id,property_id,employee_number,name_zh,name_en,department_id,operational_unit_id,position_id,position_family_id,grade_or_band,hire_date,probation_or_confirmation_date,employment_status,is_active)
    values(i,p_tenant,p_property,pg_catalog.btrim(p_employee_number),nullif(pg_catalog.btrim(p_name_zh),''),nullif(pg_catalog.btrim(p_name_en),''),p_department,p_unit,p_position,p_family,nullif(pg_catalog.btrim(p_grade),''),p_hire_date,p_confirmation_date,p_status::public.employee_employment_status,p_active);
  end if;
  insert into public.employee_external_identifiers(tenant_id,property_id,employee_id,source_system,identifier_type,identifier_value,is_primary,is_active)
  select p_tenant,p_property,i,pg_catalog.btrim(x.source_system),x.identifier_type::public.employee_identifier_type,pg_catalog.btrim(x.identifier_value),coalesce(x.is_primary,false),coalesce(x.is_active,true)
  from pg_catalog.jsonb_to_recordset(p_identifiers) as x(source_system text,identifier_type text,identifier_value text,is_primary boolean,is_active boolean);
  after_row:=app_private.neon_employee_authoritative_snapshot(i); after_ids:=app_private.neon_employee_identifier_snapshot(i);
  perform app_private.append_neon_employee_write_audit(i,case when exists_row then 'update' else 'create' end,before_row,after_row,before_ids,after_ids);
  return after_row||pg_catalog.jsonb_build_object('identifiers',after_ids);
exception
  when unique_violation then raise exception using errcode='23505',message='NEON_EMPLOYEE_IDENTIFIER_CONFLICT';
end $f$;

revoke all on function app_private.reject_employee_write_audit_mutation() from public;
revoke all on function app_private.bump_neon_employee_version() from public;
revoke all on function app_private.neon_employee_authoritative_snapshot(uuid) from public;
revoke all on function app_private.neon_employee_identifier_snapshot(uuid) from public;
revoke all on function app_private.append_neon_employee_write_audit(uuid,text,jsonb,jsonb,jsonb,jsonb) from public;
revoke all on function public.save_neon_employee_with_identifiers(text,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,text,date,date,text,boolean,jsonb) from public;
grant execute on function public.save_neon_employee_with_identifiers(text,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,text,date,date,text,boolean,jsonb) to hotel_ld_application;

commit;
