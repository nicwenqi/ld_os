/*
 * E4A / 202608060011 — Position read-only parity boundary
 *
 * Child branch only. This migration creates no Position write path, does not
 * alter existing E1/E2/E3 policies, and grants the runtime only entrypoint
 * EXECUTE. Production is explicitly outside this migration's execution scope.
 */

begin;

do $e4_preflight$
begin
  if current_database() <> 'neondb'
     or current_user <> 'neondb_owner'
     or session_user <> 'neondb_owner' then
    raise exception using errcode = '42501',
      message = 'E4_POSITION_BOOTSTRAP_IDENTITY_MISMATCH';
  end if;

  if not pg_catalog.pg_has_role(
    current_user, 'hotel_ld_migration_owner', 'SET'
  ) then
    raise exception using errcode = '42501',
      message = 'E4_POSITION_MIGRATION_OWNER_SET_ROLE_REQUIRED';
  end if;

  if exists (
    select 1 from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_private'
      and relation.relname = 'position_read_audit_events'
  ) or exists (
    select 1 from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace
      on namespace.oid = routine.pronamespace
    where namespace.nspname in ('public', 'app_private')
      and routine.proname in (
        'read_neon_position_families',
        'read_neon_positions',
        'append_neon_position_read_audit',
        'neon_position_actor_can_read_position',
        'reject_position_read_audit_mutation'
      )
  ) then
    raise exception using errcode = '42710',
      message = 'E4_POSITION_OBJECT_ALREADY_EXISTS';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles role_record
    where role_record.rolname = 'hotel_ld_application'
      and role_record.rolcanlogin
      and not role_record.rolsuper
      and not role_record.rolbypassrls
      and not role_record.rolcreatedb
      and not role_record.rolcreaterole
      and not role_record.rolreplication
      and not role_record.rolinherit
  ) then
    raise exception using errcode = '42501',
      message = 'E4_POSITION_RUNTIME_ROLE_DRIFT';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind = 'r'
      and relation.relname = any (array[
        'position_families', 'positions', 'position_department_assignments'
      ])
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) <> 3 then
    raise exception using errcode = '42501',
      message = 'E4_POSITION_RLS_BASELINE_DRIFT';
  end if;
end
$e4_preflight$;

grant select (id, tenant_id, property_id, code, name_zh, name_en,
              description, sort_order, is_active, version)
  on public.position_families to hotel_ld_migration_owner;
grant select (id, tenant_id, property_id, position_family_id, code, name_zh,
              name_en, grade_or_band, is_active, version)
  on public.positions to hotel_ld_migration_owner;
grant select (position_id, department_id, property_id, is_primary)
  on public.position_department_assignments to hotel_ld_migration_owner;

set local role hotel_ld_migration_owner;

create table app_private.position_read_audit_events (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  auth_user_id uuid not null,
  property_id uuid not null,
  operation text not null,
  result_row_count integer not null,
  occurred_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint position_read_audit_operation_check check (
    operation in ('position_families', 'positions')
  ),
  constraint position_read_audit_count_check check (result_row_count >= 0)
);

alter table app_private.position_read_audit_events enable row level security;
alter table app_private.position_read_audit_events force row level security;
create index position_read_audit_request_idx
  on app_private.position_read_audit_events(request_id, occurred_at);

create function app_private.reject_position_read_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using errcode = '42501',
    message = 'POSITION_READ_AUDIT_APPEND_ONLY';
end
$function$;

create trigger position_read_audit_append_only
before update or delete on app_private.position_read_audit_events
for each row execute function app_private.reject_position_read_audit_mutation();

create policy e4_position_read_audit_owner_only
on app_private.position_read_audit_events
for all to hotel_ld_migration_owner
using (session_user = 'hotel_ld_application')
with check (session_user = 'hotel_ld_application');

create function app_private.neon_position_actor_can_read_position(
  p_position_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select p_position_id is not null
    and exists (
      select 1
      from public.positions position
      where position.id = p_position_id
        and position.property_id = app_private.current_actor_property_id()
        and (
          app_private.neon_organization_actor_has_role('property_ld_manager')
          or exists (
            select 1
            from public.position_department_assignments assignment
            where assignment.position_id = position.id
              and assignment.property_id = position.property_id
              and app_private.neon_organization_actor_has_department_scope(
                assignment.department_id
              )
          )
          or (
            app_private.neon_organization_actor_has_role(
              'department_training_admin'
            )
            and not exists (
              select 1
              from public.position_department_assignments assignment
              where assignment.position_id = position.id
                and assignment.property_id = position.property_id
            )
          )
        )
    );
$function$;

create function app_private.append_neon_position_read_audit(
  p_operation text,
  p_result_row_count integer
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  perform app_private.assert_actor_context();
  insert into app_private.position_read_audit_events (
    request_id, auth_user_id, property_id, operation, result_row_count
  ) values (
    app_private.current_actor_request_id(),
    app_private.current_actor_auth_user_id(),
    app_private.current_actor_property_id(),
    p_operation,
    greatest(coalesce(p_result_row_count, 0), 0)
  );
end
$function$;

create function public.read_neon_position_families(p_hostname text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_payload jsonb;
  v_row_count integer;
begin
  perform app_private.assert_neon_organization_runtime_session();
  perform app_private.assert_actor_context();
  perform app_private.assert_neon_organization_hostname(p_hostname);
  perform app_private.assert_neon_organization_reader();

  with authorized as materialized (
    select family.id, family.tenant_id, family.property_id, family.code,
      family.name_zh, family.name_en, family.description, family.sort_order,
      family.is_active, family.version
    from public.position_families family
    where family.property_id = app_private.current_actor_property_id()
      and (
        app_private.neon_organization_actor_has_role('property_ld_manager')
        or exists (
          select 1 from public.positions position
          where position.property_id = family.property_id
            and position.position_family_id = family.id
            and app_private.neon_position_actor_can_read_position(position.id)
        )
      )
  )
  select pg_catalog.jsonb_build_object(
    'rows', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', row.id, 'tenant_id', row.tenant_id, 'property_id', row.property_id,
      'code', row.code, 'name_zh', row.name_zh, 'name_en', row.name_en,
      'description', row.description, 'sort_order', row.sort_order,
      'is_active', row.is_active, 'version', row.version
    ) order by row.sort_order, row.name_zh, row.id), '[]'::jsonb),
    'refreshed_at', pg_catalog.transaction_timestamp()
  ) into v_payload from authorized row;

  v_row_count := pg_catalog.jsonb_array_length(v_payload -> 'rows');
  perform app_private.append_neon_position_read_audit(
    'position_families', v_row_count
  );
  return v_payload;
end
$function$;

create function public.read_neon_positions(p_hostname text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_payload jsonb;
  v_row_count integer;
begin
  perform app_private.assert_neon_organization_runtime_session();
  perform app_private.assert_actor_context();
  perform app_private.assert_neon_organization_hostname(p_hostname);
  perform app_private.assert_neon_organization_reader();

  with authorized as materialized (
    select position.id, position.tenant_id, position.property_id,
      position.position_family_id, position.code, position.name_zh,
      position.name_en, position.grade_or_band, position.is_active,
      position.version,
      coalesce(assignments.department_ids, '[]'::jsonb) as department_ids
    from public.positions position
    left join lateral (
      select pg_catalog.jsonb_agg(assignment.department_id order by
        assignment.is_primary desc, assignment.department_id) as department_ids
      from public.position_department_assignments assignment
      where assignment.position_id = position.id
        and assignment.property_id = position.property_id
        and (
          app_private.neon_organization_actor_has_role('property_ld_manager')
          or app_private.neon_organization_actor_has_department_scope(
            assignment.department_id
          )
        )
    ) assignments on true
    where position.property_id = app_private.current_actor_property_id()
      and app_private.neon_position_actor_can_read_position(position.id)
  )
  select pg_catalog.jsonb_build_object(
    'rows', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', row.id, 'tenant_id', row.tenant_id, 'property_id', row.property_id,
      'position_family_id', row.position_family_id, 'code', row.code,
      'name_zh', row.name_zh, 'name_en', row.name_en,
      'grade_or_band', row.grade_or_band, 'is_active', row.is_active,
      'version', row.version, 'department_ids', row.department_ids
    ) order by row.name_zh, row.id), '[]'::jsonb),
    'refreshed_at', pg_catalog.transaction_timestamp()
  ) into v_payload from authorized row;

  v_row_count := pg_catalog.jsonb_array_length(v_payload -> 'rows');
  perform app_private.append_neon_position_read_audit('positions', v_row_count);
  return v_payload;
end
$function$;

revoke all on table app_private.position_read_audit_events
  from public, authenticated, neondb_owner, hotel_ld_people_read,
       hotel_ld_application, hotel_ld_readonly;
revoke all on function
  app_private.reject_position_read_audit_mutation(),
  app_private.neon_position_actor_can_read_position(uuid),
  app_private.append_neon_position_read_audit(text,integer)
from public, authenticated, neondb_owner, hotel_ld_people_read,
     hotel_ld_application, hotel_ld_readonly;

revoke all on function
  public.read_neon_position_families(text),
  public.read_neon_positions(text)
from public, authenticated, neondb_owner, hotel_ld_people_read,
     hotel_ld_application, hotel_ld_readonly;
grant execute on function public.read_neon_position_families(text),
  public.read_neon_positions(text)
to hotel_ld_application;

comment on table app_private.position_read_audit_events is
  'Append-only Position read evidence without position names or department IDs';
comment on function public.read_neon_position_families(text) is
  'Actor-, property-, and Department-scope constrained Position family read';
comment on function public.read_neon_positions(text) is
  'Actor-visible Position read with per-assignment Department scope projection';

reset role;

revoke all on table public.position_families, public.positions,
  public.position_department_assignments
from hotel_ld_application, hotel_ld_people_read, hotel_ld_readonly;

do $e4_postflight$
begin
  if current_database() <> 'neondb'
     or current_user <> 'neondb_owner'
     or session_user <> 'neondb_owner' then
    raise exception using errcode = '42501',
      message = 'E4_POSITION_POSTFLIGHT_IDENTITY_MISMATCH';
  end if;

  if (
    select count(*) from pg_catalog.pg_proc routine
    join pg_catalog.pg_roles owner_role on owner_role.oid = routine.proowner
    where routine.oid = any (array[
      pg_catalog.to_regprocedure('public.read_neon_position_families(text)'),
      pg_catalog.to_regprocedure('public.read_neon_positions(text)')
    ]::regprocedure[])
      and owner_role.rolname = 'hotel_ld_migration_owner'
      and routine.prosecdef
      and routine.proconfig = array['search_path=""']::text[]
      and not pg_catalog.has_function_privilege('public', routine.oid, 'EXECUTE')
      and pg_catalog.has_function_privilege('hotel_ld_application', routine.oid, 'EXECUTE')
  ) <> 2 then
    raise exception using errcode = '42501',
      message = 'E4_POSITION_ENTRYPOINT_ACL_DRIFT';
  end if;

  if exists (
    select 1 from pg_catalog.unnest(array[
      'public.position_families', 'public.positions',
      'public.position_department_assignments',
      'app_private.position_read_audit_events'
    ]) relation(value)
    where pg_catalog.has_table_privilege(
      'hotel_ld_application', relation.value,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  ) or not (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation
    where relation.oid = 'app_private.position_read_audit_events'::regclass
  ) then
    raise exception using errcode = '42501',
      message = 'E4_POSITION_RAW_ACL_OR_AUDIT_RLS_DRIFT';
  end if;
end
$e4_postflight$;

commit;
