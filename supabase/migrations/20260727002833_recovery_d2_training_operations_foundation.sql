-- Recovery D2: deterministic planning, Session readiness and participant
-- snapshot foundation. This migration deliberately creates no attendance,
-- completion, feedback, KPI, health, forecast, risk, intervention, QR or AI
-- facts.

-- Stable Training Plan identity and immutable approved versions ------------

create table public.training_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  code text not null,
  name_zh text not null,
  is_active boolean not null default true,
  version bigint not null default 1,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_plans_scope_fkey
    foreign key (property_id, tenant_id)
    references public.properties(id, tenant_id) on delete restrict,
  constraint training_plans_scope_key unique (id, tenant_id, property_id),
  constraint training_plans_code_key unique (property_id, code),
  constraint training_plans_code_check check (
    code = upper(code)
    and code ~ '^[A-Z0-9]+(?:-[A-Z0-9]+)*$'
  ),
  constraint training_plans_name_check check (btrim(name_zh) <> ''),
  constraint training_plans_version_check check (version > 0)
);

create table public.training_plan_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  training_plan_id uuid not null,
  version_number integer not null,
  lifecycle_state text not null default 'draft',
  name_zh text not null,
  period_start date not null,
  period_end date not null,
  purpose text not null,
  operational_owner_role_assignment_id uuid not null,
  change_reason text not null,
  continuity_rationale text not null,
  version bigint not null default 1,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  withdrawn_by uuid references auth.users(id) on delete set null,
  withdrawn_at timestamptz,
  withdrawal_reason text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_plan_versions_plan_fkey
    foreign key (training_plan_id, tenant_id, property_id)
    references public.training_plans(id, tenant_id, property_id)
    on delete restrict,
  constraint training_plan_versions_owner_fkey
    foreign key (
      operational_owner_role_assignment_id,
      tenant_id,
      property_id
    )
    references public.role_assignments(id, tenant_id, property_id)
    on delete restrict,
  constraint training_plan_versions_scope_key
    unique (id, tenant_id, property_id),
  constraint training_plan_versions_lineage_key
    unique (training_plan_id, version_number),
  constraint training_plan_versions_state_check check (
    lifecycle_state in (
      'draft', 'review', 'approved', 'superseded', 'withdrawn'
    )
  ),
  constraint training_plan_versions_dates_check check (
    period_end >= period_start
  ),
  constraint training_plan_versions_definition_check check (
    btrim(name_zh) <> ''
    and btrim(purpose) <> ''
    and btrim(change_reason) <> ''
    and btrim(continuity_rationale) <> ''
  ),
  constraint training_plan_versions_version_check check (version > 0),
  constraint training_plan_versions_withdrawal_check check (
    lifecycle_state <> 'withdrawn'
    or (
      withdrawn_at is not null
      and btrim(coalesce(withdrawal_reason, '')) <> ''
    )
  )
);

create table public.training_plan_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  training_plan_version_id uuid not null,
  sort_order integer not null default 0,
  name_zh text not null,
  purpose_type text not null,
  business_purpose text not null,
  delivery_window_start date not null,
  delivery_window_end date not null,
  planned_session_count integer not null,
  planned_seat_capacity integer not null,
  owner_department_id uuid not null,
  training_requirement_version_id uuid,
  accepted_learning_method_id uuid,
  course_version_id uuid not null,
  created_at timestamptz not null default now(),
  constraint training_plan_items_version_fkey
    foreign key (training_plan_version_id, tenant_id, property_id)
    references public.training_plan_versions(id, tenant_id, property_id)
    on delete cascade,
  constraint training_plan_items_owner_department_fkey
    foreign key (owner_department_id, tenant_id, property_id)
    references public.departments(id, tenant_id, property_id)
    on delete restrict,
  constraint training_plan_items_requirement_version_fkey
    foreign key (
      training_requirement_version_id,
      tenant_id,
      property_id
    )
    references public.training_requirement_versions(id, tenant_id, property_id)
    on delete restrict,
  constraint training_plan_items_method_fkey
    foreign key (accepted_learning_method_id, tenant_id, property_id)
    references public.accepted_learning_methods(id, tenant_id, property_id)
    on delete restrict,
  constraint training_plan_items_course_version_fkey
    foreign key (course_version_id, tenant_id, property_id)
    references public.course_versions(id, tenant_id, property_id)
    on delete restrict,
  constraint training_plan_items_scope_key
    unique (id, tenant_id, property_id),
  constraint training_plan_items_purpose_check check (
    purpose_type in ('requirement_delivery', 'development_delivery')
  ),
  constraint training_plan_items_definition_check check (
    btrim(name_zh) <> ''
    and btrim(business_purpose) <> ''
    and delivery_window_end >= delivery_window_start
    and planned_session_count > 0
    and planned_seat_capacity > 0
  ),
  constraint training_plan_items_reference_shape_check check (
    (
      purpose_type = 'requirement_delivery'
      and training_requirement_version_id is not null
      and accepted_learning_method_id is not null
    )
    or (
      purpose_type = 'development_delivery'
      and training_requirement_version_id is null
      and accepted_learning_method_id is null
    )
  )
);

create table public.training_plan_item_department_terms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  training_plan_item_id uuid not null,
  department_id uuid not null,
  include_descendants boolean not null default true,
  created_at timestamptz not null default now(),
  constraint training_plan_terms_item_fkey
    foreign key (training_plan_item_id, tenant_id, property_id)
    references public.training_plan_items(id, tenant_id, property_id)
    on delete cascade,
  constraint training_plan_terms_department_fkey
    foreign key (department_id, tenant_id, property_id)
    references public.departments(id, tenant_id, property_id)
    on delete restrict,
  constraint training_plan_terms_key
    unique (training_plan_item_id, department_id)
);

create table public.training_plan_item_department_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  training_plan_item_id uuid not null,
  source_term_id uuid not null,
  department_id uuid not null,
  department_name_zh text not null,
  department_path_ids uuid[] not null,
  captured_at timestamptz not null default now(),
  constraint training_plan_snapshots_item_fkey
    foreign key (training_plan_item_id, tenant_id, property_id)
    references public.training_plan_items(id, tenant_id, property_id)
    on delete restrict,
  constraint training_plan_snapshots_term_fkey
    foreign key (source_term_id)
    references public.training_plan_item_department_terms(id)
    on delete restrict,
  constraint training_plan_snapshots_department_fkey
    foreign key (department_id, tenant_id, property_id)
    references public.departments(id, tenant_id, property_id)
    on delete restrict,
  constraint training_plan_snapshots_key
    unique (training_plan_item_id, department_id)
);

-- Stable Session identity and immutable published revisions ----------------

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  code text not null,
  name_zh text not null,
  purpose_type text not null,
  training_plan_item_id uuid,
  training_requirement_version_id uuid,
  accepted_learning_method_id uuid,
  course_version_id uuid not null,
  owning_department_id uuid not null,
  operational_owner_role_assignment_id uuid not null,
  current_revision_id uuid,
  current_state text not null default 'draft',
  version bigint not null default 1,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_sessions_scope_fkey
    foreign key (property_id, tenant_id)
    references public.properties(id, tenant_id) on delete restrict,
  constraint training_sessions_plan_item_fkey
    foreign key (training_plan_item_id, tenant_id, property_id)
    references public.training_plan_items(id, tenant_id, property_id)
    on delete restrict,
  constraint training_sessions_requirement_version_fkey
    foreign key (
      training_requirement_version_id,
      tenant_id,
      property_id
    )
    references public.training_requirement_versions(id, tenant_id, property_id)
    on delete restrict,
  constraint training_sessions_method_fkey
    foreign key (accepted_learning_method_id, tenant_id, property_id)
    references public.accepted_learning_methods(id, tenant_id, property_id)
    on delete restrict,
  constraint training_sessions_course_version_fkey
    foreign key (course_version_id, tenant_id, property_id)
    references public.course_versions(id, tenant_id, property_id)
    on delete restrict,
  constraint training_sessions_department_fkey
    foreign key (owning_department_id, tenant_id, property_id)
    references public.departments(id, tenant_id, property_id)
    on delete restrict,
  constraint training_sessions_owner_fkey
    foreign key (
      operational_owner_role_assignment_id,
      tenant_id,
      property_id
    )
    references public.role_assignments(id, tenant_id, property_id)
    on delete restrict,
  constraint training_sessions_scope_key unique (id, tenant_id, property_id),
  constraint training_sessions_code_key unique (property_id, code),
  constraint training_sessions_purpose_check check (
    purpose_type in ('requirement_delivery', 'development_delivery')
  ),
  constraint training_sessions_state_check check (
    current_state in ('draft', 'published', 'cancelled')
  ),
  constraint training_sessions_reference_shape_check check (
    (
      purpose_type = 'requirement_delivery'
      and training_requirement_version_id is not null
      and accepted_learning_method_id is not null
    )
    or (
      purpose_type = 'development_delivery'
      and training_requirement_version_id is null
      and accepted_learning_method_id is null
    )
  ),
  constraint training_sessions_version_check check (version > 0)
);

create table public.training_session_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  training_session_id uuid not null,
  revision_number integer not null,
  lifecycle_state text not null default 'draft',
  name_zh text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  capacity integer not null,
  venue_type text not null,
  venue_id uuid,
  venue_name_snapshot text not null,
  venue_location_snapshot text not null,
  venue_capacity_snapshot integer,
  selected_employee_ids uuid[] not null default '{}',
  version bigint not null default 1,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_session_revisions_session_fkey
    foreign key (training_session_id, tenant_id, property_id)
    references public.training_sessions(id, tenant_id, property_id)
    on delete cascade,
  constraint training_session_revisions_scope_key
    unique (id, tenant_id, property_id),
  constraint training_session_revisions_lineage_key
    unique (training_session_id, revision_number),
  constraint training_session_revisions_state_check check (
    lifecycle_state in ('draft', 'published', 'superseded')
  ),
  constraint training_session_revisions_time_check check (ends_at > starts_at),
  constraint training_session_revisions_capacity_check check (capacity > 0),
  constraint training_session_revisions_venue_type_check check (
    venue_type in ('approved_venue', 'other_location')
  ),
  constraint training_session_revisions_venue_shape_check check (
    (
      venue_type = 'approved_venue'
      and venue_id is not null
    )
    or (
      venue_type = 'other_location'
      and venue_id is null
    )
  ),
  constraint training_session_revisions_venue_snapshot_check check (
    btrim(venue_name_snapshot) <> ''
    and btrim(venue_location_snapshot) <> ''
  ),
  constraint training_session_revisions_version_check check (version > 0)
);

alter table public.training_sessions
  add constraint training_sessions_current_revision_fkey
  foreign key (current_revision_id)
  references public.training_session_revisions(id) on delete restrict;

create table public.training_session_target_departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  session_revision_id uuid not null,
  department_id uuid not null,
  include_descendants boolean not null default true,
  created_at timestamptz not null default now(),
  constraint session_targets_revision_fkey
    foreign key (session_revision_id, tenant_id, property_id)
    references public.training_session_revisions(id, tenant_id, property_id)
    on delete cascade,
  constraint session_targets_department_fkey
    foreign key (department_id, tenant_id, property_id)
    references public.departments(id, tenant_id, property_id)
    on delete restrict,
  constraint session_targets_key unique (session_revision_id, department_id)
);

-- Trainers, venues and publication readiness ------------------------------

create table public.trainer_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  trainer_type text not null,
  employee_id uuid,
  display_name text not null,
  is_active boolean not null default true,
  version bigint not null default 1,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainer_profiles_scope_fkey
    foreign key (property_id, tenant_id)
    references public.properties(id, tenant_id) on delete restrict,
  constraint trainer_profiles_employee_fkey
    foreign key (employee_id, tenant_id, property_id)
    references public.employees(id, tenant_id, property_id)
    on delete restrict,
  constraint trainer_profiles_scope_key unique (id, tenant_id, property_id),
  constraint trainer_profiles_type_check check (
    trainer_type in ('internal_employee', 'external')
  ),
  constraint trainer_profiles_shape_check check (
    (
      trainer_type = 'internal_employee'
      and employee_id is not null
    )
    or (
      trainer_type = 'external'
      and employee_id is null
    )
  ),
  constraint trainer_profiles_name_check check (btrim(display_name) <> ''),
  constraint trainer_profiles_version_check check (version > 0)
);

create unique index trainer_profiles_employee_key
  on public.trainer_profiles(property_id, employee_id)
  where employee_id is not null;

create table public.trainer_course_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  trainer_profile_id uuid not null,
  course_version_id uuid not null,
  effective_from date not null,
  effective_to date,
  evidence_note text not null,
  approved_by uuid references auth.users(id) on delete set null default auth.uid(),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint trainer_approvals_profile_fkey
    foreign key (trainer_profile_id, tenant_id, property_id)
    references public.trainer_profiles(id, tenant_id, property_id)
    on delete cascade,
  constraint trainer_approvals_course_version_fkey
    foreign key (course_version_id, tenant_id, property_id)
    references public.course_versions(id, tenant_id, property_id)
    on delete restrict,
  constraint trainer_approvals_key
    unique (trainer_profile_id, course_version_id, effective_from),
  constraint trainer_approvals_dates_check check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint trainer_approvals_evidence_check check (
    btrim(evidence_note) <> ''
  )
);

create table public.training_venues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  name_zh text not null,
  location_description text not null,
  capacity integer not null,
  is_active boolean not null default true,
  version bigint not null default 1,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_venues_scope_fkey
    foreign key (property_id, tenant_id)
    references public.properties(id, tenant_id) on delete restrict,
  constraint training_venues_scope_key unique (id, tenant_id, property_id),
  constraint training_venues_name_check check (btrim(name_zh) <> ''),
  constraint training_venues_location_check check (
    btrim(location_description) <> ''
  ),
  constraint training_venues_capacity_check check (capacity > 0),
  constraint training_venues_version_check check (version > 0)
);

alter table public.training_session_revisions
  add constraint training_session_revisions_venue_fkey
  foreign key (venue_id, tenant_id, property_id)
  references public.training_venues(id, tenant_id, property_id)
  on delete restrict;

create table public.training_session_trainer_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  session_revision_id uuid not null,
  trainer_profile_id uuid not null,
  trainer_course_approval_id uuid,
  trainer_role text not null,
  trainer_name_snapshot text not null,
  employee_fact_version_id uuid,
  created_at timestamptz not null default now(),
  constraint session_trainers_revision_fkey
    foreign key (session_revision_id, tenant_id, property_id)
    references public.training_session_revisions(id, tenant_id, property_id)
    on delete cascade,
  constraint session_trainers_profile_fkey
    foreign key (trainer_profile_id, tenant_id, property_id)
    references public.trainer_profiles(id, tenant_id, property_id)
    on delete restrict,
  constraint session_trainers_approval_fkey
    foreign key (trainer_course_approval_id)
    references public.trainer_course_approvals(id) on delete restrict,
  constraint session_trainers_fact_version_fkey
    foreign key (employee_fact_version_id)
    references public.employee_fact_versions(id) on delete restrict,
  constraint session_trainers_role_check check (
    trainer_role in ('lead', 'assistant')
  ),
  constraint session_trainers_name_check check (
    btrim(trainer_name_snapshot) <> ''
  ),
  constraint session_trainers_key
    unique (session_revision_id, trainer_profile_id)
);

create table public.training_session_resource_confirmations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  session_revision_id uuid not null,
  confirmation_key text not null,
  confirmed boolean not null,
  confirmation_source text not null default 'owner_attestation',
  confirmed_by uuid references auth.users(id) on delete set null default auth.uid(),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint session_confirmations_revision_fkey
    foreign key (session_revision_id, tenant_id, property_id)
    references public.training_session_revisions(id, tenant_id, property_id)
    on delete cascade,
  constraint session_confirmations_key
    unique (session_revision_id, confirmation_key),
  constraint session_confirmations_name_check check (
    confirmation_key in (
      'materials_ready', 'room_setup_ready', 'equipment_ready'
    )
  ),
  constraint session_confirmations_source_check check (
    confirmation_source in ('owner_attestation', 'system_verified')
  ),
  constraint session_confirmations_timestamp_check check (
    confirmed = (confirmed_at is not null)
  )
);

create table public.session_participant_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  session_revision_id uuid not null,
  employee_id uuid not null,
  employee_fact_version_id uuid not null,
  employee_number_snapshot text not null,
  employee_name_snapshot text not null,
  department_id_snapshot uuid,
  eligibility_state text not null,
  missing_evidence jsonb not null default '[]'::jsonb,
  selected boolean not null default false,
  evaluated_on date not null,
  created_at timestamptz not null default now(),
  constraint participant_snapshots_revision_fkey
    foreign key (session_revision_id, tenant_id, property_id)
    references public.training_session_revisions(id, tenant_id, property_id)
    on delete restrict,
  constraint participant_snapshots_employee_fkey
    foreign key (employee_id, tenant_id, property_id)
    references public.employees(id, tenant_id, property_id)
    on delete restrict,
  constraint participant_snapshots_fact_version_fkey
    foreign key (employee_fact_version_id)
    references public.employee_fact_versions(id) on delete restrict,
  constraint participant_snapshots_department_fkey
    foreign key (department_id_snapshot, tenant_id, property_id)
    references public.departments(id, tenant_id, property_id)
    on delete restrict,
  constraint participant_snapshots_key
    unique (session_revision_id, employee_id),
  constraint participant_snapshots_state_check check (
    eligibility_state in (
      'eligible', 'not_applicable', 'unable_to_determine', 'not_evaluated'
    )
  ),
  constraint participant_snapshots_missing_check check (
    jsonb_typeof(missing_evidence) = 'array'
  ),
  constraint participant_snapshots_selection_check check (
    not selected or eligibility_state in ('eligible', 'not_evaluated')
  )
);

create table public.attendance_preparation_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  session_revision_id uuid not null,
  preparation_mode text not null,
  opens_before_minutes integer not null,
  closes_after_minutes integer not null,
  created_at timestamptz not null default now(),
  constraint attendance_preparation_revision_fkey
    foreign key (session_revision_id, tenant_id, property_id)
    references public.training_session_revisions(id, tenant_id, property_id)
    on delete cascade,
  constraint attendance_preparation_revision_key
    unique (session_revision_id),
  constraint attendance_preparation_mode_check check (
    preparation_mode in ('manual_only', 'qr_or_manual')
  ),
  constraint attendance_preparation_window_check check (
    opens_before_minutes between 0 and 1440
    and closes_after_minutes between 0 and 1440
  )
);

create table public.training_session_cancellation_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  training_session_id uuid not null,
  session_revision_id uuid not null,
  reason text not null,
  cancelled_by uuid references auth.users(id) on delete set null default auth.uid(),
  cancelled_at timestamptz not null default now(),
  constraint cancellation_events_session_fkey
    foreign key (training_session_id, tenant_id, property_id)
    references public.training_sessions(id, tenant_id, property_id)
    on delete restrict,
  constraint cancellation_events_revision_fkey
    foreign key (session_revision_id, tenant_id, property_id)
    references public.training_session_revisions(id, tenant_id, property_id)
    on delete restrict,
  constraint cancellation_events_reason_check check (btrim(reason) <> '')
);

create table public.training_operation_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null default auth.uid(),
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint training_operation_audit_scope_fkey
    foreign key (property_id, tenant_id)
    references public.properties(id, tenant_id) on delete restrict,
  constraint training_operation_audit_type_check check (
    aggregate_type in (
      'training_plan_version', 'training_session_revision',
      'training_session', 'training_venue', 'trainer_profile'
    )
  ),
  constraint training_operation_audit_event_check check (
    btrim(event_type) <> '' and btrim(reason) <> ''
  ),
  constraint training_operation_audit_evidence_check check (
    jsonb_typeof(evidence) = 'object'
  )
);

-- Every foreign-key path has a leading supporting index. ------------------

create index training_plans_property_idx
  on public.training_plans(property_id);
create index training_plans_created_by_idx
  on public.training_plans(created_by);
create index training_plans_updated_by_idx
  on public.training_plans(updated_by);

create index training_plan_versions_plan_idx
  on public.training_plan_versions(training_plan_id);
create index training_plan_versions_owner_idx
  on public.training_plan_versions(operational_owner_role_assignment_id);
create index training_plan_versions_created_by_idx
  on public.training_plan_versions(created_by);
create index training_plan_versions_updated_by_idx
  on public.training_plan_versions(updated_by);
create index training_plan_versions_reviewed_by_idx
  on public.training_plan_versions(reviewed_by);
create index training_plan_versions_approved_by_idx
  on public.training_plan_versions(approved_by);
create index training_plan_versions_withdrawn_by_idx
  on public.training_plan_versions(withdrawn_by);
create index training_plan_versions_property_state_idx
  on public.training_plan_versions(property_id, lifecycle_state, period_start);
create unique index training_plan_versions_one_approved_idx
  on public.training_plan_versions(training_plan_id)
  where lifecycle_state = 'approved';

create index training_plan_items_version_idx
  on public.training_plan_items(training_plan_version_id);
create index training_plan_items_owner_department_idx
  on public.training_plan_items(owner_department_id);
create index training_plan_items_requirement_idx
  on public.training_plan_items(training_requirement_version_id);
create index training_plan_items_method_idx
  on public.training_plan_items(accepted_learning_method_id);
create index training_plan_items_course_idx
  on public.training_plan_items(course_version_id);
create index training_plan_terms_item_idx
  on public.training_plan_item_department_terms(training_plan_item_id);
create index training_plan_terms_department_idx
  on public.training_plan_item_department_terms(department_id);
create index training_plan_snapshots_item_idx
  on public.training_plan_item_department_snapshots(training_plan_item_id);
create index training_plan_snapshots_term_idx
  on public.training_plan_item_department_snapshots(source_term_id);
create index training_plan_snapshots_department_idx
  on public.training_plan_item_department_snapshots(department_id);

create index training_sessions_property_idx
  on public.training_sessions(property_id);
create index training_sessions_plan_item_idx
  on public.training_sessions(training_plan_item_id);
create index training_sessions_requirement_idx
  on public.training_sessions(training_requirement_version_id);
create index training_sessions_method_idx
  on public.training_sessions(accepted_learning_method_id);
create index training_sessions_course_idx
  on public.training_sessions(course_version_id);
create index training_sessions_department_idx
  on public.training_sessions(owning_department_id);
create index training_sessions_owner_idx
  on public.training_sessions(operational_owner_role_assignment_id);
create index training_sessions_current_revision_idx
  on public.training_sessions(current_revision_id);
create index training_sessions_created_by_idx
  on public.training_sessions(created_by);
create index training_sessions_updated_by_idx
  on public.training_sessions(updated_by);

create index session_revisions_session_idx
  on public.training_session_revisions(training_session_id);
create index session_revisions_venue_idx
  on public.training_session_revisions(venue_id);
create index session_revisions_published_by_idx
  on public.training_session_revisions(published_by);
create index session_revisions_created_by_idx
  on public.training_session_revisions(created_by);
create index session_revisions_updated_by_idx
  on public.training_session_revisions(updated_by);
create index session_revisions_property_time_idx
  on public.training_session_revisions(property_id, starts_at);
create unique index session_revisions_one_published_idx
  on public.training_session_revisions(training_session_id)
  where lifecycle_state = 'published';
create unique index session_revisions_one_draft_idx
  on public.training_session_revisions(training_session_id)
  where lifecycle_state = 'draft';

create index session_targets_revision_idx
  on public.training_session_target_departments(session_revision_id);
create index session_targets_department_idx
  on public.training_session_target_departments(department_id);

create index trainer_profiles_property_idx
  on public.trainer_profiles(property_id);
create index trainer_profiles_employee_idx
  on public.trainer_profiles(employee_id);
create index trainer_profiles_created_by_idx
  on public.trainer_profiles(created_by);
create index trainer_profiles_updated_by_idx
  on public.trainer_profiles(updated_by);
create index trainer_approvals_profile_idx
  on public.trainer_course_approvals(trainer_profile_id);
create index trainer_approvals_course_idx
  on public.trainer_course_approvals(course_version_id);
create index trainer_approvals_approved_by_idx
  on public.trainer_course_approvals(approved_by);

create index training_venues_property_idx
  on public.training_venues(property_id);
create index training_venues_created_by_idx
  on public.training_venues(created_by);
create index training_venues_updated_by_idx
  on public.training_venues(updated_by);

create index session_trainers_revision_idx
  on public.training_session_trainer_assignments(session_revision_id);
create index session_trainers_profile_idx
  on public.training_session_trainer_assignments(trainer_profile_id);
create index session_trainers_approval_idx
  on public.training_session_trainer_assignments(trainer_course_approval_id);
create index session_trainers_fact_version_idx
  on public.training_session_trainer_assignments(employee_fact_version_id);

create index session_confirmations_revision_idx
  on public.training_session_resource_confirmations(session_revision_id);
create index session_confirmations_actor_idx
  on public.training_session_resource_confirmations(confirmed_by);

create index participant_snapshots_revision_idx
  on public.session_participant_snapshots(session_revision_id);
create index participant_snapshots_employee_idx
  on public.session_participant_snapshots(employee_id);
create index participant_snapshots_fact_version_idx
  on public.session_participant_snapshots(employee_fact_version_id);
create index participant_snapshots_department_idx
  on public.session_participant_snapshots(department_id_snapshot);

create index attendance_preparation_revision_idx
  on public.attendance_preparation_configs(session_revision_id);
create index cancellation_events_session_idx
  on public.training_session_cancellation_events(training_session_id);
create index cancellation_events_revision_idx
  on public.training_session_cancellation_events(session_revision_id);
create index cancellation_events_actor_idx
  on public.training_session_cancellation_events(cancelled_by);
create index training_operation_audit_property_idx
  on public.training_operation_audit_events(property_id);
create index training_operation_audit_actor_idx
  on public.training_operation_audit_events(actor_user_id);
create index training_operation_audit_aggregate_idx
  on public.training_operation_audit_events(
    aggregate_type,
    aggregate_id,
    occurred_at desc
  );

-- No table has a browser mutation path. Read projection also goes through
-- scoped RPCs so future tables cannot accidentally broaden access.

alter table public.training_plans enable row level security;
alter table public.training_plans force row level security;
alter table public.training_plan_versions enable row level security;
alter table public.training_plan_versions force row level security;
alter table public.training_plan_items enable row level security;
alter table public.training_plan_items force row level security;
alter table public.training_plan_item_department_terms enable row level security;
alter table public.training_plan_item_department_terms force row level security;
alter table public.training_plan_item_department_snapshots enable row level security;
alter table public.training_plan_item_department_snapshots force row level security;
alter table public.training_sessions enable row level security;
alter table public.training_sessions force row level security;
alter table public.training_session_revisions enable row level security;
alter table public.training_session_revisions force row level security;
alter table public.training_session_target_departments enable row level security;
alter table public.training_session_target_departments force row level security;
alter table public.trainer_profiles enable row level security;
alter table public.trainer_profiles force row level security;
alter table public.trainer_course_approvals enable row level security;
alter table public.trainer_course_approvals force row level security;
alter table public.training_venues enable row level security;
alter table public.training_venues force row level security;
alter table public.training_session_trainer_assignments enable row level security;
alter table public.training_session_trainer_assignments force row level security;
alter table public.training_session_resource_confirmations enable row level security;
alter table public.training_session_resource_confirmations force row level security;
alter table public.session_participant_snapshots enable row level security;
alter table public.session_participant_snapshots force row level security;
alter table public.attendance_preparation_configs enable row level security;
alter table public.attendance_preparation_configs force row level security;
alter table public.training_session_cancellation_events enable row level security;
alter table public.training_session_cancellation_events force row level security;
alter table public.training_operation_audit_events enable row level security;
alter table public.training_operation_audit_events force row level security;

revoke all on
  public.training_plans,
  public.training_plan_versions,
  public.training_plan_items,
  public.training_plan_item_department_terms,
  public.training_plan_item_department_snapshots,
  public.training_sessions,
  public.training_session_revisions,
  public.training_session_target_departments,
  public.trainer_profiles,
  public.trainer_course_approvals,
  public.training_venues,
  public.training_session_trainer_assignments,
  public.training_session_resource_confirmations,
  public.session_participant_snapshots,
  public.attendance_preparation_configs,
  public.training_session_cancellation_events,
  public.training_operation_audit_events
from public, anon, authenticated;

-- Mutation guards ---------------------------------------------------------

create or replace function app_private.guard_training_plan_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.lifecycle_state in ('superseded', 'withdrawn') then
    raise exception '已批准培训计划版本不可修改；请创建新版本。'
      using errcode = '23514';
  end if;
  if old.lifecycle_state = 'approved' then
    if new.lifecycle_state not in ('superseded', 'withdrawn')
      or new.training_plan_id is distinct from old.training_plan_id
      or new.tenant_id is distinct from old.tenant_id
      or new.property_id is distinct from old.property_id
      or new.version_number is distinct from old.version_number
      or new.name_zh is distinct from old.name_zh
      or new.period_start is distinct from old.period_start
      or new.period_end is distinct from old.period_end
      or new.purpose is distinct from old.purpose
      or new.operational_owner_role_assignment_id is distinct from
        old.operational_owner_role_assignment_id
      or new.change_reason is distinct from old.change_reason
      or new.continuity_rationale is distinct from old.continuity_rationale
    then
      raise exception '已批准培训计划版本不可修改；请创建新版本。'
        using errcode = '23514';
    end if;
  end if;
  if old.lifecycle_state = 'review' then
    if new.training_plan_id is distinct from old.training_plan_id
      or new.tenant_id is distinct from old.tenant_id
      or new.property_id is distinct from old.property_id
      or new.version_number is distinct from old.version_number
      or new.name_zh is distinct from old.name_zh
      or new.period_start is distinct from old.period_start
      or new.period_end is distinct from old.period_end
      or new.purpose is distinct from old.purpose
      or new.operational_owner_role_assignment_id is distinct from
        old.operational_owner_role_assignment_id
      or new.change_reason is distinct from old.change_reason
      or new.continuity_rationale is distinct from old.continuity_rationale
    then
      raise exception '复核中的培训计划定义不可修改；请退回草稿。'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_plan_child_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_version_id uuid;
  selected_state text;
begin
  if tg_table_name = 'training_plan_items' then
    selected_version_id := coalesce(
      new.training_plan_version_id,
      old.training_plan_version_id
    );
  elsif tg_table_name = 'training_plan_item_department_terms' then
    select item.training_plan_version_id into selected_version_id
    from public.training_plan_items item
    where item.id = coalesce(
      new.training_plan_item_id,
      old.training_plan_item_id
    );
  else
    raise exception 'APPROVED_PLAN_EVIDENCE_APPEND_ONLY'
      using errcode = '42501';
  end if;
  select version_row.lifecycle_state into selected_state
  from public.training_plan_versions version_row
  where version_row.id = selected_version_id;
  if selected_state <> 'draft' then
    raise exception '仅草稿培训计划可以修改计划项目。'
      using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function app_private.guard_session_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.lifecycle_state = 'superseded' then
    raise exception '已发布培训场次版本不可修改；请创建新版本。'
      using errcode = '23514';
  end if;
  if old.lifecycle_state = 'published' and (
    new.lifecycle_state <> 'superseded'
    or new.training_session_id is distinct from old.training_session_id
    or new.tenant_id is distinct from old.tenant_id
    or new.property_id is distinct from old.property_id
    or new.revision_number is distinct from old.revision_number
    or new.name_zh is distinct from old.name_zh
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
    or new.timezone is distinct from old.timezone
    or new.capacity is distinct from old.capacity
    or new.venue_type is distinct from old.venue_type
    or new.venue_id is distinct from old.venue_id
    or new.venue_name_snapshot is distinct from old.venue_name_snapshot
    or new.venue_location_snapshot is distinct from
      old.venue_location_snapshot
    or new.venue_capacity_snapshot is distinct from
      old.venue_capacity_snapshot
    or new.selected_employee_ids is distinct from old.selected_employee_ids
    or new.published_by is distinct from old.published_by
    or new.published_at is distinct from old.published_at
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception '已发布培训场次版本不可修改；请创建新版本。'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_session_child_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_revision_id uuid;
  selected_state text;
begin
  selected_revision_id := case tg_table_name
    when 'training_session_target_departments'
      then coalesce(new.session_revision_id, old.session_revision_id)
    when 'training_session_trainer_assignments'
      then coalesce(new.session_revision_id, old.session_revision_id)
    when 'training_session_resource_confirmations'
      then coalesce(new.session_revision_id, old.session_revision_id)
    when 'attendance_preparation_configs'
      then coalesce(new.session_revision_id, old.session_revision_id)
    else null
  end;
  if selected_revision_id is null then
    raise exception 'SESSION_EVIDENCE_APPEND_ONLY' using errcode = '42501';
  end if;
  select revision.lifecycle_state into selected_state
  from public.training_session_revisions revision
  where revision.id = selected_revision_id;
  if selected_state <> 'draft' then
    raise exception '仅草稿场次可以修改准备信息。'
      using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function app_private.reject_training_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'TRAINING_OPERATION_EVIDENCE_APPEND_ONLY'
    using errcode = '42501';
end;
$$;

create trigger training_plan_versions_guard
before update or delete on public.training_plan_versions
for each row execute function app_private.guard_training_plan_version();
create trigger training_plan_items_guard
before insert or update or delete on public.training_plan_items
for each row execute function app_private.guard_plan_child_mutation();
create trigger training_plan_terms_guard
before insert or update or delete on public.training_plan_item_department_terms
for each row execute function app_private.guard_plan_child_mutation();
create trigger training_plan_snapshots_append_only
before update or delete on public.training_plan_item_department_snapshots
for each row execute function app_private.reject_training_evidence_mutation();
create trigger session_revisions_guard
before update or delete on public.training_session_revisions
for each row execute function app_private.guard_session_revision();
create trigger session_targets_guard
before insert or update or delete on public.training_session_target_departments
for each row execute function app_private.guard_session_child_mutation();
create trigger session_trainers_guard
before insert or update or delete on public.training_session_trainer_assignments
for each row execute function app_private.guard_session_child_mutation();
create trigger session_confirmations_guard
before insert or update or delete on public.training_session_resource_confirmations
for each row execute function app_private.guard_session_child_mutation();
create trigger attendance_preparation_guard
before insert or update or delete on public.attendance_preparation_configs
for each row execute function app_private.guard_session_child_mutation();
create trigger participant_snapshots_append_only
before update or delete on public.session_participant_snapshots
for each row execute function app_private.reject_training_evidence_mutation();
create trigger cancellation_events_append_only
before update or delete on public.training_session_cancellation_events
for each row execute function app_private.reject_training_evidence_mutation();
create trigger training_audit_append_only
before update or delete on public.training_operation_audit_events
for each row execute function app_private.reject_training_evidence_mutation();

revoke all on function
  app_private.guard_training_plan_version(),
  app_private.guard_plan_child_mutation(),
  app_private.guard_session_revision(),
  app_private.guard_session_child_mutation(),
  app_private.reject_training_evidence_mutation()
from public, anon, authenticated;

-- Shared authorization and evidence helpers ------------------------------

create or replace function app_private.current_training_property()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select account.property_id
  from public.user_accounts account
  where account.auth_user_id = (select auth.uid())
    and account.account_status = 'active'
    and (
      account.locked_until is null
      or account.locked_until <= now()
    )
  limit 1;
$$;

create or replace function app_private.is_training_manager(
  p_property_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_authorized_property_role(
    p_property_id,
    'property_ld_manager'
  );
$$;

create or replace function app_private.is_training_department_actor(
  p_property_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_authorized_property_role(
    p_property_id,
    'department_training_admin'
  );
$$;

create or replace function app_private.assert_training_property_actor(
  p_property_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception '请先登录。' using errcode = '42501';
  end if;
  if app_private.current_training_property() is distinct from p_property_id then
    raise exception '无权访问此酒店的培训运营。' using errcode = '42501';
  end if;
  if app_private.is_training_manager(p_property_id) then
    return 'manager';
  end if;
  if app_private.is_training_department_actor(p_property_id) then
    return 'department';
  end if;
  raise exception '当前账号没有有效的酒店培训运营角色。'
    using errcode = '42501';
end;
$$;

create or replace function app_private.assert_department_in_actor_scope(
  p_property_id uuid,
  p_department_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if app_private.is_training_manager(p_property_id) then
    return;
  end if;
  if not app_private.has_authorized_department_scope(
    p_property_id,
    p_department_id
  ) then
    raise exception '场次包含当前账号授权范围外的部门。'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function app_private.append_training_audit(
  p_property_id uuid,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_event_type text,
  p_reason text,
  p_evidence jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_tenant_id uuid;
begin
  select property.tenant_id into selected_tenant_id
  from public.properties property
  where property.id = p_property_id;
  insert into public.training_operation_audit_events(
    tenant_id,
    property_id,
    aggregate_type,
    aggregate_id,
    event_type,
    reason,
    evidence
  ) values (
    selected_tenant_id,
    p_property_id,
    p_aggregate_type,
    p_aggregate_id,
    p_event_type,
    p_reason,
    coalesce(p_evidence, '{}'::jsonb)
  );
end;
$$;

create or replace function app_private.assert_owner_assignment(
  p_property_id uuid,
  p_role_assignment_id uuid,
  p_actor_type text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  assignment_user_id uuid;
  assignment_role text;
  actor_user_id uuid;
begin
  select assignment.user_id, role.code
  into assignment_user_id, assignment_role
  from public.role_assignments assignment
  join public.roles role on role.id = assignment.role_id
  where assignment.id = p_role_assignment_id
    and assignment.property_id = p_property_id
    and assignment.status = 'active'
    and role.is_active
    and role.code in ('property_ld_manager', 'department_training_admin');
  if assignment_user_id is null then
    raise exception '运营负责人必须是当前酒店的有效后台角色。'
      using errcode = '22023';
  end if;
  if p_actor_type = 'department' then
    select account.user_id into actor_user_id
    from public.user_accounts account
    where account.auth_user_id = auth.uid()
      and account.property_id = p_property_id
      and account.account_status = 'active'
    limit 1;
    if assignment_user_id <> actor_user_id
      or assignment_role <> 'department_training_admin'
    then
      raise exception '部门培训负责人只能把自己设为本范围场次负责人。'
        using errcode = '42501';
    end if;
  end if;
end;
$$;

revoke all on function
  app_private.current_training_property(),
  app_private.is_training_manager(uuid),
  app_private.is_training_department_actor(uuid),
  app_private.assert_training_property_actor(uuid),
  app_private.assert_department_in_actor_scope(uuid,uuid),
  app_private.append_training_audit(uuid,text,uuid,text,text,jsonb),
  app_private.assert_owner_assignment(uuid,uuid,text)
from public, anon, authenticated;

-- Manager resource maintenance -------------------------------------------

create or replace function public.save_training_venue(
  p_property_id uuid,
  p_payload jsonb,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_tenant_id uuid;
  selected_id uuid;
  selected_version bigint;
begin
  if not app_private.is_training_manager(p_property_id) then
    raise exception '仅酒店学习与发展经理可以维护培训资源。'
      using errcode = '42501';
  end if;
  select property.tenant_id into selected_tenant_id
  from public.properties property
  where property.id = p_property_id;
  if selected_tenant_id is null then
    raise exception '未找到酒店。' using errcode = 'P0002';
  end if;
  if btrim(coalesce(p_payload->>'nameZh', '')) = ''
    or btrim(coalesce(p_payload->>'locationDescription', '')) = ''
    or coalesce((p_payload->>'capacity')::integer, 0) <= 0
  then
    raise exception '请完整填写场地名称、位置和有效容量。'
      using errcode = '22023';
  end if;

  selected_id := nullif(p_payload->>'id', '')::uuid;
  if selected_id is null then
    if p_expected_version <> 0 then
      raise exception '场地版本已变化，请刷新后重试。'
        using errcode = '40001';
    end if;
    insert into public.training_venues(
      tenant_id, property_id, name_zh, location_description, capacity,
      is_active
    ) values (
      selected_tenant_id,
      p_property_id,
      btrim(p_payload->>'nameZh'),
      btrim(p_payload->>'locationDescription'),
      (p_payload->>'capacity')::integer,
      coalesce((p_payload->>'active')::boolean, true)
    )
    returning id, version into selected_id, selected_version;
  else
    update public.training_venues venue
    set
      name_zh = btrim(p_payload->>'nameZh'),
      location_description = btrim(p_payload->>'locationDescription'),
      capacity = (p_payload->>'capacity')::integer,
      is_active = coalesce((p_payload->>'active')::boolean, true),
      version = venue.version + 1,
      updated_by = auth.uid(),
      updated_at = now()
    where venue.id = selected_id
      and venue.property_id = p_property_id
      and venue.version = p_expected_version
    returning version into selected_version;
    if selected_version is null then
      raise exception '场地版本已变化，请刷新后重试。'
        using errcode = '40001';
    end if;
  end if;

  perform app_private.append_training_audit(
    p_property_id,
    'training_venue',
    selected_id,
    'saved',
    '维护受控培训场地',
    jsonb_build_object('version', selected_version)
  );
  return jsonb_build_object(
    'id', selected_id,
    'version', selected_version,
    'source', 'real'
  );
end;
$$;

create or replace function public.save_trainer_profile(
  p_property_id uuid,
  p_payload jsonb,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_tenant_id uuid;
  selected_id uuid;
  selected_version bigint;
  approval jsonb;
  selected_employee_id uuid;
begin
  if not app_private.is_training_manager(p_property_id) then
    raise exception '仅酒店学习与发展经理可以维护培训师资。'
      using errcode = '42501';
  end if;
  select property.tenant_id into selected_tenant_id
  from public.properties property
  where property.id = p_property_id;
  selected_employee_id := nullif(p_payload->>'employeeId', '')::uuid;
  if p_payload->>'type' not in ('internal_employee', 'external')
    or btrim(coalesce(p_payload->>'displayName', '')) = ''
    or (
      p_payload->>'type' = 'internal_employee'
      and selected_employee_id is null
    )
    or (
      p_payload->>'type' = 'external'
      and selected_employee_id is not null
    )
  then
    raise exception '培训师类型、姓名或员工身份不完整。'
      using errcode = '22023';
  end if;
  if selected_employee_id is not null and not exists (
    select 1
    from public.employees employee
    where employee.id = selected_employee_id
      and employee.property_id = p_property_id
  ) then
    raise exception '内部培训师必须来自当前酒店员工主数据。'
      using errcode = '22023';
  end if;

  selected_id := nullif(p_payload->>'id', '')::uuid;
  if selected_id is null then
    if p_expected_version <> 0 then
      raise exception '培训师版本已变化，请刷新后重试。'
        using errcode = '40001';
    end if;
    insert into public.trainer_profiles(
      tenant_id, property_id, trainer_type, employee_id, display_name,
      is_active
    ) values (
      selected_tenant_id,
      p_property_id,
      p_payload->>'type',
      selected_employee_id,
      btrim(p_payload->>'displayName'),
      coalesce((p_payload->>'active')::boolean, true)
    )
    returning id, version into selected_id, selected_version;
  else
    update public.trainer_profiles profile
    set
      trainer_type = p_payload->>'type',
      employee_id = selected_employee_id,
      display_name = btrim(p_payload->>'displayName'),
      is_active = coalesce((p_payload->>'active')::boolean, true),
      version = profile.version + 1,
      updated_by = auth.uid(),
      updated_at = now()
    where profile.id = selected_id
      and profile.property_id = p_property_id
      and profile.version = p_expected_version
    returning version into selected_version;
    if selected_version is null then
      raise exception '培训师版本已变化，请刷新后重试。'
        using errcode = '40001';
    end if;
  end if;

  delete from public.trainer_course_approvals approval_row
  where approval_row.trainer_profile_id = selected_id;
  for approval in
    select value from jsonb_array_elements(
      coalesce(p_payload->'approvals', '[]'::jsonb)
    )
  loop
    if not exists (
      select 1
      from public.course_versions course_version
      where course_version.id = (approval->>'courseVersionId')::uuid
        and course_version.property_id = p_property_id
        and course_version.lifecycle_state = 'published'
    ) then
      raise exception '培训师授权必须引用当前酒店已发布的课程版本。'
        using errcode = '22023';
    end if;
    insert into public.trainer_course_approvals(
      tenant_id,
      property_id,
      trainer_profile_id,
      course_version_id,
      effective_from,
      effective_to,
      evidence_note
    ) values (
      selected_tenant_id,
      p_property_id,
      selected_id,
      (approval->>'courseVersionId')::uuid,
      (approval->>'effectiveFrom')::date,
      nullif(approval->>'effectiveTo', '')::date,
      btrim(approval->>'evidenceNote')
    );
  end loop;

  perform app_private.append_training_audit(
    p_property_id,
    'trainer_profile',
    selected_id,
    'saved',
    '维护受控培训师资与课程版本授权',
    jsonb_build_object('version', selected_version)
  );
  return jsonb_build_object(
    'id', selected_id,
    'version', selected_version,
    'source', 'real'
  );
end;
$$;

-- Training Plan aggregate -------------------------------------------------

create or replace function public.save_training_plan_version_draft(
  p_property_id uuid,
  p_payload jsonb,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  selected_tenant_id uuid;
  selected_plan_id uuid;
  selected_version_id uuid;
  selected_version bigint;
  selected_identity_version bigint;
  next_version_number integer;
  item_payload jsonb;
  term_payload jsonb;
  selected_item_id uuid;
  selected_purpose text;
  requirement_version_id uuid;
  method_id uuid;
  course_version_id uuid;
  owner_department_id uuid;
  owner_assignment_id uuid;
begin
  if not app_private.is_training_manager(p_property_id) then
    raise exception '仅酒店学习与发展经理可以维护培训计划。'
      using errcode = '42501';
  end if;
  select property.tenant_id into selected_tenant_id
  from public.properties property
  where property.id = p_property_id;
  if selected_tenant_id is null then
    raise exception '未找到酒店。' using errcode = 'P0002';
  end if;
  if btrim(coalesce(p_payload->>'code', '')) = ''
    or btrim(coalesce(p_payload->>'nameZh', '')) = ''
    or btrim(coalesce(p_payload->>'purpose', '')) = ''
    or btrim(coalesce(p_payload->>'changeReason', '')) = ''
    or btrim(coalesce(p_payload->>'continuityRationale', '')) = ''
    or (p_payload->>'periodStart')::date is null
    or (p_payload->>'periodEnd')::date <
      (p_payload->>'periodStart')::date
    or jsonb_array_length(coalesce(p_payload->'items', '[]'::jsonb)) = 0
  then
    raise exception '培训计划身份、周期、目的和计划项目必须完整。'
      using errcode = '22023';
  end if;
  owner_assignment_id :=
    (p_payload->>'operationalOwnerRoleAssignmentId')::uuid;
  perform app_private.assert_owner_assignment(
    p_property_id,
    owner_assignment_id,
    'manager'
  );

  selected_version_id := nullif(p_payload->>'planVersionId', '')::uuid;
  selected_plan_id := nullif(p_payload->>'planId', '')::uuid;

  if selected_version_id is not null then
    select version_row.training_plan_id
    into selected_plan_id
    from public.training_plan_versions version_row
    where version_row.id = selected_version_id
      and version_row.property_id = p_property_id
      and version_row.lifecycle_state = 'draft'
      and version_row.version = p_expected_version
    for update;
    if selected_plan_id is null then
      raise exception '计划草稿版本已变化，请刷新后重试。'
        using errcode = '40001';
    end if;
    update public.training_plans plan
    set
      name_zh = btrim(p_payload->>'nameZh'),
      version = plan.version + 1,
      updated_by = auth.uid(),
      updated_at = now()
    where plan.id = selected_plan_id;
    update public.training_plan_versions version_row
    set
      name_zh = btrim(p_payload->>'nameZh'),
      period_start = (p_payload->>'periodStart')::date,
      period_end = (p_payload->>'periodEnd')::date,
      purpose = btrim(p_payload->>'purpose'),
      operational_owner_role_assignment_id = owner_assignment_id,
      change_reason = btrim(p_payload->>'changeReason'),
      continuity_rationale = btrim(p_payload->>'continuityRationale'),
      version = version_row.version + 1,
      updated_by = auth.uid(),
      updated_at = now()
    where version_row.id = selected_version_id
    returning version into selected_version;
    delete from public.training_plan_items item
    where item.training_plan_version_id = selected_version_id;
  else
    if selected_plan_id is null then
      if p_expected_version <> 0 then
        raise exception '新计划草稿必须从版本 0 开始。'
          using errcode = '40001';
      end if;
      insert into public.training_plans(
        tenant_id, property_id, code, name_zh
      ) values (
        selected_tenant_id,
        p_property_id,
        upper(btrim(p_payload->>'code')),
        btrim(p_payload->>'nameZh')
      )
      returning id into selected_plan_id;
    else
      select plan.version into selected_identity_version
      from public.training_plans plan
      where plan.id = selected_plan_id
        and plan.property_id = p_property_id
        and plan.is_active
      for update;
      if selected_identity_version is null then
        raise exception '未找到可创建新版本的培训计划。'
          using errcode = 'P0002';
      end if;
      if selected_identity_version <> p_expected_version then
        raise exception '计划身份已变化，请刷新后重试。'
          using errcode = '40001';
      end if;
      update public.training_plans plan
      set
        name_zh = btrim(p_payload->>'nameZh'),
        version = plan.version + 1,
        updated_by = auth.uid(),
        updated_at = now()
      where plan.id = selected_plan_id;
    end if;
    select coalesce(max(version_row.version_number), 0) + 1
    into next_version_number
    from public.training_plan_versions version_row
    where version_row.training_plan_id = selected_plan_id;
    insert into public.training_plan_versions(
      tenant_id,
      property_id,
      training_plan_id,
      version_number,
      name_zh,
      period_start,
      period_end,
      purpose,
      operational_owner_role_assignment_id,
      change_reason,
      continuity_rationale
    ) values (
      selected_tenant_id,
      p_property_id,
      selected_plan_id,
      next_version_number,
      btrim(p_payload->>'nameZh'),
      (p_payload->>'periodStart')::date,
      (p_payload->>'periodEnd')::date,
      btrim(p_payload->>'purpose'),
      owner_assignment_id,
      btrim(p_payload->>'changeReason'),
      btrim(p_payload->>'continuityRationale')
    )
    returning id, version into selected_version_id, selected_version;
  end if;

  for item_payload in
    select value
    from jsonb_array_elements(p_payload->'items')
    with ordinality
    order by ordinality
  loop
    selected_purpose := item_payload->>'purposeType';
    requirement_version_id :=
      nullif(item_payload->>'requirementVersionId', '')::uuid;
    method_id := nullif(
      item_payload->>'acceptedLearningMethodId',
      ''
    )::uuid;
    course_version_id :=
      nullif(item_payload->>'courseVersionId', '')::uuid;
    owner_department_id :=
      nullif(item_payload->>'ownerDepartmentId', '')::uuid;
    if selected_purpose not in (
      'requirement_delivery',
      'development_delivery'
    )
      or course_version_id is null
      or owner_department_id is null
      or btrim(coalesce(item_payload->>'nameZh', '')) = ''
      or btrim(coalesce(item_payload->>'businessPurpose', '')) = ''
      or coalesce((item_payload->>'plannedSessionCount')::integer, 0) <= 0
      or coalesce((item_payload->>'plannedSeatCapacity')::integer, 0) <= 0
      or (item_payload->>'deliveryWindowEnd')::date <
        (item_payload->>'deliveryWindowStart')::date
      or jsonb_array_length(
        coalesce(item_payload->'targetDepartments', '[]'::jsonb)
      ) = 0
    then
      raise exception '每个计划项目必须具有明确目的、课程版本、交付窗口、容量和部门范围。'
        using errcode = '22023';
    end if;
    if not exists (
      select 1
      from public.departments department
      where department.id = owner_department_id
        and department.property_id = p_property_id
        and department.is_active
    ) then
      raise exception '计划项目负责人部门无效。' using errcode = '22023';
    end if;
    if not exists (
      select 1
      from public.course_versions version_row
      where version_row.id = course_version_id
        and version_row.property_id = p_property_id
        and version_row.lifecycle_state = 'published'
    ) then
      raise exception '计划项目必须引用已发布课程版本。'
        using errcode = '22023';
    end if;
    if selected_purpose = 'requirement_delivery' then
      if requirement_version_id is null or method_id is null
        or not exists (
          select 1
          from public.training_requirement_versions requirement_version
          join public.completion_definitions definition
            on definition.training_requirement_version_id =
              requirement_version.id
          join public.accepted_learning_methods method
            on method.completion_definition_id = definition.id
          where requirement_version.id = requirement_version_id
            and requirement_version.property_id = p_property_id
            and requirement_version.lifecycle_state = 'effective'
            and method.id = method_id
            and method.method_type = 'course_version'
            and method.course_version_id = course_version_id
        )
      then
        raise exception '要求交付项目必须引用同一有效要求中的认可课程版本方式。'
          using errcode = '22023';
      end if;
    elsif requirement_version_id is not null or method_id is not null then
      raise exception '发展类计划项目不能伪装成培训要求交付。'
        using errcode = '22023';
    end if;

    insert into public.training_plan_items(
      tenant_id,
      property_id,
      training_plan_version_id,
      sort_order,
      name_zh,
      purpose_type,
      business_purpose,
      delivery_window_start,
      delivery_window_end,
      planned_session_count,
      planned_seat_capacity,
      owner_department_id,
      training_requirement_version_id,
      accepted_learning_method_id,
      course_version_id
    ) values (
      selected_tenant_id,
      p_property_id,
      selected_version_id,
      coalesce((item_payload->>'sortOrder')::integer, 0),
      btrim(item_payload->>'nameZh'),
      selected_purpose,
      btrim(item_payload->>'businessPurpose'),
      (item_payload->>'deliveryWindowStart')::date,
      (item_payload->>'deliveryWindowEnd')::date,
      (item_payload->>'plannedSessionCount')::integer,
      (item_payload->>'plannedSeatCapacity')::integer,
      owner_department_id,
      requirement_version_id,
      method_id,
      course_version_id
    )
    returning id into selected_item_id;

    for term_payload in
      select value
      from jsonb_array_elements(item_payload->'targetDepartments')
    loop
      if not exists (
        select 1
        from public.departments department
        where department.id =
          (term_payload->>'departmentId')::uuid
          and department.property_id = p_property_id
          and department.is_active
      ) then
        raise exception '计划项目包含无效部门。'
          using errcode = '22023';
      end if;
      insert into public.training_plan_item_department_terms(
        tenant_id,
        property_id,
        training_plan_item_id,
        department_id,
        include_descendants
      ) values (
        selected_tenant_id,
        p_property_id,
        selected_item_id,
        (term_payload->>'departmentId')::uuid,
        coalesce(
          (term_payload->>'includeDescendants')::boolean,
          false
        )
      );
    end loop;
  end loop;

  perform app_private.append_training_audit(
    p_property_id,
    'training_plan_version',
    selected_version_id,
    'draft_saved',
    '保存培训计划草稿',
    jsonb_build_object(
      'version', selected_version,
      'planId', selected_plan_id
    )
  );
  return jsonb_build_object(
    'id', selected_version_id,
    'planId', selected_plan_id,
    'version', selected_version,
    'lifecycleState', 'draft',
    'source', 'real'
  );
end;
$$;

create or replace function public.transition_training_plan_version(
  p_plan_version_id uuid,
  p_target_state text,
  p_expected_version bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_property_id uuid;
  selected_state text;
  selected_version bigint;
  superseded_version_id uuid;
begin
  select version_row.property_id, version_row.lifecycle_state
  into selected_property_id, selected_state
  from public.training_plan_versions version_row
  where version_row.id = p_plan_version_id
  for update;
  if selected_property_id is null then
    raise exception '未找到培训计划版本。' using errcode = 'P0002';
  end if;
  if not app_private.is_training_manager(selected_property_id) then
    raise exception '仅酒店学习与发展经理可以维护培训计划。'
      using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception '状态变更必须说明业务原因。' using errcode = '22023';
  end if;
  if not (
    (selected_state = 'draft' and p_target_state = 'review')
    or (selected_state = 'review' and p_target_state in ('draft', 'approved'))
    or (selected_state = 'approved' and p_target_state = 'withdrawn')
  ) then
    raise exception '培训计划状态转换无效。' using errcode = '22023';
  end if;
  if p_target_state = 'approved' and not exists (
    select 1
    from public.training_plan_items item
    where item.training_plan_version_id = p_plan_version_id
  ) then
    raise exception '没有计划项目的培训计划不能批准。'
      using errcode = '22023';
  end if;

  if p_target_state = 'approved' then
    for superseded_version_id in
      update public.training_plan_versions previous_version
      set
        lifecycle_state = 'superseded',
        version = previous_version.version + 1,
        updated_by = auth.uid(),
        updated_at = now()
      where previous_version.training_plan_id = (
        select current_version.training_plan_id
        from public.training_plan_versions current_version
        where current_version.id = p_plan_version_id
      )
        and previous_version.id <> p_plan_version_id
        and previous_version.lifecycle_state = 'approved'
      returning previous_version.id
    loop
      perform app_private.append_training_audit(
        selected_property_id,
        'training_plan_version',
        superseded_version_id,
        'superseded',
        '新培训计划版本已批准',
        jsonb_build_object('replacementVersionId', p_plan_version_id)
      );
    end loop;
  end if;

  update public.training_plan_versions version_row
  set
    lifecycle_state = p_target_state,
    reviewed_by = case
      when p_target_state = 'review' then auth.uid()
      else version_row.reviewed_by
    end,
    reviewed_at = case
      when p_target_state = 'review' then now()
      else version_row.reviewed_at
    end,
    approved_by = case
      when p_target_state = 'approved' then auth.uid()
      else version_row.approved_by
    end,
    approved_at = case
      when p_target_state = 'approved' then now()
      else version_row.approved_at
    end,
    withdrawn_by = case
      when p_target_state = 'withdrawn' then auth.uid()
      else version_row.withdrawn_by
    end,
    withdrawn_at = case
      when p_target_state = 'withdrawn' then now()
      else version_row.withdrawn_at
    end,
    withdrawal_reason = case
      when p_target_state = 'withdrawn' then btrim(p_reason)
      else version_row.withdrawal_reason
    end,
    version = version_row.version + 1,
    updated_by = auth.uid(),
    updated_at = now()
  where version_row.id = p_plan_version_id
    and version_row.version = p_expected_version
  returning version into selected_version;
  if selected_version is null then
    raise exception '计划版本已变化，请刷新后重试。'
      using errcode = '40001';
  end if;

  if p_target_state = 'approved' then
    insert into public.training_plan_item_department_snapshots(
      tenant_id,
      property_id,
      training_plan_item_id,
      source_term_id,
      department_id,
      department_name_zh,
      department_path_ids
    )
    select distinct on (item.id, department.id)
      item.tenant_id,
      item.property_id,
      item.id,
      term.id,
      department.id,
      department.name_zh,
      department.path_ids
    from public.training_plan_items item
    join public.training_plan_item_department_terms term
      on term.training_plan_item_id = item.id
    join public.departments department
      on department.id = term.department_id
      or (
        term.include_descendants
        and exists (
          select 1
          from public.department_closure closure
          where closure.property_id = item.property_id
            and closure.ancestor_department_id = term.department_id
            and closure.descendant_department_id = department.id
        )
      )
    where item.training_plan_version_id = p_plan_version_id
    order by item.id, department.id, term.id
    on conflict (training_plan_item_id, department_id) do nothing;
  end if;

  perform app_private.append_training_audit(
    selected_property_id,
    'training_plan_version',
    p_plan_version_id,
    'state_changed',
    btrim(p_reason),
    jsonb_build_object(
      'from', selected_state,
      'to', p_target_state,
      'version', selected_version
    )
  );
  return jsonb_build_object(
    'id', p_plan_version_id,
    'version', selected_version,
    'lifecycleState', p_target_state,
    'source', 'real'
  );
end;
$$;

-- Session aggregate -------------------------------------------------------

create or replace function public.save_training_session_revision_draft(
  p_property_id uuid,
  p_payload jsonb,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  actor_type text;
  selected_tenant_id uuid;
  selected_session_id uuid;
  selected_revision_id uuid;
  selected_version bigint;
  next_revision_number integer;
  selected_purpose text;
  plan_item_id uuid;
  requirement_version_id uuid;
  method_id uuid;
  course_version_id uuid;
  owning_department_id uuid;
  owner_assignment_id uuid;
  venue_payload jsonb;
  selected_venue_id uuid;
  venue_name text;
  venue_location text;
  venue_capacity integer;
  term_payload jsonb;
  trainer_payload jsonb;
  confirmation_payload jsonb;
  trainer_id uuid;
  trainer_approval_id uuid;
  selected_employee_ids uuid[];
  attendance_payload jsonb;
  existing_session public.training_sessions%rowtype;
  is_new_session boolean := false;
begin
  actor_type := app_private.assert_training_property_actor(p_property_id);
  select property.tenant_id into selected_tenant_id
  from public.properties property
  where property.id = p_property_id;

  selected_purpose := p_payload->>'purposeType';
  plan_item_id := nullif(p_payload->>'planItemId', '')::uuid;
  requirement_version_id :=
    nullif(p_payload->>'requirementVersionId', '')::uuid;
  method_id := nullif(
    p_payload->>'acceptedLearningMethodId',
    ''
  )::uuid;
  course_version_id := nullif(p_payload->>'courseVersionId', '')::uuid;
  owning_department_id :=
    nullif(p_payload->>'owningDepartmentId', '')::uuid;
  owner_assignment_id :=
    nullif(p_payload->>'operationalOwnerRoleAssignmentId', '')::uuid;
  selected_revision_id :=
    nullif(p_payload->>'sessionRevisionId', '')::uuid;
  selected_session_id := nullif(p_payload->>'sessionId', '')::uuid;
  if btrim(coalesce(p_payload->>'code', '')) = ''
    or btrim(coalesce(p_payload->>'nameZh', '')) = ''
    or selected_purpose not in (
      'requirement_delivery',
      'development_delivery'
    )
    or course_version_id is null
    or owning_department_id is null
    or owner_assignment_id is null
    or (p_payload->>'endsAt')::timestamptz <=
      (p_payload->>'startsAt')::timestamptz
    or coalesce((p_payload->>'capacity')::integer, 0) <= 0
    or btrim(coalesce(p_payload->>'timezone', '')) = ''
    or jsonb_array_length(
      coalesce(p_payload->'targetDepartments', '[]'::jsonb)
    ) = 0
  then
    raise exception '场次身份、业务目的、时间、容量、负责人和部门范围必须完整。'
      using errcode = '22023';
  end if;
  perform app_private.assert_department_in_actor_scope(
    p_property_id,
    owning_department_id
  );
  perform app_private.assert_owner_assignment(
    p_property_id,
    owner_assignment_id,
    actor_type
  );
  if not exists (
    select 1
    from public.course_versions version_row
    where version_row.id = course_version_id
      and version_row.property_id = p_property_id
      and version_row.lifecycle_state = 'published'
  ) then
    raise exception '场次必须引用已发布课程版本。'
      using errcode = '22023';
  end if;
  if selected_purpose = 'requirement_delivery' then
    if requirement_version_id is null or method_id is null
      or not exists (
        select 1
        from public.training_requirement_versions requirement_version
        join public.completion_definitions definition
          on definition.training_requirement_version_id =
            requirement_version.id
        join public.accepted_learning_methods method
          on method.completion_definition_id = definition.id
        where requirement_version.id = requirement_version_id
          and requirement_version.property_id = p_property_id
          and requirement_version.lifecycle_state = 'effective'
          and method.id = method_id
          and method.method_type = 'course_version'
          and method.course_version_id = course_version_id
      )
    then
      raise exception '要求交付场次必须引用同一有效要求中的认可课程版本方式。'
        using errcode = '22023';
    end if;
  elsif requirement_version_id is not null or method_id is not null then
    raise exception '发展类场次不能伪装成培训要求交付。'
      using errcode = '22023';
  end if;
  if plan_item_id is not null and not exists (
    select 1
    from public.training_plan_items item
    join public.training_plan_versions plan_version
      on plan_version.id = item.training_plan_version_id
    where item.id = plan_item_id
      and item.property_id = p_property_id
      and item.purpose_type = selected_purpose
      and item.course_version_id = course_version_id
      and item.training_requirement_version_id is not distinct from
        requirement_version_id
      and item.accepted_learning_method_id is not distinct from method_id
      and (
        plan_version.lifecycle_state = 'approved'
        or exists (
          select 1
          from public.training_sessions existing_plan_session
          left join public.training_session_revisions existing_plan_revision
            on existing_plan_revision.training_session_id =
              existing_plan_session.id
          where existing_plan_session.property_id = p_property_id
            and existing_plan_session.training_plan_item_id = item.id
            and (
              existing_plan_session.id = selected_session_id
              or existing_plan_revision.id = selected_revision_id
            )
        )
      )
  ) then
    raise exception '场次与已批准计划项目的业务身份不一致。'
      using errcode = '22023';
  end if;

  for term_payload in
    select value
    from jsonb_array_elements(p_payload->'targetDepartments')
  loop
    if not exists (
      select 1
      from public.departments department
      where department.id = (term_payload->>'departmentId')::uuid
        and department.property_id = p_property_id
        and department.is_active
    ) then
      raise exception '场次包含无效部门。' using errcode = '22023';
    end if;
    perform app_private.assert_department_in_actor_scope(
      p_property_id,
      (term_payload->>'departmentId')::uuid
    );
  end loop;

  venue_payload := p_payload->'venue';
  if venue_payload->>'type' = 'approved_venue' then
    selected_venue_id := nullif(venue_payload->>'venueId', '')::uuid;
    select venue.name_zh, venue.location_description, venue.capacity
    into venue_name, venue_location, venue_capacity
    from public.training_venues venue
    where venue.id = selected_venue_id
      and venue.property_id = p_property_id
      and venue.is_active;
    if venue_name is null then
      raise exception '请选择当前酒店有效的培训场地。'
        using errcode = '22023';
    end if;
  elsif venue_payload->>'type' = 'other_location' then
    selected_venue_id := null;
    venue_name := btrim(venue_payload->>'nameZh');
    venue_location := btrim(venue_payload->>'locationDescription');
    venue_capacity := nullif(venue_payload->>'capacity', '')::integer;
    if coalesce(venue_name, '') = ''
      or coalesce(venue_location, '') = ''
    then
      raise exception '其他场地必须说明名称和位置。'
        using errcode = '22023';
    end if;
  else
    raise exception '场地类型无效。' using errcode = '22023';
  end if;

  select coalesce(array_agg(value::text::uuid), '{}'::uuid[])
  into selected_employee_ids
  from jsonb_array_elements_text(
    coalesce(p_payload->'selectedEmployeeIds', '[]'::jsonb)
  );

  if selected_revision_id is not null then
    select revision.training_session_id
    into selected_session_id
    from public.training_session_revisions revision
    where revision.id = selected_revision_id
      and revision.property_id = p_property_id
      and revision.lifecycle_state = 'draft'
      and revision.version = p_expected_version
    for update;
    if selected_session_id is null then
      raise exception '场次草稿版本已变化，请刷新后重试。'
        using errcode = '40001';
    end if;
    update public.training_sessions session_row
    set
      code = upper(btrim(p_payload->>'code')),
      name_zh = btrim(p_payload->>'nameZh'),
      purpose_type = selected_purpose,
      training_plan_item_id = plan_item_id,
      training_requirement_version_id = requirement_version_id,
      accepted_learning_method_id = method_id,
      course_version_id = course_version_id,
      owning_department_id = owning_department_id,
      operational_owner_role_assignment_id = owner_assignment_id,
      version = session_row.version + 1,
      updated_by = auth.uid(),
      updated_at = now()
    where session_row.id = selected_session_id;
    update public.training_session_revisions revision
    set
      name_zh = btrim(p_payload->>'nameZh'),
      starts_at = (p_payload->>'startsAt')::timestamptz,
      ends_at = (p_payload->>'endsAt')::timestamptz,
      timezone = btrim(p_payload->>'timezone'),
      capacity = (p_payload->>'capacity')::integer,
      venue_type = venue_payload->>'type',
      venue_id = selected_venue_id,
      venue_name_snapshot = venue_name,
      venue_location_snapshot = venue_location,
      venue_capacity_snapshot = venue_capacity,
      selected_employee_ids = selected_employee_ids,
      version = revision.version + 1,
      updated_by = auth.uid(),
      updated_at = now()
    where revision.id = selected_revision_id
    returning version into selected_version;
    delete from public.training_session_target_departments target
    where target.session_revision_id = selected_revision_id;
    delete from public.training_session_trainer_assignments assignment
    where assignment.session_revision_id = selected_revision_id;
    delete from public.training_session_resource_confirmations confirmation
    where confirmation.session_revision_id = selected_revision_id;
    delete from public.attendance_preparation_configs preparation
    where preparation.session_revision_id = selected_revision_id;
  else
    if selected_session_id is null then
      if p_expected_version <> 0 then
        raise exception '新场次草稿必须从版本 0 开始。'
          using errcode = '40001';
      end if;
      is_new_session := true;
      insert into public.training_sessions(
        tenant_id,
        property_id,
        code,
        name_zh,
        purpose_type,
        training_plan_item_id,
        training_requirement_version_id,
        accepted_learning_method_id,
        course_version_id,
        owning_department_id,
        operational_owner_role_assignment_id
      ) values (
        selected_tenant_id,
        p_property_id,
        upper(btrim(p_payload->>'code')),
        btrim(p_payload->>'nameZh'),
        selected_purpose,
        plan_item_id,
        requirement_version_id,
        method_id,
        course_version_id,
        owning_department_id,
        owner_assignment_id
      )
      returning * into existing_session;
      selected_session_id := existing_session.id;
    else
      select session_row.* into existing_session
      from public.training_sessions session_row
      where session_row.id = selected_session_id
        and session_row.property_id = p_property_id
      for update;
      if existing_session.id is null then
        raise exception '未找到可创建新修订的培训场次。'
          using errcode = 'P0002';
      end if;
      if existing_session.version <> p_expected_version then
        raise exception '场次身份已变化，请刷新后重试。'
          using errcode = '40001';
      end if;
      if existing_session.current_state <> 'published' then
        raise exception '只有当前已发布场次可以建立新修订。'
          using errcode = '22023';
      end if;
      if exists (
        select 1
        from public.training_session_revisions revision
        where revision.training_session_id = selected_session_id
          and revision.lifecycle_state = 'draft'
      ) then
        raise exception '此场次已有待处理草稿修订。'
          using errcode = '22023';
      end if;
      if upper(btrim(p_payload->>'code')) <> existing_session.code
        or selected_purpose <> existing_session.purpose_type
        or plan_item_id is distinct from
          existing_session.training_plan_item_id
        or requirement_version_id is distinct from
          existing_session.training_requirement_version_id
        or method_id is distinct from
          existing_session.accepted_learning_method_id
        or course_version_id is distinct from
          existing_session.course_version_id
        or owning_department_id is distinct from
          existing_session.owning_department_id
      then
        raise exception '新修订必须保留同一场次的计划、义务、课程方式和责任部门身份。'
          using errcode = '22023';
      end if;
      update public.training_sessions session_row
      set
        operational_owner_role_assignment_id = owner_assignment_id,
        version = session_row.version + 1,
        updated_by = auth.uid(),
        updated_at = now()
      where session_row.id = selected_session_id;
    end if;
    select coalesce(max(revision.revision_number), 0) + 1
    into next_revision_number
    from public.training_session_revisions revision
    where revision.training_session_id = selected_session_id;
    insert into public.training_session_revisions(
      tenant_id,
      property_id,
      training_session_id,
      revision_number,
      name_zh,
      starts_at,
      ends_at,
      timezone,
      capacity,
      venue_type,
      venue_id,
      venue_name_snapshot,
      venue_location_snapshot,
      venue_capacity_snapshot,
      selected_employee_ids
    ) values (
      selected_tenant_id,
      p_property_id,
      selected_session_id,
      next_revision_number,
      btrim(p_payload->>'nameZh'),
      (p_payload->>'startsAt')::timestamptz,
      (p_payload->>'endsAt')::timestamptz,
      btrim(p_payload->>'timezone'),
      (p_payload->>'capacity')::integer,
      venue_payload->>'type',
      selected_venue_id,
      venue_name,
      venue_location,
      venue_capacity,
      selected_employee_ids
    )
    returning id, version into selected_revision_id, selected_version;
    if is_new_session then
      update public.training_sessions session_row
      set current_revision_id = selected_revision_id
      where session_row.id = selected_session_id;
    end if;
  end if;

  for term_payload in
    select value
    from jsonb_array_elements(p_payload->'targetDepartments')
  loop
    insert into public.training_session_target_departments(
      tenant_id,
      property_id,
      session_revision_id,
      department_id,
      include_descendants
    ) values (
      selected_tenant_id,
      p_property_id,
      selected_revision_id,
      (term_payload->>'departmentId')::uuid,
      coalesce(
        (term_payload->>'includeDescendants')::boolean,
        false
      )
    );
  end loop;

  for trainer_payload in
    select value
    from jsonb_array_elements(
      coalesce(p_payload->'trainerAssignments', '[]'::jsonb)
    )
  loop
    trainer_id := (trainer_payload->>'trainerProfileId')::uuid;
    trainer_approval_id :=
      nullif(trainer_payload->>'trainerApprovalId', '')::uuid;
    if not exists (
      select 1
      from public.trainer_profiles trainer
      where trainer.id = trainer_id
        and trainer.property_id = p_property_id
        and trainer.is_active
    ) then
      raise exception '场次培训师无效。' using errcode = '22023';
    end if;
    if trainer_approval_id is not null and not exists (
      select 1
      from public.trainer_course_approvals approval
      where approval.id = trainer_approval_id
        and approval.trainer_profile_id = trainer_id
        and approval.course_version_id = course_version_id
        and (
          (p_payload->>'startsAt')::timestamptz
            at time zone (p_payload->>'timezone')
        )::date >= approval.effective_from
        and (
          approval.effective_to is null
          or (
            (p_payload->>'startsAt')::timestamptz
              at time zone (p_payload->>'timezone')
          )::date <= approval.effective_to
        )
    ) then
      raise exception '培训师在场次日期没有此课程版本的有效交付授权。'
        using errcode = '22023';
    end if;
    insert into public.training_session_trainer_assignments(
      tenant_id,
      property_id,
      session_revision_id,
      trainer_profile_id,
      trainer_course_approval_id,
      trainer_role,
      trainer_name_snapshot
    )
    select
      selected_tenant_id,
      p_property_id,
      selected_revision_id,
      trainer.id,
      trainer_approval_id,
      coalesce(trainer_payload->>'role', 'assistant'),
      trainer.display_name
    from public.trainer_profiles trainer
    where trainer.id = trainer_id;
  end loop;

  for confirmation_payload in
    select value
    from jsonb_array_elements(
      coalesce(p_payload->'ownerConfirmations', '[]'::jsonb)
    )
  loop
    insert into public.training_session_resource_confirmations(
      tenant_id,
      property_id,
      session_revision_id,
      confirmation_key,
      confirmed,
      confirmation_source,
      confirmed_at
    ) values (
      selected_tenant_id,
      p_property_id,
      selected_revision_id,
      confirmation_payload->>'key',
      coalesce((confirmation_payload->>'confirmed')::boolean, false),
      'owner_attestation',
      case
        when coalesce(
          (confirmation_payload->>'confirmed')::boolean,
          false
        ) then now()
        else null
      end
    );
  end loop;

  attendance_payload := p_payload->'attendancePreparation';
  if attendance_payload is null then
    raise exception '场次必须配置出勤准备边界。' using errcode = '22023';
  end if;
  insert into public.attendance_preparation_configs(
    tenant_id,
    property_id,
    session_revision_id,
    preparation_mode,
    opens_before_minutes,
    closes_after_minutes
  ) values (
    selected_tenant_id,
    p_property_id,
    selected_revision_id,
    attendance_payload->>'mode',
    (attendance_payload->>'opensBeforeMinutes')::integer,
    (attendance_payload->>'closesAfterMinutes')::integer
  );

  perform app_private.append_training_audit(
    p_property_id,
    'training_session_revision',
    selected_revision_id,
    'draft_saved',
    '保存培训场次草稿',
    jsonb_build_object(
      'version', selected_version,
      'sessionId', selected_session_id
    )
  );
  return jsonb_build_object(
    'id', selected_revision_id,
    'sessionId', selected_session_id,
    'version', selected_version,
    'lifecycleState', 'draft',
    'source', 'real'
  );
end;
$$;

create or replace function public.save_department_training_session_revision_draft(
  p_payload jsonb,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_property_id uuid;
  actor_type text;
begin
  selected_property_id := app_private.current_training_property();
  if selected_property_id is null then
    raise exception '当前账号没有有效酒店成员关系。'
      using errcode = '42501';
  end if;
  actor_type := app_private.assert_training_property_actor(
    selected_property_id
  );
  if actor_type <> 'department' then
    raise exception '此入口仅用于部门培训负责人。'
      using errcode = '42501';
  end if;
  return public.save_training_session_revision_draft(
    selected_property_id,
    p_payload,
    p_expected_version
  );
end;
$$;

create or replace function app_private.build_session_participant_preview(
  p_session_revision_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  selected_property_id uuid;
  selected_purpose text;
  requirement_version_id uuid;
  selected_start timestamptz;
  selected_timezone text;
  evaluation_date date;
  selected_employee_ids uuid[];
  page_number integer := 1;
  page_result jsonb;
  all_rows jsonb := '[]'::jsonb;
  filtered_rows jsonb := '[]'::jsonb;
  total_rows integer := 0;
  item jsonb;
  item_employee_id uuid;
  item_department_id uuid;
  is_selected boolean;
  selected_count integer := 0;
  eligible_count integer := 0;
  not_applicable_count integer := 0;
  unable_count integer := 0;
begin
  select
    revision.property_id,
    session_row.purpose_type,
    session_row.training_requirement_version_id,
    revision.starts_at,
    revision.timezone,
    revision.selected_employee_ids
  into
    selected_property_id,
    selected_purpose,
    requirement_version_id,
    selected_start,
    selected_timezone,
    selected_employee_ids
  from public.training_session_revisions revision
  join public.training_sessions session_row
    on session_row.id = revision.training_session_id
  where revision.id = p_session_revision_id;
  if selected_property_id is null then
    raise exception '未找到场次版本。' using errcode = 'P0002';
  end if;
  perform app_private.assert_training_property_actor(selected_property_id);
  evaluation_date := (
    selected_start at time zone selected_timezone
  )::date;

  if selected_purpose = 'requirement_delivery' then
    loop
      page_result := public.evaluate_learning_requirement_eligibility(
        selected_property_id,
        requirement_version_id,
        evaluation_date,
        null,
        page_number,
        200
      );
      all_rows := all_rows || coalesce(page_result->'rows', '[]'::jsonb);
      total_rows := coalesce((page_result->>'total')::integer, 0);
      exit when page_number * 200 >= total_rows;
      page_number := page_number + 1;
    end loop;

    for item in
      select value from jsonb_array_elements(all_rows)
    loop
      item_employee_id := (item->>'employeeId')::uuid;
      item_department_id := nullif(item->>'departmentId', '')::uuid;
      if item_department_id is not null and exists (
        select 1
        from public.training_session_target_departments target
        where target.session_revision_id = p_session_revision_id
          and (
            target.department_id = item_department_id
            or (
              target.include_descendants
              and exists (
                select 1
                from public.department_closure closure
                where closure.property_id = selected_property_id
                  and closure.ancestor_department_id =
                    target.department_id
                  and closure.descendant_department_id =
                    item_department_id
              )
            )
          )
      ) then
        is_selected := item_employee_id = any(selected_employee_ids);
        filtered_rows := filtered_rows || jsonb_build_array(
          item || jsonb_build_object('selected', is_selected)
        );
        if is_selected then
          selected_count := selected_count + 1;
        end if;
        case item->>'result'
          when 'eligible' then eligible_count := eligible_count + 1;
          when 'not_applicable' then
            not_applicable_count := not_applicable_count + 1;
          when 'unable_to_determine' then unable_count := unable_count + 1;
          else null;
        end case;
      end if;
    end loop;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'employeeId', employee.id,
      'employeeNumber', fact.employee_number,
      'employeeName', coalesce(
        nullif(fact_row.name_zh, ''),
        nullif(fact_row.name_en, ''),
        '姓名未提供'
      ),
      'departmentId', fact.department_id,
      'departmentName', department.name_zh,
      'requirementVersionId', null,
      'result', case
        when fact.fact_version_id is null then 'unable_to_determine'
        else 'not_evaluated'
      end,
      'evidence', jsonb_build_object(
        'employeeFactVersionId', fact.fact_version_id,
        'evaluatedAt', evaluation_date,
        'missingEvidence', case
          when fact.fact_version_id is null
            then jsonb_build_array('缺少评估日期的员工事实版本')
          else '[]'::jsonb
        end,
        'explanationZh', case
          when fact.fact_version_id is null
            then '缺少必要员工事实，不能发布参与人快照。'
          else '发展类场次不执行培训要求适用性判断。'
        end
      ),
      'selected', true
    ) order by fact.employee_number), '[]'::jsonb)
    into filtered_rows
    from unnest(selected_employee_ids) selected(employee_id)
    join public.employees employee on employee.id = selected.employee_id
    left join lateral app_private.resolve_employee_fact_at(
      employee.id,
      evaluation_date
    ) fact on true
    left join public.employee_fact_versions fact_row
      on fact_row.id = fact.fact_version_id
    left join public.departments department
      on department.id = fact.department_id
    where employee.property_id = selected_property_id
      and fact.department_id is not null
      and exists (
        select 1
        from public.training_session_target_departments target
        where target.session_revision_id = p_session_revision_id
          and (
            target.department_id = fact.department_id
            or (
              target.include_descendants
              and exists (
                select 1
                from public.department_closure closure
                where closure.property_id = selected_property_id
                  and closure.ancestor_department_id =
                    target.department_id
                  and closure.descendant_department_id =
                    fact.department_id
              )
            )
          )
      );
    selected_count := jsonb_array_length(filtered_rows);
    eligible_count := 0;
    unable_count := (
      select count(*)
      from jsonb_array_elements(filtered_rows) row_value
      where row_value->>'result' = 'unable_to_determine'
    );
  end if;

  return jsonb_build_object(
    'sessionRevisionId', p_session_revision_id,
    'propertyId', selected_property_id,
    'purposeType', selected_purpose,
    'evaluationDate', evaluation_date,
    'rows', filtered_rows,
    'candidateCount', jsonb_array_length(filtered_rows),
    'selectedCount', selected_count,
    'eligibleCount', eligible_count,
    'notApplicableCount', not_applicable_count,
    'unableToDetermineCount', unable_count,
    'source', 'real',
    'writesPerformed', false
  );
end;
$$;

create or replace function public.preview_training_session_participants(
  p_property_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_revision_id uuid;
begin
  perform app_private.assert_training_property_actor(p_property_id);
  selected_revision_id :=
    nullif(p_payload->>'sessionRevisionId', '')::uuid;
  if selected_revision_id is null or not exists (
    select 1
    from public.training_session_revisions revision
    where revision.id = selected_revision_id
      and revision.property_id = p_property_id
      and revision.lifecycle_state = 'draft'
  ) then
    raise exception '未找到可预览的场次草稿。' using errcode = 'P0002';
  end if;
  return app_private.build_session_participant_preview(
    selected_revision_id
  );
end;
$$;

create or replace function public.preview_department_training_session_participants(
  p_session_revision_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_property_id uuid;
  actor_type text;
begin
  selected_property_id := app_private.current_training_property();
  if selected_property_id is null then
    raise exception '当前账号没有有效酒店成员关系。'
      using errcode = '42501';
  end if;
  actor_type := app_private.assert_training_property_actor(
    selected_property_id
  );
  if actor_type <> 'department' then
    raise exception '此入口仅用于部门培训负责人。'
      using errcode = '42501';
  end if;
  return public.preview_training_session_participants(
    selected_property_id,
    jsonb_build_object('sessionRevisionId', p_session_revision_id)
  );
end;
$$;

create or replace function public.publish_training_session_revision(
  p_session_revision_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_property_id uuid;
  selected_session_id uuid;
  selected_state text;
  selected_purpose text;
  selected_start timestamptz;
  selected_timezone text;
  selected_capacity integer;
  selected_venue_capacity integer;
  selected_employee_ids uuid[];
  selected_revision_version bigint;
  actor_type text;
  preview jsonb;
  item jsonb;
  item_fact_version_id uuid;
  item_employee_id uuid;
  item_selected boolean;
  snapshot_id uuid;
  evaluation_date date;
begin
  select
    revision.property_id,
    revision.training_session_id,
    revision.lifecycle_state,
    session_row.purpose_type,
    revision.starts_at,
    revision.timezone,
    revision.capacity,
    revision.venue_capacity_snapshot,
    revision.selected_employee_ids
  into
    selected_property_id,
    selected_session_id,
    selected_state,
    selected_purpose,
    selected_start,
    selected_timezone,
    selected_capacity,
    selected_venue_capacity,
    selected_employee_ids
  from public.training_session_revisions revision
  join public.training_sessions session_row
    on session_row.id = revision.training_session_id
  where revision.id = p_session_revision_id
  for update of revision;
  if selected_property_id is null then
    raise exception '未找到场次版本。' using errcode = 'P0002';
  end if;
  actor_type := app_private.assert_training_property_actor(
    selected_property_id
  );
  if selected_state <> 'draft' then
    raise exception '只有草稿场次版本可以发布。' using errcode = '22023';
  end if;
  if (
    select revision.version
    from public.training_session_revisions revision
    where revision.id = p_session_revision_id
  ) <> p_expected_version then
    raise exception '场次版本已变化，请刷新后重试。'
      using errcode = '40001';
  end if;
  if actor_type = 'department' and not exists (
    select 1
    from public.training_sessions session_row
    where session_row.id = selected_session_id
      and app_private.has_authorized_department_scope(
        selected_property_id,
        session_row.owning_department_id
      )
  ) then
    raise exception '场次包含当前账号授权范围外的部门。'
      using errcode = '42501';
  end if;

  if selected_venue_capacity is not null
    and selected_capacity > selected_venue_capacity
  then
    raise exception '场次人数超过已确认场地容量。'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.training_session_target_departments target
    where target.session_revision_id = p_session_revision_id
  ) then
    raise exception '发布前必须确认场次受众部门。'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.training_session_trainer_assignments assignment
    where assignment.session_revision_id = p_session_revision_id
      and assignment.trainer_role = 'lead'
      and assignment.trainer_course_approval_id is not null
  ) then
    raise exception '发布前必须配置具有有效课程版本授权的主培训师。'
      using errcode = '22023';
  end if;
  if (
    select count(*)
    from public.training_session_resource_confirmations confirmation
    where confirmation.session_revision_id = p_session_revision_id
      and confirmation.confirmation_key in (
        'materials_ready',
        'room_setup_ready'
      )
      and confirmation.confirmed
  ) <> 2 then
    raise exception '发布前必须确认教材和场地布置准备状态。'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.attendance_preparation_configs preparation
    where preparation.session_revision_id = p_session_revision_id
  ) then
    raise exception '发布前必须完成出勤准备配置。'
      using errcode = '22023';
  end if;

  evaluation_date := (
    selected_start at time zone selected_timezone
  )::date;

  -- Freeze the internal trainer's employee context without making the
  -- trainer a backend user.
  update public.training_session_trainer_assignments assignment
  set employee_fact_version_id = fact.fact_version_id
  from public.trainer_profiles trainer
  left join lateral app_private.resolve_employee_fact_at(
    trainer.employee_id,
    evaluation_date
  ) fact on trainer.employee_id is not null
  where assignment.session_revision_id = p_session_revision_id
    and trainer.id = assignment.trainer_profile_id
    and trainer.trainer_type = 'internal_employee';
  if exists (
    select 1
    from public.training_session_trainer_assignments assignment
    join public.trainer_profiles trainer
      on trainer.id = assignment.trainer_profile_id
    where assignment.session_revision_id = p_session_revision_id
      and trainer.trainer_type = 'internal_employee'
      and assignment.employee_fact_version_id is null
  ) then
    raise exception '内部培训师缺少场次日期的员工事实版本。'
      using errcode = '22023';
  end if;

  preview := app_private.build_session_participant_preview(
    p_session_revision_id
  );
  if (preview->>'selectedCount')::integer = 0 then
    raise exception '发布前必须明确选择至少一名参与员工。'
      using errcode = '22023';
  end if;
  if (preview->>'selectedCount')::integer > selected_capacity then
    raise exception '已选择员工人数超过场次容量。'
      using errcode = '22023';
  end if;
  if (preview->>'selectedCount')::integer <>
    cardinality(selected_employee_ids)
  then
    raise exception '部分已选员工不在当前场次授权部门或缺少有效员工事实。'
      using errcode = '22023';
  end if;

  for item in
    select value from jsonb_array_elements(preview->'rows')
  loop
    item_selected := coalesce((item->>'selected')::boolean, false);
    item_fact_version_id :=
      nullif(item->'evidence'->>'employeeFactVersionId', '')::uuid;
    item_employee_id := (item->>'employeeId')::uuid;
    if item_fact_version_id is null then
      raise exception '参与人候选缺少评估日期的员工事实版本。'
        using errcode = '22023';
    end if;
    if item_selected and selected_purpose = 'requirement_delivery'
      and item->>'result' <> 'eligible'
    then
      raise exception '只有适用性评估为“适用”的员工可以加入要求交付场次。'
        using errcode = '22023';
    end if;

    insert into public.session_participant_snapshots(
      tenant_id,
      property_id,
      session_revision_id,
      employee_id,
      employee_fact_version_id,
      employee_number_snapshot,
      employee_name_snapshot,
      department_id_snapshot,
      eligibility_state,
      missing_evidence,
      selected,
      evaluated_on
    )
    select
      fact.tenant_id,
      fact.property_id,
      p_session_revision_id,
      item_employee_id,
      item_fact_version_id,
      item->>'employeeNumber',
      item->>'employeeName',
      nullif(item->>'departmentId', '')::uuid,
      item->>'result',
      coalesce(
        item->'evidence'->'missingEvidence',
        '[]'::jsonb
      ),
      item_selected,
      evaluation_date
    from public.employee_fact_versions fact
    where fact.id = item_fact_version_id
    returning id into snapshot_id;

    insert into public.employee_fact_dependencies(
      tenant_id,
      property_id,
      employee_id,
      employee_fact_version_id,
      fact_type,
      fact_id
    ) values (
      (
        select fact.tenant_id
        from public.employee_fact_versions fact
        where fact.id = item_fact_version_id
      ),
      selected_property_id,
      item_employee_id,
      item_fact_version_id,
      'session_participant_snapshot',
      snapshot_id
    );
  end loop;

  update public.training_session_revisions previous_revision
  set
    lifecycle_state = 'superseded',
    version = previous_revision.version + 1,
    updated_by = auth.uid(),
    updated_at = now()
  where previous_revision.training_session_id = selected_session_id
    and previous_revision.id <> p_session_revision_id
    and previous_revision.lifecycle_state = 'published';

  update public.training_session_revisions revision
  set
    lifecycle_state = 'published',
    published_by = auth.uid(),
    published_at = now(),
    version = revision.version + 1,
    updated_by = auth.uid(),
    updated_at = now()
  where revision.id = p_session_revision_id
    and revision.version = p_expected_version
  returning version into selected_revision_version;
  if selected_revision_version is null then
    raise exception '场次版本已变化，请刷新后重试。'
      using errcode = '40001';
  end if;

  update public.training_sessions session_row
  set
    current_revision_id = p_session_revision_id,
    current_state = 'published',
    version = session_row.version + 1,
    updated_by = auth.uid(),
    updated_at = now()
  where session_row.id = selected_session_id;

  perform app_private.append_training_audit(
    selected_property_id,
    'training_session_revision',
    p_session_revision_id,
    'published',
    '发布已完成资源与参与人准备的场次版本',
    jsonb_build_object(
      'revisionVersion', selected_revision_version,
      'participantCandidates', preview->'candidateCount',
      'selectedParticipants', preview->'selectedCount',
      'eligibilityEvaluationDate', evaluation_date
    )
  );
  return jsonb_build_object(
    'id', p_session_revision_id,
    'sessionId', selected_session_id,
    'version', selected_revision_version,
    'lifecycleState', 'published',
    'participantSnapshotCount', preview->'candidateCount',
    'source', 'real'
  );
end;
$$;

create or replace function public.cancel_training_session(
  p_training_session_id uuid,
  p_expected_version bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_property_id uuid;
  selected_revision_id uuid;
  selected_department_id uuid;
  selected_state text;
  selected_version bigint;
  actor_type text;
begin
  select
    session_row.property_id,
    session_row.current_revision_id,
    session_row.owning_department_id,
    session_row.current_state
  into
    selected_property_id,
    selected_revision_id,
    selected_department_id,
    selected_state
  from public.training_sessions session_row
  where session_row.id = p_training_session_id
  for update;
  if selected_property_id is null then
    raise exception '未找到培训场次。' using errcode = 'P0002';
  end if;
  actor_type := app_private.assert_training_property_actor(
    selected_property_id
  );
  if actor_type = 'department' then
    perform app_private.assert_department_in_actor_scope(
      selected_property_id,
      selected_department_id
    );
  end if;
  if selected_state <> 'published' then
    raise exception '只有已发布场次可以取消。' using errcode = '22023';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception '取消场次必须说明酒店运营原因。'
      using errcode = '22023';
  end if;

  update public.training_sessions session_row
  set
    current_state = 'cancelled',
    version = session_row.version + 1,
    updated_by = auth.uid(),
    updated_at = now()
  where session_row.id = p_training_session_id
    and session_row.version = p_expected_version
  returning version into selected_version;
  if selected_version is null then
    raise exception '场次状态已变化，请刷新后重试。'
      using errcode = '40001';
  end if;

  insert into public.training_session_cancellation_events(
    tenant_id,
    property_id,
    training_session_id,
    session_revision_id,
    reason
  )
  select
    session_row.tenant_id,
    session_row.property_id,
    session_row.id,
    selected_revision_id,
    btrim(p_reason)
  from public.training_sessions session_row
  where session_row.id = p_training_session_id;

  perform app_private.append_training_audit(
    selected_property_id,
    'training_session',
    p_training_session_id,
    'cancelled',
    btrim(p_reason),
    jsonb_build_object(
      'sessionRevisionId', selected_revision_id,
      'version', selected_version
    )
  );
  return jsonb_build_object(
    'id', p_training_session_id,
    'version', selected_version,
    'currentState', 'cancelled',
    'source', 'real'
  );
end;
$$;

create or replace function app_private.training_session_revision_document(
  p_session_revision_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', session_row.id,
    'revisionId', revision.id,
    'revisionNumber', revision.revision_number,
    'code', session_row.code,
    'nameZh', revision.name_zh,
    'purposeType', session_row.purpose_type,
    'currentState', session_row.current_state,
    'lifecycleState', revision.lifecycle_state,
    'version', session_row.version,
    'revisionVersion', revision.version,
    'startsAt', revision.starts_at,
    'endsAt', revision.ends_at,
    'timezone', revision.timezone,
    'capacity', revision.capacity,
    'owningDepartmentId', session_row.owning_department_id,
    'owningDepartmentName', department.name_zh,
    'venueName', revision.venue_name_snapshot,
    'selectedCount', cardinality(revision.selected_employee_ids),
    'publishedAt', revision.published_at,
    'readiness', jsonb_build_object(
      'trainerReady', exists (
        select 1
        from public.training_session_trainer_assignments assignment
        where assignment.session_revision_id = revision.id
          and assignment.trainer_role = 'lead'
          and assignment.trainer_course_approval_id is not null
      ),
      'resourceReady', (
        select count(*)
        from public.training_session_resource_confirmations confirmation
        where confirmation.session_revision_id = revision.id
          and confirmation.confirmed
          and confirmation.confirmation_key in (
            'materials_ready', 'room_setup_ready'
          )
      ) = 2,
      'participantPreviewRequired', revision.lifecycle_state = 'draft',
      'attendancePreparationReady', exists (
        select 1
        from public.attendance_preparation_configs preparation
        where preparation.session_revision_id = revision.id
      )
    ),
    'details', jsonb_build_object(
      'planItemId', session_row.training_plan_item_id,
      'requirementVersionId',
        session_row.training_requirement_version_id,
      'acceptedLearningMethodId',
        session_row.accepted_learning_method_id,
      'courseVersionId', session_row.course_version_id,
      'operationalOwnerRoleAssignmentId',
        session_row.operational_owner_role_assignment_id,
      'venue', case
        when revision.venue_type = 'approved_venue' then
          jsonb_build_object(
            'type', 'approved_venue',
            'venueId', revision.venue_id
          )
        else jsonb_build_object(
          'type', 'other_location',
          'locationName', revision.venue_name_snapshot,
          'capacityAttested',
            revision.venue_capacity_snapshot is not null
            and revision.venue_capacity_snapshot >= revision.capacity
        )
      end,
      'trainerAssignments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'trainerProfileId', assignment.trainer_profile_id,
          'trainerApprovalId', assignment.trainer_course_approval_id,
          'role', case assignment.trainer_role
            when 'assistant' then 'co_trainer'
            else assignment.trainer_role
          end
        ) order by assignment.trainer_role, assignment.created_at)
        from public.training_session_trainer_assignments assignment
        where assignment.session_revision_id = revision.id
      ), '[]'::jsonb),
      'targetDepartments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'departmentId', target.department_id,
          'includeDescendants', target.include_descendants
        ) order by target.created_at)
        from public.training_session_target_departments target
        where target.session_revision_id = revision.id
      ), '[]'::jsonb),
      'selectedEmployeeIds', to_jsonb(revision.selected_employee_ids),
      'ownerConfirmations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', confirmation.confirmation_key,
          'confirmed', confirmation.confirmed
        ) order by confirmation.confirmation_key)
        from public.training_session_resource_confirmations confirmation
        where confirmation.session_revision_id = revision.id
      ), '[]'::jsonb),
      'attendancePreparation', coalesce((
        select jsonb_build_object(
          'mode', preparation.preparation_mode,
          'opensBeforeMinutes', preparation.opens_before_minutes,
          'closesAfterMinutes', preparation.closes_after_minutes
        )
        from public.attendance_preparation_configs preparation
        where preparation.session_revision_id = revision.id
      ), jsonb_build_object(
        'mode', 'manual_only',
        'opensBeforeMinutes', 0,
        'closesAfterMinutes', 0
      ))
    )
  )
  from public.training_session_revisions revision
  join public.training_sessions session_row
    on session_row.id = revision.training_session_id
  join public.departments department
    on department.id = session_row.owning_department_id
  where revision.id = p_session_revision_id;
$$;

-- Role-scoped read projections -------------------------------------------

create or replace function public.read_training_operations_foundation(
  p_property_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_training_manager(p_property_id) then
    raise exception '仅酒店学习与发展经理可以查看全酒店培训运营基础。'
      using errcode = '42501';
  end if;
  return jsonb_build_object(
    'propertyId', p_property_id,
    'source', 'real',
    'boundary', jsonb_build_object(
      'planning', 'real',
      'sessionReadiness', 'real',
      'participantSnapshots', 'real_after_publication',
      'attendance', 'unavailable',
      'completion', 'unavailable',
      'feedback', 'unavailable',
      'kpi', 'unavailable'
    ),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', plan_version.id,
        'planId', plan.id,
        'identityVersion', plan.version,
        'code', plan.code,
        'nameZh', plan_version.name_zh,
        'versionNumber', plan_version.version_number,
        'version', plan_version.version,
        'lifecycleState', plan_version.lifecycle_state,
        'periodStart', plan_version.period_start,
        'periodEnd', plan_version.period_end,
        'purpose', plan_version.purpose,
        'operationalOwnerRoleAssignmentId',
          plan_version.operational_owner_role_assignment_id,
        'itemCount', (
          select count(*)
          from public.training_plan_items item
          where item.training_plan_version_id = plan_version.id
        ),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', item.id,
            'nameZh', item.name_zh,
            'purposeType', item.purpose_type,
            'businessPurpose', item.business_purpose,
            'deliveryWindowStart', item.delivery_window_start,
            'deliveryWindowEnd', item.delivery_window_end,
            'plannedSessionCount', item.planned_session_count,
            'plannedSeatCapacity', item.planned_seat_capacity,
            'ownerDepartmentId', item.owner_department_id,
            'requirementVersionId',
              item.training_requirement_version_id,
            'acceptedLearningMethodId',
              item.accepted_learning_method_id,
            'courseVersionId', item.course_version_id,
            'targetDepartments', coalesce((
              select jsonb_agg(jsonb_build_object(
                'departmentId', term.department_id,
                'includeDescendants', term.include_descendants
              ) order by term.created_at)
              from public.training_plan_item_department_terms term
              where term.training_plan_item_id = item.id
            ), '[]'::jsonb)
          ) order by item.sort_order, item.created_at)
          from public.training_plan_items item
          where item.training_plan_version_id = plan_version.id
        ), '[]'::jsonb),
        'approvedAt', plan_version.approved_at,
        'updatedAt', plan_version.updated_at
      ) order by plan_version.updated_at desc)
      from public.training_plan_versions plan_version
      join public.training_plans plan
        on plan.id = plan_version.training_plan_id
      where plan_version.property_id = p_property_id
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(
        app_private.training_session_revision_document(revision.id)
        order by revision.starts_at, revision.revision_number
      )
      from public.training_sessions session_row
      join public.training_session_revisions revision
        on revision.training_session_id = session_row.id
       and (
         revision.id = session_row.current_revision_id
         or revision.lifecycle_state = 'draft'
       )
      where session_row.property_id = p_property_id
    ), '[]'::jsonb),
    'venues', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', venue.id,
        'nameZh', venue.name_zh,
        'locationDescription', venue.location_description,
        'capacity', venue.capacity,
        'active', venue.is_active,
        'version', venue.version
      ) order by venue.name_zh)
      from public.training_venues venue
      where venue.property_id = p_property_id
    ), '[]'::jsonb),
    'trainers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', trainer.id,
        'type', trainer.trainer_type,
        'employeeId', trainer.employee_id,
        'displayName', trainer.display_name,
        'active', trainer.is_active,
        'version', trainer.version,
        'approvalCount', (
          select count(*)
          from public.trainer_course_approvals approval
          where approval.trainer_profile_id = trainer.id
        )
      ) order by trainer.display_name)
      from public.trainer_profiles trainer
      where trainer.property_id = p_property_id
    ), '[]'::jsonb),
    'trainerApprovals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', approval.id,
        'trainerProfileId', approval.trainer_profile_id,
        'courseVersionId', approval.course_version_id,
        'effectiveFrom', approval.effective_from,
        'effectiveTo', approval.effective_to,
        'evidenceNote', approval.evidence_note,
        'approvedBy', approval.approved_by
      ) order by approval.effective_from desc)
      from public.trainer_course_approvals approval
      where approval.property_id = p_property_id
    ), '[]'::jsonb),
    'referenceOptions', jsonb_build_object(
      'courseVersions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', version_row.id,
          'courseId', version_row.course_id,
          'nameZh', version_row.name_zh,
          'versionNumber', version_row.version_number,
          'durationMinutes', version_row.standard_duration_minutes
        ) order by version_row.name_zh)
        from public.course_versions version_row
        where version_row.property_id = p_property_id
          and version_row.lifecycle_state = 'published'
      ), '[]'::jsonb),
      'requirementVersions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', requirement_version.id,
          'requirementId', requirement_version.training_requirement_id,
          'nameZh', requirement_version.name_zh,
          'versionNumber', requirement_version.version_number,
          'effectiveFrom', requirement_version.effective_from,
          'effectiveTo', requirement_version.effective_to,
          'acceptedMethods', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', method.id,
              'labelZh', method.label_zh,
              'methodType', method.method_type,
              'courseVersionId', method.course_version_id
            ) order by method.sort_order, method.label_zh)
            from public.completion_definitions definition
            join public.accepted_learning_methods method
              on method.completion_definition_id = definition.id
            where definition.training_requirement_version_id =
              requirement_version.id
          ), '[]'::jsonb)
        ) order by requirement_version.name_zh)
        from public.training_requirement_versions requirement_version
        where requirement_version.property_id = p_property_id
          and requirement_version.lifecycle_state = 'effective'
      ), '[]'::jsonb),
      'departments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', department.id,
          'nameZh', department.name_zh,
          'parentId', department.parent_id,
          'depth', department.depth
        ) order by department.path_ids)
        from public.departments department
        where department.property_id = p_property_id
          and department.is_active
      ), '[]'::jsonb),
      'owners', coalesce((
        select jsonb_agg(jsonb_build_object(
          'roleAssignmentId', assignment.id,
          'userId', assignment.user_id,
          'displayName', profile.display_name,
          'roleCode', role.code,
          'roleNameZh', role.name_zh
        ) order by profile.display_name)
        from public.role_assignments assignment
        join public.roles role on role.id = assignment.role_id
        join public.profiles profile on profile.id = assignment.user_id
        where assignment.property_id = p_property_id
          and assignment.status = 'active'
          and role.is_active
          and role.code in (
            'property_ld_manager',
            'department_training_admin'
          )
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.read_department_training_operations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_property_id uuid;
begin
  selected_property_id := app_private.current_training_property();
  if selected_property_id is null
    or not app_private.is_training_department_actor(selected_property_id)
  then
    raise exception '仅部门培训负责人可以查看部门培训运营。'
      using errcode = '42501';
  end if;
  return jsonb_build_object(
    'propertyId', selected_property_id,
    'source', 'real',
    'boundary', jsonb_build_object(
      'planning', 'read_only_when_approved',
      'sessionReadiness', 'real',
      'participantSnapshots', 'real_after_publication',
      'attendance', 'unavailable',
      'completion', 'unavailable',
      'feedback', 'unavailable',
      'kpi', 'unavailable'
    ),
    'scope', coalesce((
      select jsonb_agg(jsonb_build_object(
        'departmentId', department.id,
        'departmentName', department.name_zh,
        'includeDescendants', scope.include_descendants,
        'breadcrumb', (
          select jsonb_agg(parent_department.name_zh order by closure.distance desc)
          from public.department_closure closure
          join public.departments parent_department
            on parent_department.id = closure.ancestor_department_id
          where closure.property_id = selected_property_id
            and closure.descendant_department_id = department.id
        )
      ) order by department.name_zh)
      from public.user_accounts account
      join public.role_assignments assignment
        on assignment.user_id = account.user_id
       and assignment.property_id = account.property_id
       and assignment.status = 'active'
      join public.roles role
        on role.id = assignment.role_id
       and role.code = 'department_training_admin'
       and role.is_active
      join public.trainer_scopes scope
        on scope.role_assignment_id = assignment.id
       and scope.is_active
      join public.departments department
        on department.id = scope.department_id
       and department.is_active
      where account.auth_user_id = auth.uid()
        and account.property_id = selected_property_id
        and account.account_status = 'active'
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(
        app_private.training_session_revision_document(revision.id)
        order by revision.starts_at, revision.revision_number
      )
      from public.training_sessions session_row
      join public.training_session_revisions revision
        on revision.training_session_id = session_row.id
       and (
         revision.id = session_row.current_revision_id
         or revision.lifecycle_state = 'draft'
       )
      where session_row.property_id = selected_property_id
        and app_private.has_authorized_department_scope(
          selected_property_id,
          session_row.owning_department_id
        )
    ), '[]'::jsonb),
    'participantCandidates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'employeeId', employee.id,
        'employeeNumber', employee.employee_number,
        'employeeName', coalesce(
          nullif(employee.name_zh, ''),
          nullif(employee.name_en, ''),
          '姓名未提供'
        ),
        'departmentId', employee.department_id,
        'departmentName', department.name_zh
      ) order by employee.employee_number)
      from public.employees employee
      join public.departments department
        on department.id = employee.department_id
      where employee.property_id = selected_property_id
        and employee.is_active
        and app_private.has_authorized_department_scope(
          selected_property_id,
          employee.department_id
        )
    ), '[]'::jsonb),
    'referenceOptions', jsonb_build_object(
      'courseVersions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', version_row.id,
          'nameZh', version_row.name_zh,
          'versionNumber', version_row.version_number,
          'durationMinutes', version_row.standard_duration_minutes
        ) order by version_row.name_zh)
        from public.course_versions version_row
        where version_row.property_id = selected_property_id
          and version_row.lifecycle_state = 'published'
      ), '[]'::jsonb),
      'requirements', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', requirement_version.id,
          'nameZh', requirement_version.name_zh,
          'versionNumber', requirement_version.version_number,
          'acceptedMethods', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', method.id,
              'labelZh', method.label_zh,
              'methodType', method.method_type,
              'courseVersionId', method.course_version_id
            ) order by method.sort_order, method.label_zh)
            from public.completion_definitions definition
            join public.accepted_learning_methods method
              on method.completion_definition_id = definition.id
            where definition.training_requirement_version_id =
              requirement_version.id
          ), '[]'::jsonb)
        ) order by requirement_version.name_zh)
        from public.training_requirement_versions requirement_version
        where requirement_version.property_id = selected_property_id
          and requirement_version.lifecycle_state = 'effective'
      ), '[]'::jsonb),
      'departments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', department.id,
          'nameZh', department.name_zh,
          'parentId', department.parent_id,
          'depth', department.depth
        ) order by department.path_ids)
        from public.departments department
        where department.property_id = selected_property_id
          and department.is_active
          and app_private.has_authorized_department_scope(
            selected_property_id,
            department.id
          )
      ), '[]'::jsonb),
      'owners', coalesce((
        select jsonb_agg(jsonb_build_object(
          'roleAssignmentId', assignment.id,
          'userId', assignment.user_id,
          'displayName', profile.display_name,
          'roleCode', role.code,
          'roleNameZh', role.name_zh
        ))
        from public.user_accounts account
        join public.role_assignments assignment
          on assignment.user_id = account.user_id
         and assignment.property_id = account.property_id
         and assignment.status = 'active'
        join public.roles role
          on role.id = assignment.role_id
         and role.code = 'department_training_admin'
         and role.is_active
        join public.profiles profile on profile.id = assignment.user_id
        where account.auth_user_id = auth.uid()
          and account.property_id = selected_property_id
          and account.account_status = 'active'
      ), '[]'::jsonb),
      'venues', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', venue.id,
          'nameZh', venue.name_zh,
          'locationDescription', venue.location_description,
          'capacity', venue.capacity,
          'active', venue.is_active,
          'version', venue.version
        ) order by venue.name_zh)
        from public.training_venues venue
        where venue.property_id = selected_property_id
          and venue.is_active
      ), '[]'::jsonb),
      'trainers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', trainer.id,
          'type', trainer.trainer_type,
          'employeeId', trainer.employee_id,
          'displayName', trainer.display_name,
          'active', trainer.is_active,
          'version', trainer.version
        ) order by trainer.display_name)
        from public.trainer_profiles trainer
        where trainer.property_id = selected_property_id
          and trainer.is_active
      ), '[]'::jsonb),
      'trainerApprovals', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', approval.id,
          'trainerProfileId', approval.trainer_profile_id,
          'courseVersionId', approval.course_version_id,
          'effectiveFrom', approval.effective_from,
          'effectiveTo', approval.effective_to,
          'evidenceNote', approval.evidence_note,
          'approvedBy', approval.approved_by
        ))
        from public.trainer_course_approvals approval
        where approval.property_id = selected_property_id
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- Narrow RPC grants only. -------------------------------------------------

revoke all on function
  public.read_training_operations_foundation(uuid),
  public.read_department_training_operations(),
  public.save_training_plan_version_draft(uuid,jsonb,bigint),
  public.transition_training_plan_version(uuid,text,bigint,text),
  public.save_training_session_revision_draft(uuid,jsonb,bigint),
  public.save_department_training_session_revision_draft(jsonb,bigint),
  public.preview_training_session_participants(uuid,jsonb),
  public.preview_department_training_session_participants(uuid),
  public.publish_training_session_revision(uuid,bigint),
  public.cancel_training_session(uuid,bigint,text),
  public.save_training_venue(uuid,jsonb,bigint),
  public.save_trainer_profile(uuid,jsonb,bigint)
from public, anon;

grant execute on function
  public.read_training_operations_foundation(uuid),
  public.read_department_training_operations(),
  public.save_training_plan_version_draft(uuid,jsonb,bigint),
  public.transition_training_plan_version(uuid,text,bigint,text),
  public.save_training_session_revision_draft(uuid,jsonb,bigint),
  public.save_department_training_session_revision_draft(jsonb,bigint),
  public.preview_training_session_participants(uuid,jsonb),
  public.preview_department_training_session_participants(uuid),
  public.publish_training_session_revision(uuid,bigint),
  public.cancel_training_session(uuid,bigint,text),
  public.save_training_venue(uuid,jsonb,bigint),
  public.save_trainer_profile(uuid,jsonb,bigint)
to authenticated;

revoke all on function
  app_private.build_session_participant_preview(uuid),
  app_private.training_session_revision_document(uuid)
from public, anon, authenticated;

comment on table public.training_plans is
  'D2 stable Training Plan identity; no Session or attendance is implied.';
comment on table public.training_plan_versions is
  'D2 versioned planning decision. Approved definitions are immutable.';
comment on table public.training_sessions is
  'D2 stable scheduled Session identity. It is not attendance or completion.';
comment on table public.training_session_revisions is
  'D2 immutable publication-time schedule and readiness definition.';
comment on table public.session_participant_snapshots is
  'Publication-time candidate and selected participant evidence, pinned to D0 Employee Fact Versions.';
comment on table public.attendance_preparation_configs is
  'Configuration boundary only. It creates no attendance record or QR token.';
