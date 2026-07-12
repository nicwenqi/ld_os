create type public.employee_employment_status as enum ('active', 'inactive', 'leave', 'terminated', 'unknown');
create type public.employee_identifier_type as enum ('local_employee_number', 'lms_employee_id', 'merlin_id', 'hris_id', 'other');
create type public.employee_import_type as enum ('employee_master');
create type public.import_batch_status as enum ('uploaded', 'inspecting', 'mapping_required', 'validating', 'ready_for_review', 'importing', 'completed', 'completed_with_warnings', 'cancelled', 'failed', 'reverted');
create type public.import_row_status as enum ('staged', 'valid', 'warning', 'error', 'excluded', 'committed');
create type public.import_proposed_action as enum ('insert', 'update', 'unchanged', 'excluded', 'unresolved');
create type public.import_mapping_status as enum ('suggested', 'confirmed', 'excluded');
create type public.import_issue_severity as enum ('warning', 'error');
create type public.import_resolution_status as enum ('unresolved', 'accepted', 'corrected', 'excluded', 'ignored', 'deferred');
create type public.import_commit_action as enum ('insert', 'update', 'unchanged', 'excluded');

create table public.import_batches (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  import_type public.employee_import_type not null default 'employee_master', source_system text not null,
  original_filename text not null, sanitized_filename text not null, storage_object_path text not null,
  file_checksum text not null, file_size_bytes bigint not null, mime_type text not null,
  status public.import_batch_status not null default 'uploaded', detected_sheet_count integer not null default 0,
  total_source_rows integer not null default 0, valid_rows integer not null default 0,
  warning_rows integer not null default 0, error_rows integer not null default 0, excluded_rows integer not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(),
  started_at timestamptz, completed_at timestamptz, cancelled_at timestamptz, reverted_at timestamptz,
  version bigint not null default 1,
  foreign key (property_id, tenant_id) references public.properties(id, tenant_id),
  unique (id, tenant_id, property_id),
  check (btrim(source_system) <> '' and btrim(original_filename) <> '' and btrim(sanitized_filename) <> ''),
  check (file_size_bytes between 1 and 26214400), check (version > 0),
  check (storage_object_path = tenant_id::text || '/' || property_id::text || '/imports/' || id::text || '/' || sanitized_filename)
);

create table public.employees (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  employee_number text not null, name_zh text, name_en text, department_id uuid,
  operational_unit_id uuid, position_id uuid, position_family_id uuid, grade_or_band text,
  hire_date date, probation_or_confirmation_date date,
  employment_status public.employee_employment_status not null default 'active',
  is_new_employee boolean not null default false, is_active boolean not null default true,
  source_system text not null, source_batch_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id), updated_by uuid default auth.uid() references auth.users(id), version bigint not null default 1,
  foreign key (property_id, tenant_id) references public.properties(id, tenant_id),
  foreign key (department_id, tenant_id, property_id) references public.departments(id, tenant_id, property_id),
  foreign key (operational_unit_id, tenant_id, property_id) references public.operational_units(id, tenant_id, property_id),
  foreign key (position_id, tenant_id, property_id) references public.positions(id, tenant_id, property_id),
  foreign key (position_family_id, tenant_id, property_id) references public.position_families(id, tenant_id, property_id),
  foreign key (source_batch_id, tenant_id, property_id) references public.import_batches(id, tenant_id, property_id),
  unique (id, tenant_id, property_id), unique (property_id, employee_number),
  check (btrim(employee_number) <> ''), check (coalesce(nullif(btrim(name_zh), ''), nullif(btrim(name_en), '')) is not null),
  check (not is_active or (department_id is not null and position_id is not null)), check (version > 0)
);

create table public.employee_external_identifiers (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null, employee_id uuid not null,
  source_system text not null, identifier_type public.employee_identifier_type not null, identifier_value text not null,
  is_primary boolean not null default false, is_active boolean not null default true, source_batch_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (property_id, tenant_id) references public.properties(id, tenant_id),
  foreign key (employee_id, tenant_id, property_id) references public.employees(id, tenant_id, property_id) on delete cascade,
  foreign key (source_batch_id, tenant_id, property_id) references public.import_batches(id, tenant_id, property_id),
  unique (id, tenant_id, property_id), unique (property_id, source_system, identifier_value),
  check (btrim(source_system) <> '' and btrim(identifier_value) <> '')
);

create table public.import_sheets (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null, import_batch_id uuid not null,
  sheet_name text not null, sheet_index integer not null, detected_header_row integer, source_row_count integer not null default 0,
  selected_for_import boolean not null default false, inferred_purpose text, created_at timestamptz not null default now(),
  foreign key (import_batch_id, tenant_id, property_id) references public.import_batches(id, tenant_id, property_id) on delete cascade,
  unique (id, tenant_id, property_id, import_batch_id), unique (import_batch_id, sheet_index), check (sheet_index >= 0)
);

create table public.import_source_rows (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  import_batch_id uuid not null, import_sheet_id uuid not null, source_row_number integer not null,
  raw_values jsonb not null, normalized_values jsonb not null default '{}', row_fingerprint text not null,
  processing_status public.import_row_status not null default 'staged', proposed_action public.import_proposed_action not null default 'unresolved',
  matched_employee_id uuid, validation_summary jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (import_batch_id, tenant_id, property_id) references public.import_batches(id, tenant_id, property_id) on delete cascade,
  foreign key (import_sheet_id, tenant_id, property_id, import_batch_id) references public.import_sheets(id, tenant_id, property_id, import_batch_id) on delete cascade,
  foreign key (matched_employee_id, tenant_id, property_id) references public.employees(id, tenant_id, property_id),
  unique (id, tenant_id, property_id), unique (id, tenant_id, property_id, import_batch_id), unique (import_sheet_id, source_row_number),
  check (source_row_number > 0 and jsonb_typeof(raw_values) = 'object' and jsonb_typeof(normalized_values) = 'object')
);

create table public.import_field_mappings (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  import_batch_id uuid not null, import_sheet_id uuid not null, source_column_name text not null, source_column_index integer not null,
  target_field text not null, transformation_rule jsonb not null default '{}', is_required boolean not null default false,
  mapping_status public.import_mapping_status not null default 'suggested', approved_by uuid references auth.users(id), approved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (import_batch_id, tenant_id, property_id) references public.import_batches(id, tenant_id, property_id) on delete cascade,
  foreign key (import_sheet_id, tenant_id, property_id, import_batch_id) references public.import_sheets(id, tenant_id, property_id, import_batch_id) on delete cascade,
  unique (import_sheet_id, source_column_index),
  check (target_field in ('employee_number','name_zh','name_en','department_source_label','position_source_label','grade_or_band','hire_date','probation_or_confirmation_date','employment_status','lms_employee_id','merlin_id'))
);

create table public.import_issues (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null, import_batch_id uuid not null,
  import_source_row_id uuid, issue_type text not null, severity public.import_issue_severity not null, source_field text, source_value text,
  message text not null, suggested_resolution jsonb, resolution_status public.import_resolution_status not null default 'unresolved',
  resolved_by uuid references auth.users(id), resolved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (import_batch_id, tenant_id, property_id) references public.import_batches(id, tenant_id, property_id) on delete cascade,
  foreign key (import_source_row_id, tenant_id, property_id, import_batch_id) references public.import_source_rows(id, tenant_id, property_id, import_batch_id) on delete cascade,
  check (issue_type in ('duplicate_employee_number_in_file','duplicate_employee_number_in_property','missing_employee_number','missing_name','unresolved_department','unresolved_position','invalid_date','ambiguous_name_match','external_identifier_conflict','missing_required_field','unsupported_status','excluded_by_admin','other'))
);

create table public.import_resolution_rules (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null, source_system text not null,
  rule_type text not null, source_value text not null, normalized_source_value text not null,
  target_entity_type text, target_entity_id uuid, transformation_payload jsonb not null default '{}', is_active boolean not null default true,
  approved_by uuid references auth.users(id), approved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (property_id, tenant_id) references public.properties(id, tenant_id),
  unique (property_id, source_system, rule_type, normalized_source_value),
  check (target_entity_type is null or target_entity_type in ('department','position','position_family','operational_unit'))
);

create table public.import_commits (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null, import_batch_id uuid not null unique,
  committed_by uuid not null references auth.users(id), committed_at timestamptz not null default now(), inserted_employee_count integer not null default 0,
  updated_employee_count integer not null default 0, unchanged_employee_count integer not null default 0, excluded_row_count integer not null default 0,
  unresolved_row_count integer not null default 0, commit_summary jsonb not null default '{}', reverted_at timestamptz, reverted_by uuid references auth.users(id),
  foreign key (import_batch_id, tenant_id, property_id) references public.import_batches(id, tenant_id, property_id),
  unique (id, tenant_id, property_id)
);

create table public.import_commit_items (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null, import_commit_id uuid not null,
  import_source_row_id uuid not null, employee_id uuid, action public.import_commit_action not null,
  before_snapshot jsonb, after_snapshot jsonb, created_at timestamptz not null default now(),
  foreign key (import_commit_id, tenant_id, property_id) references public.import_commits(id, tenant_id, property_id) on delete cascade,
  foreign key (import_source_row_id, tenant_id, property_id) references public.import_source_rows(id, tenant_id, property_id),
  foreign key (employee_id, tenant_id, property_id) references public.employees(id, tenant_id, property_id),
  unique (import_commit_id, import_source_row_id)
);

create index employees_property_department_idx on public.employees(property_id, department_id, is_active);
create index employees_property_position_idx on public.employees(property_id, position_id);
create index import_batches_property_created_idx on public.import_batches(property_id, created_at desc);
create index import_rows_batch_action_idx on public.import_source_rows(import_batch_id, proposed_action, processing_status);
create index import_issues_batch_state_idx on public.import_issues(import_batch_id, resolution_status, severity);
