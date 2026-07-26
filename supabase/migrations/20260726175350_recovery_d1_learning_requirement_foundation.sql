-- Recovery D1: deterministic Learning Requirement Foundation.
-- This migration creates no assignment, plan, session, attendance, completion,
-- feedback, KPI, forecast, health, risk, intervention, or AI facts.

create extension if not exists btree_gist with schema extensions;

-- Stable identities -------------------------------------------------------

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  code text not null,
  name_zh text not null,
  name_en text,
  is_active boolean not null default true,
  version bigint not null default 1,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint courses_property_scope_fkey
    foreign key (property_id, tenant_id)
    references public.properties(id, tenant_id) on delete restrict,
  constraint courses_scope_key unique (id, tenant_id, property_id),
  constraint courses_property_code_key unique (property_id, code),
  constraint courses_code_check check (
    code = upper(code)
    and code ~ '^[A-Z0-9]+(?:-[A-Z0-9]+)*$'
  ),
  constraint courses_name_check check (
    btrim(name_zh) <> ''
    and (name_en is null or btrim(name_en) <> '')
  ),
  constraint courses_version_check check (version > 0)
);

create table public.course_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  course_id uuid not null,
  version_number integer not null,
  lifecycle_state text not null default 'draft',
  name_zh text not null,
  name_en text,
  description text not null,
  outline text not null,
  learning_material_version text not null,
  standard_duration_minutes integer not null,
  learning_objectives text[] not null,
  capability_tags text[] not null default '{}',
  assessment_criteria text not null,
  change_reason text not null,
  continuity_rationale text not null,
  impact_review_required boolean not null default false,
  impact_note text,
  version bigint not null default 1,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  retired_by uuid references auth.users(id) on delete set null,
  retired_at timestamptz,
  retirement_reason text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_versions_course_scope_fkey
    foreign key (course_id, tenant_id, property_id)
    references public.courses(id, tenant_id, property_id) on delete restrict,
  constraint course_versions_scope_key unique (id, tenant_id, property_id),
  constraint course_versions_lineage_key unique (course_id, version_number),
  constraint course_versions_number_check check (version_number > 0),
  constraint course_versions_state_check check (
    lifecycle_state in ('draft', 'review', 'published', 'retired')
  ),
  constraint course_versions_content_check check (
    btrim(name_zh) <> ''
    and btrim(description) <> ''
    and btrim(outline) <> ''
    and btrim(learning_material_version) <> ''
    and standard_duration_minutes > 0
  ),
  constraint course_versions_capability_check check (
    cardinality(learning_objectives) > 0
    and btrim(assessment_criteria) <> ''
  ),
  constraint course_versions_continuity_check check (
    btrim(change_reason) <> ''
    and btrim(continuity_rationale) <> ''
    and (not impact_review_required or btrim(coalesce(impact_note, '')) <> '')
  ),
  constraint course_versions_version_check check (version > 0),
  constraint course_versions_retirement_check check (
    lifecycle_state <> 'retired'
    or (
      retired_at is not null
      and btrim(coalesce(retirement_reason, '')) <> ''
    )
  )
);

create index course_versions_property_state_idx
  on public.course_versions(property_id, lifecycle_state, updated_at desc);
create index course_versions_created_by_idx
  on public.course_versions(created_by);
create index course_versions_updated_by_idx
  on public.course_versions(updated_by);
create index course_versions_reviewed_by_idx
  on public.course_versions(reviewed_by);
create index course_versions_published_by_idx
  on public.course_versions(published_by);
create index course_versions_retired_by_idx
  on public.course_versions(retired_by);
create index courses_created_by_idx on public.courses(created_by);
create index courses_updated_by_idx on public.courses(updated_by);

create table public.training_requirements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  code text not null,
  name_zh text not null,
  name_en text,
  is_active boolean not null default true,
  version bigint not null default 1,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint requirements_property_scope_fkey
    foreign key (property_id, tenant_id)
    references public.properties(id, tenant_id) on delete restrict,
  constraint requirements_scope_key unique (id, tenant_id, property_id),
  constraint requirements_property_code_key unique (property_id, code),
  constraint requirements_code_check check (
    code = upper(code)
    and code ~ '^[A-Z0-9]+(?:-[A-Z0-9]+)*$'
  ),
  constraint requirements_name_check check (
    btrim(name_zh) <> ''
    and (name_en is null or btrim(name_en) <> '')
  ),
  constraint requirements_version_check check (version > 0)
);

create table public.training_requirement_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  training_requirement_id uuid not null,
  version_number integer not null,
  lifecycle_state text not null default 'draft',
  name_zh text not null,
  name_en text,
  purpose text not null,
  obligation_explanation text not null,
  effective_from date not null,
  effective_to date,
  change_reason text not null,
  continuity_rationale text not null,
  version bigint not null default 1,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  effective_by uuid references auth.users(id) on delete set null,
  effective_at timestamptz,
  superseded_by_version_id uuid,
  superseded_at timestamptz,
  retired_by uuid references auth.users(id) on delete set null,
  retired_at timestamptz,
  retirement_reason text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint requirement_versions_requirement_scope_fkey
    foreign key (training_requirement_id, tenant_id, property_id)
    references public.training_requirements(id, tenant_id, property_id)
    on delete restrict,
  constraint requirement_versions_scope_key
    unique (id, tenant_id, property_id),
  constraint requirement_versions_lineage_key
    unique (training_requirement_id, version_number),
  constraint requirement_versions_number_check check (version_number > 0),
  constraint requirement_versions_state_check check (
    lifecycle_state in (
      'draft', 'approved', 'effective', 'superseded', 'retired'
    )
  ),
  constraint requirement_versions_definition_check check (
    btrim(name_zh) <> ''
    and btrim(purpose) <> ''
    and btrim(obligation_explanation) <> ''
    and btrim(change_reason) <> ''
    and btrim(continuity_rationale) <> ''
  ),
  constraint requirement_versions_dates_check check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint requirement_versions_version_check check (version > 0),
  constraint requirement_versions_retirement_check check (
    lifecycle_state <> 'retired'
    or (
      retired_at is not null
      and btrim(coalesce(retirement_reason, '')) <> ''
    )
  )
);

alter table public.training_requirement_versions
  add constraint requirement_versions_superseded_fkey
  foreign key (superseded_by_version_id)
  references public.training_requirement_versions(id) on delete restrict;

create unique index requirement_versions_one_effective_idx
  on public.training_requirement_versions(training_requirement_id)
  where lifecycle_state = 'effective';
create index requirement_versions_property_state_idx
  on public.training_requirement_versions(
    property_id,
    lifecycle_state,
    effective_from
  );
create index requirement_versions_superseded_by_idx
  on public.training_requirement_versions(superseded_by_version_id);
create index requirement_versions_created_by_idx
  on public.training_requirement_versions(created_by);
create index requirement_versions_updated_by_idx
  on public.training_requirement_versions(updated_by);
create index requirement_versions_approved_by_idx
  on public.training_requirement_versions(approved_by);
create index requirement_versions_effective_by_idx
  on public.training_requirement_versions(effective_by);
create index requirement_versions_retired_by_idx
  on public.training_requirement_versions(retired_by);
create index requirements_created_by_idx
  on public.training_requirements(created_by);
create index requirements_updated_by_idx
  on public.training_requirements(updated_by);

-- Completion, timing and explicit applicability --------------------------

create table public.completion_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  training_requirement_version_id uuid not null,
  satisfaction_operator text not null default 'any_one',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint completion_definitions_version_scope_fkey
    foreign key (training_requirement_version_id, tenant_id, property_id)
    references public.training_requirement_versions(id, tenant_id, property_id)
    on delete cascade,
  constraint completion_definitions_scope_key
    unique (id, tenant_id, property_id),
  constraint completion_definitions_version_key
    unique (training_requirement_version_id),
  constraint completion_definitions_operator_check check (
    satisfaction_operator = 'any_one'
  )
);

create table public.accepted_learning_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  completion_definition_id uuid not null,
  method_type text not null,
  label_zh text not null,
  course_version_id uuid,
  certificate_type text,
  issuer_criteria text,
  evidence_description text,
  validity_months integer,
  assessment_name text,
  pass_criteria text,
  approval_standard text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint accepted_methods_definition_scope_fkey
    foreign key (completion_definition_id, tenant_id, property_id)
    references public.completion_definitions(id, tenant_id, property_id)
    on delete cascade,
  constraint accepted_methods_course_scope_fkey
    foreign key (course_version_id, tenant_id, property_id)
    references public.course_versions(id, tenant_id, property_id)
    on delete restrict,
  constraint accepted_methods_scope_key unique (id, tenant_id, property_id),
  constraint accepted_methods_type_check check (
    method_type in (
      'course_version',
      'external_certificate',
      'assessment',
      'manager_equivalency'
    )
  ),
  constraint accepted_methods_label_check check (btrim(label_zh) <> ''),
  constraint accepted_methods_validity_check check (
    validity_months is null or validity_months > 0
  ),
  constraint accepted_methods_subtype_check check (
    (
      method_type = 'course_version'
      and course_version_id is not null
      and certificate_type is null
      and issuer_criteria is null
      and evidence_description is null
      and validity_months is null
      and assessment_name is null
      and pass_criteria is null
      and approval_standard is null
    )
    or (
      method_type = 'external_certificate'
      and course_version_id is null
      and btrim(coalesce(certificate_type, '')) <> ''
      and btrim(coalesce(issuer_criteria, '')) <> ''
      and btrim(coalesce(evidence_description, '')) <> ''
      and assessment_name is null
      and pass_criteria is null
      and approval_standard is null
    )
    or (
      method_type = 'assessment'
      and course_version_id is null
      and certificate_type is null
      and issuer_criteria is null
      and validity_months is null
      and btrim(coalesce(assessment_name, '')) <> ''
      and btrim(coalesce(evidence_description, '')) <> ''
      and btrim(coalesce(pass_criteria, '')) <> ''
      and approval_standard is null
    )
    or (
      method_type = 'manager_equivalency'
      and course_version_id is null
      and certificate_type is null
      and issuer_criteria is null
      and validity_months is null
      and assessment_name is null
      and pass_criteria is null
      and btrim(coalesce(evidence_description, '')) <> ''
      and btrim(coalesce(approval_standard, '')) <> ''
    )
  )
);
create index accepted_methods_definition_idx
  on public.accepted_learning_methods(completion_definition_id);
create index accepted_methods_course_version_idx
  on public.accepted_learning_methods(course_version_id);

create table public.requirement_timing_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  training_requirement_version_id uuid not null,
  timing_type text not null,
  due_date date,
  due_within_days integer,
  recurrence_period text,
  interval_months integer,
  anchor_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint timing_version_scope_fkey
    foreign key (training_requirement_version_id, tenant_id, property_id)
    references public.training_requirement_versions(id, tenant_id, property_id)
    on delete cascade,
  constraint timing_scope_key unique (id, tenant_id, property_id),
  constraint timing_version_key unique (training_requirement_version_id),
  constraint timing_type_check check (
    timing_type in (
      'fixed_date',
      'hire_relative',
      'calendar_recurrence',
      'interval_months'
    )
  ),
  constraint timing_shape_check check (
    (
      timing_type = 'fixed_date'
      and due_date is not null
      and due_within_days is null
      and recurrence_period is null
      and interval_months is null
      and anchor_date is null
    )
    or (
      timing_type = 'hire_relative'
      and due_date is null
      and due_within_days > 0
      and recurrence_period is null
      and interval_months is null
      and anchor_date is null
    )
    or (
      timing_type = 'calendar_recurrence'
      and due_date is null
      and due_within_days is null
      and recurrence_period in ('month', 'quarter', 'year')
      and interval_months is null
      and anchor_date is null
    )
    or (
      timing_type = 'interval_months'
      and due_date is null
      and due_within_days is null
      and recurrence_period is null
      and interval_months > 0
      and anchor_date is not null
    )
  )
);

create table public.eligibility_rule_sets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  training_requirement_version_id uuid not null,
  effective_from date not null,
  effective_to date,
  audience_mode text not null,
  new_employee_condition text not null default 'not_evaluated',
  employment_statuses public.employee_employment_status[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint eligibility_rules_version_scope_fkey
    foreign key (training_requirement_version_id, tenant_id, property_id)
    references public.training_requirement_versions(id, tenant_id, property_id)
    on delete cascade,
  constraint eligibility_rules_scope_key unique (id, tenant_id, property_id),
  constraint eligibility_rules_dates_check check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint eligibility_rules_audience_check check (
    audience_mode in ('all_employees', 'structured_scope')
  ),
  constraint eligibility_rules_new_employee_check check (
    new_employee_condition in ('required', 'excluded', 'not_evaluated')
  ),
  constraint eligibility_rules_statuses_check check (
    cardinality(employment_statuses) > 0
  ),
  constraint eligibility_rules_no_period_overlap exclude using gist (
    training_requirement_version_id with =,
    daterange(
      effective_from,
      coalesce(effective_to, 'infinity'::date),
      '[]'
    ) with &&
  )
);

create table public.eligibility_rule_departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  eligibility_rule_set_id uuid not null,
  department_id uuid not null,
  include_descendants boolean not null default false,
  created_at timestamptz not null default now(),
  constraint eligibility_rule_departments_rule_scope_fkey
    foreign key (eligibility_rule_set_id, tenant_id, property_id)
    references public.eligibility_rule_sets(id, tenant_id, property_id)
    on delete cascade,
  constraint eligibility_rule_departments_department_scope_fkey
    foreign key (department_id, tenant_id, property_id)
    references public.departments(id, tenant_id, property_id)
    on delete restrict,
  constraint eligibility_rule_departments_scope_key
    unique (id, tenant_id, property_id),
  constraint eligibility_rule_departments_term_key
    unique (eligibility_rule_set_id, department_id)
);
create index eligibility_rule_departments_department_idx
  on public.eligibility_rule_departments(department_id);

create table public.eligibility_rule_positions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  eligibility_rule_set_id uuid not null,
  position_id uuid not null,
  created_at timestamptz not null default now(),
  constraint eligibility_rule_positions_rule_scope_fkey
    foreign key (eligibility_rule_set_id, tenant_id, property_id)
    references public.eligibility_rule_sets(id, tenant_id, property_id)
    on delete cascade,
  constraint eligibility_rule_positions_position_scope_fkey
    foreign key (position_id, tenant_id, property_id)
    references public.positions(id, tenant_id, property_id) on delete restrict,
  constraint eligibility_rule_positions_scope_key
    unique (id, tenant_id, property_id),
  constraint eligibility_rule_positions_term_key
    unique (eligibility_rule_set_id, position_id)
);
create index eligibility_rule_positions_position_idx
  on public.eligibility_rule_positions(position_id);

create table public.eligibility_rule_position_families (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  eligibility_rule_set_id uuid not null,
  position_family_id uuid not null,
  created_at timestamptz not null default now(),
  constraint eligibility_rule_families_rule_scope_fkey
    foreign key (eligibility_rule_set_id, tenant_id, property_id)
    references public.eligibility_rule_sets(id, tenant_id, property_id)
    on delete cascade,
  constraint eligibility_rule_families_family_scope_fkey
    foreign key (position_family_id, tenant_id, property_id)
    references public.position_families(id, tenant_id, property_id)
    on delete restrict,
  constraint eligibility_rule_families_scope_key
    unique (id, tenant_id, property_id),
  constraint eligibility_rule_families_term_key
    unique (eligibility_rule_set_id, position_family_id)
);
create index eligibility_rule_families_family_idx
  on public.eligibility_rule_position_families(position_family_id);

create table public.learning_requirement_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  aggregate_version_id uuid,
  action text not null,
  reason text not null,
  before_evidence jsonb,
  after_evidence jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  constraint learning_requirement_audit_property_scope_fkey
    foreign key (property_id, tenant_id)
    references public.properties(id, tenant_id) on delete restrict,
  constraint learning_requirement_audit_type_check check (
    aggregate_type in ('course', 'requirement')
  ),
  constraint learning_requirement_audit_action_check check (
    btrim(action) <> '' and btrim(reason) <> ''
  ),
  constraint learning_requirement_audit_evidence_check check (
    (before_evidence is null or jsonb_typeof(before_evidence) = 'object')
    and (after_evidence is null or jsonb_typeof(after_evidence) = 'object')
  )
);

create index learning_requirement_audit_property_idx
  on public.learning_requirement_audit_events(
    property_id,
    aggregate_type,
    aggregate_id,
    occurred_at desc
  );
create index learning_requirement_audit_actor_idx
  on public.learning_requirement_audit_events(actor_id);

-- No table is a client mutation or broad read boundary. ------------------

alter table public.courses enable row level security;
alter table public.courses force row level security;
alter table public.course_versions enable row level security;
alter table public.course_versions force row level security;
alter table public.training_requirements enable row level security;
alter table public.training_requirements force row level security;
alter table public.training_requirement_versions enable row level security;
alter table public.training_requirement_versions force row level security;
alter table public.completion_definitions enable row level security;
alter table public.completion_definitions force row level security;
alter table public.accepted_learning_methods enable row level security;
alter table public.accepted_learning_methods force row level security;
alter table public.requirement_timing_definitions enable row level security;
alter table public.requirement_timing_definitions force row level security;
alter table public.eligibility_rule_sets enable row level security;
alter table public.eligibility_rule_sets force row level security;
alter table public.eligibility_rule_departments enable row level security;
alter table public.eligibility_rule_departments force row level security;
alter table public.eligibility_rule_positions enable row level security;
alter table public.eligibility_rule_positions force row level security;
alter table public.eligibility_rule_position_families enable row level security;
alter table public.eligibility_rule_position_families force row level security;
alter table public.learning_requirement_audit_events enable row level security;
alter table public.learning_requirement_audit_events force row level security;

revoke all on
  public.courses,
  public.course_versions,
  public.training_requirements,
  public.training_requirement_versions,
  public.completion_definitions,
  public.accepted_learning_methods,
  public.requirement_timing_definitions,
  public.eligibility_rule_sets,
  public.eligibility_rule_departments,
  public.eligibility_rule_positions,
  public.eligibility_rule_position_families,
  public.learning_requirement_audit_events
from public, anon, authenticated;

-- Private guards, immutable definitions and evidence ---------------------

create or replace function app_private.assert_learning_requirement_manager(
  p_property_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception '请先登录。' using errcode = '42501';
  end if;
  if not app_private.is_authorized_property_role(
    p_property_id,
    'property_ld_manager'
  ) then
    raise exception '仅酒店学习与发展经理可以维护培训要求。'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function app_private.reject_learning_requirement_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '培训要求审计记录为只增证据，不能修改或删除。'
    using errcode = '42501';
end;
$$;

create trigger learning_requirement_audit_append_only
before update or delete on public.learning_requirement_audit_events
for each row execute function
  app_private.reject_learning_requirement_audit_mutation();

create or replace function app_private.protect_course_version_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.lifecycle_state in ('published', 'retired') and (
    new.tenant_id is distinct from old.tenant_id
    or new.property_id is distinct from old.property_id
    or new.course_id is distinct from old.course_id
    or new.version_number is distinct from old.version_number
    or new.name_zh is distinct from old.name_zh
    or new.name_en is distinct from old.name_en
    or new.description is distinct from old.description
    or new.outline is distinct from old.outline
    or new.learning_material_version is distinct from old.learning_material_version
    or new.standard_duration_minutes is distinct from old.standard_duration_minutes
    or new.learning_objectives is distinct from old.learning_objectives
    or new.capability_tags is distinct from old.capability_tags
    or new.assessment_criteria is distinct from old.assessment_criteria
    or new.change_reason is distinct from old.change_reason
    or new.continuity_rationale is distinct from old.continuity_rationale
    or new.impact_review_required is distinct from old.impact_review_required
    or new.impact_note is distinct from old.impact_note
  ) then
    raise exception '已发布课程版本不可修改；请创建新版本。'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger course_versions_protect_definition
before update on public.course_versions
for each row execute function app_private.protect_course_version_definition();

create or replace function app_private.assert_requirement_children_mutable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  requirement_version_id uuid;
  state text;
begin
  if tg_table_name in (
    'completion_definitions',
    'requirement_timing_definitions',
    'eligibility_rule_sets'
  ) then
    requirement_version_id := coalesce(
      new.training_requirement_version_id,
      old.training_requirement_version_id
    );
  elsif tg_table_name = 'accepted_learning_methods' then
    select definition.training_requirement_version_id
    into requirement_version_id
    from public.completion_definitions definition
    where definition.id = coalesce(
      new.completion_definition_id,
      old.completion_definition_id
    );
  else
    select rule_set.training_requirement_version_id
    into requirement_version_id
    from public.eligibility_rule_sets rule_set
    where rule_set.id = coalesce(
      new.eligibility_rule_set_id,
      old.eligibility_rule_set_id
    );
  end if;

  select version_row.lifecycle_state into state
  from public.training_requirement_versions version_row
  where version_row.id = requirement_version_id;

  if state is distinct from 'draft' then
    raise exception '已批准或已生效的培训要求版本不可修改；请创建新版本。'
      using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger completion_definitions_mutable_draft
before insert or update or delete on public.completion_definitions
for each row execute function app_private.assert_requirement_children_mutable();
create trigger accepted_methods_mutable_draft
before insert or update or delete on public.accepted_learning_methods
for each row execute function app_private.assert_requirement_children_mutable();
create trigger timing_definitions_mutable_draft
before insert or update or delete on public.requirement_timing_definitions
for each row execute function app_private.assert_requirement_children_mutable();
create trigger eligibility_rule_sets_mutable_draft
before insert or update or delete on public.eligibility_rule_sets
for each row execute function app_private.assert_requirement_children_mutable();
create trigger eligibility_rule_departments_mutable_draft
before insert or update or delete on public.eligibility_rule_departments
for each row execute function app_private.assert_requirement_children_mutable();
create trigger eligibility_rule_positions_mutable_draft
before insert or update or delete on public.eligibility_rule_positions
for each row execute function app_private.assert_requirement_children_mutable();
create trigger eligibility_rule_families_mutable_draft
before insert or update or delete
on public.eligibility_rule_position_families
for each row execute function app_private.assert_requirement_children_mutable();

create or replace function app_private.protect_requirement_version_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.lifecycle_state <> 'draft' and (
    new.tenant_id is distinct from old.tenant_id
    or new.property_id is distinct from old.property_id
    or new.training_requirement_id is distinct from old.training_requirement_id
    or new.version_number is distinct from old.version_number
    or new.name_zh is distinct from old.name_zh
    or new.name_en is distinct from old.name_en
    or new.purpose is distinct from old.purpose
    or new.obligation_explanation is distinct from old.obligation_explanation
    or new.effective_from is distinct from old.effective_from
    or new.effective_to is distinct from old.effective_to
    or new.change_reason is distinct from old.change_reason
    or new.continuity_rationale is distinct from old.continuity_rationale
  ) then
    raise exception '已批准或已生效的培训要求版本不可修改；请创建新版本。'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger requirement_versions_protect_definition
before update on public.training_requirement_versions
for each row execute function
  app_private.protect_requirement_version_definition();

-- Authoritative JSON projections -----------------------------------------

create or replace function app_private.course_version_document(
  p_course_version_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', version_row.id,
    'courseId', course.id,
    'propertyId', course.property_id,
    'code', course.code,
    'nameZh', version_row.name_zh,
    'nameEn', version_row.name_en,
    'description', version_row.description,
    'outline', version_row.outline,
    'learningMaterialVersion', version_row.learning_material_version,
    'standardDurationMinutes', version_row.standard_duration_minutes,
    'learningObjectives', to_jsonb(version_row.learning_objectives),
    'capabilityTags', to_jsonb(version_row.capability_tags),
    'assessmentCriteria', version_row.assessment_criteria,
    'changeReason', version_row.change_reason,
    'continuityRationale', version_row.continuity_rationale,
    'impactReviewRequired', version_row.impact_review_required,
    'impactNote', version_row.impact_note,
    'versionNumber', version_row.version_number,
    'state', version_row.lifecycle_state,
    'identityVersion', course.version,
    'expectedVersion', version_row.version,
    'createdAt', version_row.created_at,
    'updatedAt', version_row.updated_at
  )
  from public.course_versions version_row
  join public.courses course on course.id = version_row.course_id
  where version_row.id = p_course_version_id;
$$;

create or replace function app_private.requirement_version_document(
  p_requirement_version_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', version_row.id,
    'requirementId', requirement.id,
    'propertyId', requirement.property_id,
    'code', requirement.code,
    'nameZh', version_row.name_zh,
    'nameEn', version_row.name_en,
    'purpose', version_row.purpose,
    'obligationExplanation', version_row.obligation_explanation,
    'effectiveFrom', version_row.effective_from,
    'effectiveTo', version_row.effective_to,
    'changeReason', version_row.change_reason,
    'continuityRationale', version_row.continuity_rationale,
    'versionNumber', version_row.version_number,
    'state', version_row.lifecycle_state,
    'identityVersion', requirement.version,
    'expectedVersion', version_row.version,
    'timing', jsonb_strip_nulls(jsonb_build_object(
      'type', timing.timing_type,
      'dueDate', timing.due_date,
      'dueWithinDays', timing.due_within_days,
      'period', timing.recurrence_period,
      'intervalMonths', timing.interval_months,
      'anchorDate', timing.anchor_date
    )),
    'completionDefinition', jsonb_build_object(
      'satisfactionOperator', definition.satisfaction_operator,
      'methods', coalesce(methods.items, '[]'::jsonb)
    ),
    'ruleSets', coalesce(rule_sets.items, '[]'::jsonb),
    'createdAt', version_row.created_at,
    'updatedAt', version_row.updated_at
  )
  from public.training_requirement_versions version_row
  join public.training_requirements requirement
    on requirement.id = version_row.training_requirement_id
  left join public.completion_definitions definition
    on definition.training_requirement_version_id = version_row.id
  left join public.requirement_timing_definitions timing
    on timing.training_requirement_version_id = version_row.id
  left join lateral (
    select jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'id', method.id,
        'type', method.method_type,
        'labelZh', method.label_zh,
        'courseVersionId', method.course_version_id,
        'certificateType', method.certificate_type,
        'issuerCriteria', method.issuer_criteria,
        'evidenceDescription', method.evidence_description,
        'validityMonths', method.validity_months,
        'assessmentName', method.assessment_name,
        'passCriteria', method.pass_criteria,
        'approvalStandard', method.approval_standard
      ))
      order by method.sort_order, method.created_at
    ) as items
    from public.accepted_learning_methods method
    where method.completion_definition_id = definition.id
  ) methods on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', rule_set.id,
        'effectiveFrom', rule_set.effective_from,
        'effectiveTo', rule_set.effective_to,
        'audienceMode', rule_set.audience_mode,
        'newEmployeeCondition', rule_set.new_employee_condition,
        'employmentStatuses', to_jsonb(rule_set.employment_statuses),
        'departments', coalesce(departments.items, '[]'::jsonb),
        'positionIds', coalesce(positions.items, '[]'::jsonb),
        'positionFamilyIds', coalesce(families.items, '[]'::jsonb)
      )
      order by rule_set.effective_from
    ) as items
    from public.eligibility_rule_sets rule_set
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'departmentId', term.department_id,
        'includeDescendants', term.include_descendants
      ) order by term.created_at) as items
      from public.eligibility_rule_departments term
      where term.eligibility_rule_set_id = rule_set.id
    ) departments on true
    left join lateral (
      select jsonb_agg(term.position_id order by term.created_at) as items
      from public.eligibility_rule_positions term
      where term.eligibility_rule_set_id = rule_set.id
    ) positions on true
    left join lateral (
      select jsonb_agg(term.position_family_id order by term.created_at)
        as items
      from public.eligibility_rule_position_families term
      where term.eligibility_rule_set_id = rule_set.id
    ) families on true
    where rule_set.training_requirement_version_id = version_row.id
  ) rule_sets on true
  where version_row.id = p_requirement_version_id
  group by
    version_row.id,
    requirement.id,
    requirement.property_id,
    requirement.code,
    definition.satisfaction_operator,
    timing.timing_type,
    timing.due_date,
    timing.due_within_days,
    timing.recurrence_period,
    timing.interval_months,
    timing.anchor_date,
    methods.items,
    rule_sets.items;
$$;

-- Manager reads and transactional draft writes ---------------------------

create or replace function public.read_learning_requirement_foundation(
  p_property_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform app_private.assert_learning_requirement_manager(p_property_id);
  select jsonb_build_object(
    'propertyId', p_property_id,
    'source', 'real',
    'courses', coalesce((
      select jsonb_agg(app_private.course_version_document(version_row.id)
        order by course.code, version_row.version_number desc)
      from public.courses course
      join public.course_versions version_row
        on version_row.course_id = course.id
      where course.property_id = p_property_id
    ), '[]'::jsonb),
    'requirements', coalesce((
      select jsonb_agg(
        app_private.requirement_version_document(version_row.id)
        order by requirement.code, version_row.version_number desc
      )
      from public.training_requirements requirement
      join public.training_requirement_versions version_row
        on version_row.training_requirement_id = requirement.id
      where requirement.property_id = p_property_id
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.save_course_version_draft(
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
  property_tenant_id uuid;
  selected_course_id uuid := nullif(p_payload->>'courseId', '')::uuid;
  selected_version_id uuid :=
    nullif(p_payload->>'courseVersionId', '')::uuid;
  selected_course public.courses;
  selected_version public.course_versions;
  version_number integer;
  before_document jsonb;
begin
  perform app_private.assert_learning_requirement_manager(p_property_id);
  select property.tenant_id into property_tenant_id
  from public.properties property
  where property.id = p_property_id;

  if selected_version_id is not null then
    select * into selected_version
    from public.course_versions version_row
    where version_row.id = selected_version_id
      and version_row.property_id = p_property_id
    for update;
    if not found then raise exception '未找到课程版本。' using errcode = 'P0002'; end if;
    if selected_version.lifecycle_state <> 'draft' then
      raise exception '仅草稿课程版本可以编辑。' using errcode = '23514';
    end if;
    if selected_version.version <> p_expected_version then
      raise exception '课程版本已被其他用户更新，请重新读取后重试。'
        using errcode = '40001';
    end if;
    before_document := app_private.course_version_document(selected_version_id);
    selected_course_id := selected_version.course_id;
    update public.course_versions set
      name_zh = btrim(p_payload->>'nameZh'),
      name_en = nullif(btrim(p_payload->>'nameEn'), ''),
      description = btrim(p_payload->>'description'),
      outline = btrim(p_payload->>'outline'),
      learning_material_version = btrim(
        p_payload->>'learningMaterialVersion'
      ),
      standard_duration_minutes =
        (p_payload->>'standardDurationMinutes')::integer,
      learning_objectives = array(
        select jsonb_array_elements_text(p_payload->'learningObjectives')
      ),
      capability_tags = array(
        select jsonb_array_elements_text(
          coalesce(p_payload->'capabilityTags', '[]'::jsonb)
        )
      ),
      assessment_criteria = btrim(p_payload->>'assessmentCriteria'),
      change_reason = btrim(p_payload->>'changeReason'),
      continuity_rationale = btrim(p_payload->>'continuityRationale'),
      impact_review_required = coalesce(
        (p_payload->>'impactReviewRequired')::boolean,
        false
      ),
      impact_note = nullif(btrim(p_payload->>'impactNote'), ''),
      version = version + 1,
      updated_by = auth.uid(),
      updated_at = now()
    where id = selected_version_id;
  else
    if selected_course_id is null then
      insert into public.courses(
        tenant_id,
        property_id,
        code,
        name_zh,
        name_en
      ) values (
        property_tenant_id,
        p_property_id,
        upper(btrim(p_payload->>'code')),
        btrim(p_payload->>'nameZh'),
        nullif(btrim(p_payload->>'nameEn'), '')
      ) returning * into selected_course;
      selected_course_id := selected_course.id;
      version_number := 1;
    else
      select * into selected_course
      from public.courses course
      where course.id = selected_course_id
        and course.property_id = p_property_id
      for update;
      if not found then raise exception '未找到课程。' using errcode = 'P0002'; end if;
      if selected_course.version <> p_expected_version then
        raise exception '课程已被其他用户更新，请重新读取后重试。'
          using errcode = '40001';
      end if;
      select coalesce(max(existing.version_number), 0) + 1
      into version_number
      from public.course_versions existing
      where existing.course_id = selected_course_id;
      update public.courses set
        name_zh = btrim(p_payload->>'nameZh'),
        name_en = nullif(btrim(p_payload->>'nameEn'), ''),
        version = version + 1,
        updated_by = auth.uid(),
        updated_at = now()
      where id = selected_course_id;
    end if;

    insert into public.course_versions(
      tenant_id,
      property_id,
      course_id,
      version_number,
      name_zh,
      name_en,
      description,
      outline,
      learning_material_version,
      standard_duration_minutes,
      learning_objectives,
      capability_tags,
      assessment_criteria,
      change_reason,
      continuity_rationale,
      impact_review_required,
      impact_note
    ) values (
      property_tenant_id,
      p_property_id,
      selected_course_id,
      version_number,
      btrim(p_payload->>'nameZh'),
      nullif(btrim(p_payload->>'nameEn'), ''),
      btrim(p_payload->>'description'),
      btrim(p_payload->>'outline'),
      btrim(p_payload->>'learningMaterialVersion'),
      (p_payload->>'standardDurationMinutes')::integer,
      array(select jsonb_array_elements_text(
        p_payload->'learningObjectives'
      )),
      array(select jsonb_array_elements_text(
        coalesce(p_payload->'capabilityTags', '[]'::jsonb)
      )),
      btrim(p_payload->>'assessmentCriteria'),
      btrim(p_payload->>'changeReason'),
      btrim(p_payload->>'continuityRationale'),
      coalesce((p_payload->>'impactReviewRequired')::boolean, false),
      nullif(btrim(p_payload->>'impactNote'), '')
    ) returning id into selected_version_id;
  end if;

  insert into public.learning_requirement_audit_events(
    tenant_id,
    property_id,
    aggregate_type,
    aggregate_id,
    aggregate_version_id,
    action,
    reason,
    before_evidence,
    after_evidence,
    actor_id
  ) values (
    property_tenant_id,
    p_property_id,
    'course',
    selected_course_id,
    selected_version_id,
    'draft_saved',
    btrim(p_payload->>'changeReason'),
    before_document,
    app_private.course_version_document(selected_version_id),
    auth.uid()
  );
  return app_private.course_version_document(selected_version_id);
end;
$$;

create or replace function public.transition_course_version(
  p_course_version_id uuid,
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
  current_row public.course_versions;
  before_document jsonb;
begin
  select * into current_row
  from public.course_versions version_row
  where version_row.id = p_course_version_id
  for update;
  if not found then raise exception '未找到课程版本。' using errcode = 'P0002'; end if;
  perform app_private.assert_learning_requirement_manager(
    current_row.property_id
  );
  if current_row.version <> p_expected_version then
    raise exception '课程版本已被其他用户更新，请重新读取后重试。'
      using errcode = '40001';
  end if;
  if not (
    (current_row.lifecycle_state = 'draft' and p_target_state = 'review')
    or (current_row.lifecycle_state = 'review' and p_target_state = 'draft')
    or (
      current_row.lifecycle_state = 'review'
      and p_target_state = 'published'
    )
    or (
      current_row.lifecycle_state = 'published'
      and p_target_state = 'retired'
    )
  ) then
    raise exception '不允许从“%”转为“%”。',
      current_row.lifecycle_state, p_target_state using errcode = '23514';
  end if;
  if (
    p_target_state in ('draft', 'retired')
    and btrim(coalesce(p_reason, '')) = ''
  ) then
    raise exception '退回或停用版本必须说明原因。' using errcode = '23514';
  end if;

  before_document := app_private.course_version_document(
    p_course_version_id
  );
  update public.course_versions set
    lifecycle_state = p_target_state,
    reviewed_by = case when p_target_state = 'review'
      then auth.uid() else reviewed_by end,
    reviewed_at = case when p_target_state = 'review'
      then now() else reviewed_at end,
    published_by = case when p_target_state = 'published'
      then auth.uid() else published_by end,
    published_at = case when p_target_state = 'published'
      then now() else published_at end,
    retired_by = case when p_target_state = 'retired'
      then auth.uid() else retired_by end,
    retired_at = case when p_target_state = 'retired'
      then now() else retired_at end,
    retirement_reason = case when p_target_state = 'retired'
      then btrim(p_reason) else retirement_reason end,
    version = version + 1,
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_course_version_id;

  insert into public.learning_requirement_audit_events(
    tenant_id,
    property_id,
    aggregate_type,
    aggregate_id,
    aggregate_version_id,
    action,
    reason,
    before_evidence,
    after_evidence,
    actor_id
  ) values (
    current_row.tenant_id,
    current_row.property_id,
    'course',
    current_row.course_id,
    p_course_version_id,
    'state_' || p_target_state,
    coalesce(nullif(btrim(p_reason), ''), '经经理确认的版本状态变更'),
    before_document,
    app_private.course_version_document(p_course_version_id),
    auth.uid()
  );
  return app_private.course_version_document(p_course_version_id);
end;
$$;

create or replace function public.save_requirement_version_draft(
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
  property_tenant_id uuid;
  selected_requirement_id uuid :=
    nullif(p_payload->>'requirementId', '')::uuid;
  selected_version_id uuid :=
    nullif(p_payload->>'requirementVersionId', '')::uuid;
  selected_requirement public.training_requirements;
  selected_version public.training_requirement_versions;
  selected_definition_id uuid;
  selected_rule_id uuid;
  version_number integer;
  before_document jsonb;
  method jsonb;
  rule_set jsonb;
  department_term jsonb;
  position_term jsonb;
  family_term jsonb;
  timing jsonb := p_payload->'timing';
begin
  perform app_private.assert_learning_requirement_manager(p_property_id);
  select property.tenant_id into property_tenant_id
  from public.properties property
  where property.id = p_property_id;

  if jsonb_array_length(
    coalesce(p_payload#>'{completionDefinition,methods}', '[]'::jsonb)
  ) = 0 then
    raise exception '培训要求至少需要一个认可完成方式。'
      using errcode = '23514';
  end if;
  if jsonb_array_length(coalesce(p_payload->'ruleSets', '[]'::jsonb)) = 0 then
    raise exception '培训要求至少需要一个适用规则。'
      using errcode = '23514';
  end if;

  if selected_version_id is not null then
    select * into selected_version
    from public.training_requirement_versions version_row
    where version_row.id = selected_version_id
      and version_row.property_id = p_property_id
    for update;
    if not found then raise exception '未找到培训要求版本。' using errcode = 'P0002'; end if;
    if selected_version.lifecycle_state <> 'draft' then
      raise exception '仅草稿培训要求版本可以编辑。'
        using errcode = '23514';
    end if;
    if selected_version.version <> p_expected_version then
      raise exception '培训要求版本已被其他用户更新，请重新读取后重试。'
        using errcode = '40001';
    end if;
    before_document := app_private.requirement_version_document(
      selected_version_id
    );
    selected_requirement_id := selected_version.training_requirement_id;
    update public.training_requirement_versions set
      name_zh = btrim(p_payload->>'nameZh'),
      name_en = nullif(btrim(p_payload->>'nameEn'), ''),
      purpose = btrim(p_payload->>'purpose'),
      obligation_explanation = btrim(
        p_payload->>'obligationExplanation'
      ),
      effective_from = (p_payload->>'effectiveFrom')::date,
      effective_to = nullif(p_payload->>'effectiveTo', '')::date,
      change_reason = btrim(p_payload->>'changeReason'),
      continuity_rationale = btrim(p_payload->>'continuityRationale'),
      version = version + 1,
      updated_by = auth.uid(),
      updated_at = now()
    where id = selected_version_id;

    delete from public.completion_definitions
    where training_requirement_version_id = selected_version_id;
    delete from public.requirement_timing_definitions
    where training_requirement_version_id = selected_version_id;
    delete from public.eligibility_rule_sets
    where training_requirement_version_id = selected_version_id;
  else
    if selected_requirement_id is null then
      insert into public.training_requirements(
        tenant_id,
        property_id,
        code,
        name_zh,
        name_en
      ) values (
        property_tenant_id,
        p_property_id,
        upper(btrim(p_payload->>'code')),
        btrim(p_payload->>'nameZh'),
        nullif(btrim(p_payload->>'nameEn'), '')
      ) returning * into selected_requirement;
      selected_requirement_id := selected_requirement.id;
      version_number := 1;
    else
      select * into selected_requirement
      from public.training_requirements requirement
      where requirement.id = selected_requirement_id
        and requirement.property_id = p_property_id
      for update;
      if not found then raise exception '未找到培训要求。' using errcode = 'P0002'; end if;
      if selected_requirement.version <> p_expected_version then
        raise exception '培训要求已被其他用户更新，请重新读取后重试。'
          using errcode = '40001';
      end if;
      select coalesce(max(existing.version_number), 0) + 1
      into version_number
      from public.training_requirement_versions existing
      where existing.training_requirement_id = selected_requirement_id;
      update public.training_requirements set
        name_zh = btrim(p_payload->>'nameZh'),
        name_en = nullif(btrim(p_payload->>'nameEn'), ''),
        version = version + 1,
        updated_by = auth.uid(),
        updated_at = now()
      where id = selected_requirement_id;
    end if;

    insert into public.training_requirement_versions(
      tenant_id,
      property_id,
      training_requirement_id,
      version_number,
      name_zh,
      name_en,
      purpose,
      obligation_explanation,
      effective_from,
      effective_to,
      change_reason,
      continuity_rationale
    ) values (
      property_tenant_id,
      p_property_id,
      selected_requirement_id,
      version_number,
      btrim(p_payload->>'nameZh'),
      nullif(btrim(p_payload->>'nameEn'), ''),
      btrim(p_payload->>'purpose'),
      btrim(p_payload->>'obligationExplanation'),
      (p_payload->>'effectiveFrom')::date,
      nullif(p_payload->>'effectiveTo', '')::date,
      btrim(p_payload->>'changeReason'),
      btrim(p_payload->>'continuityRationale')
    ) returning id into selected_version_id;
  end if;

  insert into public.completion_definitions(
    tenant_id,
    property_id,
    training_requirement_version_id,
    satisfaction_operator
  ) values (
    property_tenant_id,
    p_property_id,
    selected_version_id,
    p_payload#>>'{completionDefinition,satisfactionOperator}'
  ) returning id into selected_definition_id;

  for method in select * from jsonb_array_elements(
    p_payload#>'{completionDefinition,methods}'
  ) loop
    if method->>'type' = 'course_version' and not exists (
      select 1
      from public.course_versions course_version
      where course_version.id = (method->>'courseVersionId')::uuid
        and course_version.property_id = p_property_id
        and course_version.lifecycle_state = 'published'
    ) then
      raise exception '课程完成方式只能引用本酒店已发布的课程版本。'
        using errcode = '23514';
    end if;

    insert into public.accepted_learning_methods(
      tenant_id,
      property_id,
      completion_definition_id,
      method_type,
      label_zh,
      course_version_id,
      certificate_type,
      issuer_criteria,
      evidence_description,
      validity_months,
      assessment_name,
      pass_criteria,
      approval_standard,
      sort_order
    ) values (
      property_tenant_id,
      p_property_id,
      selected_definition_id,
      method->>'type',
      btrim(method->>'labelZh'),
      nullif(method->>'courseVersionId', '')::uuid,
      nullif(btrim(method->>'certificateType'), ''),
      nullif(btrim(method->>'issuerCriteria'), ''),
      nullif(btrim(method->>'evidenceDescription'), ''),
      nullif(method->>'validityMonths', '')::integer,
      nullif(btrim(method->>'assessmentName'), ''),
      nullif(btrim(method->>'passCriteria'), ''),
      nullif(btrim(method->>'approvalStandard'), ''),
      coalesce((method->>'sortOrder')::integer, 0)
    );
  end loop;

  insert into public.requirement_timing_definitions(
    tenant_id,
    property_id,
    training_requirement_version_id,
    timing_type,
    due_date,
    due_within_days,
    recurrence_period,
    interval_months,
    anchor_date
  ) values (
    property_tenant_id,
    p_property_id,
    selected_version_id,
    timing->>'type',
    nullif(timing->>'dueDate', '')::date,
    nullif(timing->>'dueWithinDays', '')::integer,
    nullif(timing->>'period', ''),
    nullif(timing->>'intervalMonths', '')::integer,
    nullif(timing->>'anchorDate', '')::date
  );

  for rule_set in select * from jsonb_array_elements(
    p_payload->'ruleSets'
  ) loop
    insert into public.eligibility_rule_sets(
      tenant_id,
      property_id,
      training_requirement_version_id,
      effective_from,
      effective_to,
      audience_mode,
      new_employee_condition,
      employment_statuses
    ) values (
      property_tenant_id,
      p_property_id,
      selected_version_id,
      (rule_set->>'effectiveFrom')::date,
      nullif(rule_set->>'effectiveTo', '')::date,
      rule_set->>'audienceMode',
      rule_set->>'newEmployeeCondition',
      array(
        select value::public.employee_employment_status
        from jsonb_array_elements_text(
          rule_set->'employmentStatuses'
        ) value
      )
    ) returning id into selected_rule_id;

    for department_term in select * from jsonb_array_elements(
      coalesce(rule_set->'departments', '[]'::jsonb)
    ) loop
      insert into public.eligibility_rule_departments(
        tenant_id,
        property_id,
        eligibility_rule_set_id,
        department_id,
        include_descendants
      ) values (
        property_tenant_id,
        p_property_id,
        selected_rule_id,
        (department_term->>'departmentId')::uuid,
        coalesce(
          (department_term->>'includeDescendants')::boolean,
          false
        )
      );
    end loop;

    for position_term in select * from jsonb_array_elements(
      coalesce(rule_set->'positionIds', '[]'::jsonb)
    ) loop
      insert into public.eligibility_rule_positions(
        tenant_id,
        property_id,
        eligibility_rule_set_id,
        position_id
      ) values (
        property_tenant_id,
        p_property_id,
        selected_rule_id,
        (position_term#>>'{}')::uuid
      );
    end loop;

    for family_term in select * from jsonb_array_elements(
      coalesce(rule_set->'positionFamilyIds', '[]'::jsonb)
    ) loop
      insert into public.eligibility_rule_position_families(
        tenant_id,
        property_id,
        eligibility_rule_set_id,
        position_family_id
      ) values (
        property_tenant_id,
        p_property_id,
        selected_rule_id,
        (family_term#>>'{}')::uuid
      );
    end loop;
  end loop;

  insert into public.learning_requirement_audit_events(
    tenant_id,
    property_id,
    aggregate_type,
    aggregate_id,
    aggregate_version_id,
    action,
    reason,
    before_evidence,
    after_evidence,
    actor_id
  ) values (
    property_tenant_id,
    p_property_id,
    'requirement',
    selected_requirement_id,
    selected_version_id,
    'draft_saved',
    btrim(p_payload->>'changeReason'),
    before_document,
    app_private.requirement_version_document(selected_version_id),
    auth.uid()
  );
  return app_private.requirement_version_document(selected_version_id);
exception
  when exclusion_violation then
    raise exception '适用规则有效期重叠；同一日期只能有一组明确规则。'
      using errcode = '23514';
end;
$$;

create or replace function public.transition_requirement_version(
  p_requirement_version_id uuid,
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
  current_row public.training_requirement_versions;
  previous_effective public.training_requirement_versions;
  before_document jsonb;
  previous_before_document jsonb;
begin
  select * into current_row
  from public.training_requirement_versions version_row
  where version_row.id = p_requirement_version_id
  for update;
  if not found then raise exception '未找到培训要求版本。' using errcode = 'P0002'; end if;
  perform app_private.assert_learning_requirement_manager(
    current_row.property_id
  );
  if current_row.version <> p_expected_version then
    raise exception '培训要求版本已被其他用户更新，请重新读取后重试。'
      using errcode = '40001';
  end if;
  if not (
    (current_row.lifecycle_state = 'draft' and p_target_state = 'approved')
    or (
      current_row.lifecycle_state = 'approved'
      and p_target_state = 'effective'
    )
    or (
      current_row.lifecycle_state in (
        'approved', 'effective', 'superseded'
      )
      and p_target_state = 'retired'
    )
  ) then
    raise exception '不允许从“%”转为“%”。',
      current_row.lifecycle_state, p_target_state using errcode = '23514';
  end if;
  if p_target_state = 'retired'
    and btrim(coalesce(p_reason, '')) = '' then
    raise exception '停用培训要求版本必须说明原因。'
      using errcode = '23514';
  end if;
  if p_target_state = 'approved' and (
    not exists (
      select 1
      from public.completion_definitions definition
      join public.accepted_learning_methods method
        on method.completion_definition_id = definition.id
      where definition.training_requirement_version_id =
        p_requirement_version_id
    )
    or not exists (
      select 1
      from public.requirement_timing_definitions timing
      where timing.training_requirement_version_id =
        p_requirement_version_id
    )
    or not exists (
      select 1
      from public.eligibility_rule_sets rule_set
      where rule_set.training_requirement_version_id =
        p_requirement_version_id
    )
    or exists (
      select 1
      from public.completion_definitions definition
      join public.accepted_learning_methods method
        on method.completion_definition_id = definition.id
       and method.method_type = 'course_version'
      join public.course_versions course_version
        on course_version.id = method.course_version_id
      where definition.training_requirement_version_id =
          p_requirement_version_id
        and course_version.lifecycle_state <> 'published'
    )
  ) then
    raise exception '批准前必须完整定义完成方式、期限和适用规则。'
      using errcode = '23514';
  end if;
  if p_target_state = 'effective'
    and current_date < current_row.effective_from then
    raise exception '尚未到版本生效日期，不能提前设为生效。'
      using errcode = '23514';
  end if;

  before_document := app_private.requirement_version_document(
    p_requirement_version_id
  );

  if p_target_state = 'effective' then
    select * into previous_effective
    from public.training_requirement_versions existing
    where existing.training_requirement_id =
        current_row.training_requirement_id
      and existing.lifecycle_state = 'effective'
      and existing.id <> p_requirement_version_id
    for update;
    if found then
      previous_before_document :=
        app_private.requirement_version_document(previous_effective.id);
      update public.training_requirement_versions set
        lifecycle_state = 'superseded',
        superseded_by_version_id = p_requirement_version_id,
        superseded_at = now(),
        version = version + 1,
        updated_by = auth.uid(),
        updated_at = now()
      where id = previous_effective.id;
      insert into public.learning_requirement_audit_events(
        tenant_id,
        property_id,
        aggregate_type,
        aggregate_id,
        aggregate_version_id,
        action,
        reason,
        before_evidence,
        after_evidence,
        actor_id
      ) values (
        previous_effective.tenant_id,
        previous_effective.property_id,
        'requirement',
        previous_effective.training_requirement_id,
        previous_effective.id,
        'state_superseded',
        '较新批准版本已生效',
        previous_before_document,
        app_private.requirement_version_document(previous_effective.id),
        auth.uid()
      );
    end if;
  end if;

  update public.training_requirement_versions set
    lifecycle_state = p_target_state,
    approved_by = case when p_target_state = 'approved'
      then auth.uid() else approved_by end,
    approved_at = case when p_target_state = 'approved'
      then now() else approved_at end,
    effective_by = case when p_target_state = 'effective'
      then auth.uid() else effective_by end,
    effective_at = case when p_target_state = 'effective'
      then now() else effective_at end,
    retired_by = case when p_target_state = 'retired'
      then auth.uid() else retired_by end,
    retired_at = case when p_target_state = 'retired'
      then now() else retired_at end,
    retirement_reason = case when p_target_state = 'retired'
      then btrim(p_reason) else retirement_reason end,
    version = version + 1,
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_requirement_version_id;

  insert into public.learning_requirement_audit_events(
    tenant_id,
    property_id,
    aggregate_type,
    aggregate_id,
    aggregate_version_id,
    action,
    reason,
    before_evidence,
    after_evidence,
    actor_id
  ) values (
    current_row.tenant_id,
    current_row.property_id,
    'requirement',
    current_row.training_requirement_id,
    p_requirement_version_id,
    'state_' || p_target_state,
    coalesce(nullif(btrim(p_reason), ''), '经经理确认的版本状态变更'),
    before_document,
    app_private.requirement_version_document(p_requirement_version_id),
    auth.uid()
  );
  return app_private.requirement_version_document(
    p_requirement_version_id
  );
end;
$$;

-- Point-in-time eligibility. This projection persists no employee fact. ---

create or replace function public.evaluate_learning_requirement_eligibility(
  p_property_id uuid,
  p_requirement_version_id uuid,
  p_evaluation_date date,
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  is_manager boolean;
  is_department_user boolean;
  requirement_state text;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception '请先登录。' using errcode = '42501';
  end if;
  is_manager := app_private.is_authorized_property_role(
    p_property_id,
    'property_ld_manager'
  );
  is_department_user := app_private.is_authorized_property_role(
    p_property_id,
    'department_training_admin'
  );
  if not is_manager and not is_department_user then
    raise exception '无权查看此酒店的适用性评估。' using errcode = '42501';
  end if;
  if p_evaluation_date is null then
    raise exception '适用性评估必须指定评估日期。'
      using errcode = '22023';
  end if;
  if p_page < 1 or p_page_size < 1 or p_page_size > 200 then
    raise exception '分页参数无效。' using errcode = '22023';
  end if;

  select version_row.lifecycle_state into requirement_state
  from public.training_requirement_versions version_row
  where version_row.id = p_requirement_version_id
    and version_row.property_id = p_property_id;
  if requirement_state is null then
    raise exception '未找到培训要求版本。' using errcode = 'P0002';
  end if;
  if is_department_user and requirement_state <> 'effective' then
    raise exception '部门培训负责人只能查看已生效培训要求。'
      using errcode = '42501';
  end if;

  with candidate as (
    select
      employee.id as employee_id,
      employee.employee_number as current_employee_number,
      fact.fact_version_id,
      fact.employee_number,
      fact.department_id,
      fact.position_id,
      fact.position_family_id,
      fact.hire_date,
      fact.employment_status,
      fact.is_new_employee_at_event,
      fact_row.name_zh,
      fact_row.name_en,
      rule_set.id as rule_set_id,
      rule_set.audience_mode,
      rule_set.new_employee_condition,
      rule_set.employment_statuses,
      exists (
        select 1
        from public.eligibility_rule_departments term
        where term.eligibility_rule_set_id = rule_set.id
      ) as has_department_terms,
      exists (
        select 1
        from public.eligibility_rule_positions term
        where term.eligibility_rule_set_id = rule_set.id
      ) as has_position_terms,
      exists (
        select 1
        from public.eligibility_rule_position_families term
        where term.eligibility_rule_set_id = rule_set.id
      ) as has_family_terms
    from public.employees employee
    left join lateral app_private.resolve_employee_fact_at(
      employee.id,
      p_evaluation_date
    ) fact on true
    left join public.employee_fact_versions fact_row
      on fact_row.id = fact.fact_version_id
    left join public.eligibility_rule_sets rule_set
      on rule_set.training_requirement_version_id =
        p_requirement_version_id
     and p_evaluation_date >= rule_set.effective_from
     and (
       rule_set.effective_to is null
       or p_evaluation_date <= rule_set.effective_to
     )
    where employee.property_id = p_property_id
      and (
        nullif(btrim(coalesce(p_search, '')), '') is null
        or employee.employee_number ilike '%' || btrim(p_search) || '%'
        or employee.name_zh ilike '%' || btrim(p_search) || '%'
        or employee.name_en ilike '%' || btrim(p_search) || '%'
      )
      and (
        is_manager
        or (
          fact.department_id is not null
          and app_private.has_authorized_department_scope(
            p_property_id,
            fact.department_id
          )
        )
      )
  ),
  evaluated as (
    select
      candidate.*,
      (
        candidate.fact_version_id is null
        or candidate.rule_set_id is null
        or (
          candidate.employment_status = 'unknown'
          and cardinality(candidate.employment_statuses) > 0
        )
        or (
          candidate.has_department_terms
          and candidate.department_id is null
        )
        or (
          candidate.has_position_terms
          and candidate.position_id is null
        )
        or (
          candidate.has_family_terms
          and candidate.position_family_id is null
        )
        or (
          candidate.new_employee_condition <> 'not_evaluated'
          and candidate.hire_date is null
        )
      ) as has_missing_evidence,
      (
        (
          candidate.fact_version_id is not null
          and candidate.employment_status <> 'unknown'
          and not (
            candidate.employment_status =
              any(candidate.employment_statuses)
          )
        )
        or (
          candidate.has_department_terms
          and candidate.department_id is not null
          and not exists (
            select 1
            from public.eligibility_rule_departments term
            where term.eligibility_rule_set_id = candidate.rule_set_id
              and (
                term.department_id = candidate.department_id
                or (
                  term.include_descendants
                  and exists (
                    select 1
                    from public.department_closure closure
                    where closure.property_id = p_property_id
                      and closure.ancestor_department_id =
                        term.department_id
                      and closure.descendant_department_id =
                        candidate.department_id
                  )
                )
              )
          )
        )
        or (
          candidate.has_position_terms
          and candidate.position_id is not null
          and not exists (
            select 1
            from public.eligibility_rule_positions term
            where term.eligibility_rule_set_id = candidate.rule_set_id
              and term.position_id = candidate.position_id
          )
        )
        or (
          candidate.has_family_terms
          and candidate.position_family_id is not null
          and not exists (
            select 1
            from public.eligibility_rule_position_families term
            where term.eligibility_rule_set_id = candidate.rule_set_id
              and term.position_family_id = candidate.position_family_id
          )
        )
        or (
          candidate.new_employee_condition = 'required'
          and candidate.hire_date is not null
          and not candidate.is_new_employee_at_event
        )
        or (
          candidate.new_employee_condition = 'excluded'
          and candidate.hire_date is not null
          and candidate.is_new_employee_at_event
        )
      ) as has_non_match
    from candidate
  ),
  shaped as (
    select
      employee_id,
      coalesce(employee_number, current_employee_number) as employee_number,
      coalesce(nullif(name_zh, ''), nullif(name_en, ''), '姓名未提供')
        as employee_name,
      department_id,
      (
        select department.name_zh
        from public.departments department
        where department.id = evaluated.department_id
      ) as department_name,
      p_requirement_version_id as requirement_version_id,
      case
        when has_non_match then 'not_applicable'
        when has_missing_evidence then 'unable_to_determine'
        else 'eligible'
      end as result_state,
      fact_version_id,
      array_remove(array[
        case when fact_version_id is null then '缺少评估日期的员工事实版本' end,
        case when rule_set_id is null then '评估日期没有生效的适用规则' end,
        case when employment_status = 'unknown'
          then '员工状态无法判断' end,
        case when has_department_terms and department_id is null
          then '缺少部门归属' end,
        case when has_position_terms and position_id is null
          then '缺少职位归属' end,
        case when has_family_terms and position_family_id is null
          then '缺少职位族归属' end,
        case when new_employee_condition <> 'not_evaluated'
          and hire_date is null then '缺少入职日期' end
      ], null) as missing_evidence
    from evaluated
  ),
  paged as (
    select *
    from shaped
    order by employee_number
    offset (p_page - 1) * p_page_size
    limit p_page_size
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'employeeId', paged.employee_id,
        'employeeNumber', paged.employee_number,
        'employeeName', paged.employee_name,
        'departmentId', paged.department_id,
        'departmentName', paged.department_name,
        'requirementVersionId', paged.requirement_version_id,
        'result', paged.result_state,
        'evidence', jsonb_build_object(
          'employeeFactVersionId', paged.fact_version_id,
          'evaluatedAt', p_evaluation_date,
          'matchedDimensions', '[]'::jsonb,
          'missingEvidence', to_jsonb(paged.missing_evidence),
          'explanationZh', case paged.result_state
            when 'eligible' then '在评估日期满足该版本的全部适用条件。'
            when 'not_applicable' then '在评估日期至少有一项明确条件不匹配。'
            else '缺少必要证据，不能判定为不适用。'
          end
        )
      ) order by paged.employee_number)
      from paged
    ), '[]'::jsonb),
    'total', (select count(*) from shaped),
    'evaluatedAt', p_evaluation_date,
    'source', 'real'
  ) into result;
  return result;
end;
$$;

-- Department users receive only effective obligations and authorized scope.
create or replace function public.read_department_learning_requirements()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_property_id uuid;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception '请先登录。' using errcode = '42501';
  end if;
  select account.property_id into selected_property_id
  from public.user_accounts account
  where account.auth_user_id = auth.uid()
    and account.account_status = 'active'
    and (
      account.locked_until is null
      or account.locked_until <= now()
    )
  limit 1;
  if selected_property_id is null
    or not app_private.is_authorized_property_role(
      selected_property_id,
      'department_training_admin'
    ) then
    raise exception '仅部门培训负责人可以查看部门培训要求。'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'propertyId', selected_property_id,
    'source', 'real',
    'scope', coalesce((
      select jsonb_agg(distinct jsonb_build_object(
        'departmentId', department.id,
        'departmentName', department.name_zh,
        'includeDescendants', scope.include_descendants
      ))
      from public.user_accounts account
      join public.role_assignments assignment
        on assignment.user_id = account.user_id
       and assignment.property_id = account.property_id
       and assignment.status = 'active'
      join public.roles role
        on role.id = assignment.role_id
       and role.code = 'department_training_admin'
      join public.trainer_scopes scope
        on scope.role_assignment_id = assignment.id
       and scope.is_active
      join public.departments department
        on department.id = scope.department_id
       and department.is_active
      where account.auth_user_id = auth.uid()
        and account.property_id = selected_property_id
    ), '[]'::jsonb),
    'requirements', coalesce((
      select jsonb_agg(
        app_private.requirement_version_document(version_row.id)
        order by requirement.code
      )
      from public.training_requirements requirement
      join public.training_requirement_versions version_row
        on version_row.training_requirement_id = requirement.id
       and version_row.lifecycle_state = 'effective'
      where requirement.property_id = selected_property_id
        and (
          exists (
            select 1
            from public.eligibility_rule_sets rule_set
            where rule_set.training_requirement_version_id = version_row.id
              and current_date >= rule_set.effective_from
              and (
                rule_set.effective_to is null
                or current_date <= rule_set.effective_to
              )
              and rule_set.audience_mode = 'all_employees'
          )
          or exists (
            select 1
            from public.eligibility_rule_sets rule_set
            where rule_set.training_requirement_version_id = version_row.id
              and current_date >= rule_set.effective_from
              and (
                rule_set.effective_to is null
                or current_date <= rule_set.effective_to
              )
              and not exists (
                select 1
                from public.eligibility_rule_departments department_term
                where department_term.eligibility_rule_set_id = rule_set.id
              )
          )
          or exists (
            select 1
            from public.eligibility_rule_sets rule_set
            join public.eligibility_rule_departments term
              on term.eligibility_rule_set_id = rule_set.id
            where rule_set.training_requirement_version_id = version_row.id
              and current_date >= rule_set.effective_from
              and (
                rule_set.effective_to is null
                or current_date <= rule_set.effective_to
              )
              and (
                app_private.has_authorized_department_scope(
                  selected_property_id,
                  term.department_id
                )
                or exists (
                  select 1
                  from public.department_closure closure
                  where closure.property_id = selected_property_id
                    and closure.ancestor_department_id = term.department_id
                    and term.include_descendants
                    and app_private.has_authorized_department_scope(
                      selected_property_id,
                      closure.descendant_department_id
                    )
                )
              )
          )
        )
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- Function privileges are explicit and each RPC re-asserts live authority.
revoke all on function
  app_private.assert_learning_requirement_manager(uuid),
  app_private.reject_learning_requirement_audit_mutation(),
  app_private.protect_course_version_definition(),
  app_private.assert_requirement_children_mutable(),
  app_private.protect_requirement_version_definition(),
  app_private.course_version_document(uuid),
  app_private.requirement_version_document(uuid)
from public, anon, authenticated;

revoke all on function
  public.read_learning_requirement_foundation(uuid),
  public.save_course_version_draft(uuid,jsonb,bigint),
  public.transition_course_version(uuid,text,bigint,text),
  public.save_requirement_version_draft(uuid,jsonb,bigint),
  public.transition_requirement_version(uuid,text,bigint,text),
  public.evaluate_learning_requirement_eligibility(
    uuid,uuid,date,text,integer,integer
  ),
  public.read_department_learning_requirements()
from public, anon, authenticated;

grant execute on function
  public.read_learning_requirement_foundation(uuid),
  public.save_course_version_draft(uuid,jsonb,bigint),
  public.transition_course_version(uuid,text,bigint,text),
  public.save_requirement_version_draft(uuid,jsonb,bigint),
  public.transition_requirement_version(uuid,text,bigint,text),
  public.evaluate_learning_requirement_eligibility(
    uuid,uuid,date,text,integer,integer
  ),
  public.read_department_learning_requirements()
to authenticated;
