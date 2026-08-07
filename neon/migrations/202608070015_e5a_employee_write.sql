/* E5A Employee write foundation. Child branch only; Import and Employee facts are excluded. */
begin;

do $e5a_preflight$
begin
  if current_database() <> 'neondb'
     or current_user <> 'neondb_owner'
     or session_user <> 'neondb_owner' then
    raise exception using
      errcode = '42501',
      message = 'E5A_EMPLOYEE_WRITE_BOOTSTRAP_IDENTITY_MISMATCH';
  end if;

  if not pg_catalog.pg_has_role(
    current_user,
    'hotel_ld_migration_owner',
    'SET'
  ) then
    raise exception using
      errcode = '42501',
      message = 'E5A_EMPLOYEE_WRITE_MIGRATION_OWNER_REQUIRED';
  end if;

  if pg_catalog.to_regclass('public.employees') is null
     or pg_catalog.to_regclass('public.employee_external_identifiers') is null
     or pg_catalog.to_regprocedure(
       'app_private.assert_neon_people_runtime_session()'
     ) is null
     or pg_catalog.to_regprocedure(
       'app_private.assert_neon_people_hostname(text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'app_private.assert_neon_people_manager()'
     ) is null then
    raise exception using
      errcode = '42P01',
      message = 'E5A_EMPLOYEE_WRITE_PREREQUISITE_MISSING';
  end if;

  if pg_catalog.to_regclass(
       'app_private.employee_write_audit_events'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.save_neon_employee_with_identifiers(text,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,text,date,date,text,boolean,jsonb)'
     ) is not null then
    raise exception using
      errcode = '42710',
      message = 'E5A_EMPLOYEE_WRITE_OBJECT_EXISTS';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    where relation.oid = 'public.employees'::regclass
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) or not exists (
    select 1
    from pg_catalog.pg_class relation
    where relation.oid = 'public.employee_external_identifiers'::regclass
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) then
    raise exception using
      errcode = '42501',
      message = 'E5A_EMPLOYEE_WRITE_FORCE_RLS_REQUIRED';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(array[
      'public.employees',
      'public.employee_external_identifiers'
    ]) relation(value)
    where pg_catalog.has_table_privilege(
      'hotel_ld_application',
      relation.value,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'E5A_EMPLOYEE_WRITE_RUNTIME_RAW_PRIVILEGE_DRIFT';
  end if;
end
$e5a_preflight$;

grant select (
  id, tenant_id, property_id, employee_number, name_zh, name_en,
  department_id, operational_unit_id, position_id, position_family_id,
  grade_or_band, hire_date, probation_or_confirmation_date,
  employment_status, is_active, version
) on public.employees to hotel_ld_migration_owner;
grant insert (
  tenant_id, property_id, employee_number, name_zh, name_en,
  department_id, operational_unit_id, position_id, position_family_id,
  grade_or_band, hire_date, probation_or_confirmation_date,
  employment_status, is_active, source_system, source_batch_id,
  created_by, updated_by
) on public.employees to hotel_ld_migration_owner;
grant update (
  employee_number, name_zh, name_en, department_id, operational_unit_id,
  position_id, position_family_id, grade_or_band, hire_date,
  probation_or_confirmation_date, employment_status, is_active,
  source_system, source_batch_id, updated_by
) on public.employees to hotel_ld_migration_owner;
grant select (
  id, tenant_id, property_id, employee_id, source_system, identifier_type,
  identifier_value, is_primary, is_active, version
) on public.employee_external_identifiers to hotel_ld_migration_owner;
grant insert (
  tenant_id, property_id, employee_id, source_system, identifier_type,
  identifier_value, is_primary, is_active, source_batch_id
) on public.employee_external_identifiers to hotel_ld_migration_owner;
grant delete on public.employee_external_identifiers
  to hotel_ld_migration_owner;

create policy e5a_employees_insert
on public.employees for insert to hotel_ld_migration_owner
with check (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_people_actor_has_role('property_ld_manager')
);

create policy e5a_employees_update
on public.employees for update to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_people_actor_has_role('property_ld_manager')
)
with check (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_people_actor_has_role('property_ld_manager')
);

create policy e5a_employee_identifiers_insert
on public.employee_external_identifiers
for insert to hotel_ld_migration_owner
with check (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_people_actor_has_role('property_ld_manager')
);

create policy e5a_employee_identifiers_delete
on public.employee_external_identifiers
for delete to hotel_ld_migration_owner
using (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_people_actor_has_role('property_ld_manager')
);

set local role hotel_ld_migration_owner;

create table app_private.employee_write_audit_events (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  auth_user_id uuid not null,
  tenant_id uuid not null,
  property_id uuid not null,
  employee_id uuid not null,
  operation text not null check (operation in ('create', 'update')),
  previous_version bigint,
  result_version bigint not null check (result_version > 0),
  before_snapshot jsonb,
  after_snapshot jsonb not null,
  occurred_at timestamptz not null default pg_catalog.transaction_timestamp(),
  check (before_snapshot is null or pg_catalog.jsonb_typeof(before_snapshot) = 'object'),
  check (pg_catalog.jsonb_typeof(after_snapshot) = 'object')
);

alter table app_private.employee_write_audit_events enable row level security;
alter table app_private.employee_write_audit_events force row level security;

create policy e5a_employee_write_audit_insert
on app_private.employee_write_audit_events
for insert to hotel_ld_migration_owner
with check (
  session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
);

create function app_private.reject_employee_write_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '42501',
    message = 'EMPLOYEE_WRITE_AUDIT_APPEND_ONLY';
end
$function$;

create trigger e5a_employee_write_audit_append_only
before update or delete on app_private.employee_write_audit_events
for each row execute function app_private.reject_employee_write_audit_mutation();

create function app_private.neon_employee_identifier_snapshot(
  p_employee_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'source_system', identifier.source_system,
        'identifier_type', identifier.identifier_type,
        'identifier_value', identifier.identifier_value,
        'is_primary', identifier.is_primary,
        'is_active', identifier.is_active,
        'version', identifier.version
      ) order by identifier.source_system,
                 identifier.identifier_type,
                 identifier.identifier_value
    ),
    '[]'::jsonb
  )
  from public.employee_external_identifiers identifier
  where identifier.employee_id = p_employee_id;
$function$;

create function app_private.neon_employee_authoritative_snapshot(
  p_employee_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', employee.id,
    'employee_number', employee.employee_number,
    'name_zh', employee.name_zh,
    'name_en', employee.name_en,
    'department_id', employee.department_id,
    'operational_unit_id', employee.operational_unit_id,
    'position_id', employee.position_id,
    'position_family_id', employee.position_family_id,
    'grade_or_band', employee.grade_or_band,
    'hire_date', employee.hire_date,
    'probation_or_confirmation_date',
      employee.probation_or_confirmation_date,
    'employment_status', employee.employment_status,
    'is_active', employee.is_active,
    'version', employee.version,
    'identifiers', app_private.neon_employee_identifier_snapshot(employee.id)
  )
  from public.employees employee
  where employee.id = p_employee_id;
$function$;

create function app_private.append_neon_employee_write_audit(
  p_tenant_id uuid,
  p_property_id uuid,
  p_employee_id uuid,
  p_operation text,
  p_previous_version bigint,
  p_result_version bigint,
  p_before_snapshot jsonb,
  p_after_snapshot jsonb
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  perform app_private.assert_neon_people_manager();

  insert into app_private.employee_write_audit_events (
    request_id,
    auth_user_id,
    tenant_id,
    property_id,
    employee_id,
    operation,
    previous_version,
    result_version,
    before_snapshot,
    after_snapshot
  ) values (
    app_private.current_actor_request_id(),
    app_private.current_actor_auth_user_id(),
    p_tenant_id,
    p_property_id,
    p_employee_id,
    p_operation,
    p_previous_version,
    p_result_version,
    p_before_snapshot,
    p_after_snapshot
  );
end
$function$;

create function public.save_neon_employee_with_identifiers(
  p_hostname text,
  p_tenant_id uuid,
  p_property_id uuid,
  p_employee_id uuid,
  p_expected_version bigint,
  p_employee_number text,
  p_name_zh text,
  p_name_en text,
  p_department_id uuid,
  p_operational_unit_id uuid,
  p_position_id uuid,
  p_position_family_id uuid,
  p_grade_or_band text,
  p_hire_date date,
  p_probation_or_confirmation_date date,
  p_employment_status text,
  p_is_active boolean,
  p_identifiers jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_employee_id uuid;
  v_previous_version bigint;
  v_result_version bigint;
  v_before_snapshot jsonb;
  v_after_snapshot jsonb;
  v_authoritative_family_id uuid;
  v_identifier_count integer;
  v_target_active boolean;
  v_target_department_id uuid;
begin
  perform app_private.assert_neon_people_runtime_session();
  perform app_private.assert_actor_context();
  perform app_private.assert_neon_people_hostname(p_hostname);
  perform app_private.assert_neon_people_manager();

  if p_property_id <> app_private.current_actor_property_id() then
    raise exception using
      errcode = '42501',
      message = 'NEON_EMPLOYEE_WRITE_PROPERTY_FORBIDDEN';
  end if;

  perform 1
  from public.properties property
  where property.id = p_property_id
    and property.tenant_id = p_tenant_id
    and property.status::text = 'active'
  for key share;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'NEON_EMPLOYEE_WRITE_PROPERTY_FORBIDDEN';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_property_id::text, 510)
  );

  if nullif(pg_catalog.btrim(coalesce(p_employee_number, '')), '') is null
     or (
       nullif(pg_catalog.btrim(coalesce(p_name_zh, '')), '') is null
       and nullif(pg_catalog.btrim(coalesce(p_name_en, '')), '') is null
     )
     or p_expected_version is null
     or p_expected_version < 0
     or p_employment_status not in (
       'active', 'inactive', 'leave', 'terminated', 'unknown'
     )
     or p_is_active is null
     or pg_catalog.jsonb_typeof(p_identifiers) <> 'array' then
    raise exception using
      errcode = 'P2006',
      message = 'NEON_EMPLOYEE_WRITE_INPUT_INVALID';
  end if;

  if p_employee_id is null then
    if p_expected_version <> 0 then
      raise exception using
        errcode = 'P2002',
        message = 'NEON_EMPLOYEE_WRITE_STALE';
    end if;
  else
    select employee.version
    into v_previous_version
    from public.employees employee
    where employee.id = p_employee_id
      and employee.tenant_id = p_tenant_id
      and employee.property_id = p_property_id
    for update;

    if not found then
      raise exception using
        errcode = 'P2000',
        message = 'NEON_EMPLOYEE_WRITE_NOT_FOUND';
    end if;
    if v_previous_version <> p_expected_version then
      raise exception using
        errcode = 'P2002',
        message = 'NEON_EMPLOYEE_WRITE_STALE';
    end if;

    v_employee_id := p_employee_id;

    perform identifier.id
    from public.employee_external_identifiers identifier
    where identifier.employee_id = v_employee_id
      and identifier.tenant_id = p_tenant_id
      and identifier.property_id = p_property_id
    order by identifier.source_system,
             identifier.identifier_type,
             identifier.identifier_value
    for update;

    v_before_snapshot := app_private.neon_employee_authoritative_snapshot(
      v_employee_id
    );
  end if;

  if p_department_id is not null then
    select department.is_active
    into v_target_active
    from public.departments department
    where department.id = p_department_id
      and department.tenant_id = p_tenant_id
      and department.property_id = p_property_id
    for key share;
    if not found then
      raise exception using
        errcode = 'P2000',
        message = 'NEON_EMPLOYEE_WRITE_DEPARTMENT_NOT_FOUND';
    end if;
    if not v_target_active then
      raise exception using
        errcode = 'P2006',
        message = 'NEON_EMPLOYEE_WRITE_DEPARTMENT_INACTIVE';
    end if;
  end if;

  if p_operational_unit_id is not null then
    select unit.is_active, unit.department_id
    into v_target_active, v_target_department_id
    from public.operational_units unit
    where unit.id = p_operational_unit_id
      and unit.tenant_id = p_tenant_id
      and unit.property_id = p_property_id
    for key share;
    if not found then
      raise exception using
        errcode = 'P2000',
        message = 'NEON_EMPLOYEE_WRITE_OPERATIONAL_UNIT_NOT_FOUND';
    end if;
    if not v_target_active
       or v_target_department_id is distinct from p_department_id then
      raise exception using
        errcode = 'P2006',
        message = 'NEON_EMPLOYEE_WRITE_OPERATIONAL_UNIT_INVALID';
    end if;
  end if;

  if p_position_id is not null then
    select position.position_family_id, position.is_active
    into v_authoritative_family_id, v_target_active
    from public.positions position
    where position.id = p_position_id
      and position.tenant_id = p_tenant_id
      and position.property_id = p_property_id
    for key share;
    if not found then
      raise exception using
        errcode = 'P2000',
        message = 'NEON_EMPLOYEE_WRITE_POSITION_NOT_FOUND';
    end if;
    if not v_target_active then
      raise exception using
        errcode = 'P2006',
        message = 'NEON_EMPLOYEE_WRITE_POSITION_INACTIVE';
    end if;

    if v_authoritative_family_id is not null then
      select family.is_active
      into v_target_active
      from public.position_families family
      where family.id = v_authoritative_family_id
        and family.tenant_id = p_tenant_id
        and family.property_id = p_property_id
      for key share;
      if not found then
        raise exception using
          errcode = 'P2000',
          message = 'NEON_EMPLOYEE_WRITE_POSITION_FAMILY_NOT_FOUND';
      end if;
      if not v_target_active then
        raise exception using
          errcode = 'P2006',
          message = 'NEON_EMPLOYEE_WRITE_POSITION_FAMILY_INACTIVE';
      end if;
    end if;

    if p_position_family_id is not null
       and p_position_family_id is distinct from v_authoritative_family_id then
      raise exception using
        errcode = 'P2006',
        message = 'NEON_EMPLOYEE_WRITE_POSITION_FAMILY_MISMATCH';
    end if;
  elsif p_position_family_id is not null then
    select family.is_active
    into v_target_active
    from public.position_families family
    where family.id = p_position_family_id
      and family.tenant_id = p_tenant_id
      and family.property_id = p_property_id
    for key share;
    if not found then
      raise exception using
        errcode = 'P2000',
        message = 'NEON_EMPLOYEE_WRITE_POSITION_FAMILY_NOT_FOUND';
    end if;
    if not v_target_active then
      raise exception using
        errcode = 'P2006',
        message = 'NEON_EMPLOYEE_WRITE_POSITION_FAMILY_INACTIVE';
    end if;
    v_authoritative_family_id := p_position_family_id;
  end if;

  if p_department_id is not null and p_position_id is not null
     and not exists (
       select 1
       from public.position_department_assignments assignment
       where assignment.tenant_id = p_tenant_id
         and assignment.property_id = p_property_id
         and assignment.department_id = p_department_id
         and assignment.position_id = p_position_id
     ) then
    raise exception using
      errcode = 'P2006',
      message = 'NEON_EMPLOYEE_WRITE_POSITION_DEPARTMENT_INVALID';
  end if;

  if p_is_active and (p_department_id is null or p_position_id is null) then
    raise exception using
      errcode = 'P2006',
      message = 'NEON_EMPLOYEE_WRITE_ACTIVE_TARGETS_REQUIRED';
  end if;

  select pg_catalog.count(*)::integer
  into v_identifier_count
  from pg_catalog.jsonb_to_recordset(p_identifiers) identifier(
    source_system text,
    identifier_type text,
    identifier_value text,
    is_primary boolean,
    is_active boolean
  );

  if v_identifier_count > 100 then
    raise exception using
      errcode = 'P2006',
      message = 'NEON_EMPLOYEE_WRITE_IDENTIFIER_LIMIT_EXCEEDED';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_identifiers) identifier(
      source_system text,
      identifier_type text,
      identifier_value text,
      is_primary boolean,
      is_active boolean
    )
    where nullif(pg_catalog.btrim(coalesce(identifier.source_system, '')), '') is null
       or nullif(pg_catalog.btrim(coalesce(identifier.identifier_value, '')), '') is null
       or identifier.identifier_type not in (
         'local_employee_number', 'lms_employee_id', 'merlin_id',
         'hris_id', 'other'
       )
       or identifier.is_primary is null
       or identifier.is_active is null
  ) or (
    select pg_catalog.count(*)
    from (
      select pg_catalog.lower(pg_catalog.btrim(identifier.source_system)),
             pg_catalog.btrim(identifier.identifier_value)
      from pg_catalog.jsonb_to_recordset(p_identifiers) identifier(
        source_system text,
        identifier_type text,
        identifier_value text,
        is_primary boolean,
        is_active boolean
      )
      group by pg_catalog.lower(pg_catalog.btrim(identifier.source_system)),
               pg_catalog.btrim(identifier.identifier_value)
      having pg_catalog.count(*) > 1
    ) duplicate_identifier
  ) > 0 then
    raise exception using
      errcode = 'P2006',
      message = 'NEON_EMPLOYEE_WRITE_IDENTIFIER_INVALID';
  end if;

  perform existing_identifier.id
  from public.employee_external_identifiers existing_identifier
  join pg_catalog.jsonb_to_recordset(p_identifiers) requested_identifier(
    source_system text,
    identifier_type text,
    identifier_value text,
    is_primary boolean,
    is_active boolean
  ) on existing_identifier.property_id = p_property_id
     and existing_identifier.source_system = pg_catalog.lower(
       pg_catalog.btrim(requested_identifier.source_system)
     )
     and existing_identifier.identifier_value = pg_catalog.btrim(
       requested_identifier.identifier_value
     )
  where existing_identifier.employee_id is distinct from v_employee_id
  order by existing_identifier.source_system,
           existing_identifier.identifier_value,
           existing_identifier.id
  for update;

  if exists (
    select 1
    from public.employee_external_identifiers existing_identifier
    join pg_catalog.jsonb_to_recordset(p_identifiers) requested_identifier(
      source_system text,
      identifier_type text,
      identifier_value text,
      is_primary boolean,
      is_active boolean
    ) on existing_identifier.property_id = p_property_id
       and existing_identifier.source_system = pg_catalog.lower(
         pg_catalog.btrim(requested_identifier.source_system)
       )
       and existing_identifier.identifier_value = pg_catalog.btrim(
         requested_identifier.identifier_value
       )
    where existing_identifier.employee_id is distinct from v_employee_id
  ) then
    raise exception using
      errcode = 'P2002',
      message = 'NEON_EMPLOYEE_WRITE_IDENTIFIER_CONFLICT';
  end if;

  if p_employee_id is null then
    insert into public.employees (
      tenant_id,
      property_id,
      employee_number,
      name_zh,
      name_en,
      department_id,
      operational_unit_id,
      position_id,
      position_family_id,
      grade_or_band,
      hire_date,
      probation_or_confirmation_date,
      employment_status,
      is_active,
      source_system,
      source_batch_id,
      created_by,
      updated_by
    ) values (
      p_tenant_id,
      p_property_id,
      pg_catalog.btrim(p_employee_number),
      nullif(pg_catalog.btrim(p_name_zh), ''),
      nullif(pg_catalog.btrim(p_name_en), ''),
      p_department_id,
      p_operational_unit_id,
      p_position_id,
      v_authoritative_family_id,
      nullif(pg_catalog.btrim(p_grade_or_band), ''),
      p_hire_date,
      p_probation_or_confirmation_date,
      p_employment_status::public.employee_employment_status,
      p_is_active,
      'neon_employee_write',
      null,
      app_private.current_actor_auth_user_id(),
      app_private.current_actor_auth_user_id()
    ) returning id, version into v_employee_id, v_result_version;
  else
    update public.employees employee
    set employee_number = pg_catalog.btrim(p_employee_number),
        name_zh = nullif(pg_catalog.btrim(p_name_zh), ''),
        name_en = nullif(pg_catalog.btrim(p_name_en), ''),
        department_id = p_department_id,
        operational_unit_id = p_operational_unit_id,
        position_id = p_position_id,
        position_family_id = v_authoritative_family_id,
        grade_or_band = nullif(pg_catalog.btrim(p_grade_or_band), ''),
        hire_date = p_hire_date,
        probation_or_confirmation_date = p_probation_or_confirmation_date,
        employment_status = p_employment_status::public.employee_employment_status,
        is_active = p_is_active,
        source_system = 'neon_employee_write',
        source_batch_id = null,
        updated_by = app_private.current_actor_auth_user_id()
    where employee.id = v_employee_id
    returning employee.version into v_result_version;
  end if;

  delete from public.employee_external_identifiers identifier
  where identifier.employee_id = v_employee_id
    and identifier.tenant_id = p_tenant_id
    and identifier.property_id = p_property_id;

  insert into public.employee_external_identifiers (
    tenant_id,
    property_id,
    employee_id,
    source_system,
    identifier_type,
    identifier_value,
    is_primary,
    is_active,
    source_batch_id
  )
  select p_tenant_id,
         p_property_id,
         v_employee_id,
         pg_catalog.lower(pg_catalog.btrim(identifier.source_system)),
         identifier.identifier_type::public.employee_identifier_type,
         pg_catalog.btrim(identifier.identifier_value),
         identifier.is_primary,
         identifier.is_active,
         null
  from pg_catalog.jsonb_to_recordset(p_identifiers) identifier(
    source_system text,
    identifier_type text,
    identifier_value text,
    is_primary boolean,
    is_active boolean
  );

  v_after_snapshot := app_private.neon_employee_authoritative_snapshot(
    v_employee_id
  );

  perform app_private.append_neon_employee_write_audit(
    p_tenant_id,
    p_property_id,
    v_employee_id,
    case when p_employee_id is null then 'create' else 'update' end,
    v_previous_version,
    v_result_version,
    v_before_snapshot,
    v_after_snapshot
  );

  return v_after_snapshot;
exception
  when unique_violation then
    raise exception using
      errcode = 'P2002',
      message = 'NEON_EMPLOYEE_WRITE_CONFLICT';
end
$function$;

revoke all on table app_private.employee_write_audit_events
from public, authenticated, neondb_owner,
     hotel_ld_people_read, hotel_ld_application, hotel_ld_readonly;

revoke all on function
  app_private.reject_employee_write_audit_mutation(),
  app_private.neon_employee_identifier_snapshot(uuid),
  app_private.neon_employee_authoritative_snapshot(uuid),
  app_private.append_neon_employee_write_audit(
    uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb
  ),
  public.save_neon_employee_with_identifiers(
    text,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,
    text,date,date,text,boolean,jsonb
  )
from public, authenticated, neondb_owner,
     hotel_ld_people_read, hotel_ld_application, hotel_ld_readonly;

grant execute on function
  public.save_neon_employee_with_identifiers(
    text,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,
    text,date,date,text,boolean,jsonb
  )
to hotel_ld_application;

reset role;

revoke all on table
  public.employees,
  public.employee_external_identifiers,
  app_private.employee_write_audit_events
from hotel_ld_application, hotel_ld_people_read, hotel_ld_readonly;

do $e5a_postflight$
declare
  v_entrypoint regprocedure := pg_catalog.to_regprocedure(
    'public.save_neon_employee_with_identifiers(text,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,text,date,date,text,boolean,jsonb)'
  );
begin
  if v_entrypoint is null or not exists (
    select 1
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_roles owner_role
      on owner_role.oid = routine.proowner
    where routine.oid = v_entrypoint
      and owner_role.rolname = 'hotel_ld_migration_owner'
      and routine.prosecdef
      and routine.proconfig = array['search_path=""']::text[]
      and not pg_catalog.has_function_privilege(
        'public', routine.oid, 'EXECUTE'
      )
      and pg_catalog.has_function_privilege(
        'hotel_ld_application', routine.oid, 'EXECUTE'
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'E5A_EMPLOYEE_WRITE_ENTRYPOINT_ACL_DRIFT';
  end if;

  if pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef(v_entrypoint)),
    'is_new_employee'
  ) > 0 then
    raise exception using
      errcode = '42501',
      message = 'E5A_EMPLOYEE_WRITE_NEW_EMPLOYEE_RULE_LEAK';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(array[
      'public.employees',
      'public.employee_external_identifiers',
      'app_private.employee_write_audit_events'
    ]) relation(value)
    where pg_catalog.has_table_privilege(
      'hotel_ld_application',
      relation.value,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'E5A_EMPLOYEE_WRITE_RUNTIME_RAW_PRIVILEGE_DRIFT';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.employees'::regclass
      and trigger_record.tgname = 'employees_record_fact_version'
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled <> 'D'
      and trigger_record.tgfoid = pg_catalog.to_regprocedure(
        'app_private.record_employee_fact_version()'
      )
  ) or not exists (
    select 1 from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid =
      'app_private.employee_write_audit_events'::regclass
      and trigger_record.tgname = 'e5a_employee_write_audit_append_only'
      and not trigger_record.tgisinternal
      and trigger_record.tgenabled <> 'D'
      and trigger_record.tgfoid = pg_catalog.to_regprocedure(
        'app_private.reject_employee_write_audit_mutation()'
      )
  ) then
    raise exception using errcode = '42501',
      message = 'E5A_EMPLOYEE_WRITE_TRIGGER_DRIFT';
  end if;

end
$e5a_postflight$;

commit;
