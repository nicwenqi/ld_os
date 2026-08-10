begin;
set local role hotel_ld_migration_owner;
set local check_function_bodies = off;

create type public.import_storage_lifecycle as enum (
  'intent_created', 'uploaded_unverified', 'verification_failed', 'verified',
  'linked', 'cleanup_pending', 'cleanup_in_progress', 'cleanup_failed', 'cleanup_completed'
);
create type public.import_workbook_lifecycle as enum (
  'intent_created', 'inspecting', 'mapping_required', 'failed'
);
create type public.import_verification_status as enum ('pending', 'passed', 'failed');
create type public.import_sheet_purpose as enum ('employee_master', 'excluded');
create type public.import_field_mapping_status as enum ('suggested', 'excluded');
create type public.import_source_row_status as enum ('staged', 'warning', 'error');
create type public.import_issue_severity as enum ('warning', 'error');
create type public.import_issue_resolution_status as enum ('open');
create type public.import_source_label_type as enum ('department', 'position');
create type public.import_source_label_status as enum ('pending');
create type public.import_cleanup_state as enum (
  'not_required', 'cleanup_pending', 'cleanup_in_progress', 'cleanup_completed', 'cleanup_failed'
);

create table public.import_batches (
  id uuid primary key,
  tenant_id uuid not null,
  property_id uuid not null,
  import_type text not null default 'employee_master'
    check (import_type = 'employee_master'),
  source_system text not null check (nullif(pg_catalog.btrim(source_system), '') is not null),
  original_filename text not null check (
    nullif(pg_catalog.btrim(original_filename), '') is not null
    and pg_catalog.char_length(original_filename) <= 255
  ),
  sanitized_filename text not null check (
    sanitized_filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$'
    and sanitized_filename !~ '\\.\\.'
  ),
  storage_provider text not null default 'supabase_storage'
    check (storage_provider = 'supabase_storage'),
  storage_bucket text not null default 'property-import-files'
    check (storage_bucket = 'property-import-files'),
  object_path text not null check (
    object_path = tenant_id::text || '/' || property_id::text || '/imports/' || id::text || '/' || sanitized_filename
  ),
  declared_checksum_sha256 text not null check (declared_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  declared_size_bytes bigint not null check (declared_size_bytes between 1 and 52428800),
  declared_mime_type text not null check (declared_mime_type in (
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  )),
  verified_checksum_sha256 text check (
    verified_checksum_sha256 is null or verified_checksum_sha256 ~ '^[0-9a-f]{64}$'
  ),
  verified_size_bytes bigint check (verified_size_bytes is null or verified_size_bytes between 1 and 52428800),
  verified_mime_type text check (verified_mime_type is null or verified_mime_type in (
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  )),
  verified_at timestamptz,
  verification_status public.import_verification_status not null default 'pending',
  storage_lifecycle public.import_storage_lifecycle not null default 'intent_created',
  workbook_lifecycle public.import_workbook_lifecycle not null default 'intent_created',
  detected_sheet_count integer not null default 0 check (detected_sheet_count >= 0),
  total_source_rows integer not null default 0 check (total_source_rows >= 0),
  valid_rows integer not null default 0 check (valid_rows >= 0),
  warning_rows integer not null default 0 check (warning_rows >= 0),
  error_rows integer not null default 0 check (error_rows >= 0),
  selected_sheet_id uuid,
  sealed_evidence_sha256 text check (
    sealed_evidence_sha256 is null or sealed_evidence_sha256 ~ '^[0-9a-f]{64}$'
  ),
  linked_at timestamptz,
  failure_reason text check (failure_reason is null or pg_catalog.char_length(failure_reason) <= 500),
  created_by_auth_user_id uuid not null,
  created_request_id uuid not null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  updated_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint import_batches_property_scope_fkey
    foreign key (tenant_id, property_id)
    references public.properties(tenant_id, id) on delete restrict,
  constraint import_batches_tenant_property_key unique (id, tenant_id, property_id),
  constraint import_batches_object_path_scope_key unique (id, tenant_id, property_id, object_path),
  constraint import_batches_verification_evidence_check check (
    (verification_status = 'pending'
      and verified_checksum_sha256 is null
      and verified_size_bytes is null
      and verified_mime_type is null
      and verified_at is null)
    or (verification_status = 'passed'
      and verified_checksum_sha256 = declared_checksum_sha256
      and verified_size_bytes = declared_size_bytes
      and verified_mime_type = declared_mime_type
      and verified_at is not null)
    or (verification_status = 'failed'
      and failure_reason is not null)
  ),
  constraint import_batches_storage_verification_state_check check (
    storage_lifecycle not in ('verified', 'linked')
    or (verification_status = 'passed'
      and verified_checksum_sha256 is not null
      and verified_size_bytes is not null
      and verified_mime_type is not null
      and verified_checksum_sha256 = declared_checksum_sha256
      and verified_size_bytes = declared_size_bytes
      and verified_mime_type = declared_mime_type)
  ),
  constraint import_batches_verification_failure_coherence_check check (
    (storage_lifecycle <> 'verification_failed' or verification_status = 'failed')
    and (verification_status <> 'failed' or storage_lifecycle in (
      'verification_failed', 'cleanup_pending', 'cleanup_in_progress', 'cleanup_failed', 'cleanup_completed'
    ))
  ),
  constraint import_batches_linked_evidence_check check (
    storage_lifecycle <> 'linked'
    or (verification_status = 'passed'
      and verified_checksum_sha256 is not null
      and verified_size_bytes is not null
      and verified_mime_type is not null
      and verified_checksum_sha256 = declared_checksum_sha256
      and verified_size_bytes = declared_size_bytes
      and verified_mime_type = declared_mime_type
      and workbook_lifecycle = 'mapping_required'
      and sealed_evidence_sha256 is not null and linked_at is not null)
  ),
  constraint import_batches_row_counts_check check (
    valid_rows + warning_rows + error_rows <= total_source_rows
  )
);

create table public.import_sheets (
  id uuid primary key,
  tenant_id uuid not null,
  property_id uuid not null,
  batch_id uuid not null,
  sheet_name text not null check (nullif(pg_catalog.btrim(sheet_name), '') is not null),
  sheet_index integer not null check (sheet_index >= 0),
  header_row integer check (header_row is null or header_row >= 1),
  row_count integer not null check (row_count >= 0),
  column_count integer not null check (column_count >= 0),
  is_hidden boolean not null default false,
  is_selected boolean not null default false,
  purpose public.import_sheet_purpose not null,
  created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint import_sheets_batch_scope_fkey
    foreign key (batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete restrict,
  constraint import_sheets_scope_key unique (id, batch_id, tenant_id, property_id),
  constraint import_sheets_batch_index_key unique (batch_id, sheet_index)
);

alter table public.import_batches
  add constraint import_batches_selected_sheet_scope_fkey
  foreign key (selected_sheet_id, id, tenant_id, property_id)
  references public.import_sheets(id, batch_id, tenant_id, property_id)
  deferrable initially deferred;

create table public.import_source_rows (
  id uuid primary key,
  tenant_id uuid not null,
  property_id uuid not null,
  batch_id uuid not null,
  sheet_id uuid not null,
  source_row_number integer not null check (source_row_number >= 1),
  raw_values jsonb not null check (
    pg_catalog.jsonb_typeof(raw_values) = 'array' and pg_catalog.pg_column_size(raw_values) <= 32768
  ),
  normalized_values jsonb not null check (
    pg_catalog.jsonb_typeof(normalized_values) = 'object' and pg_catalog.pg_column_size(normalized_values) <= 16384
  ),
  row_fingerprint text not null check (row_fingerprint ~ '^[0-9a-f]{64}$'),
  processing_status public.import_source_row_status not null,
  proposed_action text not null default 'unresolved' check (proposed_action = 'unresolved'),
  validation_summary jsonb not null check (
    pg_catalog.jsonb_typeof(validation_summary) = 'object' and pg_catalog.pg_column_size(validation_summary) <= 8192
  ),
  created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint import_source_rows_batch_scope_fkey
    foreign key (batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete restrict,
  constraint import_source_rows_sheet_scope_fkey
    foreign key (sheet_id, batch_id, tenant_id, property_id)
    references public.import_sheets(id, batch_id, tenant_id, property_id) on delete restrict,
  constraint import_source_rows_scope_key unique (id, batch_id, tenant_id, property_id),
  constraint import_source_rows_sheet_number_key unique (sheet_id, source_row_number)
);

create table public.import_field_mappings (
  id uuid primary key,
  tenant_id uuid not null,
  property_id uuid not null,
  batch_id uuid not null,
  sheet_id uuid not null,
  source_column_name text not null check (nullif(pg_catalog.btrim(source_column_name), '') is not null),
  source_column_index integer not null check (source_column_index >= 0),
  target_field text check (target_field in (
    'employee_number', 'name_zh', 'name_en', 'department_source_label',
    'position_source_label', 'grade_or_band', 'hire_date',
    'probation_or_confirmation_date', 'employment_status'
  )),
  transformation_rule jsonb not null check (
    pg_catalog.jsonb_typeof(transformation_rule) = 'object' and pg_catalog.pg_column_size(transformation_rule) <= 4096
  ),
  is_required boolean not null,
  mapping_status public.import_field_mapping_status not null,
  created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint import_field_mappings_batch_scope_fkey
    foreign key (batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete restrict,
  constraint import_field_mappings_sheet_scope_fkey
    foreign key (sheet_id, batch_id, tenant_id, property_id)
    references public.import_sheets(id, batch_id, tenant_id, property_id) on delete restrict,
  constraint import_field_mappings_sheet_column_key unique (sheet_id, source_column_index)
);

create table public.import_issues (
  id uuid primary key,
  tenant_id uuid not null,
  property_id uuid not null,
  batch_id uuid not null,
  source_row_id uuid,
  issue_type text not null check (nullif(pg_catalog.btrim(issue_type), '') is not null),
  severity public.import_issue_severity not null,
  source_field text check (source_field is null or source_field in (
    'employee_number', 'name_zh', 'name_en', 'department_source_label',
    'position_source_label', 'grade_or_band', 'hire_date',
    'probation_or_confirmation_date', 'employment_status'
  )),
  source_value_projection text check (source_value_projection is null or pg_catalog.char_length(source_value_projection) <= 256),
  message text not null check (nullif(pg_catalog.btrim(message), '') is not null and pg_catalog.char_length(message) <= 1000),
  resolution_status public.import_issue_resolution_status not null default 'open',
  created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint import_issues_batch_scope_fkey
    foreign key (batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete restrict,
  constraint import_issues_source_row_scope_fkey
    foreign key (source_row_id, batch_id, tenant_id, property_id)
    references public.import_source_rows(id, batch_id, tenant_id, property_id) on delete restrict
);

create table public.import_source_label_resolutions (
  id uuid primary key,
  tenant_id uuid not null,
  property_id uuid not null,
  batch_id uuid not null,
  sheet_id uuid not null,
  resolution_type public.import_source_label_type not null,
  source_label text not null check (nullif(pg_catalog.btrim(source_label), '') is not null),
  normalized_source_label text not null check (nullif(pg_catalog.btrim(normalized_source_label), '') is not null),
  affected_row_count integer not null check (affected_row_count >= 0),
  resolution_status public.import_source_label_status not null default 'pending',
  created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint import_source_label_resolutions_batch_scope_fkey
    foreign key (batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete restrict,
  constraint import_source_label_resolutions_sheet_scope_fkey
    foreign key (sheet_id, batch_id, tenant_id, property_id)
    references public.import_sheets(id, batch_id, tenant_id, property_id) on delete restrict,
  constraint import_source_label_resolutions_evidence_key unique (
    batch_id, resolution_type, sheet_id, normalized_source_label
  )
);

create table app_private.import_storage_operations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  batch_id uuid not null,
  object_path text not null,
  operation_type text not null default 'delete_unlinked_object'
    check (operation_type = 'delete_unlinked_object'),
  cleanup_state public.import_cleanup_state not null default 'not_required',
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  claim_id uuid,
  lease_expires_at timestamptz,
  originating_request_id uuid not null,
  last_request_id uuid,
  last_error_code text check (last_error_code is null or pg_catalog.char_length(last_error_code) <= 80),
  last_error_message text check (last_error_message is null or pg_catalog.char_length(last_error_message) <= 500),
  completed_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  updated_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint import_storage_operations_batch_object_scope_fkey
    foreign key (batch_id, tenant_id, property_id, object_path)
    references public.import_batches(id, tenant_id, property_id, object_path) on delete restrict,
  constraint import_storage_operations_batch_key unique (batch_id),
  constraint import_storage_operations_cleanup_lease_check check (
    cleanup_state <> 'cleanup_in_progress'
    or (claim_id is not null and lease_expires_at is not null and last_attempt_at is not null
      and lease_expires_at > last_attempt_at)
  ),
  constraint import_storage_operations_cleanup_completion_check check (
    cleanup_state <> 'cleanup_completed' or completed_at is not null
  )
);

create table app_private.import_activity_events (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  auth_user_id uuid not null,
  actor_user_id uuid not null,
  tenant_id uuid not null,
  property_id uuid not null,
  batch_id uuid not null,
  event_type text not null check (nullif(pg_catalog.btrim(event_type), '') is not null and pg_catalog.char_length(event_type) <= 80),
  previous_storage_lifecycle public.import_storage_lifecycle,
  next_storage_lifecycle public.import_storage_lifecycle,
  previous_workbook_lifecycle public.import_workbook_lifecycle,
  next_workbook_lifecycle public.import_workbook_lifecycle,
  details jsonb not null default '{}'::jsonb check (
    pg_catalog.jsonb_typeof(details) = 'object' and pg_catalog.pg_column_size(details) <= 8192
  ),
  occurred_at timestamptz not null default pg_catalog.transaction_timestamp(),
  constraint import_activity_events_batch_scope_fkey
    foreign key (batch_id, tenant_id, property_id)
    references public.import_batches(id, tenant_id, property_id) on delete restrict
);

create function app_private.neon_import_storage_transition_allowed(
  p_from public.import_storage_lifecycle,
  p_to public.import_storage_lifecycle
)
returns boolean language sql immutable security invoker set search_path = ''
as $function$
  select p_from = p_to or (p_from, p_to) in (
    ('intent_created'::public.import_storage_lifecycle, 'uploaded_unverified'::public.import_storage_lifecycle),
    ('intent_created'::public.import_storage_lifecycle, 'cleanup_pending'::public.import_storage_lifecycle),
    ('uploaded_unverified'::public.import_storage_lifecycle, 'verified'::public.import_storage_lifecycle),
    ('uploaded_unverified'::public.import_storage_lifecycle, 'verification_failed'::public.import_storage_lifecycle),
    ('uploaded_unverified'::public.import_storage_lifecycle, 'cleanup_pending'::public.import_storage_lifecycle),
    ('verification_failed'::public.import_storage_lifecycle, 'cleanup_pending'::public.import_storage_lifecycle),
    ('verified'::public.import_storage_lifecycle, 'linked'::public.import_storage_lifecycle),
    ('verified'::public.import_storage_lifecycle, 'cleanup_pending'::public.import_storage_lifecycle),
    ('cleanup_pending'::public.import_storage_lifecycle, 'cleanup_in_progress'::public.import_storage_lifecycle),
    ('cleanup_pending'::public.import_storage_lifecycle, 'cleanup_completed'::public.import_storage_lifecycle),
    ('cleanup_in_progress'::public.import_storage_lifecycle, 'cleanup_completed'::public.import_storage_lifecycle),
    ('cleanup_in_progress'::public.import_storage_lifecycle, 'cleanup_failed'::public.import_storage_lifecycle),
    ('cleanup_failed'::public.import_storage_lifecycle, 'cleanup_pending'::public.import_storage_lifecycle)
  )
$function$;

create function app_private.neon_import_workbook_transition_allowed(
  p_from public.import_workbook_lifecycle,
  p_to public.import_workbook_lifecycle
)
returns boolean language sql immutable security invoker set search_path = ''
as $function$
  select p_from = p_to or (p_from, p_to) in (
    ('intent_created'::public.import_workbook_lifecycle, 'inspecting'::public.import_workbook_lifecycle),
    ('intent_created'::public.import_workbook_lifecycle, 'failed'::public.import_workbook_lifecycle),
    ('inspecting'::public.import_workbook_lifecycle, 'mapping_required'::public.import_workbook_lifecycle),
    ('inspecting'::public.import_workbook_lifecycle, 'failed'::public.import_workbook_lifecycle)
  )
$function$;

create function app_private.enforce_neon_import_batch_lifecycle_transition()
returns trigger language plpgsql volatile security invoker set search_path = ''
as $function$
begin
  if not app_private.neon_import_storage_transition_allowed(old.storage_lifecycle, new.storage_lifecycle) then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_STORAGE_LIFECYCLE_TRANSITION_INVALID';
  end if;
  if not app_private.neon_import_workbook_transition_allowed(old.workbook_lifecycle, new.workbook_lifecycle) then
    raise exception using errcode = '22023', message = 'NEON_IMPORT_WORKBOOK_LIFECYCLE_TRANSITION_INVALID';
  end if;
  if new.tenant_id is distinct from old.tenant_id
    or new.property_id is distinct from old.property_id
    or new.source_system is distinct from old.source_system
    or new.original_filename is distinct from old.original_filename
    or new.sanitized_filename is distinct from old.sanitized_filename
    or new.storage_provider is distinct from old.storage_provider
    or new.storage_bucket is distinct from old.storage_bucket
    or new.object_path is distinct from old.object_path
    or new.declared_checksum_sha256 is distinct from old.declared_checksum_sha256
    or new.declared_size_bytes is distinct from old.declared_size_bytes
    or new.declared_mime_type is distinct from old.declared_mime_type
    or new.created_by_auth_user_id is distinct from old.created_by_auth_user_id
    or new.created_request_id is distinct from old.created_request_id then
    raise exception using errcode = '42501', message = 'NEON_IMPORT_BATCH_IMMUTABLE_EVIDENCE';
  end if;
  new.updated_at := pg_catalog.transaction_timestamp();
  return new;
end
$function$;

create function app_private.enforce_neon_import_selected_sheet()
returns trigger language plpgsql volatile security invoker set search_path = ''
as $function$
declare
  v_batch_id uuid;
  v_tenant_id uuid;
  v_property_id uuid;
  v_selected_sheet_id uuid;
  v_selected_count bigint;
  v_matching_selected_count bigint;
begin
  if tg_table_name = 'import_batches' then
    if tg_op = 'DELETE' then return null; end if;
    v_batch_id := new.id;
    v_tenant_id := new.tenant_id;
    v_property_id := new.property_id;
  elsif tg_op = 'DELETE' then
    v_batch_id := old.batch_id;
    v_tenant_id := old.tenant_id;
    v_property_id := old.property_id;
  else
    v_batch_id := new.batch_id;
    v_tenant_id := new.tenant_id;
    v_property_id := new.property_id;
  end if;

  select b.selected_sheet_id
  into v_selected_sheet_id
  from public.import_batches b
  where b.id = v_batch_id and b.tenant_id = v_tenant_id and b.property_id = v_property_id;
  if not found then return null; end if;

  select count(*), count(*) filter (where s.id = v_selected_sheet_id and s.is_selected)
  into v_selected_count, v_matching_selected_count
  from public.import_sheets s
  where s.batch_id = v_batch_id and s.tenant_id = v_tenant_id and s.property_id = v_property_id
    and s.is_selected;

  if (v_selected_sheet_id is null and v_selected_count <> 0)
    or (v_selected_sheet_id is not null
      and (v_selected_count <> 1 or v_matching_selected_count <> 1)) then
    raise exception using errcode = '23514', message = 'NEON_IMPORT_SELECTED_SHEET_INTEGRITY_INVALID';
  end if;
  return null;
end
$function$;

create function app_private.reject_import_activity_audit_mutation()
returns trigger language plpgsql volatile security invoker set search_path = ''
as $function$
begin
  raise exception using errcode = '42501', message = 'IMPORT_ACTIVITY_APPEND_ONLY';
end
$function$;

create trigger canonical_import_batch_lifecycle_transition
before update on public.import_batches
for each row execute function app_private.enforce_neon_import_batch_lifecycle_transition();

create constraint trigger canonical_import_selected_sheet_integrity_batches
after insert or update or delete on public.import_batches
deferrable initially deferred
for each row execute function app_private.enforce_neon_import_selected_sheet();

create constraint trigger canonical_import_selected_sheet_integrity_sheets
after insert or update or delete on public.import_sheets
deferrable initially deferred
for each row execute function app_private.enforce_neon_import_selected_sheet();

create trigger import_activity_events_append_only
before update or delete on app_private.import_activity_events
  for each row execute function app_private.reject_import_activity_audit_mutation();

create index import_batches_property_history_idx
  on public.import_batches (property_id, created_at desc, id);
create index import_batches_reconciliation_idx
  on public.import_batches (property_id, storage_lifecycle, workbook_lifecycle, updated_at);
create index import_sheets_batch_order_idx
  on public.import_sheets (batch_id, sheet_index, id);
create unique index import_sheets_selected_batch_idx
  on public.import_sheets (batch_id) where is_selected;
create index import_source_rows_batch_sheet_row_idx
  on public.import_source_rows (batch_id, sheet_id, source_row_number, id);
create index import_field_mappings_batch_sheet_idx
  on public.import_field_mappings (batch_id, sheet_id, source_column_index, id);
create index import_issues_batch_severity_idx
  on public.import_issues (batch_id, severity, id);
create index import_source_labels_evidence_idx
  on public.import_source_label_resolutions (batch_id, resolution_type, normalized_source_label, id);
create index import_storage_operations_due_cleanup_idx
  on app_private.import_storage_operations (next_attempt_at, id)
  where cleanup_state in ('cleanup_pending', 'cleanup_failed');
create index import_storage_operations_claim_expiry_idx
  on app_private.import_storage_operations (lease_expires_at, id)
  where cleanup_state = 'cleanup_in_progress';
create index import_activity_events_property_history_idx
  on app_private.import_activity_events (property_id, occurred_at desc, id);
create index import_activity_events_request_idx
  on app_private.import_activity_events (request_id, occurred_at, id);

alter table public.import_batches owner to hotel_ld_migration_owner;
alter table public.import_sheets owner to hotel_ld_migration_owner;
alter table public.import_source_rows owner to hotel_ld_migration_owner;
alter table public.import_field_mappings owner to hotel_ld_migration_owner;
alter table public.import_issues owner to hotel_ld_migration_owner;
alter table public.import_source_label_resolutions owner to hotel_ld_migration_owner;
alter table app_private.import_storage_operations owner to hotel_ld_migration_owner;
alter table app_private.import_activity_events owner to hotel_ld_migration_owner;
alter function app_private.neon_import_storage_transition_allowed(public.import_storage_lifecycle, public.import_storage_lifecycle) owner to hotel_ld_migration_owner;
alter function app_private.neon_import_workbook_transition_allowed(public.import_workbook_lifecycle, public.import_workbook_lifecycle) owner to hotel_ld_migration_owner;
alter function app_private.enforce_neon_import_batch_lifecycle_transition() owner to hotel_ld_migration_owner;
alter function app_private.enforce_neon_import_selected_sheet() owner to hotel_ld_migration_owner;
alter function app_private.reject_import_activity_audit_mutation() owner to hotel_ld_migration_owner;

alter table public.import_batches enable row level security;
alter table public.import_batches force row level security;
alter table public.import_sheets enable row level security;
alter table public.import_sheets force row level security;
alter table public.import_source_rows enable row level security;
alter table public.import_source_rows force row level security;
alter table public.import_field_mappings enable row level security;
alter table public.import_field_mappings force row level security;
alter table public.import_issues enable row level security;
alter table public.import_issues force row level security;
alter table public.import_source_label_resolutions enable row level security;
alter table public.import_source_label_resolutions force row level security;
alter table app_private.import_storage_operations enable row level security;
alter table app_private.import_storage_operations force row level security;
alter table app_private.import_activity_events enable row level security;
alter table app_private.import_activity_events force row level security;

create policy canonical_import_batches_scope on public.import_batches for all to hotel_ld_migration_owner
  using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id())
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_sheets_scope on public.import_sheets for all to hotel_ld_migration_owner
  using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id())
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_source_rows_scope on public.import_source_rows for all to hotel_ld_migration_owner
  using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id())
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_field_mappings_scope on public.import_field_mappings for all to hotel_ld_migration_owner
  using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id())
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_issues_scope on public.import_issues for all to hotel_ld_migration_owner
  using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id())
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_source_label_resolutions_scope on public.import_source_label_resolutions for all to hotel_ld_migration_owner
  using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id())
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_storage_operations_scope on app_private.import_storage_operations for all to hotel_ld_migration_owner
  using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id())
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_activity_events_insert on app_private.import_activity_events for insert to hotel_ld_migration_owner
  with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());

revoke all on table public.import_batches from public, hotel_ld_application;
revoke all on table public.import_sheets from public, hotel_ld_application;
revoke all on table public.import_source_rows from public, hotel_ld_application;
revoke all on table public.import_field_mappings from public, hotel_ld_application;
revoke all on table public.import_issues from public, hotel_ld_application;
revoke all on table public.import_source_label_resolutions from public, hotel_ld_application;
revoke all on table app_private.import_storage_operations from public, hotel_ld_application;
revoke all on table app_private.import_activity_events from public, hotel_ld_application;
revoke all on sequence app_private.import_activity_events_id_seq from public, hotel_ld_application;
revoke all on function app_private.neon_import_storage_transition_allowed(public.import_storage_lifecycle, public.import_storage_lifecycle) from public;
revoke all on function app_private.neon_import_workbook_transition_allowed(public.import_workbook_lifecycle, public.import_workbook_lifecycle) from public;
revoke all on function app_private.enforce_neon_import_batch_lifecycle_transition() from public;
revoke all on function app_private.enforce_neon_import_selected_sheet() from public;
revoke all on function app_private.reject_import_activity_audit_mutation() from public;

set local check_function_bodies = on;
commit;
