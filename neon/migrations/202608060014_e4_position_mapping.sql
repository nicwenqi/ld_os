/* E4C Position mapping parity. Child Neon branch only; Import is not migrated. */
begin;

do $e4c_preflight$
begin
  if current_database() <> 'neondb' or current_user <> 'neondb_owner' or session_user <> 'neondb_owner' then
    raise exception using errcode = '42501', message = 'E4C_POSITION_MAPPING_BOOTSTRAP_IDENTITY_MISMATCH';
  end if;
  if not pg_catalog.pg_has_role(current_user, 'hotel_ld_migration_owner', 'SET') then
    raise exception using errcode = '42501', message = 'E4C_POSITION_MAPPING_MIGRATION_OWNER_REQUIRED';
  end if;
  if pg_catalog.to_regclass('app_private.position_mapping_audit_events') is not null
     or pg_catalog.to_regprocedure('public.read_neon_position_source_labels(text)') is not null
     or pg_catalog.to_regprocedure('public.preview_neon_position_source_impact(text,uuid)') is not null
     or pg_catalog.to_regprocedure('public.resolve_neon_position_alias(text,uuid,text,uuid,text,text)') is not null then
    raise exception using errcode = '42710', message = 'E4C_POSITION_MAPPING_OBJECT_EXISTS';
  end if;
  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'hotel_ld_application' and (rolbypassrls or rolsuper or not rolcanlogin)
  ) then
    raise exception using errcode = '42501', message = 'E4C_POSITION_MAPPING_APPLICATION_ROLE_DRIFT';
  end if;
  if (
    select count(*) from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relkind = 'r'
      and relation.relname = any (array['position_aliases', 'positions', 'position_families'])
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) <> 3 then
    raise exception using errcode = '42501', message = 'E4C_POSITION_MAPPING_RLS_BASELINE_DRIFT';
  end if;
end
$e4c_preflight$;

grant select (id, tenant_id, property_id, source_system, source_sheet, source_value,
  normalized_source_value, source_row_count, target_position_id, target_position_family_id,
  external_role_code, external_role_name, resolution_status, approved_by, approved_at,
  is_active, created_at)
on public.position_aliases to hotel_ld_migration_owner;
grant update (target_position_id, target_position_family_id, external_role_code,
  external_role_name, resolution_status, approved_by, approved_at, is_active)
on public.position_aliases to hotel_ld_migration_owner;
grant select (id, tenant_id, property_id, position_family_id, is_active)
on public.positions to hotel_ld_migration_owner;
grant select (id, tenant_id, property_id, is_active)
on public.position_families to hotel_ld_migration_owner;

create policy e4c_position_aliases_read on public.position_aliases for select to hotel_ld_migration_owner
using (session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_has_role('property_ld_manager'));
create policy e4c_position_aliases_update on public.position_aliases for update to hotel_ld_migration_owner
using (session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_has_role('property_ld_manager'))
with check (session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_has_role('property_ld_manager'));
create policy e4c_positions_target_read on public.positions for select to hotel_ld_migration_owner
using (session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_has_role('property_ld_manager'));
create policy e4c_position_families_target_read on public.position_families for select to hotel_ld_migration_owner
using (session_user = 'hotel_ld_application'
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_has_role('property_ld_manager'));

set local role hotel_ld_migration_owner;

create table app_private.position_mapping_audit_events (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  auth_user_id uuid not null,
  actor_user_id uuid not null,
  tenant_id uuid not null,
  property_id uuid not null,
  alias_id uuid not null,
  action text not null check (action in ('position', 'family', 'external', 'ignore', 'defer')),
  previous_resolution_status public.position_resolution_status not null,
  result_resolution_status public.position_resolution_status not null,
  previous_position_id uuid,
  result_position_id uuid,
  previous_family_id uuid,
  result_family_id uuid,
  previous_external_role_code text,
  result_external_role_code text,
  occurred_at timestamptz not null default pg_catalog.transaction_timestamp()
);
alter table app_private.position_mapping_audit_events enable row level security;
alter table app_private.position_mapping_audit_events force row level security;

create policy e4c_position_mapping_audit_insert
on app_private.position_mapping_audit_events for insert to hotel_ld_migration_owner
with check (session_user = 'hotel_ld_application'
  and auth_user_id = app_private.current_actor_auth_user_id()
  and actor_user_id = app_private.current_neon_organization_actor_user_id()
  and property_id = app_private.current_actor_property_id()
  and app_private.neon_organization_actor_has_role('property_ld_manager'));

create function app_private.reject_position_mapping_audit_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  raise exception using errcode = '42501', message = 'E4C_POSITION_MAPPING_AUDIT_APPEND_ONLY';
end
$function$;
create trigger e4c_position_mapping_audit_append_only
before update or delete on app_private.position_mapping_audit_events
for each row execute function app_private.reject_position_mapping_audit_mutation();

create function app_private.neon_position_alias_payload(p_alias_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $function$
  select pg_catalog.jsonb_build_object(
    'id', alias_row.id,
    'property_id', alias_row.property_id,
    'source_system', alias_row.source_system,
    'source_sheet', coalesce(alias_row.source_sheet, '历史批准来源'),
    'source_value', alias_row.source_value,
    'normalized_source_value', alias_row.normalized_source_value,
    'source_row_count', alias_row.source_row_count,
    'suggested_position_id', alias_row.target_position_id,
    'suggested_family_id', alias_row.target_position_family_id,
    'confidence', case when alias_row.approved_at is null then 0 else 100 end,
    'suggestion_reason', case when alias_row.approved_at is null then '尚未建立批准规则' else '来自已确认的历史映射' end,
    'target_position_id', alias_row.target_position_id,
    'target_position_family_id', alias_row.target_position_family_id,
    'external_role_code', alias_row.external_role_code,
    'external_role_name', alias_row.external_role_name,
    'resolution_status', alias_row.resolution_status::text
  )
  from public.position_aliases alias_row
  where alias_row.id = p_alias_id
    and alias_row.property_id = app_private.current_actor_property_id();
$function$;

create function public.read_neon_position_source_labels(p_hostname text)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_payload jsonb;
begin
  perform app_private.assert_neon_organization_runtime_session();
  perform app_private.assert_actor_context();
  perform app_private.assert_neon_organization_hostname(p_hostname);
  perform app_private.assert_neon_organization_manager();
  select pg_catalog.jsonb_build_object('rows', coalesce(pg_catalog.jsonb_agg(
    app_private.neon_position_alias_payload(alias_row.id) order by alias_row.created_at, alias_row.id
  ), '[]'::jsonb)) into v_payload
  from public.position_aliases alias_row
  where alias_row.property_id = app_private.current_actor_property_id();
  return v_payload;
end
$function$;

create function public.preview_neon_position_source_impact(p_hostname text, p_alias_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_alias public.position_aliases%rowtype;
begin
  perform app_private.assert_neon_organization_runtime_session();
  perform app_private.assert_actor_context();
  perform app_private.assert_neon_organization_hostname(p_hostname);
  perform app_private.assert_neon_organization_manager();
  select * into v_alias from public.position_aliases
  where id = p_alias_id and property_id = app_private.current_actor_property_id()
  for key share;
  if not found then raise exception using errcode = 'P2000', message = 'NEON_POSITION_ALIAS_NOT_FOUND'; end if;
  return pg_catalog.jsonb_build_object(
    'source_label_id', v_alias.id,
    'source_evidence', pg_catalog.jsonb_build_object(
      'source_system', v_alias.source_system,
      'source_sheet', coalesce(v_alias.source_sheet, '历史批准来源'),
      'source_row_count', v_alias.source_row_count
    ),
    'employee_impact', pg_catalog.jsonb_build_object('state', 'unavailable', 'reason', 'import_source_rows_not_migrated'),
    'department_impact', pg_catalog.jsonb_build_object('state', 'unavailable', 'reason', 'import_source_rows_not_migrated')
  );
end
$function$;

create function public.resolve_neon_position_alias(
  p_hostname text, p_alias_id uuid, p_action text, p_target_id uuid,
  p_external_role_code text, p_external_role_name text
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_alias public.position_aliases%rowtype;
  v_position public.positions%rowtype;
  v_family public.position_families%rowtype;
  v_result_status public.position_resolution_status;
  v_result_position uuid;
  v_result_family uuid;
  v_result_external_code text;
  v_result_external_name text;
  v_previous_status public.position_resolution_status;
  v_previous_position uuid;
  v_previous_family uuid;
  v_previous_external_code text;
begin
  perform app_private.assert_neon_organization_runtime_session();
  perform app_private.assert_actor_context();
  perform app_private.assert_neon_organization_hostname(p_hostname);
  perform app_private.assert_neon_organization_manager();
  select * into v_alias from public.position_aliases
  where id = p_alias_id and property_id = app_private.current_actor_property_id()
  for update;
  if not found then raise exception using errcode = 'P2000', message = 'NEON_POSITION_ALIAS_NOT_FOUND'; end if;
  v_previous_status := v_alias.resolution_status;
  v_previous_position := v_alias.target_position_id;
  v_previous_family := v_alias.target_position_family_id;
  v_previous_external_code := v_alias.external_role_code;
  if p_action = 'position' and p_target_id is not null then
    select * into v_position from public.positions
    where id = p_target_id and tenant_id = v_alias.tenant_id and property_id = v_alias.property_id and is_active
    for key share;
    if not found then raise exception using errcode = 'P2006', message = 'NEON_POSITION_ALIAS_TARGET_INVALID'; end if;
    v_result_status := 'mapped'; v_result_position := v_position.id; v_result_family := v_position.position_family_id;
  elsif p_action = 'family' and p_target_id is not null then
    select * into v_family from public.position_families
    where id = p_target_id and tenant_id = v_alias.tenant_id and property_id = v_alias.property_id and is_active
    for key share;
    if not found then raise exception using errcode = 'P2006', message = 'NEON_POSITION_ALIAS_TARGET_INVALID'; end if;
    v_result_status := 'family_only'; v_result_family := v_family.id;
  elsif p_action = 'external' and p_target_id is null
    and nullif(btrim(p_external_role_code), '') is not null and nullif(btrim(p_external_role_name), '') is not null then
    v_result_status := 'external_only'; v_result_external_code := btrim(p_external_role_code); v_result_external_name := btrim(p_external_role_name);
  elsif p_action = 'ignore' and p_target_id is null and nullif(btrim(p_external_role_code), '') is null and nullif(btrim(p_external_role_name), '') is null then
    v_result_status := 'ignored';
  elsif p_action = 'defer' and p_target_id is null and nullif(btrim(p_external_role_code), '') is null and nullif(btrim(p_external_role_name), '') is null then
    v_result_status := 'deferred';
  else
    raise exception using errcode = 'P2006', message = 'NEON_POSITION_ALIAS_ACTION_INVALID';
  end if;
  update public.position_aliases
  set target_position_id = v_result_position,
      target_position_family_id = v_result_family,
      external_role_code = v_result_external_code,
      external_role_name = v_result_external_name,
      resolution_status = v_result_status,
      approved_by = case when v_result_status = 'deferred' then null else app_private.current_actor_auth_user_id() end,
      approved_at = case when v_result_status = 'deferred' then null else pg_catalog.transaction_timestamp() end,
      is_active = true
  where id = v_alias.id
  returning * into v_alias;
  insert into app_private.position_mapping_audit_events(
    request_id, auth_user_id, actor_user_id, tenant_id, property_id, alias_id, action,
    previous_resolution_status, result_resolution_status, previous_position_id, result_position_id,
    previous_family_id, result_family_id, previous_external_role_code, result_external_role_code
  ) values (
    app_private.current_actor_request_id(), app_private.current_actor_auth_user_id(),
    app_private.current_neon_organization_actor_user_id(), v_alias.tenant_id, v_alias.property_id,
    v_alias.id, p_action, v_previous_status, v_result_status,
    v_previous_position, v_result_position, v_previous_family, v_result_family,
    v_previous_external_code, v_result_external_code
  );
  return app_private.neon_position_alias_payload(v_alias.id);
end
$function$;

revoke all on function
  app_private.reject_position_mapping_audit_mutation(),
  app_private.neon_position_alias_payload(uuid),
  public.read_neon_position_source_labels(text),
  public.preview_neon_position_source_impact(text,uuid),
  public.resolve_neon_position_alias(text,uuid,text,uuid,text,text)
from public, authenticated, neondb_owner, hotel_ld_people_read, hotel_ld_application, hotel_ld_readonly;
grant execute on function
  public.read_neon_position_source_labels(text),
  public.preview_neon_position_source_impact(text,uuid),
  public.resolve_neon_position_alias(text,uuid,text,uuid,text,text)
to hotel_ld_application;
revoke all on table app_private.position_mapping_audit_events
from public, authenticated, neondb_owner, hotel_ld_people_read, hotel_ld_application, hotel_ld_readonly;
reset role;
revoke all on table public.position_aliases, public.positions, public.position_families
from hotel_ld_application, hotel_ld_people_read, hotel_ld_readonly;

do $e4c_postflight$
begin
  if (
    select count(*) from pg_catalog.pg_proc routine join pg_catalog.pg_roles owner_role on owner_role.oid = routine.proowner
    where routine.oid = any (array[
      pg_catalog.to_regprocedure('public.read_neon_position_source_labels(text)'),
      pg_catalog.to_regprocedure('public.preview_neon_position_source_impact(text,uuid)'),
      pg_catalog.to_regprocedure('public.resolve_neon_position_alias(text,uuid,text,uuid,text,text)')
    ]::regprocedure[])
      and owner_role.rolname = 'hotel_ld_migration_owner' and routine.prosecdef
      and routine.proconfig = array['search_path=""']::text[]
      and not pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
      and pg_catalog.has_function_privilege('hotel_ld_application', routine.oid, 'EXECUTE')
  ) <> 3 then raise exception using errcode = '42501', message = 'E4C_POSITION_MAPPING_FUNCTION_ACL_DRIFT'; end if;
  if exists (
    select 1 from pg_catalog.unnest(array[
      'public.position_aliases', 'public.positions', 'public.position_families',
      'app_private.position_mapping_audit_events'
    ]) relation(value)
    where pg_catalog.has_table_privilege('hotel_ld_application', relation.value,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ) then raise exception using errcode = '42501', message = 'E4C_POSITION_MAPPING_RAW_PRIVILEGE_DRIFT'; end if;
end
$e4c_postflight$;
commit;
