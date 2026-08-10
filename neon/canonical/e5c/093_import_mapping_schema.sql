begin;
set local role hotel_ld_migration_owner;
set local check_function_bodies = off;

create type public.import_e5c_mapping_status as enum ('confirmed', 'excluded');
create type public.import_e5c_source_label_action as enum (
  'department', 'operational_unit', 'position', 'family', 'external', 'ignore', 'defer'
);
create type public.import_e5c_issue_status as enum (
  'accepted', 'corrected', 'excluded', 'ignored', 'deferred'
);

create table public.import_decision_versions (
  batch_id uuid primary key,
  tenant_id uuid not null,
  property_id uuid not null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  updated_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint import_decision_versions_batch_scope_fkey
    foreign key (batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete restrict
);

create table public.import_field_mapping_decisions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  batch_id uuid not null,
  mapping_id uuid not null,
  mapping_status public.import_e5c_mapping_status not null,
  target_field text,
  transformation_rule jsonb not null default '{}'::jsonb check (
    pg_catalog.jsonb_typeof(transformation_rule) = 'object'
    and pg_catalog.pg_column_size(transformation_rule) <= 4096
  ),
  decided_by uuid not null,
  decided_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint import_field_mapping_decisions_batch_scope_fkey
    foreign key (batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete restrict,
  constraint import_field_mapping_decisions_mapping_fkey
    foreign key (mapping_id) references public.import_field_mappings(id) on delete restrict,
  constraint import_field_mapping_decisions_status_shape_check check (
    (mapping_status = 'confirmed' and target_field is not null)
    or (mapping_status = 'excluded' and target_field is null)
  ),
  constraint import_field_mapping_decisions_key unique (batch_id, mapping_id)
);

create table public.import_source_label_decisions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  batch_id uuid not null,
  source_label_id uuid not null,
  action public.import_e5c_source_label_action not null,
  target_department_id uuid,
  target_operational_unit_id uuid,
  target_position_id uuid,
  target_position_family_id uuid,
  external_role_code text,
  external_role_name text,
  decided_by uuid not null,
  decided_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint import_source_label_decisions_batch_scope_fkey
    foreign key (batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete restrict,
  constraint import_source_label_decisions_source_fkey
    foreign key (source_label_id) references public.import_source_label_resolutions(id) on delete restrict,
  constraint import_source_label_decisions_department_fkey
    foreign key (tenant_id, property_id, target_department_id)
    references public.departments(tenant_id, property_id, id) on delete restrict,
  constraint import_source_label_decisions_operational_unit_fkey
    foreign key (tenant_id, property_id, target_operational_unit_id)
    references public.operational_units(tenant_id, property_id, id) on delete restrict,
  constraint import_source_label_decisions_position_fkey
    foreign key (tenant_id, property_id, target_position_id)
    references public.positions(tenant_id, property_id, id) on delete restrict,
  constraint import_source_label_decisions_family_fkey
    foreign key (tenant_id, property_id, target_position_family_id)
    references public.position_families(tenant_id, property_id, id) on delete restrict,
  constraint import_source_label_decisions_action_shape_check check (
    (action = 'department' and target_department_id is not null and target_operational_unit_id is null and target_position_id is null and target_position_family_id is null and external_role_code is null and external_role_name is null)
    or (action = 'operational_unit' and target_department_id is null and target_operational_unit_id is not null and target_position_id is null and target_position_family_id is null and external_role_code is null and external_role_name is null)
    or (action = 'position' and target_department_id is null and target_operational_unit_id is null and target_position_id is not null and target_position_family_id is null and external_role_code is null and external_role_name is null)
    or (action = 'family' and target_department_id is null and target_operational_unit_id is null and target_position_id is null and target_position_family_id is not null and external_role_code is null and external_role_name is null)
    or (action = 'external' and target_department_id is null and target_operational_unit_id is null and target_position_id is null and target_position_family_id is null and nullif(pg_catalog.btrim(external_role_code), '') is not null and nullif(pg_catalog.btrim(external_role_name), '') is not null)
    or (action in ('ignore', 'defer') and target_department_id is null and target_operational_unit_id is null and target_position_id is null and target_position_family_id is null and external_role_code is null and external_role_name is null)
  ),
  constraint import_source_label_decisions_key unique (batch_id, source_label_id)
);

create table public.import_issue_resolutions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  batch_id uuid not null,
  issue_id uuid not null,
  status public.import_e5c_issue_status not null,
  correction jsonb not null default '{}'::jsonb check (
    pg_catalog.jsonb_typeof(correction) = 'object'
    and pg_catalog.pg_column_size(correction) <= 8192
  ),
  resolution_note text check (resolution_note is null or pg_catalog.char_length(resolution_note) <= 500),
  decided_by uuid not null,
  decided_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint import_issue_resolutions_batch_scope_fkey
    foreign key (batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete restrict,
  constraint import_issue_resolutions_issue_fkey
    foreign key (issue_id) references public.import_issues(id) on delete restrict,
  constraint import_issue_resolutions_key unique (batch_id, issue_id)
);

create table app_private.import_decision_audit_events (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  auth_user_id uuid not null,
  actor_user_id uuid not null,
  tenant_id uuid not null,
  property_id uuid not null,
  batch_id uuid not null,
  decision_kind text not null check (decision_kind in ('field_mapping', 'source_label', 'issue')),
  decision_id uuid not null,
  operation text not null check (operation in ('create', 'replace')),
  previous_decision jsonb not null default '{}'::jsonb,
  next_decision jsonb not null default '{}'::jsonb,
  decision_version bigint not null check (decision_version > 0),
  occurred_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint import_decision_audit_batch_scope_fkey
    foreign key (batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete restrict
);

create function app_private.reject_import_decision_audit_mutation()
returns trigger language plpgsql volatile security invoker set search_path = ''
as $function$
begin
  raise exception using errcode = '42501', message = 'IMPORT_DECISION_AUDIT_APPEND_ONLY';
end
$function$;

create trigger import_decision_audit_append_only
before update or delete on app_private.import_decision_audit_events
for each row execute function app_private.reject_import_decision_audit_mutation();

create index import_decision_versions_property_idx
  on public.import_decision_versions (property_id, updated_at desc, batch_id);
create index import_field_mapping_decisions_batch_idx
  on public.import_field_mapping_decisions (batch_id, mapping_id);
create index import_source_label_decisions_batch_idx
  on public.import_source_label_decisions (batch_id, source_label_id);
create index import_issue_resolutions_batch_idx
  on public.import_issue_resolutions (batch_id, issue_id);
create index import_decision_audit_property_history_idx
  on app_private.import_decision_audit_events (property_id, occurred_at desc, id);

alter table public.import_decision_versions owner to hotel_ld_migration_owner;
alter table public.import_field_mapping_decisions owner to hotel_ld_migration_owner;
alter table public.import_source_label_decisions owner to hotel_ld_migration_owner;
alter table public.import_issue_resolutions owner to hotel_ld_migration_owner;
alter table app_private.import_decision_audit_events owner to hotel_ld_migration_owner;
alter function app_private.reject_import_decision_audit_mutation() owner to hotel_ld_migration_owner;

alter table public.import_decision_versions enable row level security;
alter table public.import_decision_versions force row level security;
alter table public.import_field_mapping_decisions enable row level security;
alter table public.import_field_mapping_decisions force row level security;
alter table public.import_source_label_decisions enable row level security;
alter table public.import_source_label_decisions force row level security;
alter table public.import_issue_resolutions enable row level security;
alter table public.import_issue_resolutions force row level security;
alter table app_private.import_decision_audit_events enable row level security;
alter table app_private.import_decision_audit_events force row level security;

create policy canonical_import_decision_versions_scope on public.import_decision_versions for all to hotel_ld_migration_owner
  using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id())
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_field_mapping_decisions_scope on public.import_field_mapping_decisions for all to hotel_ld_migration_owner
  using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id())
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_source_label_decisions_scope on public.import_source_label_decisions for all to hotel_ld_migration_owner
  using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id())
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_issue_resolutions_scope on public.import_issue_resolutions for all to hotel_ld_migration_owner
  using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id())
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_decision_audit_insert on app_private.import_decision_audit_events for insert to hotel_ld_migration_owner
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());

revoke all on table public.import_decision_versions from public, hotel_ld_application;
revoke all on table public.import_field_mapping_decisions from public, hotel_ld_application;
revoke all on table public.import_source_label_decisions from public, hotel_ld_application;
revoke all on table public.import_issue_resolutions from public, hotel_ld_application;
revoke all on table app_private.import_decision_audit_events from public, hotel_ld_application;
revoke all on sequence app_private.import_decision_audit_events_id_seq from public, hotel_ld_application;
revoke all on function app_private.reject_import_decision_audit_mutation() from public;

commit;
