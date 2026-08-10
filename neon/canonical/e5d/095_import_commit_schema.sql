begin;
set local role hotel_ld_migration_owner;
set local check_function_bodies = off;

create type public.import_commit_status as enum ('committed', 'reverted');
create type public.import_commit_item_action as enum ('insert', 'update', 'unchanged', 'excluded');

create table public.import_commits (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  batch_id uuid not null,
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  batch_version bigint not null check (batch_version > 0),
  decision_version bigint not null check (decision_version > 0),
  status public.import_commit_status not null default 'committed',
  version bigint not null default 1 check (version > 0),
  committed_by uuid not null,
  committed_at timestamptz not null default pg_catalog.transaction_timestamp(),
  reverted_by uuid,
  reverted_at timestamptz,
  inserted_count integer not null default 0 check (inserted_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  excluded_count integer not null default 0 check (excluded_count >= 0),
  constraint import_commits_batch_scope_fkey
    foreign key (batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete restrict,
  constraint import_commits_batch_key unique (batch_id),
  constraint import_commits_scope_key unique (id, tenant_id, property_id),
  constraint import_commits_revert_shape_check check (
    (status = 'committed' and reverted_by is null and reverted_at is null)
    or (status = 'reverted' and reverted_by is not null and reverted_at is not null)
  )
);

create table public.import_commit_items (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  batch_id uuid not null,
  commit_id uuid not null,
  source_row_id uuid,
  row_fingerprint text not null check (row_fingerprint ~ '^[0-9a-f]{64}$'),
  employee_id uuid,
  action public.import_commit_item_action not null,
  employee_version_before bigint check (employee_version_before is null or employee_version_before > 0),
  employee_version_after bigint check (employee_version_after is null or employee_version_after > 0),
  before_employee jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(before_employee) = 'object'),
  after_employee jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(after_employee) = 'object'),
  before_identifiers jsonb not null default '[]'::jsonb check (pg_catalog.jsonb_typeof(before_identifiers) = 'array'),
  after_identifiers jsonb not null default '[]'::jsonb check (pg_catalog.jsonb_typeof(after_identifiers) = 'array'),
  created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint import_commit_items_commit_scope_fkey
    foreign key (commit_id, tenant_id, property_id)
    references public.import_commits(id, tenant_id, property_id) on delete restrict,
  constraint import_commit_items_batch_scope_fkey
    foreign key (batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete restrict,
  constraint import_commit_items_row_scope_fkey
    foreign key (source_row_id, batch_id, tenant_id, property_id)
    references public.import_source_rows(id, batch_id, tenant_id, property_id) on delete restrict,
  constraint import_commit_items_employee_scope_fkey
    foreign key (employee_id)
    references public.employees(id) on delete restrict,
  constraint import_commit_items_action_shape_check check (
    (action = 'excluded' and employee_id is null and employee_version_before is null and employee_version_after is null)
    or (action in ('insert', 'update', 'unchanged') and employee_id is not null and employee_version_after is not null)
  ),
  constraint import_commit_items_key unique (commit_id, source_row_id)
);

create table app_private.import_commit_audit_events (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  auth_user_id uuid not null,
  actor_user_id uuid not null,
  tenant_id uuid not null,
  property_id uuid not null,
  batch_id uuid not null,
  commit_id uuid not null,
  event_type text not null check (event_type in ('commit', 'commit_item', 'revert_preview', 'revert')),
  details jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint import_commit_audit_scope_fkey
    foreign key (batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete restrict,
  constraint import_commit_audit_commit_fkey
    foreign key (commit_id, tenant_id, property_id)
    references public.import_commits(id, tenant_id, property_id) on delete restrict
);

create function app_private.reject_import_commit_audit_mutation()
returns trigger language plpgsql volatile security invoker set search_path = ''
as $function$
begin
  raise exception using errcode = '42501', message = 'IMPORT_COMMIT_AUDIT_APPEND_ONLY';
end
$function$;

create trigger import_commit_audit_append_only
before update or delete on app_private.import_commit_audit_events
for each row execute function app_private.reject_import_commit_audit_mutation();

create index import_commits_property_history_idx on public.import_commits (property_id, committed_at desc, id);
create index import_commit_items_batch_idx on public.import_commit_items (batch_id, created_at, id);
create index import_commit_items_employee_idx on public.import_commit_items (employee_id, created_at, id);
create index import_commit_audit_history_idx on app_private.import_commit_audit_events (property_id, occurred_at desc, id);

alter table public.import_commits owner to hotel_ld_migration_owner;
alter table public.import_commit_items owner to hotel_ld_migration_owner;
alter table app_private.import_commit_audit_events owner to hotel_ld_migration_owner;
alter function app_private.reject_import_commit_audit_mutation() owner to hotel_ld_migration_owner;

alter table public.import_commits enable row level security;
alter table public.import_commits force row level security;
alter table public.import_commit_items enable row level security;
alter table public.import_commit_items force row level security;
alter table app_private.import_commit_audit_events enable row level security;
alter table app_private.import_commit_audit_events force row level security;

create policy canonical_import_commits_scope on public.import_commits for all to hotel_ld_migration_owner
  using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id())
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_commit_items_scope on public.import_commit_items for all to hotel_ld_migration_owner
  using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id())
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_commit_audit_insert on app_private.import_commit_audit_events for insert to hotel_ld_migration_owner
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());

revoke all on table public.import_commits from public, hotel_ld_application;
revoke all on table public.import_commit_items from public, hotel_ld_application;
revoke all on table app_private.import_commit_audit_events from public, hotel_ld_application;
revoke all on sequence app_private.import_commit_audit_events_id_seq from public, hotel_ld_application;
revoke all on function app_private.reject_import_commit_audit_mutation() from public;

commit;
