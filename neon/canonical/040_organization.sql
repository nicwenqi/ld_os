begin;
set local role hotel_ld_migration_owner;
set local check_function_bodies = off;

create type public.department_node_type as enum ('division','department','section','team','other');
create type public.department_resolution_type as enum ('mapped','created_top_level','created_child','merged','ignored','deferred');
create type public.operational_unit_type as enum ('venue','outlet','kitchen','restaurant','recreation','other');

create table public.departments (
  id uuid primary key default pg_catalog.gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  parent_id uuid, node_type public.department_node_type not null default 'department',
  code text, name_zh text not null, name_en text, sort_order integer not null default 0,
  depth integer not null default 0, path_ids uuid[] not null default '{}'::uuid[],
  path_names_zh text[] not null default '{}'::text[], path_names_en text[] not null default '{}'::text[],
  is_active boolean not null default true, version bigint not null default 1 check (version > 0),
  foreign key (tenant_id, property_id) references public.properties(tenant_id,id),
  foreign key (tenant_id, property_id, parent_id) references public.departments(tenant_id, property_id, id),
  unique (property_id,id), unique (tenant_id,property_id,id), unique (property_id,code)
);

create table public.department_closure (
  tenant_id uuid not null, property_id uuid not null, ancestor_department_id uuid not null,
  descendant_department_id uuid not null, distance integer not null check (distance >= 0),
  primary key (property_id,ancestor_department_id,descendant_department_id),
  foreign key (tenant_id,property_id) references public.properties(tenant_id,id),
  foreign key (tenant_id,property_id,ancestor_department_id) references public.departments(tenant_id,property_id,id),
  foreign key (tenant_id,property_id,descendant_department_id) references public.departments(tenant_id,property_id,id)
);

alter table public.trainer_scopes
  add foreign key (tenant_id,property_id,department_id)
  references public.departments(tenant_id,property_id,id);

create table public.department_aliases (
  id uuid primary key default pg_catalog.gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  source_system text not null, source_sheet text, source_value text not null, normalized_source_value text not null,
  source_row_count integer not null default 0 check (source_row_count >= 0), suggested_target_id uuid,
  suggestion_label text not null default '', confidence integer not null default 0 check (confidence between 0 and 100),
  suggestion_reason text not null default '', target_department_id uuid, operational_unit_id uuid,
  resolution_type public.department_resolution_type not null default 'deferred', is_active boolean not null default true,
  resolved_by uuid, resolved_at timestamptz, version bigint not null default 1,
  foreign key (tenant_id,property_id) references public.properties(tenant_id,id),
  foreign key (tenant_id,property_id,suggested_target_id) references public.departments(tenant_id,property_id,id),
  foreign key (tenant_id,property_id,target_department_id) references public.departments(tenant_id,property_id,id),
  unique (property_id,source_system,source_sheet,normalized_source_value)
);

create table public.operational_units (
  id uuid primary key default pg_catalog.gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  department_id uuid not null, parent_operational_unit_id uuid,
  unit_type public.operational_unit_type not null, code text, name_zh text not null, name_en text, sort_order integer not null default 0,
  depth integer not null default 0, path_ids uuid[] not null default '{}'::uuid[], is_active boolean not null default true,
  version bigint not null default 1 check (version > 0), foreign key (tenant_id,property_id) references public.properties(tenant_id,id),
  foreign key (tenant_id,property_id,department_id) references public.departments(tenant_id,property_id,id),
  foreign key (tenant_id,property_id,parent_operational_unit_id) references public.operational_units(tenant_id,property_id,id),
  unique (property_id,id), unique (tenant_id,property_id,id), unique (property_id,code)
);

alter table public.department_aliases add foreign key (tenant_id,property_id,operational_unit_id)
  references public.operational_units(tenant_id,property_id,id);

create table public.operational_unit_aliases (
  id uuid primary key default pg_catalog.gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  operational_unit_id uuid not null, source_system text not null,
  source_sheet text, source_value text not null, normalized_source_value text not null, source_row_count integer not null default 0,
  is_active boolean not null default true, foreign key (tenant_id,property_id) references public.properties(tenant_id,id),
  foreign key (tenant_id,property_id,operational_unit_id) references public.operational_units(tenant_id,property_id,id),
  unique (property_id,source_system,source_sheet,normalized_source_value)
);

create table app_private.organization_read_audit_events (
  id bigint generated always as identity primary key, request_id uuid not null, auth_user_id uuid not null,
  actor_user_id uuid not null, tenant_id uuid not null, property_id uuid not null, operation text not null,
  target_id uuid, details jsonb not null default '{}'::jsonb, occurred_at timestamptz not null default pg_catalog.transaction_timestamp()
);
create table app_private.organization_write_audit_events (like app_private.organization_read_audit_events including all);
create table app_private.organization_alias_resolution_audit_events (like app_private.organization_read_audit_events including all);
create table app_private.organization_operational_unit_audit_events (like app_private.organization_read_audit_events including all);
create table app_private.organization_alias_activation_audit_events (like app_private.organization_read_audit_events including all);

create function app_private.reject_organization_read_audit_mutation() returns trigger language plpgsql volatile security invoker set search_path='' as $f$ begin raise exception using errcode='42501',message='ORGANIZATION_READ_AUDIT_APPEND_ONLY'; end $f$;
create function app_private.reject_organization_write_audit_mutation() returns trigger language plpgsql volatile security invoker set search_path='' as $f$ begin raise exception using errcode='42501',message='ORGANIZATION_WRITE_AUDIT_APPEND_ONLY'; end $f$;
create function app_private.reject_organization_alias_audit_mutation() returns trigger language plpgsql volatile security invoker set search_path='' as $f$ begin raise exception using errcode='42501',message='ORGANIZATION_ALIAS_AUDIT_APPEND_ONLY'; end $f$;
create function app_private.reject_organization_operational_unit_audit_mutation() returns trigger language plpgsql volatile security invoker set search_path='' as $f$ begin raise exception using errcode='42501',message='ORGANIZATION_UNIT_AUDIT_APPEND_ONLY'; end $f$;
create function app_private.reject_organization_alias_activation_audit_mutation() returns trigger language plpgsql volatile security invoker set search_path='' as $f$ begin raise exception using errcode='42501',message='ORGANIZATION_ALIAS_ACTIVATION_AUDIT_APPEND_ONLY'; end $f$;

create trigger organization_read_audit_append_only before update or delete on app_private.organization_read_audit_events for each row execute function app_private.reject_organization_read_audit_mutation();
create trigger organization_write_audit_append_only before update or delete on app_private.organization_write_audit_events for each row execute function app_private.reject_organization_write_audit_mutation();
create trigger organization_alias_resolution_audit_append_only before update or delete on app_private.organization_alias_resolution_audit_events for each row execute function app_private.reject_organization_alias_audit_mutation();
create trigger organization_operational_unit_audit_append_only before update or delete on app_private.organization_operational_unit_audit_events for each row execute function app_private.reject_organization_operational_unit_audit_mutation();
create trigger organization_alias_activation_audit_append_only before update or delete on app_private.organization_alias_activation_audit_events for each row execute function app_private.reject_organization_alias_activation_audit_mutation();

create function app_private.current_neon_organization_actor_user_id() returns uuid language sql stable security invoker set search_path='' as $f$
  select account.user_id from public.user_accounts account where account.auth_user_id=app_private.current_actor_auth_user_id() and account.property_id=app_private.current_actor_property_id() and account.account_status='active'
$f$;
create function app_private.neon_organization_actor_is_active() returns boolean language sql stable security invoker set search_path='' as $f$ select app_private.neon_people_actor_is_active() $f$;
create function app_private.neon_organization_actor_has_role(p_code text) returns boolean language sql stable security invoker set search_path='' as $f$ select app_private.neon_people_actor_has_role(p_code) $f$;
create function app_private.neon_organization_actor_has_department_scope(p_id uuid) returns boolean language sql stable security invoker set search_path='' as $f$ select app_private.neon_people_actor_has_department_scope(p_id) $f$;
create function app_private.neon_organization_hostname_matches(p_hostname text) returns boolean language sql stable security invoker set search_path='' as $f$ select app_private.neon_people_hostname_matches(p_hostname) $f$;
create function app_private.neon_organization_actor_can_read_department(p_id uuid) returns boolean language sql stable security invoker set search_path='' as $f$ select app_private.neon_organization_actor_has_role('property_ld_manager') or app_private.neon_organization_actor_has_department_scope(p_id) $f$;
create function app_private.neon_organization_actor_can_read_aliases() returns boolean language sql stable security invoker set search_path='' as $f$
  select app_private.neon_organization_actor_is_active() and (
    app_private.neon_organization_actor_has_role('property_ld_manager') or exists (
      select 1
      from public.user_accounts account
      join public.role_assignments assignment
        on assignment.user_id=account.user_id and assignment.tenant_id=account.tenant_id
        and assignment.property_id=account.property_id and assignment.status='active'
      join public.roles role
        on role.id=assignment.role_id and role.tenant_id=assignment.tenant_id
        and role.property_id=assignment.property_id and role.code='department_training_admin' and role.is_active
      join public.trainer_scopes scope
        on scope.role_assignment_id=assignment.id and scope.tenant_id=assignment.tenant_id
        and scope.property_id=assignment.property_id and scope.is_active
      join public.departments department
        on department.id=scope.department_id and department.tenant_id=scope.tenant_id
        and department.property_id=scope.property_id and department.is_active
      where account.auth_user_id=app_private.current_actor_auth_user_id()
        and account.property_id=app_private.current_actor_property_id()
    )
  )
$f$;
create function app_private.neon_organization_actor_can_resolve_aliases() returns boolean language sql stable security invoker set search_path='' as $f$
  select app_private.neon_organization_actor_is_active() and app_private.neon_organization_actor_has_role('property_ld_manager')
$f$;
create function app_private.neon_organization_actor_can_read_operational_unit(p_id uuid) returns boolean language sql stable security invoker set search_path='' as $f$ select exists(select 1 from public.operational_units u where u.id=p_id and u.property_id=app_private.current_actor_property_id() and app_private.neon_organization_actor_can_read_department(u.department_id)) $f$;
create function app_private.neon_organization_actor_can_mutate_operational_units() returns boolean language sql stable security invoker set search_path='' as $f$ select app_private.neon_organization_actor_has_role('property_ld_manager') $f$;

create function app_private.assert_neon_organization_hostname(p_hostname text) returns void language plpgsql stable security invoker set search_path='' as $f$ begin perform app_private.assert_actor_context(); if not app_private.neon_organization_actor_is_active() or not app_private.neon_organization_hostname_matches(p_hostname) then raise exception using errcode='42501',message='NEON_ORGANIZATION_SCOPE_DENIED'; end if; end $f$;
create function app_private.assert_neon_organization_reader() returns void language plpgsql stable security invoker set search_path='' as $f$ begin if not (app_private.neon_organization_actor_has_role('property_ld_manager') or app_private.neon_organization_actor_has_role('department_training_admin')) then raise exception using errcode='42501',message='NEON_ORGANIZATION_READER_REQUIRED'; end if; end $f$;
create function app_private.assert_neon_organization_manager() returns void language plpgsql stable security invoker set search_path='' as $f$ begin if not app_private.neon_organization_actor_has_role('property_ld_manager') then raise exception using errcode='42501',message='NEON_ORGANIZATION_MANAGER_REQUIRED'; end if; end $f$;
create function app_private.lock_neon_organization_hierarchy(p_property_id uuid) returns void language plpgsql volatile security invoker set search_path='' as $f$ begin perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_property_id::text,0)); end $f$;

create function app_private.prepare_department_insert() returns trigger language plpgsql volatile security invoker set search_path='' as $f$
declare p public.departments;
begin
  if new.parent_id is null then new.depth:=0; new.path_ids:=array[new.id]; new.path_names_zh:=array[new.name_zh]; new.path_names_en:=array[coalesce(new.name_en,new.name_zh)];
  else select * into strict p from public.departments where id=new.parent_id and tenant_id=new.tenant_id and property_id=new.property_id; new.depth:=p.depth+1; new.path_ids:=p.path_ids||new.id; new.path_names_zh:=p.path_names_zh||new.name_zh; new.path_names_en:=p.path_names_en||coalesce(new.name_en,new.name_zh); end if;
  return new;
end $f$;
create function app_private.insert_department_closure() returns trigger language plpgsql volatile security invoker set search_path='' as $f$
begin
  insert into public.department_closure(tenant_id,property_id,ancestor_department_id,descendant_department_id,distance) values(new.tenant_id,new.property_id,new.id,new.id,0);
  if new.parent_id is not null then insert into public.department_closure(tenant_id,property_id,ancestor_department_id,descendant_department_id,distance) select tenant_id,property_id,ancestor_department_id,new.id,distance+1 from public.department_closure where property_id=new.property_id and descendant_department_id=new.parent_id; end if;
  return new;
end $f$;
create trigger canonical_department_path_insert before insert or update of parent_id,name_zh,name_en on public.departments for each row execute function app_private.prepare_department_insert();
create trigger canonical_department_closure_insert after insert on public.departments for each row execute function app_private.insert_department_closure();

create function app_private.prepare_operational_unit_insert() returns trigger language plpgsql volatile security invoker set search_path='' as $f$
declare p public.operational_units;
begin if new.parent_operational_unit_id is null then new.depth:=0; new.path_ids:=array[new.id]; else select * into strict p from public.operational_units where id=new.parent_operational_unit_id and property_id=new.property_id; new.depth:=p.depth+1; new.path_ids:=p.path_ids||new.id; end if; return new; end $f$;
create trigger canonical_operational_unit_path_insert before insert or update of parent_operational_unit_id on public.operational_units for each row execute function app_private.prepare_operational_unit_insert();

create function app_private.neon_organization_department_payload(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $f$
  select pg_catalog.jsonb_build_object('id',d.id,'tenant_id',d.tenant_id,'property_id',d.property_id,'parent_id',d.parent_id,'node_type',d.node_type,'code',d.code,'name_zh',d.name_zh,'name_en',d.name_en,'sort_order',d.sort_order,'depth',d.depth,'path_ids',d.path_ids,'is_active',d.is_active,'version',d.version,'synthetic_employee_count',(select count(*) from public.employees e where e.department_id=d.id)) from public.departments d where d.id=p_id
$f$;
create function app_private.neon_organization_department_alias_payload(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $f$
  select pg_catalog.jsonb_build_object('id',a.id,'property_id',a.property_id,'source_system',a.source_system,'source_sheet',a.source_sheet,'source_value',a.source_value,'normalized_source_value',a.normalized_source_value,'source_row_count',a.source_row_count,'suggested_target_id',a.suggested_target_id,'suggestion_label',a.suggestion_label,'confidence',a.confidence,'suggestion_reason',a.suggestion_reason,'target_department_id',a.target_department_id,'operational_unit_id',a.operational_unit_id,'resolution_type',a.resolution_type,'is_active',a.is_active) from public.department_aliases a where a.id=p_id
$f$;
create function app_private.neon_organization_operational_unit_payload(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $f$
  select pg_catalog.jsonb_build_object('id',u.id,'tenant_id',u.tenant_id,'property_id',u.property_id,'department_id',u.department_id,'parent_operational_unit_id',u.parent_operational_unit_id,'unit_type',u.unit_type,'code',u.code,'name_zh',u.name_zh,'name_en',u.name_en,'sort_order',u.sort_order,'is_active',u.is_active,'version',u.version) from public.operational_units u where u.id=p_id
$f$;

create function app_private.append_neon_organization_read_audit(p_operation text,p_target uuid,p_details jsonb) returns void language plpgsql volatile security invoker set search_path='' as $f$
declare a uuid; t uuid; begin a:=app_private.current_neon_organization_actor_user_id(); select tenant_id into t from public.properties where id=app_private.current_actor_property_id(); insert into app_private.organization_read_audit_events(request_id,auth_user_id,actor_user_id,tenant_id,property_id,operation,target_id,details) values(app_private.current_actor_request_id(),app_private.current_actor_auth_user_id(),a,t,app_private.current_actor_property_id(),p_operation,p_target,coalesce(p_details,'{}'::jsonb)); end $f$;
create function app_private.append_neon_organization_write_audit(p_operation text,p_target uuid,p_details jsonb) returns void language plpgsql volatile security invoker set search_path='' as $f$
declare a uuid; t uuid; begin a:=app_private.current_neon_organization_actor_user_id(); select tenant_id into t from public.properties where id=app_private.current_actor_property_id(); insert into app_private.organization_write_audit_events(request_id,auth_user_id,actor_user_id,tenant_id,property_id,operation,target_id,details) values(app_private.current_actor_request_id(),app_private.current_actor_auth_user_id(),a,t,app_private.current_actor_property_id(),p_operation,p_target,coalesce(p_details,'{}'::jsonb)); end $f$;
create function app_private.append_neon_organization_alias_activation_audit(p_operation text,p_alias uuid,p_target uuid,p_resolution public.department_resolution_type,p_department uuid,p_unit uuid,p_details jsonb) returns void language plpgsql volatile security invoker set search_path='' as $f$
declare a uuid; t uuid; begin a:=app_private.current_neon_organization_actor_user_id(); select tenant_id into t from public.properties where id=app_private.current_actor_property_id(); insert into app_private.organization_alias_activation_audit_events(request_id,auth_user_id,actor_user_id,tenant_id,property_id,operation,target_id,details) values(app_private.current_actor_request_id(),app_private.current_actor_auth_user_id(),a,t,app_private.current_actor_property_id(),p_operation,p_alias,pg_catalog.jsonb_build_object('target',p_target,'resolution',p_resolution,'department',p_department,'unit',p_unit)||coalesce(p_details,'{}'::jsonb)); end $f$;

create function public.resolve_neon_organization_property(p_hostname text) returns table(tenant_id uuid,property_id uuid) language plpgsql stable security definer set search_path='' as $f$ begin if session_user<>'hotel_ld_application' then raise exception using errcode='42501',message='CANONICAL_RUNTIME_REQUIRED'; end if; return query select d.tenant_id,d.property_id from public.property_domains d join public.properties p on p.id=d.property_id and p.tenant_id=d.tenant_id and p.status='active' where pg_catalog.lower(d.hostname)=pg_catalog.lower(pg_catalog.split_part(pg_catalog.btrim(coalesce(p_hostname,'')),':',1)) and d.is_active and d.verification_status='verified'; end $f$;

create function public.read_neon_organization_department_tree(p_hostname text) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare r jsonb; c integer; begin perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_reader(); select coalesce(pg_catalog.jsonb_agg(app_private.neon_organization_department_payload(d.id) order by d.path_ids),'[]'::jsonb),count(*)::integer into r,c from public.departments d where d.property_id=app_private.current_actor_property_id() and app_private.neon_organization_actor_can_read_department(d.id); perform app_private.append_neon_organization_read_audit('department_tree',null,pg_catalog.jsonb_build_object('count',c)); return pg_catalog.jsonb_build_object('rows',r); end $f$;
create function public.create_neon_organization_department(p_hostname text,p_tenant uuid,p_property uuid,p_parent uuid,p_type text,p_code text,p_zh text,p_en text,p_sort integer) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare i uuid:=pg_catalog.gen_random_uuid();
begin
  perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_manager();
  if p_tenant<>(select tenant_id from public.properties where id=p_property and status='active') or p_property<>app_private.current_actor_property_id() or nullif(pg_catalog.btrim(coalesce(p_zh,'')),'') is null then raise exception using errcode='42501',message='NEON_ORGANIZATION_SCOPE_DENIED'; end if;
  perform app_private.lock_neon_organization_hierarchy(p_property);
  if p_parent is not null then
    perform d.id from public.departments d where d.id=p_parent and d.tenant_id=p_tenant and d.property_id=p_property and d.is_active order by d.id for key share;
    if not found then raise exception using errcode='22023',message='NEON_ORGANIZATION_DEPARTMENT_PARENT_INVALID'; end if;
  end if;
  insert into public.departments(id,tenant_id,property_id,parent_id,node_type,code,name_zh,name_en,sort_order) values(i,p_tenant,p_property,p_parent,p_type::public.department_node_type,nullif(pg_catalog.lower(pg_catalog.btrim(p_code)),''),pg_catalog.btrim(p_zh),nullif(pg_catalog.btrim(p_en),''),coalesce(p_sort,0)); perform app_private.append_neon_organization_write_audit('department_create',i,'{}'::jsonb); return app_private.neon_organization_department_payload(i);
end $f$;
create function public.update_neon_organization_department(p_hostname text,p_id uuid,p_version bigint,p_zh text,p_en text,p_sort integer,p_active boolean) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare prop uuid;
begin
  perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_manager();
  if nullif(pg_catalog.btrim(coalesce(p_zh,'')),'') is null or p_version is null or p_version<1 or p_active is null then raise exception using errcode='22023',message='NEON_ORGANIZATION_DEPARTMENT_INPUT_INVALID'; end if;
  prop:=app_private.current_actor_property_id();
  perform app_private.lock_neon_organization_hierarchy(prop);
  perform d.id from public.departments d where d.property_id=prop and (d.id=p_id or p_id=any(d.path_ids)) order by d.id for update;
  update public.departments set name_zh=pg_catalog.btrim(p_zh),name_en=nullif(pg_catalog.btrim(p_en),''),sort_order=coalesce(p_sort,0),is_active=p_active,version=version+1 where id=p_id and property_id=prop and version=p_version;
  if not found then raise exception using errcode='40001',message='NEON_ORGANIZATION_VERSION_CONFLICT'; end if;
  with recursive tree as (
    select d.id,d.parent_id,0 depth,array[d.id] ids,array[d.name_zh] path_names_zh,array[coalesce(d.name_en,d.name_zh)] path_names_en from public.departments d where d.property_id=prop and d.parent_id is null
    union all
    select d.id,d.parent_id,t.depth+1,t.ids||d.id,t.path_names_zh||d.name_zh,t.path_names_en||coalesce(d.name_en,d.name_zh) from public.departments d join tree t on t.id=d.parent_id where d.property_id=prop
  )
  update public.departments d set depth=t.depth,path_ids=t.ids,path_names_zh=t.path_names_zh,path_names_en=t.path_names_en,version=case when d.id=p_id then d.version else d.version+1 end from tree t where d.id=t.id and p_id=any(t.ids);
  perform app_private.append_neon_organization_write_audit('department_update',p_id,'{}'::jsonb); return app_private.neon_organization_department_payload(p_id);
end $f$;
create function public.preview_neon_organization_department_move(p_hostname text,p_id uuid,p_parent uuid) returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare d public.departments; q public.departments; proposed text;
begin
  perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_manager();
  select * into strict d from public.departments where id=p_id and property_id=app_private.current_actor_property_id();
  if p_parent is not null then
    if p_parent=p_id then raise exception using errcode='23514',message='NEON_ORGANIZATION_MOVE_SELF_PARENT'; end if;
    select * into strict q from public.departments where id=p_parent and tenant_id=d.tenant_id and property_id=d.property_id and is_active;
    if exists(select 1 from public.department_closure where tenant_id=d.tenant_id and property_id=d.property_id and ancestor_department_id=d.id and descendant_department_id=p_parent) then raise exception using errcode='23514',message='NEON_ORGANIZATION_MOVE_CYCLE'; end if;
    proposed:=pg_catalog.array_to_string(q.path_names_zh||d.name_zh,' / ');
  else proposed:=d.name_zh; end if;
  return pg_catalog.jsonb_build_object(
    'current_path',pg_catalog.array_to_string(d.path_names_zh,' / '),'proposed_path',proposed,
    'child_departments_affected',(select count(*)-1 from public.department_closure where tenant_id=d.tenant_id and property_id=d.property_id and ancestor_department_id=d.id),
    'synthetic_employee_impact',(select count(*) from public.employees e join public.department_closure c on c.tenant_id=e.tenant_id and c.property_id=e.property_id and c.descendant_department_id=e.department_id where c.tenant_id=d.tenant_id and c.property_id=d.property_id and c.ancestor_department_id=d.id),
    'aliases_affected',(select count(*) from public.department_aliases a join public.department_closure c on c.tenant_id=a.tenant_id and c.property_id=a.property_id and c.descendant_department_id=a.target_department_id where c.tenant_id=d.tenant_id and c.property_id=d.property_id and c.ancestor_department_id=d.id),
    'operational_units_affected',(select count(*) from public.operational_units u join public.department_closure c on c.tenant_id=u.tenant_id and c.property_id=u.property_id and c.descendant_department_id=u.department_id where c.tenant_id=d.tenant_id and c.property_id=d.property_id and c.ancestor_department_id=d.id)
  );
end $f$;
create function public.move_neon_organization_department(p_hostname text,p_id uuid,p_parent uuid,p_version bigint) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare moving public.departments; parent public.departments; prop uuid;
begin
  perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_manager();
  prop:=app_private.current_actor_property_id();
  perform app_private.lock_neon_organization_hierarchy(prop);
  perform d.id from public.departments d where d.property_id=prop and (d.id=p_id or d.id=p_parent or p_id=any(d.path_ids)) order by d.id for update;
  select * into strict moving from public.departments where id=p_id and property_id=prop;
  if moving.version<>p_version then raise exception using errcode='40001',message='NEON_ORGANIZATION_VERSION_CONFLICT'; end if;
  if p_parent is null then null;
  else
    if p_parent=p_id then raise exception using errcode='23514',message='NEON_ORGANIZATION_MOVE_SELF_PARENT'; end if;
    select * into strict parent from public.departments where id=p_parent and tenant_id=moving.tenant_id and property_id=moving.property_id and is_active;
    if exists(select 1 from public.department_closure where tenant_id=moving.tenant_id and property_id=moving.property_id and ancestor_department_id=moving.id and descendant_department_id=p_parent) then raise exception using errcode='23514',message='NEON_ORGANIZATION_MOVE_CYCLE'; end if;
  end if;
  update public.departments set parent_id=p_parent,version=version+1 where id=p_id and tenant_id=moving.tenant_id and property_id=moving.property_id;
  with recursive tree as (
    select d.id,0 depth,array[d.id] ids,array[d.name_zh] path_names_zh,array[coalesce(d.name_en,d.name_zh)] path_names_en from public.departments d where d.tenant_id=moving.tenant_id and d.property_id=moving.property_id and d.parent_id is null
    union all
    select d.id,t.depth+1,t.ids||d.id,t.path_names_zh||d.name_zh,t.path_names_en||coalesce(d.name_en,d.name_zh) from public.departments d join tree t on t.id=d.parent_id where d.tenant_id=moving.tenant_id and d.property_id=moving.property_id
  )
  update public.departments d set depth=t.depth,path_ids=t.ids,path_names_zh=t.path_names_zh,path_names_en=t.path_names_en,version=case when d.id=p_id then d.version else d.version+1 end from tree t where d.id=t.id and p_id=any(t.ids);
  delete from public.department_closure where tenant_id=moving.tenant_id and property_id=moving.property_id;
  insert into public.department_closure(tenant_id,property_id,ancestor_department_id,descendant_department_id,distance)
  select d.tenant_id,d.property_id,d.path_ids[s.position],d.id,pg_catalog.cardinality(d.path_ids)-s.position from public.departments d cross join lateral pg_catalog.generate_subscripts(d.path_ids,1) as s(position) where d.tenant_id=moving.tenant_id and d.property_id=moving.property_id;
  perform app_private.append_neon_organization_write_audit('department_move',p_id,pg_catalog.jsonb_build_object('parent',p_parent)); return app_private.neon_organization_department_payload(p_id);
end $f$;

create function public.read_neon_organization_department_aliases(p_hostname text) returns jsonb language plpgsql volatile security definer set search_path='' as $f$ declare r jsonb; begin perform app_private.assert_neon_organization_hostname(p_hostname); if not app_private.neon_organization_actor_can_read_aliases() then raise exception using errcode='42501',message='NEON_ORGANIZATION_ALIAS_DENIED'; end if; select coalesce(pg_catalog.jsonb_agg(app_private.neon_organization_department_alias_payload(id) order by source_value),'[]'::jsonb) into r from public.department_aliases where property_id=app_private.current_actor_property_id() and is_active; perform app_private.append_neon_organization_read_audit('department_aliases',null,pg_catalog.jsonb_build_object('count',pg_catalog.jsonb_array_length(r))); return pg_catalog.jsonb_build_object('rows',r); end $f$;
create function public.resolve_neon_organization_department_alias(p_hostname text,p_alias uuid,p_action text,p_target uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare alias_row public.department_aliases; rt public.department_resolution_type;
begin
  perform app_private.assert_neon_organization_hostname(p_hostname); if not app_private.neon_organization_actor_can_resolve_aliases() then raise exception using errcode='42501',message='NEON_ORGANIZATION_ALIAS_DENIED'; end if;
  select * into strict alias_row from public.department_aliases where id=p_alias and property_id=app_private.current_actor_property_id() and is_active for update;
  rt:=case p_action when 'department' then 'mapped'::public.department_resolution_type when 'ignore' then 'ignored'::public.department_resolution_type when 'defer' then 'deferred'::public.department_resolution_type else null end;
  if rt is null or (p_action='department')<>(p_target is not null) then raise exception using errcode='22023',message='NEON_ORGANIZATION_ALIAS_TARGET_INVALID'; end if;
  if p_action='department' and not exists(select 1 from public.departments d where d.id=p_target and d.tenant_id=alias_row.tenant_id and d.property_id=alias_row.property_id and d.is_active for key share) then raise exception using errcode='22023',message='NEON_ORGANIZATION_ALIAS_TARGET_INVALID'; end if;
  update public.department_aliases set target_department_id=p_target,operational_unit_id=null,resolution_type=rt,resolved_by=app_private.current_neon_organization_actor_user_id(),resolved_at=pg_catalog.transaction_timestamp(),version=version+1 where id=p_alias and tenant_id=alias_row.tenant_id and property_id=alias_row.property_id;
  insert into app_private.organization_alias_resolution_audit_events(request_id,auth_user_id,actor_user_id,tenant_id,property_id,operation,target_id,details) values(app_private.current_actor_request_id(),app_private.current_actor_auth_user_id(),app_private.current_neon_organization_actor_user_id(),alias_row.tenant_id,alias_row.property_id,p_action,p_alias,pg_catalog.jsonb_build_object('target',p_target)); return app_private.neon_organization_department_alias_payload(p_alias);
end $f$;
create function public.create_neon_organization_department_from_alias(p_hostname text,p_alias uuid,p_resolution text,p_parent uuid,p_type text,p_code text,p_zh text,p_en text,p_sort integer) returns jsonb language plpgsql volatile security definer set search_path='' as $f$ declare a public.department_aliases; d jsonb; i uuid; begin perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_manager(); select * into strict a from public.department_aliases where id=p_alias and property_id=app_private.current_actor_property_id(); if p_resolution not in ('created_top_level','created_child') or (p_resolution='created_top_level')<>(p_parent is null) then raise exception using errcode='22023',message='NEON_ORGANIZATION_ALIAS_TARGET_INVALID'; end if; d:=public.create_neon_organization_department(p_hostname,a.tenant_id,a.property_id,p_parent,p_type,p_code,p_zh,p_en,p_sort); i:=(d->>'id')::uuid; update public.department_aliases set target_department_id=i,operational_unit_id=null,resolution_type=p_resolution::public.department_resolution_type,resolved_by=app_private.current_neon_organization_actor_user_id(),resolved_at=pg_catalog.transaction_timestamp(),version=version+1 where id=p_alias; perform app_private.append_neon_organization_alias_activation_audit('create_department',p_alias,i,p_resolution::public.department_resolution_type,i,null,'{}'::jsonb); return app_private.neon_organization_department_alias_payload(p_alias); end $f$;
create function public.merge_neon_organization_department_alias(p_hostname text,p_alias uuid,p_target uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare alias_row public.department_aliases;
begin
  perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_manager();
  select * into strict alias_row from public.department_aliases where id=p_alias and property_id=app_private.current_actor_property_id() and is_active for update;
  if not exists(select 1 from public.departments d where d.id=p_target and d.tenant_id=alias_row.tenant_id and d.property_id=alias_row.property_id and d.is_active for key share) then raise exception using errcode='22023',message='NEON_ORGANIZATION_ALIAS_TARGET_INVALID'; end if;
  update public.department_aliases set target_department_id=p_target,operational_unit_id=null,resolution_type='merged',resolved_by=app_private.current_neon_organization_actor_user_id(),resolved_at=pg_catalog.transaction_timestamp(),version=version+1 where id=p_alias and tenant_id=alias_row.tenant_id and property_id=alias_row.property_id;
  perform app_private.append_neon_organization_alias_activation_audit('merge',p_alias,p_target,'merged',p_target,null,'{}'::jsonb); return app_private.neon_organization_department_alias_payload(p_alias);
end $f$;
create function public.resolve_neon_organization_department_alias_to_operational_unit(p_hostname text,p_alias uuid,p_unit uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare alias_row public.department_aliases; unit_row public.operational_units;
begin
  perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_manager();
  select * into strict alias_row from public.department_aliases where id=p_alias and property_id=app_private.current_actor_property_id() and is_active for update;
  select * into strict unit_row from public.operational_units where id=p_unit and tenant_id=alias_row.tenant_id and property_id=alias_row.property_id and is_active for key share;
  update public.department_aliases set target_department_id=null,operational_unit_id=p_unit,resolution_type='mapped',resolved_by=app_private.current_neon_organization_actor_user_id(),resolved_at=pg_catalog.transaction_timestamp(),version=version+1 where id=p_alias and tenant_id=alias_row.tenant_id and property_id=alias_row.property_id;
  perform app_private.append_neon_organization_alias_activation_audit('operational_unit',p_alias,p_unit,'mapped',unit_row.department_id,p_unit,'{}'::jsonb); return app_private.neon_organization_department_alias_payload(p_alias);
end $f$;

create function public.read_neon_organization_operational_units(p_hostname text) returns jsonb language plpgsql volatile security definer set search_path='' as $f$ declare r jsonb; begin perform app_private.assert_neon_organization_hostname(p_hostname); perform app_private.assert_neon_organization_reader(); select coalesce(pg_catalog.jsonb_agg(app_private.neon_organization_operational_unit_payload(id) order by path_ids,sort_order,name_zh),'[]'::jsonb) into r from public.operational_units where property_id=app_private.current_actor_property_id() and app_private.neon_organization_actor_can_read_department(department_id); perform app_private.append_neon_organization_read_audit('operational_units',null,pg_catalog.jsonb_build_object('count',pg_catalog.jsonb_array_length(r))); return pg_catalog.jsonb_build_object('rows',r); end $f$;
create function public.create_neon_organization_operational_unit(p_hostname text,p_tenant uuid,p_property uuid,p_department uuid,p_parent uuid,p_type text,p_code text,p_zh text,p_en text,p_sort integer,p_active boolean) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare i uuid:=pg_catalog.gen_random_uuid(); parent public.operational_units;
begin
  perform app_private.assert_neon_organization_hostname(p_hostname);
  if not app_private.neon_organization_actor_can_mutate_operational_units() or p_property<>app_private.current_actor_property_id() or nullif(pg_catalog.btrim(coalesce(p_zh,'')),'') is null then raise exception using errcode='42501',message='NEON_ORGANIZATION_UNIT_DENIED'; end if;
  perform app_private.lock_neon_organization_hierarchy(p_property);
  perform d.id from public.departments d where d.id=p_department and d.tenant_id=p_tenant and d.property_id=p_property and d.is_active order by d.id for key share;
  if not found then raise exception using errcode='22023',message='NEON_ORGANIZATION_OPERATIONAL_UNIT_DEPARTMENT_INVALID'; end if;
  if p_parent is not null then
    perform u.id from public.operational_units u where u.id=p_parent and u.tenant_id=p_tenant and u.property_id=p_property and u.department_id=p_department and u.is_active order by u.id for key share;
    if not found then raise exception using errcode='22023',message='NEON_ORGANIZATION_OPERATIONAL_UNIT_PARENT_INVALID'; end if;
    select * into parent from public.operational_units u where u.id=p_parent and u.tenant_id=p_tenant and u.property_id=p_property;
  end if;
  insert into public.operational_units(id,tenant_id,property_id,department_id,parent_operational_unit_id,unit_type,code,name_zh,name_en,sort_order,is_active) values(i,p_tenant,p_property,p_department,p_parent,p_type::public.operational_unit_type,nullif(pg_catalog.lower(pg_catalog.btrim(p_code)),''),pg_catalog.btrim(p_zh),nullif(pg_catalog.btrim(p_en),''),coalesce(p_sort,0),coalesce(p_active,true));
  insert into app_private.organization_operational_unit_audit_events(request_id,auth_user_id,actor_user_id,tenant_id,property_id,operation,target_id,details) values(app_private.current_actor_request_id(),app_private.current_actor_auth_user_id(),app_private.current_neon_organization_actor_user_id(),p_tenant,p_property,'create',i,'{}'::jsonb); return app_private.neon_organization_operational_unit_payload(i);
end $f$;
create function public.update_neon_organization_operational_unit(p_hostname text,p_id uuid,p_version bigint,p_department uuid,p_parent uuid,p_type text,p_code text,p_zh text,p_en text,p_sort integer,p_active boolean) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare current_unit public.operational_units; parent public.operational_units; has_children boolean; prop uuid;
begin
  perform app_private.assert_neon_organization_hostname(p_hostname);
  if not app_private.neon_organization_actor_can_mutate_operational_units() or nullif(pg_catalog.btrim(coalesce(p_zh,'')),'') is null then raise exception using errcode='42501',message='NEON_ORGANIZATION_UNIT_DENIED'; end if;
  prop:=app_private.current_actor_property_id();
  perform app_private.lock_neon_organization_hierarchy(prop);
  select * into strict current_unit from public.operational_units where id=p_id and property_id=prop;
  perform d.id from public.departments d where d.id=p_department and d.tenant_id=current_unit.tenant_id and d.property_id=current_unit.property_id and d.is_active order by d.id for key share;
  if not found then raise exception using errcode='22023',message='NEON_ORGANIZATION_OPERATIONAL_UNIT_DEPARTMENT_INVALID'; end if;
  perform u.id from public.operational_units u where u.tenant_id=current_unit.tenant_id and u.property_id=current_unit.property_id and (u.id=p_id or u.id=p_parent or p_id=any(u.path_ids)) order by u.id for update;
  select * into strict current_unit from public.operational_units where id=p_id and property_id=prop;
  if current_unit.version<>p_version then raise exception using errcode='40001',message='NEON_ORGANIZATION_VERSION_CONFLICT'; end if;
  select exists(select 1 from public.operational_units u where u.tenant_id=current_unit.tenant_id and u.property_id=current_unit.property_id and u.parent_operational_unit_id=p_id) into has_children;
  if current_unit.department_id<>p_department and has_children then raise exception using errcode='22023',message='NEON_ORGANIZATION_OPERATIONAL_UNIT_DEPARTMENT_MOVE_BLOCKED'; end if;
  if p_parent=p_id or (p_parent is not null and exists(with recursive descendants(id) as (select u.id from public.operational_units u where u.tenant_id=current_unit.tenant_id and u.property_id=current_unit.property_id and u.parent_operational_unit_id=p_id union all select u.id from public.operational_units u join descendants d on u.parent_operational_unit_id=d.id where u.tenant_id=current_unit.tenant_id and u.property_id=current_unit.property_id) select 1 from descendants where id=p_parent)) then raise exception using errcode='22023',message='NEON_ORGANIZATION_OPERATIONAL_UNIT_CYCLE'; end if;
  if p_parent is not null then select * into strict parent from public.operational_units u where u.id=p_parent and u.tenant_id=current_unit.tenant_id and u.property_id=current_unit.property_id and u.department_id=p_department and u.is_active; end if;
  update public.operational_units set department_id=p_department,parent_operational_unit_id=p_parent,unit_type=p_type::public.operational_unit_type,code=nullif(pg_catalog.lower(pg_catalog.btrim(p_code)),''),name_zh=pg_catalog.btrim(p_zh),name_en=nullif(pg_catalog.btrim(p_en),''),sort_order=coalesce(p_sort,0),is_active=coalesce(p_active,true),version=version+1 where id=p_id and tenant_id=current_unit.tenant_id and property_id=current_unit.property_id;
  with recursive subtree as (
    select u.id,u.depth,u.path_ids from public.operational_units u where u.id=p_id and u.tenant_id=current_unit.tenant_id and u.property_id=current_unit.property_id
    union all
    select u.id,s.depth+1,s.path_ids||u.id from public.operational_units u join subtree s on u.parent_operational_unit_id=s.id where u.tenant_id=current_unit.tenant_id and u.property_id=current_unit.property_id
  )
  update public.operational_units u set depth=s.depth,path_ids=s.path_ids,version=case when u.id=p_id then u.version else u.version+1 end from subtree s where u.id=s.id;
  insert into app_private.organization_operational_unit_audit_events(request_id,auth_user_id,actor_user_id,tenant_id,property_id,operation,target_id,details) values(app_private.current_actor_request_id(),app_private.current_actor_auth_user_id(),app_private.current_neon_organization_actor_user_id(),current_unit.tenant_id,current_unit.property_id,'update',p_id,pg_catalog.jsonb_build_object('previous_parent',current_unit.parent_operational_unit_id,'result_parent',p_parent)); return app_private.neon_organization_operational_unit_payload(p_id);
end $f$;

revoke all on function app_private.reject_organization_read_audit_mutation() from public;
revoke all on function app_private.reject_organization_write_audit_mutation() from public;
revoke all on function app_private.reject_organization_alias_audit_mutation() from public;
revoke all on function app_private.reject_organization_operational_unit_audit_mutation() from public;
revoke all on function app_private.reject_organization_alias_activation_audit_mutation() from public;
revoke all on function app_private.current_neon_organization_actor_user_id() from public;
revoke all on function app_private.neon_organization_actor_is_active() from public;
revoke all on function app_private.neon_organization_actor_has_role(text) from public;
revoke all on function app_private.neon_organization_actor_has_department_scope(uuid) from public;
revoke all on function app_private.neon_organization_hostname_matches(text) from public;
revoke all on function app_private.neon_organization_actor_can_read_department(uuid) from public;
revoke all on function app_private.neon_organization_actor_can_read_aliases() from public;
revoke all on function app_private.neon_organization_actor_can_resolve_aliases() from public;
revoke all on function app_private.neon_organization_actor_can_read_operational_unit(uuid) from public;
revoke all on function app_private.neon_organization_actor_can_mutate_operational_units() from public;
revoke all on function app_private.assert_neon_organization_hostname(text) from public;
revoke all on function app_private.assert_neon_organization_reader() from public;
revoke all on function app_private.assert_neon_organization_manager() from public;
revoke all on function app_private.lock_neon_organization_hierarchy(uuid) from public;
revoke all on function app_private.prepare_department_insert() from public;
revoke all on function app_private.insert_department_closure() from public;
revoke all on function app_private.prepare_operational_unit_insert() from public;
revoke all on function app_private.neon_organization_department_payload(uuid) from public;
revoke all on function app_private.neon_organization_department_alias_payload(uuid) from public;
revoke all on function app_private.neon_organization_operational_unit_payload(uuid) from public;
revoke all on function app_private.append_neon_organization_read_audit(text,uuid,jsonb) from public;
revoke all on function app_private.append_neon_organization_write_audit(text,uuid,jsonb) from public;
revoke all on function app_private.append_neon_organization_alias_activation_audit(text,uuid,uuid,public.department_resolution_type,uuid,uuid,jsonb) from public;

revoke all on function public.resolve_neon_organization_property(text) from public;
revoke all on function public.read_neon_organization_department_tree(text) from public;
revoke all on function public.create_neon_organization_department(text,uuid,uuid,uuid,text,text,text,text,integer) from public;
revoke all on function public.update_neon_organization_department(text,uuid,bigint,text,text,integer,boolean) from public;
revoke all on function public.preview_neon_organization_department_move(text,uuid,uuid) from public;
revoke all on function public.move_neon_organization_department(text,uuid,uuid,bigint) from public;
revoke all on function public.read_neon_organization_department_aliases(text) from public;
revoke all on function public.resolve_neon_organization_department_alias(text,uuid,text,uuid) from public;
revoke all on function public.create_neon_organization_department_from_alias(text,uuid,text,uuid,text,text,text,text,integer) from public;
revoke all on function public.merge_neon_organization_department_alias(text,uuid,uuid) from public;
revoke all on function public.resolve_neon_organization_department_alias_to_operational_unit(text,uuid,uuid) from public;
revoke all on function public.read_neon_organization_operational_units(text) from public;
revoke all on function public.create_neon_organization_operational_unit(text,uuid,uuid,uuid,uuid,text,text,text,text,integer,boolean) from public;
revoke all on function public.update_neon_organization_operational_unit(text,uuid,bigint,uuid,uuid,text,text,text,text,integer,boolean) from public;

grant execute on function public.resolve_neon_organization_property(text) to hotel_ld_application;
grant execute on function public.read_neon_organization_department_tree(text) to hotel_ld_application;
grant execute on function public.create_neon_organization_department(text,uuid,uuid,uuid,text,text,text,text,integer) to hotel_ld_application;
grant execute on function public.update_neon_organization_department(text,uuid,bigint,text,text,integer,boolean) to hotel_ld_application;
grant execute on function public.preview_neon_organization_department_move(text,uuid,uuid) to hotel_ld_application;
grant execute on function public.move_neon_organization_department(text,uuid,uuid,bigint) to hotel_ld_application;
grant execute on function public.read_neon_organization_department_aliases(text) to hotel_ld_application;
grant execute on function public.resolve_neon_organization_department_alias(text,uuid,text,uuid) to hotel_ld_application;
grant execute on function public.create_neon_organization_department_from_alias(text,uuid,text,uuid,text,text,text,text,integer) to hotel_ld_application;
grant execute on function public.merge_neon_organization_department_alias(text,uuid,uuid) to hotel_ld_application;
grant execute on function public.resolve_neon_organization_department_alias_to_operational_unit(text,uuid,uuid) to hotel_ld_application;
grant execute on function public.read_neon_organization_operational_units(text) to hotel_ld_application;
grant execute on function public.create_neon_organization_operational_unit(text,uuid,uuid,uuid,uuid,text,text,text,text,integer,boolean) to hotel_ld_application;
grant execute on function public.update_neon_organization_operational_unit(text,uuid,bigint,uuid,uuid,text,text,text,text,integer,boolean) to hotel_ld_application;

commit;
