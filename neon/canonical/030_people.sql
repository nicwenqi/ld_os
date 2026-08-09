begin;
set local role hotel_ld_migration_owner;

create type public.employee_employment_status as enum ('active', 'inactive', 'leave', 'terminated', 'unknown');
create type public.employee_identifier_type as enum ('local_employee_number', 'lms_employee_id', 'merlin_id', 'hris_id', 'other');

create table public.tenants (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  code text not null unique,
  name text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  updated_at timestamptz not null default pg_catalog.transaction_timestamp()
);

create table public.properties (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  code text not null,
  name_zh text not null,
  name_en text,
  timezone text not null default 'Asia/Shanghai',
  status text not null default 'active' check (status in ('active', 'inactive')),
  unique (tenant_id, id),
  unique (tenant_id, code)
);

create table public.property_domains (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  hostname text not null check (hostname = pg_catalog.lower(pg_catalog.btrim(hostname)) and hostname !~ ':'),
  verification_status text not null default 'verified' check (verification_status in ('pending', 'verified', 'failed')),
  is_active boolean not null default true,
  foreign key (tenant_id, property_id) references public.properties(tenant_id, id)
);
create unique index canonical_property_domain_hostname
  on public.property_domains(pg_catalog.lower(hostname));

create table public.profiles (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  display_name text,
  email text,
  is_active boolean not null default true
);

create table public.user_accounts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  auth_user_id uuid not null unique,
  user_id uuid not null unique references public.profiles(id),
  tenant_id uuid not null references public.tenants(id),
  property_id uuid not null,
  account_status text not null default 'active' check (account_status in ('active', 'inactive', 'locked')),
  locked_until timestamptz,
  must_change_password boolean not null default false,
  foreign key (tenant_id, property_id) references public.properties(tenant_id, id)
);

create table public.tenant_memberships (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null references public.profiles(id),
  status text not null default 'active' check (status in ('active', 'inactive')),
  unique (tenant_id, user_id)
);

create table public.property_memberships (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  user_id uuid not null references public.profiles(id),
  status text not null default 'active' check (status in ('active', 'inactive')),
  foreign key (tenant_id, property_id) references public.properties(tenant_id, id),
  unique (property_id, user_id),
  unique (tenant_id, property_id, user_id)
);

create table public.roles (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  property_id uuid,
  code text not null,
  scope_level text not null check (scope_level in ('tenant', 'property', 'department')),
  is_active boolean not null default true,
  unique (tenant_id, property_id, code),
  unique (tenant_id, property_id, id)
);

create table public.role_assignments (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  user_id uuid not null,
  role_id uuid not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  foreign key (tenant_id, property_id) references public.properties(tenant_id, id),
  foreign key (tenant_id, property_id, user_id)
    references public.property_memberships(tenant_id, property_id, user_id),
  foreign key (tenant_id, property_id, role_id)
    references public.roles(tenant_id, property_id, id),
  unique (property_id, user_id, role_id),
  unique (tenant_id, property_id, id)
);

create table public.trainer_scopes (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  role_assignment_id uuid not null,
  department_id uuid not null,
  include_descendants boolean not null default false,
  is_active boolean not null default true,
  foreign key (tenant_id, property_id) references public.properties(tenant_id, id),
  foreign key (tenant_id, property_id, role_assignment_id)
    references public.role_assignments(tenant_id, property_id, id),
  unique (role_assignment_id, department_id)
);

create table app_private.people_read_audit_events (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  auth_user_id uuid not null,
  property_id uuid not null,
  operation text not null,
  result_row_count integer not null check (result_row_count >= 0),
  occurred_at timestamptz not null default pg_catalog.transaction_timestamp()
);

create function app_private.reject_people_read_audit_mutation()
returns trigger language plpgsql volatile security invoker set search_path = ''
as $function$
begin
  raise exception using errcode = '42501', message = 'PEOPLE_READ_AUDIT_APPEND_ONLY';
end
$function$;

create trigger people_read_audit_append_only
before update or delete on app_private.people_read_audit_events
for each row execute function app_private.reject_people_read_audit_mutation();

create function app_private.neon_people_actor_is_active()
returns boolean language sql stable security invoker set search_path = ''
as $function$
  select exists (
    select 1
    from public.user_accounts account
    join public.profiles profile on profile.id = account.user_id and profile.is_active
    join public.tenants tenant on tenant.id = account.tenant_id and tenant.status = 'active'
    join public.properties property on property.id = account.property_id and property.tenant_id = account.tenant_id and property.status = 'active'
    join public.tenant_memberships tm on tm.tenant_id = account.tenant_id and tm.user_id = account.user_id and tm.status = 'active'
    join public.property_memberships pm on pm.property_id = account.property_id and pm.user_id = account.user_id and pm.status = 'active'
    where account.auth_user_id = app_private.current_actor_auth_user_id()
      and account.property_id = app_private.current_actor_property_id()
      and account.account_status = 'active'
      and (account.locked_until is null or account.locked_until <= pg_catalog.transaction_timestamp())
  )
$function$;

create function app_private.neon_people_actor_has_role(p_role_code text)
returns boolean language sql stable security invoker set search_path = ''
as $function$
  select exists (
    select 1
    from public.user_accounts account
    join public.role_assignments assignment on assignment.user_id = account.user_id and assignment.property_id = account.property_id and assignment.status = 'active'
    join public.roles role on role.id = assignment.role_id and role.is_active
    where account.auth_user_id = app_private.current_actor_auth_user_id()
      and account.property_id = app_private.current_actor_property_id()
      and role.code = p_role_code
  )
$function$;

create function app_private.neon_people_actor_has_department_scope(p_department_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $function$
  select app_private.neon_people_actor_has_role('property_ld_manager') or exists (
    select 1
    from public.user_accounts account
    join public.role_assignments assignment on assignment.user_id = account.user_id and assignment.property_id = account.property_id and assignment.status = 'active'
    join public.roles role on role.id = assignment.role_id and role.code = 'department_trainer' and role.is_active
    join public.trainer_scopes scope on scope.role_assignment_id = assignment.id and scope.is_active
    where account.auth_user_id = app_private.current_actor_auth_user_id()
      and account.property_id = app_private.current_actor_property_id()
      and (scope.department_id = p_department_id or (scope.include_descendants and exists (
        select 1 from public.department_closure closure
        where closure.property_id = account.property_id
          and closure.ancestor_department_id = scope.department_id
          and closure.descendant_department_id = p_department_id
      )))
  )
$function$;

create function app_private.neon_people_can_read_employee(p_employee_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $function$
  select exists (
    select 1 from public.employees employee
    where employee.id = p_employee_id
      and employee.property_id = app_private.current_actor_property_id()
      and app_private.neon_people_actor_has_department_scope(employee.department_id)
  )
$function$;

create function app_private.neon_people_hostname_matches(p_hostname text)
returns boolean language sql stable security invoker set search_path = ''
as $function$
  select exists (
    select 1 from public.property_domains domain
    join public.properties property on property.id = domain.property_id and property.tenant_id = domain.tenant_id and property.status = 'active'
    join public.tenants tenant on tenant.id = domain.tenant_id and tenant.status = 'active'
    where pg_catalog.lower(domain.hostname) = pg_catalog.lower(
      pg_catalog.split_part(pg_catalog.btrim(coalesce(p_hostname,'')),':',1)
    )
      and domain.is_active and domain.verification_status = 'verified'
      and domain.property_id = app_private.current_actor_property_id()
  )
$function$;

create function app_private.assert_neon_people_hostname(p_hostname text)
returns void language plpgsql stable security invoker set search_path = ''
as $function$
begin
  perform app_private.assert_actor_context();
  if not app_private.neon_people_actor_is_active() or not app_private.neon_people_hostname_matches(p_hostname) then
    raise exception using errcode = '42501', message = 'NEON_PEOPLE_SCOPE_DENIED';
  end if;
end
$function$;

create function app_private.assert_neon_people_manager()
returns void language plpgsql stable security invoker set search_path = ''
as $function$
begin
  if not app_private.neon_people_actor_has_role('property_ld_manager') then
    raise exception using errcode = '42501', message = 'NEON_PEOPLE_MANAGER_REQUIRED';
  end if;
end
$function$;

create function app_private.assert_neon_people_department()
returns void language plpgsql stable security invoker set search_path = ''
as $function$
begin
  if not app_private.neon_people_actor_has_role('department_trainer') then
    raise exception using errcode = '42501', message = 'NEON_PEOPLE_DEPARTMENT_REQUIRED';
  end if;
end
$function$;

create function app_private.append_neon_people_read_audit(p_operation text, p_count integer)
returns void language plpgsql volatile security invoker set search_path = ''
as $function$
begin
  insert into app_private.people_read_audit_events(request_id, auth_user_id, property_id, operation, result_row_count)
  values (app_private.current_actor_request_id(), app_private.current_actor_auth_user_id(), app_private.current_actor_property_id(), p_operation, p_count);
end
$function$;

create function public.resolve_neon_people_property(p_hostname text)
returns table (tenant_id uuid, property_id uuid)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if session_user <> 'hotel_ld_application' then
    raise exception using errcode = '42501', message = 'CANONICAL_RUNTIME_REQUIRED';
  end if;
  return query
    select domain.tenant_id, domain.property_id
    from public.property_domains domain
    join public.properties property on property.id = domain.property_id and property.tenant_id = domain.tenant_id
    where pg_catalog.lower(domain.hostname) = pg_catalog.lower(
      pg_catalog.split_part(pg_catalog.btrim(coalesce(p_hostname,'')),':',1)
    )
      and domain.is_active and domain.verification_status = 'verified'
      and property.status = 'active';
end
$function$;

create function public.read_neon_people_manager_directory(
  p_hostname text, p_query text, p_department_id uuid, p_position_id uuid,
  p_position_family_id uuid, p_employment_status text, p_active boolean,
  p_limit integer, p_offset integer
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_payload jsonb; v_count integer;
begin
  perform app_private.assert_neon_people_hostname(p_hostname);
  perform app_private.assert_neon_people_manager();
  with filtered as (
    select e.*, d.name_zh department_name, u.name_zh operational_unit_name,
      p.name_zh position_name, f.name_zh position_family_name
    from public.employees e
    left join public.departments d on d.id = e.department_id
    left join public.operational_units u on u.id = e.operational_unit_id
    left join public.positions p on p.id = e.position_id
    left join public.position_families f on f.id = e.position_family_id
    where e.property_id = app_private.current_actor_property_id()
      and (p_query is null or e.employee_number ilike '%' || p_query || '%' or coalesce(e.name_zh,'') ilike '%' || p_query || '%' or coalesce(e.name_en,'') ilike '%' || p_query || '%')
      and (p_department_id is null or e.department_id = p_department_id)
      and (p_position_id is null or e.position_id = p_position_id)
      and (p_position_family_id is null or e.position_family_id = p_position_family_id)
      and (p_employment_status is null or e.employment_status::text = p_employment_status)
      and (p_active is null or e.is_active = p_active)
  ), paged as (
    select * from filtered order by employee_number limit pg_catalog.greatest(1, pg_catalog.least(coalesce(p_limit,25),100)) offset pg_catalog.greatest(coalesce(p_offset,0),0)
  )
  select pg_catalog.jsonb_build_object(
    'rows', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', id, 'tenant_id', tenant_id, 'property_id', property_id, 'employee_number', employee_number,
      'name_zh', name_zh, 'name_en', name_en, 'department_id', department_id, 'department_name', department_name,
      'operational_unit_id', operational_unit_id, 'operational_unit_name', operational_unit_name,
      'position_id', position_id, 'position_name', position_name, 'position_family_id', position_family_id,
      'position_family_name', position_family_name, 'grade_or_band', grade_or_band, 'hire_date', hire_date,
      'probation_or_confirmation_date', probation_or_confirmation_date, 'employment_status', employment_status,
      'is_new_employee', coalesce(hire_date >= current_date - 30, false), 'is_active', is_active,
      'external_identifier_types', coalesce((select pg_catalog.jsonb_agg(x.identifier_type order by x.identifier_type) from public.employee_external_identifiers x where x.employee_id = paged.id and x.is_active), '[]'::jsonb),
      'version', version
    ) order by employee_number), '[]'::jsonb),
    'total', (select count(*) from filtered), 'refreshed_at', pg_catalog.transaction_timestamp()
  ), (select count(*)::integer from filtered) into v_payload, v_count from paged;
  v_payload := coalesce(v_payload, pg_catalog.jsonb_build_object('rows','[]'::jsonb,'total',0,'refreshed_at',pg_catalog.transaction_timestamp()));
  perform app_private.append_neon_people_read_audit('manager_directory', coalesce(v_count,0));
  return v_payload;
end
$function$;

create function public.read_neon_people_manager_employee(p_hostname text, p_employee_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_payload jsonb;
begin
  perform app_private.assert_neon_people_hostname(p_hostname);
  perform app_private.assert_neon_people_manager();
  select pg_catalog.jsonb_build_object(
    'id', e.id, 'tenant_id', e.tenant_id, 'property_id', e.property_id, 'employee_number', e.employee_number,
    'name_zh', e.name_zh, 'name_en', e.name_en, 'department_id', e.department_id, 'department_name', d.name_zh,
    'operational_unit_id', e.operational_unit_id, 'operational_unit_name', u.name_zh, 'position_id', e.position_id,
    'position_name', p.name_zh, 'position_family_id', e.position_family_id, 'position_family_name', f.name_zh,
    'grade_or_band', e.grade_or_band, 'hire_date', e.hire_date, 'probation_or_confirmation_date', e.probation_or_confirmation_date,
    'employment_status', e.employment_status, 'is_new_employee', coalesce(e.hire_date >= current_date - 30, false),
    'is_active', e.is_active, 'external_identifier_types', coalesce((select pg_catalog.jsonb_agg(x.identifier_type order by x.identifier_type) from public.employee_external_identifiers x where x.employee_id=e.id and x.is_active),'[]'::jsonb), 'version', e.version
  ) into v_payload
  from public.employees e
  left join public.departments d on d.id=e.department_id
  left join public.operational_units u on u.id=e.operational_unit_id
  left join public.positions p on p.id=e.position_id
  left join public.position_families f on f.id=e.position_family_id
  where e.id=p_employee_id and e.property_id=app_private.current_actor_property_id();
  perform app_private.append_neon_people_read_audit('manager_employee', case when v_payload is null then 0 else 1 end);
  return v_payload;
end
$function$;

create function public.read_neon_people_manager_facets(p_hostname text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_payload jsonb; v_count integer;
begin
  perform app_private.assert_neon_people_hostname(p_hostname);
  perform app_private.assert_neon_people_manager();
  select pg_catalog.jsonb_build_object(
    'departments', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'label',name_zh) order by sort_order,name_zh) from public.departments where property_id=app_private.current_actor_property_id() and is_active),'[]'::jsonb),
    'positions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'label',name_zh) order by name_zh) from public.positions where property_id=app_private.current_actor_property_id() and is_active),'[]'::jsonb),
    'position_families', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'label',name_zh) order by sort_order,name_zh) from public.position_families where property_id=app_private.current_actor_property_id() and is_active),'[]'::jsonb)
  ) into v_payload;
  v_count := pg_catalog.jsonb_array_length(v_payload->'departments') + pg_catalog.jsonb_array_length(v_payload->'positions') + pg_catalog.jsonb_array_length(v_payload->'position_families');
  perform app_private.append_neon_people_read_audit('manager_facets',v_count);
  return v_payload;
end
$function$;

create function public.read_neon_people_department_directory(p_hostname text, p_query text, p_limit integer, p_offset integer)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare v_payload jsonb; v_count integer;
begin
  perform app_private.assert_neon_people_hostname(p_hostname);
  perform app_private.assert_neon_people_department();
  with scoped as (
    select e.*, d.name_zh department_name, u.name_zh operational_unit_name, p.name_zh position_name, f.name_zh position_family_name
    from public.employees e join public.departments d on d.id=e.department_id
    left join public.operational_units u on u.id=e.operational_unit_id
    left join public.positions p on p.id=e.position_id left join public.position_families f on f.id=e.position_family_id
    where e.property_id=app_private.current_actor_property_id() and app_private.neon_people_actor_has_department_scope(e.department_id)
      and (p_query is null or e.employee_number ilike '%'||p_query||'%' or coalesce(e.name_zh,'') ilike '%'||p_query||'%')
  ), paged as (select * from scoped order by employee_number limit pg_catalog.greatest(1,pg_catalog.least(coalesce(p_limit,25),100)) offset pg_catalog.greatest(coalesce(p_offset,0),0))
  select pg_catalog.jsonb_build_object(
    'rows',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('employee_number',employee_number,'name_zh',name_zh,'name_en',name_en,'department_id',department_id,'department_name',department_name,'operational_unit_id',operational_unit_id,'operational_unit_name',operational_unit_name,'position_id',position_id,'position_name',position_name,'position_family_id',position_family_id,'position_family_name',position_family_name,'hire_date',hire_date,'probation_or_confirmation_date',probation_or_confirmation_date,'employment_status',employment_status,'is_new_employee',coalesce(hire_date>=current_date-30,false),'is_active',is_active) order by employee_number),'[]'::jsonb),
    'total',(select count(*) from scoped),
    'refreshed_at',pg_catalog.transaction_timestamp(),
    'scopes',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('department_id',d.id,'department_name_zh',d.name_zh,'department_name_en',d.name_en,'breadcrumb',d.path_names_zh,'breadcrumb_en',d.path_names_en,'include_descendants',s.include_descendants)) from public.user_accounts a join public.role_assignments ra on ra.user_id=a.user_id and ra.status='active' join public.trainer_scopes s on s.role_assignment_id=ra.id and s.is_active join public.departments d on d.id=s.department_id where a.auth_user_id=app_private.current_actor_auth_user_id() and a.property_id=app_private.current_actor_property_id()),'[]'::jsonb)
  ), (select count(*)::integer from scoped) into v_payload,v_count from paged;
  v_payload := coalesce(v_payload,pg_catalog.jsonb_build_object('rows','[]'::jsonb,'total',0,'refreshed_at',pg_catalog.transaction_timestamp(),'scopes','[]'::jsonb));
  perform app_private.append_neon_people_read_audit('department_directory',coalesce(v_count,0));
  return v_payload;
end
$function$;

revoke all on function app_private.reject_people_read_audit_mutation() from public;
revoke all on function app_private.neon_people_actor_is_active() from public;
revoke all on function app_private.neon_people_actor_has_role(text) from public;
revoke all on function app_private.neon_people_actor_has_department_scope(uuid) from public;
revoke all on function app_private.neon_people_can_read_employee(uuid) from public;
revoke all on function app_private.neon_people_hostname_matches(text) from public;
revoke all on function app_private.assert_neon_people_hostname(text) from public;
revoke all on function app_private.assert_neon_people_manager() from public;
revoke all on function app_private.assert_neon_people_department() from public;
revoke all on function app_private.append_neon_people_read_audit(text,integer) from public;
revoke all on function public.resolve_neon_people_property(text) from public;
revoke all on function public.read_neon_people_manager_directory(text,text,uuid,uuid,uuid,text,boolean,integer,integer) from public;
revoke all on function public.read_neon_people_manager_employee(text,uuid) from public;
revoke all on function public.read_neon_people_manager_facets(text) from public;
revoke all on function public.read_neon_people_department_directory(text,text,integer,integer) from public;

grant execute on function public.resolve_neon_people_property(text) to hotel_ld_application;
grant execute on function public.read_neon_people_manager_directory(text,text,uuid,uuid,uuid,text,boolean,integer,integer) to hotel_ld_application;
grant execute on function public.read_neon_people_manager_employee(text,uuid) to hotel_ld_application;
grant execute on function public.read_neon_people_manager_facets(text) to hotel_ld_application;
grant execute on function public.read_neon_people_department_directory(text,text,integer,integer) to hotel_ld_application;

commit;
