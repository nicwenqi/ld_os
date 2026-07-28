-- Recovery D4: trusted Completion Evidence and Completion Record facts.
-- Completion remains distinct from Attendance and creates no Assignment,
-- reminder, Feedback, KPI, Health, Forecast, Risk, AI or HR fact.

-- Immutable fact tables ---------------------------------------------------

create table public.completion_evidence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  employee_id uuid not null,
  employee_fact_version_id uuid not null,
  training_requirement_version_id uuid not null,
  accepted_learning_method_id uuid not null,
  course_version_id uuid,
  source_type text not null,
  evidence_date date not null,
  source_summary text not null,
  integrity_hash text not null,
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  constraint completion_evidence_property_fkey
    foreign key (property_id, tenant_id)
    references public.properties(id, tenant_id) on delete restrict,
  constraint completion_evidence_employee_fkey
    foreign key (employee_id, tenant_id, property_id)
    references public.employees(id, tenant_id, property_id)
    on delete restrict,
  constraint completion_evidence_fact_version_fkey
    foreign key (employee_fact_version_id)
    references public.employee_fact_versions(id) on delete restrict,
  constraint completion_evidence_requirement_version_fkey
    foreign key (training_requirement_version_id, tenant_id, property_id)
    references public.training_requirement_versions(
      id, tenant_id, property_id
    ) on delete restrict,
  constraint completion_evidence_method_fkey
    foreign key (accepted_learning_method_id, tenant_id, property_id)
    references public.accepted_learning_methods(id, tenant_id, property_id)
    on delete restrict,
  constraint completion_evidence_course_version_fkey
    foreign key (course_version_id, tenant_id, property_id)
    references public.course_versions(id, tenant_id, property_id)
    on delete restrict,
  constraint completion_evidence_scope_key
    unique (id, tenant_id, property_id),
  constraint completion_evidence_source_check check (
    source_type in (
      'attendance', 'external_evidence', 'manager_recognition'
    )
  ),
  constraint completion_evidence_summary_check check (
    btrim(source_summary) <> ''
  ),
  constraint completion_evidence_hash_check check (
    integrity_hash ~ '^[a-f0-9]{64}$'
  )
);

create table public.completion_attendance_sources (
  completion_evidence_id uuid primary key,
  tenant_id uuid not null,
  property_id uuid not null,
  session_revision_id uuid not null,
  participant_snapshot_id uuid not null,
  attendance_determination_id uuid not null,
  created_at timestamptz not null default now(),
  constraint completion_attendance_evidence_fkey
    foreign key (completion_evidence_id, tenant_id, property_id)
    references public.completion_evidence(id, tenant_id, property_id)
    on delete restrict,
  constraint completion_attendance_revision_fkey
    foreign key (session_revision_id, tenant_id, property_id)
    references public.training_session_revisions(id, tenant_id, property_id)
    on delete restrict,
  constraint completion_attendance_participant_fkey
    foreign key (participant_snapshot_id, tenant_id, property_id)
    references public.session_participant_snapshots(
      id, tenant_id, property_id
    ) on delete restrict,
  constraint completion_attendance_determination_fkey
    foreign key (attendance_determination_id)
    references public.attendance_determinations(id) on delete restrict,
  constraint completion_attendance_determination_key
    unique (attendance_determination_id)
);

create table public.completion_external_sources (
  completion_evidence_id uuid primary key,
  tenant_id uuid not null,
  property_id uuid not null,
  issuer_name text not null,
  credential_reference text not null,
  issued_on date not null,
  expires_on date,
  evidence_description text not null,
  created_at timestamptz not null default now(),
  constraint completion_external_evidence_fkey
    foreign key (completion_evidence_id, tenant_id, property_id)
    references public.completion_evidence(id, tenant_id, property_id)
    on delete restrict,
  constraint completion_external_issuer_check check (
    btrim(issuer_name) <> ''
  ),
  constraint completion_external_reference_check check (
    btrim(credential_reference) <> ''
  ),
  constraint completion_external_description_check check (
    btrim(evidence_description) <> ''
  ),
  constraint completion_external_dates_check check (
    expires_on is null or expires_on >= issued_on
  )
);

create table public.completion_manager_recognition_sources (
  completion_evidence_id uuid primary key,
  tenant_id uuid not null,
  property_id uuid not null,
  recognition_date date not null,
  recognition_basis text not null,
  approval_standard_snapshot text not null,
  recognized_by uuid references auth.users(id) on delete set null,
  recognized_at timestamptz not null default now(),
  constraint completion_recognition_evidence_fkey
    foreign key (completion_evidence_id, tenant_id, property_id)
    references public.completion_evidence(id, tenant_id, property_id)
    on delete restrict,
  constraint completion_recognition_basis_check check (
    btrim(recognition_basis) <> ''
  ),
  constraint completion_recognition_standard_check check (
    btrim(approval_standard_snapshot) <> ''
  )
);

create table public.completion_evidence_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  completion_evidence_id uuid not null,
  decision text not null,
  reason text not null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  constraint completion_reviews_evidence_fkey
    foreign key (completion_evidence_id, tenant_id, property_id)
    references public.completion_evidence(id, tenant_id, property_id)
    on delete restrict,
  constraint completion_reviews_scope_key
    unique (id, tenant_id, property_id),
  constraint completion_reviews_evidence_key
    unique (completion_evidence_id),
  constraint completion_reviews_decision_check check (
    decision in ('accepted', 'rejected')
  ),
  constraint completion_reviews_reason_check check (btrim(reason) <> '')
);

create table public.completion_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  completion_evidence_id uuid not null,
  completion_evidence_review_id uuid not null,
  employee_id uuid not null,
  employee_fact_version_id uuid not null,
  training_requirement_version_id uuid not null,
  accepted_learning_method_id uuid not null,
  course_version_id uuid,
  completed_on date not null,
  valid_until date,
  supersedes_completion_record_id uuid,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz not null default now(),
  constraint completion_records_property_fkey
    foreign key (property_id, tenant_id)
    references public.properties(id, tenant_id) on delete restrict,
  constraint completion_records_evidence_fkey
    foreign key (completion_evidence_id, tenant_id, property_id)
    references public.completion_evidence(id, tenant_id, property_id)
    on delete restrict,
  constraint completion_records_review_fkey
    foreign key (completion_evidence_review_id, tenant_id, property_id)
    references public.completion_evidence_reviews(id, tenant_id, property_id)
    on delete restrict,
  constraint completion_records_employee_fkey
    foreign key (employee_id, tenant_id, property_id)
    references public.employees(id, tenant_id, property_id)
    on delete restrict,
  constraint completion_records_fact_version_fkey
    foreign key (employee_fact_version_id)
    references public.employee_fact_versions(id) on delete restrict,
  constraint completion_records_requirement_version_fkey
    foreign key (training_requirement_version_id, tenant_id, property_id)
    references public.training_requirement_versions(
      id, tenant_id, property_id
    ) on delete restrict,
  constraint completion_records_method_fkey
    foreign key (accepted_learning_method_id, tenant_id, property_id)
    references public.accepted_learning_methods(id, tenant_id, property_id)
    on delete restrict,
  constraint completion_records_course_version_fkey
    foreign key (course_version_id, tenant_id, property_id)
    references public.course_versions(id, tenant_id, property_id)
    on delete restrict,
  constraint completion_records_supersedes_fkey
    foreign key (supersedes_completion_record_id)
    references public.completion_records(id) on delete restrict,
  constraint completion_records_scope_key
    unique (id, tenant_id, property_id),
  constraint completion_records_evidence_key
    unique (completion_evidence_id),
  constraint completion_records_review_key
    unique (completion_evidence_review_id),
  constraint completion_records_validity_check check (
    valid_until is null or valid_until >= completed_on
  )
);

create table public.completion_record_revocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  completion_record_id uuid not null,
  original_completion_evidence_id uuid not null,
  reason text not null,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz not null default now(),
  constraint completion_revocations_record_fkey
    foreign key (completion_record_id, tenant_id, property_id)
    references public.completion_records(id, tenant_id, property_id)
    on delete restrict,
  constraint completion_revocations_evidence_fkey
    foreign key (
      original_completion_evidence_id,
      tenant_id,
      property_id
    )
    references public.completion_evidence(id, tenant_id, property_id)
    on delete restrict,
  constraint completion_revocations_record_key
    unique (completion_record_id),
  constraint completion_revocations_reason_check check (btrim(reason) <> '')
);

create table public.completion_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  completion_evidence_id uuid,
  completion_record_id uuid,
  event_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  reason text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint completion_audit_property_fkey
    foreign key (property_id, tenant_id)
    references public.properties(id, tenant_id) on delete restrict,
  constraint completion_audit_evidence_fkey
    foreign key (completion_evidence_id)
    references public.completion_evidence(id) on delete restrict,
  constraint completion_audit_record_fkey
    foreign key (completion_record_id)
    references public.completion_records(id) on delete restrict,
  constraint completion_audit_event_check check (
    event_type in (
      'evidence_recorded',
      'evidence_accepted',
      'evidence_rejected',
      'completion_recorded',
      'completion_revoked'
    )
  ),
  constraint completion_audit_reason_check check (btrim(reason) <> ''),
  constraint completion_audit_details_check check (
    jsonb_typeof(details) = 'object'
  ),
  constraint completion_audit_target_check check (
    completion_evidence_id is not null or completion_record_id is not null
  )
);

-- Supporting indexes ------------------------------------------------------

create index completion_evidence_property_date_idx
  on public.completion_evidence(property_id, evidence_date desc);
create index completion_evidence_employee_idx
  on public.completion_evidence(employee_id, evidence_date desc);
create index completion_evidence_fact_version_idx
  on public.completion_evidence(employee_fact_version_id);
create index completion_evidence_requirement_idx
  on public.completion_evidence(training_requirement_version_id);
create index completion_evidence_method_idx
  on public.completion_evidence(accepted_learning_method_id);
create index completion_evidence_course_idx
  on public.completion_evidence(course_version_id);
create index completion_evidence_recorded_by_idx
  on public.completion_evidence(recorded_by);

create index completion_attendance_revision_idx
  on public.completion_attendance_sources(session_revision_id);
create index completion_attendance_participant_idx
  on public.completion_attendance_sources(participant_snapshot_id);

create index completion_recognition_recognized_by_idx
  on public.completion_manager_recognition_sources(recognized_by);
create index completion_reviews_reviewed_by_idx
  on public.completion_evidence_reviews(reviewed_by);

create index completion_records_property_date_idx
  on public.completion_records(property_id, completed_on desc);
create index completion_records_employee_idx
  on public.completion_records(employee_id, completed_on desc);
create index completion_records_fact_version_idx
  on public.completion_records(employee_fact_version_id);
create index completion_records_requirement_idx
  on public.completion_records(training_requirement_version_id);
create index completion_records_method_idx
  on public.completion_records(accepted_learning_method_id);
create index completion_records_course_idx
  on public.completion_records(course_version_id);
create index completion_records_supersedes_idx
  on public.completion_records(supersedes_completion_record_id);
create index completion_records_verified_by_idx
  on public.completion_records(verified_by);

create index completion_revocations_evidence_idx
  on public.completion_record_revocations(original_completion_evidence_id);
create index completion_revocations_revoked_by_idx
  on public.completion_record_revocations(revoked_by);

create index completion_audit_evidence_idx
  on public.completion_audit_events(completion_evidence_id);
create index completion_audit_record_idx
  on public.completion_audit_events(completion_record_id);
create index completion_audit_actor_idx
  on public.completion_audit_events(actor_user_id);
create index completion_audit_property_idx
  on public.completion_audit_events(property_id, occurred_at desc);

-- Private-by-default browser boundary ------------------------------------

alter table public.completion_evidence enable row level security;
alter table public.completion_evidence force row level security;
alter table public.completion_attendance_sources enable row level security;
alter table public.completion_attendance_sources force row level security;
alter table public.completion_external_sources enable row level security;
alter table public.completion_external_sources force row level security;
alter table public.completion_manager_recognition_sources
  enable row level security;
alter table public.completion_manager_recognition_sources
  force row level security;
alter table public.completion_evidence_reviews enable row level security;
alter table public.completion_evidence_reviews force row level security;
alter table public.completion_records enable row level security;
alter table public.completion_records force row level security;
alter table public.completion_record_revocations enable row level security;
alter table public.completion_record_revocations force row level security;
alter table public.completion_audit_events enable row level security;
alter table public.completion_audit_events force row level security;

revoke all on
  public.completion_evidence,
  public.completion_attendance_sources,
  public.completion_external_sources,
  public.completion_manager_recognition_sources,
  public.completion_evidence_reviews,
  public.completion_records,
  public.completion_record_revocations,
  public.completion_audit_events
from public, anon, authenticated;

create or replace function app_private.reject_completion_fact_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'COMPLETION_FACT_APPEND_ONLY' using errcode = '42501';
end;
$$;

create trigger completion_evidence_append_only
before update or delete on public.completion_evidence
for each row execute function app_private.reject_completion_fact_mutation();
create trigger completion_attendance_sources_append_only
before update or delete on public.completion_attendance_sources
for each row execute function app_private.reject_completion_fact_mutation();
create trigger completion_external_sources_append_only
before update or delete on public.completion_external_sources
for each row execute function app_private.reject_completion_fact_mutation();
create trigger completion_recognition_sources_append_only
before update or delete on public.completion_manager_recognition_sources
for each row execute function app_private.reject_completion_fact_mutation();
create trigger completion_evidence_reviews_append_only
before update or delete on public.completion_evidence_reviews
for each row execute function app_private.reject_completion_fact_mutation();
create trigger completion_records_append_only
before update or delete on public.completion_records
for each row execute function app_private.reject_completion_fact_mutation();
create trigger completion_revocations_append_only
before update or delete on public.completion_record_revocations
for each row execute function app_private.reject_completion_fact_mutation();
create trigger completion_audit_append_only
before update or delete on public.completion_audit_events
for each row execute function app_private.reject_completion_fact_mutation();

-- Deterministic lineage and authorization helpers ------------------------

create or replace function app_private.validate_completion_fact_lineage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_evidence public.completion_evidence%rowtype;
begin
  if tg_table_name = 'completion_evidence' then
    if not exists (
      select 1
      from public.employee_fact_versions fact
      where fact.id = new.employee_fact_version_id
        and fact.employee_id = new.employee_id
        and fact.tenant_id = new.tenant_id
        and fact.property_id = new.property_id
    ) then
      raise exception 'COMPLETION_EMPLOYEE_FACT_LINEAGE_MISMATCH'
        using errcode = '23514';
    end if;
    if not exists (
      select 1
      from public.accepted_learning_methods method
      join public.completion_definitions definition
        on definition.id = method.completion_definition_id
       and definition.tenant_id = method.tenant_id
       and definition.property_id = method.property_id
      where method.id = new.accepted_learning_method_id
        and method.tenant_id = new.tenant_id
        and method.property_id = new.property_id
        and definition.training_requirement_version_id =
          new.training_requirement_version_id
        and (
          (
            method.method_type = 'course_version'
            and new.source_type = 'attendance'
            and new.course_version_id = method.course_version_id
          )
          or (
            method.method_type = 'external_certificate'
            and new.source_type = 'external_evidence'
            and new.course_version_id is null
          )
          or (
            method.method_type = 'manager_equivalency'
            and new.source_type = 'manager_recognition'
            and new.course_version_id is null
          )
        )
    ) then
      raise exception 'COMPLETION_METHOD_LINEAGE_MISMATCH'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'completion_attendance_sources' then
    select evidence.* into selected_evidence
    from public.completion_evidence evidence
    where evidence.id = new.completion_evidence_id
      and evidence.tenant_id = new.tenant_id
      and evidence.property_id = new.property_id
      and evidence.source_type = 'attendance';
    if selected_evidence.id is null or not exists (
      select 1
      from public.attendance_determinations determination
      join public.attendance_registers register_row
        on register_row.id = determination.attendance_register_id
       and register_row.lifecycle_state = 'closed'
      join public.session_participant_snapshots snapshot
        on snapshot.id = determination.participant_snapshot_id
       and snapshot.session_revision_id = register_row.session_revision_id
       and snapshot.employee_fact_version_id =
         determination.employee_fact_version_id
      join public.training_session_revisions revision
        on revision.id = register_row.session_revision_id
      join public.training_sessions session_row
        on session_row.id = revision.training_session_id
      where determination.id = new.attendance_determination_id
        and determination.determination = 'present'
        and determination.tenant_id = new.tenant_id
        and determination.property_id = new.property_id
        and register_row.session_revision_id = new.session_revision_id
        and snapshot.id = new.participant_snapshot_id
        and snapshot.employee_id = selected_evidence.employee_id
        and snapshot.employee_fact_version_id =
          selected_evidence.employee_fact_version_id
        and session_row.purpose_type = 'requirement_delivery'
        and session_row.training_requirement_version_id =
          selected_evidence.training_requirement_version_id
        and session_row.accepted_learning_method_id =
          selected_evidence.accepted_learning_method_id
        and session_row.course_version_id =
          selected_evidence.course_version_id
        and not exists (
          select 1
          from public.attendance_determinations later
          where later.attendance_register_id =
              determination.attendance_register_id
            and later.participant_snapshot_id =
              determination.participant_snapshot_id
            and later.determination_number >
              determination.determination_number
        )
    ) then
      raise exception 'COMPLETION_ATTENDANCE_LINEAGE_MISMATCH'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'completion_external_sources' then
    if not exists (
      select 1
      from public.completion_evidence evidence
      where evidence.id = new.completion_evidence_id
        and evidence.tenant_id = new.tenant_id
        and evidence.property_id = new.property_id
        and evidence.source_type = 'external_evidence'
        and evidence.evidence_date = new.issued_on
    ) then
      raise exception 'COMPLETION_EXTERNAL_LINEAGE_MISMATCH'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'completion_manager_recognition_sources' then
    if not exists (
      select 1
      from public.completion_evidence evidence
      where evidence.id = new.completion_evidence_id
        and evidence.tenant_id = new.tenant_id
        and evidence.property_id = new.property_id
        and evidence.source_type = 'manager_recognition'
        and evidence.evidence_date = new.recognition_date
        and evidence.recorded_by = new.recognized_by
    ) then
      raise exception 'COMPLETION_RECOGNITION_LINEAGE_MISMATCH'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'completion_records' then
    if not exists (
      select 1
      from public.completion_evidence evidence
      join public.completion_evidence_reviews review
        on review.id = new.completion_evidence_review_id
       and review.completion_evidence_id = evidence.id
       and review.decision = 'accepted'
      where evidence.id = new.completion_evidence_id
        and evidence.tenant_id = new.tenant_id
        and evidence.property_id = new.property_id
        and evidence.employee_id = new.employee_id
        and evidence.employee_fact_version_id =
          new.employee_fact_version_id
        and evidence.training_requirement_version_id =
          new.training_requirement_version_id
        and evidence.accepted_learning_method_id =
          new.accepted_learning_method_id
        and evidence.course_version_id is not distinct from
          new.course_version_id
        and evidence.evidence_date = new.completed_on
        and review.tenant_id = new.tenant_id
        and review.property_id = new.property_id
        and review.reviewed_by = new.verified_by
    ) then
      raise exception 'COMPLETION_RECORD_LINEAGE_MISMATCH'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'completion_record_revocations' then
    if not exists (
      select 1
      from public.completion_records record
      where record.id = new.completion_record_id
        and record.tenant_id = new.tenant_id
        and record.property_id = new.property_id
        and record.completion_evidence_id =
          new.original_completion_evidence_id
    ) then
      raise exception 'COMPLETION_REVOCATION_LINEAGE_MISMATCH'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger completion_evidence_lineage
before insert on public.completion_evidence
for each row execute function app_private.validate_completion_fact_lineage();
create trigger completion_attendance_sources_lineage
before insert on public.completion_attendance_sources
for each row execute function app_private.validate_completion_fact_lineage();
create trigger completion_external_sources_lineage
before insert on public.completion_external_sources
for each row execute function app_private.validate_completion_fact_lineage();
create trigger completion_recognition_sources_lineage
before insert on public.completion_manager_recognition_sources
for each row execute function app_private.validate_completion_fact_lineage();
create trigger completion_records_lineage
before insert on public.completion_records
for each row execute function app_private.validate_completion_fact_lineage();
create trigger completion_revocations_lineage
before insert on public.completion_record_revocations
for each row execute function app_private.validate_completion_fact_lineage();

create or replace function app_private.completion_employee_fact_on(
  p_property_id uuid,
  p_employee_id uuid,
  p_effective_date date
)
returns public.employee_fact_versions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_fact public.employee_fact_versions%rowtype;
begin
  select fact.* into selected_fact
  from public.employee_fact_versions fact
  where fact.property_id = p_property_id
    and fact.employee_id = p_employee_id
    and fact.effective_date <= p_effective_date
  order by fact.effective_date desc, fact.employee_version desc
  limit 1;
  if selected_fact.id is null then
    raise exception '证据发生日期缺少可用的员工事实版本，无法建立完成证据。'
      using errcode = '23514';
  end if;
  return selected_fact;
end;
$$;

create or replace function app_private.assert_completion_actor(
  p_property_id uuid,
  p_department_id uuid,
  p_manager_only boolean default false
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_type text;
begin
  actor_type := app_private.assert_training_property_actor(p_property_id);
  if p_manager_only and actor_type <> 'manager' then
    raise exception '经理等价认定仅限酒店学习与发展经理。'
      using errcode = '42501';
  end if;
  if actor_type = 'department' and (
    p_department_id is null
    or not app_private.has_authorized_department_scope(
      p_property_id,
      p_department_id
    )
  ) then
    raise exception '无权管理此员工在证据发生时的完成事实。'
      using errcode = '42501';
  end if;
  return actor_type;
end;
$$;

create or replace function app_private.append_completion_audit(
  p_tenant_id uuid,
  p_property_id uuid,
  p_completion_evidence_id uuid,
  p_completion_record_id uuid,
  p_event_type text,
  p_reason text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.completion_audit_events(
    tenant_id,
    property_id,
    completion_evidence_id,
    completion_record_id,
    event_type,
    actor_user_id,
    reason,
    details
  ) values (
    p_tenant_id,
    p_property_id,
    p_completion_evidence_id,
    p_completion_record_id,
    p_event_type,
    auth.uid(),
    btrim(p_reason),
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

revoke all on function
  app_private.reject_completion_fact_mutation(),
  app_private.validate_completion_fact_lineage(),
  app_private.completion_employee_fact_on(uuid,uuid,date),
  app_private.assert_completion_actor(uuid,uuid,boolean),
  app_private.append_completion_audit(
    uuid,uuid,uuid,uuid,text,text,jsonb
  )
from public, anon, authenticated;

-- Authorized reader documents -------------------------------------------

create or replace function app_private.completion_workspace_document(
  p_property_id uuid,
  p_department_scoped boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with evidence_rows as (
    select
      evidence.*,
      fact.employee_number,
      coalesce(fact.name_zh, fact.name_en, fact.employee_number)
        as employee_name,
      fact.department_id,
      department.name_zh as department_name,
      requirement.name_zh as requirement_name,
      method.label_zh as method_label,
      method.method_type,
      course_version.name_zh as course_version_name,
      review.id as review_id,
      review.decision as review_decision,
      review.reason as review_reason,
      review.reviewed_at,
      record.id as completion_record_id,
      revocation.id as revocation_id,
      revocation.reason as revocation_reason,
      revocation.revoked_at
    from public.completion_evidence evidence
    join public.employee_fact_versions fact
      on fact.id = evidence.employee_fact_version_id
    left join public.departments department
      on department.id = fact.department_id
    join public.training_requirement_versions requirement
      on requirement.id = evidence.training_requirement_version_id
    join public.accepted_learning_methods method
      on method.id = evidence.accepted_learning_method_id
    left join public.course_versions course_version
      on course_version.id = evidence.course_version_id
    left join public.completion_evidence_reviews review
      on review.completion_evidence_id = evidence.id
    left join public.completion_records record
      on record.completion_evidence_id = evidence.id
    left join public.completion_record_revocations revocation
      on revocation.completion_record_id = record.id
    where evidence.property_id = p_property_id
      and (
        not p_department_scoped
        or (
          fact.department_id is not null
          and app_private.has_authorized_department_scope(
            p_property_id,
            fact.department_id
          )
        )
      )
  ),
  record_rows as (
    select
      record.*,
      evidence.source_type,
      evidence.source_summary,
      evidence.recorded_at,
      fact.employee_number,
      coalesce(fact.name_zh, fact.name_en, fact.employee_number)
        as employee_name,
      fact.department_id,
      department.name_zh as department_name,
      requirement.name_zh as requirement_name,
      method.label_zh as method_label,
      method.method_type,
      course_version.name_zh as course_version_name,
      revocation.id as revocation_id,
      revocation.reason as revocation_reason,
      revocation.revoked_at,
      revocation.revoked_by
    from public.completion_records record
    join public.completion_evidence evidence
      on evidence.id = record.completion_evidence_id
    join public.employee_fact_versions fact
      on fact.id = record.employee_fact_version_id
    left join public.departments department
      on department.id = fact.department_id
    join public.training_requirement_versions requirement
      on requirement.id = record.training_requirement_version_id
    join public.accepted_learning_methods method
      on method.id = record.accepted_learning_method_id
    left join public.course_versions course_version
      on course_version.id = record.course_version_id
    left join public.completion_record_revocations revocation
      on revocation.completion_record_id = record.id
    where record.property_id = p_property_id
      and (
        not p_department_scoped
        or (
          fact.department_id is not null
          and app_private.has_authorized_department_scope(
            p_property_id,
            fact.department_id
          )
        )
      )
  ),
  attendance_candidates as (
    select
      determination.id as attendance_determination_id,
      determination.decided_at,
      register_row.id as attendance_register_id,
      revision.id as session_revision_id,
      revision.name_zh as session_name,
      session_row.code as session_code,
      session_row.training_requirement_version_id,
      session_row.accepted_learning_method_id,
      session_row.course_version_id,
      snapshot.id as participant_snapshot_id,
      snapshot.employee_id,
      snapshot.employee_fact_version_id,
      snapshot.employee_number_snapshot,
      snapshot.employee_name_snapshot,
      snapshot.department_id_snapshot,
      department.name_zh as department_name,
      requirement.name_zh as requirement_name,
      method.label_zh as method_label
    from public.attendance_determinations determination
    join public.attendance_registers register_row
      on register_row.id = determination.attendance_register_id
     and register_row.lifecycle_state = 'closed'
    join public.session_participant_snapshots snapshot
      on snapshot.id = determination.participant_snapshot_id
     and snapshot.session_revision_id = register_row.session_revision_id
    join public.training_session_revisions revision
      on revision.id = register_row.session_revision_id
    join public.training_sessions session_row
      on session_row.id = revision.training_session_id
     and session_row.purpose_type = 'requirement_delivery'
    join public.training_requirement_versions requirement
      on requirement.id = session_row.training_requirement_version_id
    join public.accepted_learning_methods method
      on method.id = session_row.accepted_learning_method_id
     and method.method_type = 'course_version'
    left join public.departments department
      on department.id = snapshot.department_id_snapshot
    where determination.property_id = p_property_id
      and determination.determination = 'present'
      and not exists (
        select 1
        from public.attendance_determinations later
        where later.attendance_register_id =
            determination.attendance_register_id
          and later.participant_snapshot_id =
            determination.participant_snapshot_id
          and later.determination_number >
            determination.determination_number
      )
      and not exists (
        select 1
        from public.completion_attendance_sources source
        where source.attendance_determination_id = determination.id
      )
      and (
        not p_department_scoped
        or (
          snapshot.department_id_snapshot is not null
          and app_private.has_authorized_department_scope(
            p_property_id,
            snapshot.department_id_snapshot
          )
        )
      )
  ),
  employee_options as (
    select distinct on (employee.id)
      employee.id,
      fact.employee_number,
      coalesce(fact.name_zh, fact.name_en, fact.employee_number)
        as employee_name,
      fact.department_id,
      department.name_zh as department_name
    from public.employees employee
    join public.employee_fact_versions fact
      on fact.employee_id = employee.id
     and fact.effective_date <= current_date
    left join public.departments department
      on department.id = fact.department_id
    where employee.property_id = p_property_id
      and (
        not p_department_scoped
        or (
          fact.department_id is not null
          and app_private.has_authorized_department_scope(
            p_property_id,
            fact.department_id
          )
        )
      )
    order by
      employee.id,
      fact.effective_date desc,
      fact.employee_version desc
  ),
  method_options as (
    select
      requirement.id as requirement_version_id,
      requirement.name_zh as requirement_name,
      requirement.lifecycle_state as requirement_state,
      requirement.effective_from,
      requirement.effective_to,
      method.id as method_id,
      method.label_zh as method_label,
      method.method_type,
      method.course_version_id,
      method.certificate_type,
      method.issuer_criteria,
      method.evidence_description,
      method.validity_months,
      method.assessment_name,
      method.pass_criteria,
      method.approval_standard,
      course_version.name_zh as course_version_name
    from public.training_requirement_versions requirement
    join public.completion_definitions definition
      on definition.training_requirement_version_id = requirement.id
    join public.accepted_learning_methods method
      on method.completion_definition_id = definition.id
    left join public.course_versions course_version
      on course_version.id = method.course_version_id
    where requirement.property_id = p_property_id
      and requirement.lifecycle_state in (
        'effective', 'superseded', 'retired'
      )
  )
  select jsonb_build_object(
    'evidence',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', row.id,
            'sourceType', row.source_type,
            'evidenceDate', row.evidence_date,
            'sourceSummary', row.source_summary,
            'employeeId', row.employee_id,
            'employeeFactVersionId', row.employee_fact_version_id,
            'employeeNumber', row.employee_number,
            'employeeName', row.employee_name,
            'departmentId', row.department_id,
            'departmentName', row.department_name,
            'requirementVersionId',
              row.training_requirement_version_id,
            'requirementName', row.requirement_name,
            'acceptedLearningMethodId',
              row.accepted_learning_method_id,
            'acceptedLearningMethodLabel', row.method_label,
            'methodType', row.method_type,
            'courseVersionId', row.course_version_id,
            'courseVersionName', row.course_version_name,
            'recordedAt', row.recorded_at,
            'review',
              case when row.review_id is null then null
              else jsonb_build_object(
                'id', row.review_id,
                'decision', row.review_decision,
                'reason', row.review_reason,
                'reviewedAt', row.reviewed_at
              ) end,
            'completionRecordId', row.completion_record_id,
            'revoked', row.revocation_id is not null,
            'revocationReason', row.revocation_reason,
            'revokedAt', row.revoked_at
          )
          order by row.recorded_at desc
        )
        from evidence_rows row
      ),
      '[]'::jsonb
    ),
    'records',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', row.id,
            'completionEvidenceId', row.completion_evidence_id,
            'sourceType', row.source_type,
            'sourceSummary', row.source_summary,
            'employeeId', row.employee_id,
            'employeeFactVersionId', row.employee_fact_version_id,
            'employeeNumber', row.employee_number,
            'employeeName', row.employee_name,
            'departmentId', row.department_id,
            'departmentName', row.department_name,
            'requirementVersionId',
              row.training_requirement_version_id,
            'requirementName', row.requirement_name,
            'acceptedLearningMethodId',
              row.accepted_learning_method_id,
            'acceptedLearningMethodLabel', row.method_label,
            'methodType', row.method_type,
            'courseVersionId', row.course_version_id,
            'courseVersionName', row.course_version_name,
            'completedOn', row.completed_on,
            'validUntil', row.valid_until,
            'verifiedAt', row.verified_at,
            'supersedesCompletionRecordId',
              row.supersedes_completion_record_id,
            'status',
              case when row.revocation_id is null
                then 'active' else 'revoked' end,
            'revocation',
              case when row.revocation_id is null then null
              else jsonb_build_object(
                'id', row.revocation_id,
                'reason', row.revocation_reason,
                'revokedAt', row.revoked_at
              ) end
          )
          order by row.completed_on desc, row.verified_at desc
        )
        from record_rows row
      ),
      '[]'::jsonb
    ),
    'attendanceCandidates',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'attendanceDeterminationId',
              candidate.attendance_determination_id,
            'sessionRevisionId', candidate.session_revision_id,
            'sessionName', candidate.session_name,
            'sessionCode', candidate.session_code,
            'participantSnapshotId', candidate.participant_snapshot_id,
            'employeeId', candidate.employee_id,
            'employeeFactVersionId',
              candidate.employee_fact_version_id,
            'employeeNumber', candidate.employee_number_snapshot,
            'employeeName', candidate.employee_name_snapshot,
            'departmentId', candidate.department_id_snapshot,
            'departmentName', candidate.department_name,
            'requirementVersionId',
              candidate.training_requirement_version_id,
            'requirementName', candidate.requirement_name,
            'acceptedLearningMethodId',
              candidate.accepted_learning_method_id,
            'acceptedLearningMethodLabel', candidate.method_label,
            'courseVersionId', candidate.course_version_id,
            'decidedAt', candidate.decided_at
          )
          order by candidate.decided_at desc
        )
        from attendance_candidates candidate
      ),
      '[]'::jsonb
    ),
    'employees',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', employee.id,
            'employeeNumber', employee.employee_number,
            'employeeName', employee.employee_name,
            'departmentId', employee.department_id,
            'departmentName', employee.department_name
          )
          order by employee.employee_number
        )
        from employee_options employee
      ),
      '[]'::jsonb
    ),
    'methods',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'requirementVersionId', option.requirement_version_id,
            'requirementName', option.requirement_name,
            'requirementState', option.requirement_state,
            'effectiveFrom', option.effective_from,
            'effectiveTo', option.effective_to,
            'id', option.method_id,
            'label', option.method_label,
            'methodType', option.method_type,
            'courseVersionId', option.course_version_id,
            'courseVersionName', option.course_version_name,
            'certificateType', option.certificate_type,
            'issuerCriteria', option.issuer_criteria,
            'evidenceDescription', option.evidence_description,
            'validityMonths', option.validity_months,
            'assessmentName', option.assessment_name,
            'passCriteria', option.pass_criteria,
            'approvalStandard', option.approval_standard
          )
          order by option.requirement_name, option.method_label
        )
        from method_options option
      ),
      '[]'::jsonb
    )
  );
$$;

create or replace function public.read_completion_workspace(
  p_property_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_name text;
begin
  if not app_private.is_authorized_property_role(
    p_property_id,
    'property_ld_manager'
  ) then
    raise exception '无权查看此酒店的完成证据。'
      using errcode = '42501';
  end if;
  select property.name_zh into selected_name
  from public.properties property
  where property.id = p_property_id;
  return jsonb_build_object(
    'propertyId', p_property_id,
    'propertyName', selected_name,
    'role', 'manager',
    'source', 'real',
    'scope', '[]'::jsonb,
    'boundary', jsonb_build_object(
      'completion', 'real',
      'assignment', 'unavailable',
      'feedback', 'unavailable',
      'kpi', 'unavailable'
    )
  ) || app_private.completion_workspace_document(p_property_id, false);
end;
$$;

create or replace function public.read_department_completion_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_property_id uuid;
  selected_name text;
  scope_document jsonb;
begin
  selected_property_id := app_private.current_training_property();
  if app_private.assert_training_property_actor(selected_property_id)
      <> 'department'
  then
    raise exception '此入口仅供部门培训负责人使用。'
      using errcode = '42501';
  end if;
  select property.name_zh into selected_name
  from public.properties property
  where property.id = selected_property_id;
  scope_document := coalesce((
    select jsonb_agg(jsonb_build_object(
      'departmentId', department.id,
      'departmentName', department.name_zh,
      'includeDescendants', scope.include_descendants,
      'breadcrumb', (
        select jsonb_agg(
          parent_department.name_zh
          order by closure.distance desc
        )
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
  ), '[]'::jsonb);
  return jsonb_build_object(
    'propertyId', selected_property_id,
    'propertyName', selected_name,
    'role', 'department',
    'source', 'real',
    'scope', scope_document,
    'boundary', jsonb_build_object(
      'completion', 'real',
      'assignment', 'unavailable',
      'feedback', 'unavailable',
      'kpi', 'unavailable'
    )
  ) || app_private.completion_workspace_document(
    selected_property_id,
    true
  );
end;
$$;

revoke all on function
  app_private.completion_workspace_document(uuid,boolean),
  public.read_completion_workspace(uuid),
  public.read_department_completion_workspace()
from public, anon, authenticated;

-- Controlled evidence recording -----------------------------------------

create or replace function public.record_attendance_completion_evidence(
  p_attendance_determination_id uuid,
  p_source_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_determination public.attendance_determinations%rowtype;
  selected_tenant_id uuid;
  selected_property_id uuid;
  selected_employee_id uuid;
  selected_employee_fact_version_id uuid;
  selected_department_id uuid;
  selected_requirement_version_id uuid;
  selected_method_id uuid;
  selected_course_version_id uuid;
  selected_session_revision_id uuid;
  selected_participant_snapshot_id uuid;
  selected_evidence_date date;
  selected_evidence_id uuid;
begin
  if btrim(coalesce(p_source_summary, '')) = '' then
    raise exception '请说明 Attendance 证据的核对情况。'
      using errcode = '22023';
  end if;

  select determination.* into selected_determination
  from public.attendance_determinations determination
  where determination.id = p_attendance_determination_id;
  if selected_determination.id is null then
    raise exception '未找到 Attendance Determination。'
      using errcode = 'P0002';
  end if;
  if selected_determination.determination <> 'present' then
    raise exception '只有出席判定可以作为完成证据来源。'
      using errcode = '23514';
  end if;

  select
    determination.tenant_id,
    determination.property_id,
    snapshot.employee_id,
    snapshot.employee_fact_version_id,
    snapshot.department_id_snapshot,
    session_row.training_requirement_version_id,
    session_row.accepted_learning_method_id,
    session_row.course_version_id,
    revision.id,
    snapshot.id,
    (revision.ends_at at time zone revision.timezone)::date
  into
    selected_tenant_id,
    selected_property_id,
    selected_employee_id,
    selected_employee_fact_version_id,
    selected_department_id,
    selected_requirement_version_id,
    selected_method_id,
    selected_course_version_id,
    selected_session_revision_id,
    selected_participant_snapshot_id,
    selected_evidence_date
  from public.attendance_determinations determination
  join public.attendance_registers register_row
    on register_row.id = determination.attendance_register_id
   and register_row.lifecycle_state = 'closed'
  join public.session_participant_snapshots snapshot
    on snapshot.id = determination.participant_snapshot_id
   and snapshot.session_revision_id = register_row.session_revision_id
   and snapshot.employee_fact_version_id =
     determination.employee_fact_version_id
  join public.training_session_revisions revision
    on revision.id = register_row.session_revision_id
  join public.training_sessions session_row
    on session_row.id = revision.training_session_id
   and session_row.purpose_type = 'requirement_delivery'
  join public.accepted_learning_methods method
    on method.id = session_row.accepted_learning_method_id
   and method.method_type = 'course_version'
   and method.course_version_id = session_row.course_version_id
  where determination.id = p_attendance_determination_id
    and not exists (
      select 1
      from public.attendance_determinations later
      where later.attendance_register_id =
          determination.attendance_register_id
        and later.participant_snapshot_id =
          determination.participant_snapshot_id
        and later.determination_number >
          determination.determination_number
    );
  if selected_property_id is null then
    raise exception
      'Attendance 必须来自已关闭登记册的当前出席判定和培训要求场次。'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.completion_attendance_sources source
    where source.attendance_determination_id =
      p_attendance_determination_id
  ) then
    raise exception '该 Attendance Determination 已登记为完成证据。'
      using errcode = 'P0001';
  end if;

  perform app_private.assert_completion_actor(
    selected_property_id,
    selected_department_id,
    false
  );

  insert into public.completion_evidence(
    tenant_id,
    property_id,
    employee_id,
    employee_fact_version_id,
    training_requirement_version_id,
    accepted_learning_method_id,
    course_version_id,
    source_type,
    evidence_date,
    source_summary,
    integrity_hash,
    recorded_by
  ) values (
    selected_tenant_id,
    selected_property_id,
    selected_employee_id,
    selected_employee_fact_version_id,
    selected_requirement_version_id,
    selected_method_id,
    selected_course_version_id,
    'attendance',
    selected_evidence_date,
    btrim(p_source_summary),
    encode(
      extensions.digest(
        p_attendance_determination_id::text || ':' ||
        selected_session_revision_id::text || ':' ||
        selected_employee_fact_version_id::text || ':' ||
        selected_requirement_version_id::text || ':' ||
        selected_method_id::text || ':' ||
        selected_evidence_date::text || ':' ||
        btrim(p_source_summary),
        'sha256'
      ),
      'hex'
    ),
    auth.uid()
  )
  returning id into selected_evidence_id;

  insert into public.completion_attendance_sources(
    completion_evidence_id,
    tenant_id,
    property_id,
    session_revision_id,
    participant_snapshot_id,
    attendance_determination_id
  ) values (
    selected_evidence_id,
    selected_tenant_id,
    selected_property_id,
    selected_session_revision_id,
    selected_participant_snapshot_id,
    p_attendance_determination_id
  );

  insert into public.employee_fact_dependencies(
    tenant_id,
    property_id,
    employee_id,
    employee_fact_version_id,
    fact_type,
    fact_id
  ) values (
    selected_tenant_id,
    selected_property_id,
    selected_employee_id,
    selected_employee_fact_version_id,
    'completion_evidence',
    selected_evidence_id
  );

  perform app_private.append_completion_audit(
    selected_tenant_id,
    selected_property_id,
    selected_evidence_id,
    null,
    'evidence_recorded',
    '登记 Attendance 来源完成证据。',
    jsonb_build_object(
      'sourceType', 'attendance',
      'attendanceDeterminationId', p_attendance_determination_id,
      'sessionRevisionId', selected_session_revision_id
    )
  );

  return jsonb_build_object(
    'id', selected_evidence_id,
    'factType', 'completion_evidence',
    'reviewState', 'pending',
    'source', 'real'
  );
end;
$$;

create or replace function public.record_external_completion_evidence(
  p_employee_id uuid,
  p_requirement_version_id uuid,
  p_accepted_learning_method_id uuid,
  p_issuer_name text,
  p_credential_reference text,
  p_issued_on date,
  p_expires_on date,
  p_source_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_tenant_id uuid;
  selected_property_id uuid;
  selected_validity_months integer;
  selected_fact public.employee_fact_versions%rowtype;
  selected_evidence_id uuid;
begin
  if p_issued_on is null then
    raise exception '请选择证据发生日期。' using errcode = '22023';
  end if;
  if p_expires_on is not null and p_expires_on < p_issued_on then
    raise exception '证书有效期不能早于发证日期。'
      using errcode = '22023';
  end if;
  if btrim(coalesce(p_issuer_name, '')) = ''
    or btrim(coalesce(p_credential_reference, '')) = ''
    or btrim(coalesce(p_source_summary, '')) = ''
  then
    raise exception '外部证据必须包含发证机构、凭证编号和核对说明。'
      using errcode = '22023';
  end if;

  select
    method.tenant_id,
    method.property_id,
    method.validity_months
  into
    selected_tenant_id,
    selected_property_id,
    selected_validity_months
  from public.accepted_learning_methods method
  join public.completion_definitions definition
    on definition.id = method.completion_definition_id
  join public.training_requirement_versions requirement
    on requirement.id = definition.training_requirement_version_id
  where method.id = p_accepted_learning_method_id
    and method.method_type = 'external_certificate'
    and requirement.id = p_requirement_version_id
    and requirement.lifecycle_state in (
      'effective', 'superseded', 'retired'
    )
    and p_issued_on >= requirement.effective_from
    and (
      requirement.effective_to is null
      or p_issued_on <= requirement.effective_to
    );
  if selected_property_id is null then
    raise exception '所选完成方式不是外部证书方法。'
      using errcode = '23514';
  end if;

  selected_fact := app_private.completion_employee_fact_on(
    selected_property_id,
    p_employee_id,
    p_issued_on
  );
  perform app_private.assert_completion_actor(
    selected_property_id,
    selected_fact.department_id,
    false
  );

  if p_expires_on is not null
    and selected_validity_months is not null
    and p_expires_on > (
      p_issued_on + make_interval(months => selected_validity_months)
    )::date
  then
    raise exception '证书有效期超过该完成方式允许的有效期限。'
      using errcode = '23514';
  end if;

  insert into public.completion_evidence(
    tenant_id,
    property_id,
    employee_id,
    employee_fact_version_id,
    training_requirement_version_id,
    accepted_learning_method_id,
    source_type,
    evidence_date,
    source_summary,
    integrity_hash,
    recorded_by
  ) values (
    selected_tenant_id,
    selected_property_id,
    p_employee_id,
    selected_fact.id,
    p_requirement_version_id,
    p_accepted_learning_method_id,
    'external_evidence',
    p_issued_on,
    btrim(p_source_summary),
    encode(
      extensions.digest(
        p_employee_id::text || ':' ||
        selected_fact.id::text || ':' ||
        p_requirement_version_id::text || ':' ||
        p_accepted_learning_method_id::text || ':' ||
        btrim(p_issuer_name) || ':' ||
        btrim(p_credential_reference) || ':' ||
        p_issued_on::text || ':' ||
        coalesce(p_expires_on::text, '') || ':' ||
        btrim(p_source_summary),
        'sha256'
      ),
      'hex'
    ),
    auth.uid()
  )
  returning id into selected_evidence_id;

  insert into public.completion_external_sources(
    completion_evidence_id,
    tenant_id,
    property_id,
    issuer_name,
    credential_reference,
    issued_on,
    expires_on,
    evidence_description
  ) values (
    selected_evidence_id,
    selected_tenant_id,
    selected_property_id,
    btrim(p_issuer_name),
    btrim(p_credential_reference),
    p_issued_on,
    p_expires_on,
    btrim(p_source_summary)
  );

  insert into public.employee_fact_dependencies(
    tenant_id, property_id, employee_id, employee_fact_version_id,
    fact_type, fact_id
  ) values (
    selected_tenant_id, selected_property_id, p_employee_id,
    selected_fact.id, 'completion_evidence', selected_evidence_id
  );

  perform app_private.append_completion_audit(
    selected_tenant_id,
    selected_property_id,
    selected_evidence_id,
    null,
    'evidence_recorded',
    '登记外部来源完成证据。',
    jsonb_build_object(
      'sourceType', 'external_evidence',
      'issuedOn', p_issued_on,
      'expiresOn', p_expires_on
    )
  );

  return jsonb_build_object(
    'id', selected_evidence_id,
    'factType', 'completion_evidence',
    'reviewState', 'pending',
    'source', 'real'
  );
end;
$$;

create or replace function
  public.record_manager_recognition_evidence(
    p_employee_id uuid,
    p_requirement_version_id uuid,
    p_accepted_learning_method_id uuid,
    p_recognition_date date,
    p_recognition_basis text
  )
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_tenant_id uuid;
  selected_property_id uuid;
  selected_approval_standard text;
  selected_fact public.employee_fact_versions%rowtype;
  selected_evidence_id uuid;
begin
  if p_recognition_date is null then
    raise exception '请选择等价认定日期。' using errcode = '22023';
  end if;
  if btrim(coalesce(p_recognition_basis, '')) = '' then
    raise exception '经理等价认定必须说明认定依据。'
      using errcode = '22023';
  end if;

  select
    method.tenant_id,
    method.property_id,
    method.approval_standard
  into
    selected_tenant_id,
    selected_property_id,
    selected_approval_standard
  from public.accepted_learning_methods method
  join public.completion_definitions definition
    on definition.id = method.completion_definition_id
  join public.training_requirement_versions requirement
    on requirement.id = definition.training_requirement_version_id
  where method.id = p_accepted_learning_method_id
    and method.method_type = 'manager_equivalency'
    and requirement.id = p_requirement_version_id
    and requirement.lifecycle_state in (
      'effective', 'superseded', 'retired'
    )
    and p_recognition_date >= requirement.effective_from
    and (
      requirement.effective_to is null
      or p_recognition_date <= requirement.effective_to
    );
  if selected_property_id is null then
    raise exception '所选完成方式不是经理等价认定方法。'
      using errcode = '23514';
  end if;

  selected_fact := app_private.completion_employee_fact_on(
    selected_property_id,
    p_employee_id,
    p_recognition_date
  );
  perform app_private.assert_completion_actor(
    selected_property_id,
    selected_fact.department_id,
    true
  );

  insert into public.completion_evidence(
    tenant_id,
    property_id,
    employee_id,
    employee_fact_version_id,
    training_requirement_version_id,
    accepted_learning_method_id,
    source_type,
    evidence_date,
    source_summary,
    integrity_hash,
    recorded_by
  ) values (
    selected_tenant_id,
    selected_property_id,
    p_employee_id,
    selected_fact.id,
    p_requirement_version_id,
    p_accepted_learning_method_id,
    'manager_recognition',
    p_recognition_date,
    btrim(p_recognition_basis),
    encode(
      extensions.digest(
        p_employee_id::text || ':' ||
        selected_fact.id::text || ':' ||
        p_requirement_version_id::text || ':' ||
        p_accepted_learning_method_id::text || ':' ||
        p_recognition_date::text || ':' ||
        btrim(p_recognition_basis) || ':' ||
        selected_approval_standard,
        'sha256'
      ),
      'hex'
    ),
    auth.uid()
  )
  returning id into selected_evidence_id;

  insert into public.completion_manager_recognition_sources(
    completion_evidence_id,
    tenant_id,
    property_id,
    recognition_date,
    recognition_basis,
    approval_standard_snapshot,
    recognized_by
  ) values (
    selected_evidence_id,
    selected_tenant_id,
    selected_property_id,
    p_recognition_date,
    btrim(p_recognition_basis),
    selected_approval_standard,
    auth.uid()
  );

  insert into public.employee_fact_dependencies(
    tenant_id, property_id, employee_id, employee_fact_version_id,
    fact_type, fact_id
  ) values (
    selected_tenant_id, selected_property_id, p_employee_id,
    selected_fact.id, 'completion_evidence', selected_evidence_id
  );

  perform app_private.append_completion_audit(
    selected_tenant_id,
    selected_property_id,
    selected_evidence_id,
    null,
    'evidence_recorded',
    '登记经理等价认定完成证据。',
    jsonb_build_object(
      'sourceType', 'manager_recognition',
      'recognitionDate', p_recognition_date
    )
  );

  return jsonb_build_object(
    'id', selected_evidence_id,
    'factType', 'completion_evidence',
    'reviewState', 'pending',
    'source', 'real'
  );
end;
$$;

-- Explicit review, Completion and revocation -----------------------------

create or replace function public.review_completion_evidence(
  p_completion_evidence_id uuid,
  p_decision text,
  p_reason text,
  p_supersedes_completion_record_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_evidence public.completion_evidence%rowtype;
  selected_department_id uuid;
  selected_actor_type text;
  selected_review_id uuid;
  selected_record_id uuid;
  selected_valid_until date;
  selected_validity_months integer;
begin
  if p_decision not in ('accepted', 'rejected') then
    raise exception '核验决定必须是接受或拒绝。'
      using errcode = '22023';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception '核验决定必须说明原因。'
      using errcode = '22023';
  end if;

  select evidence.* into selected_evidence
  from public.completion_evidence evidence
  where evidence.id = p_completion_evidence_id
  for update;
  if selected_evidence.id is null then
    raise exception '未找到完成证据。' using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from public.completion_evidence_reviews review
    where review.completion_evidence_id = selected_evidence.id
  ) then
    raise exception '完成证据已被其他用户核验，请重新读取。'
      using errcode = 'P0001';
  end if;

  select fact.department_id into selected_department_id
  from public.employee_fact_versions fact
  where fact.id = selected_evidence.employee_fact_version_id;
  selected_actor_type := app_private.assert_completion_actor(
    selected_evidence.property_id,
    selected_department_id,
    selected_evidence.source_type = 'manager_recognition'
  );

  insert into public.completion_evidence_reviews(
    tenant_id,
    property_id,
    completion_evidence_id,
    decision,
    reason,
    reviewed_by
  ) values (
    selected_evidence.tenant_id,
    selected_evidence.property_id,
    selected_evidence.id,
    p_decision,
    btrim(p_reason),
    auth.uid()
  )
  returning id into selected_review_id;

  if p_decision = 'rejected' then
    perform app_private.append_completion_audit(
      selected_evidence.tenant_id,
      selected_evidence.property_id,
      selected_evidence.id,
      null,
      'evidence_rejected',
      btrim(p_reason),
      jsonb_build_object('actorType', selected_actor_type)
    );
    return jsonb_build_object(
      'id', selected_review_id,
      'factType', 'completion_evidence_review',
      'reviewState', 'rejected',
      'source', 'real'
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      selected_evidence.employee_id::text || ':' ||
      selected_evidence.training_requirement_version_id::text,
      0
    )
  );

  if p_supersedes_completion_record_id is not null and not exists (
    select 1
    from public.completion_records predecessor
    join public.completion_record_revocations revocation
      on revocation.completion_record_id = predecessor.id
    where predecessor.id = p_supersedes_completion_record_id
      and predecessor.property_id = selected_evidence.property_id
      and predecessor.employee_id = selected_evidence.employee_id
      and predecessor.training_requirement_version_id =
        selected_evidence.training_requirement_version_id
  ) then
    raise exception '替代记录必须指向同一员工、同一要求版本的已撤销完成记录。'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.completion_records existing
    where existing.property_id = selected_evidence.property_id
      and existing.employee_id = selected_evidence.employee_id
      and existing.training_requirement_version_id =
        selected_evidence.training_requirement_version_id
      and not exists (
        select 1
        from public.completion_record_revocations revocation
        where revocation.completion_record_id = existing.id
      )
  ) then
    raise exception '该员工已有此要求版本的有效完成记录。'
      using errcode = 'P0001';
  end if;

  select method.validity_months into selected_validity_months
  from public.accepted_learning_methods method
  where method.id = selected_evidence.accepted_learning_method_id;
  if selected_evidence.source_type = 'external_evidence' then
    select source.expires_on into selected_valid_until
    from public.completion_external_sources source
    where source.completion_evidence_id = selected_evidence.id;
  end if;
  if selected_valid_until is null and selected_validity_months is not null then
    selected_valid_until := (
      selected_evidence.evidence_date +
        make_interval(months => selected_validity_months)
    )::date;
  end if;

  insert into public.completion_records(
    tenant_id,
    property_id,
    completion_evidence_id,
    completion_evidence_review_id,
    employee_id,
    employee_fact_version_id,
    training_requirement_version_id,
    accepted_learning_method_id,
    course_version_id,
    completed_on,
    valid_until,
    supersedes_completion_record_id,
    verified_by
  ) values (
    selected_evidence.tenant_id,
    selected_evidence.property_id,
    selected_evidence.id,
    selected_review_id,
    selected_evidence.employee_id,
    selected_evidence.employee_fact_version_id,
    selected_evidence.training_requirement_version_id,
    selected_evidence.accepted_learning_method_id,
    selected_evidence.course_version_id,
    selected_evidence.evidence_date,
    selected_valid_until,
    p_supersedes_completion_record_id,
    auth.uid()
  )
  returning id into selected_record_id;

  insert into public.employee_fact_dependencies(
    tenant_id, property_id, employee_id, employee_fact_version_id,
    fact_type, fact_id
  ) values (
    selected_evidence.tenant_id,
    selected_evidence.property_id,
    selected_evidence.employee_id,
    selected_evidence.employee_fact_version_id,
    'completion_record',
    selected_record_id
  );

  perform app_private.append_completion_audit(
    selected_evidence.tenant_id,
    selected_evidence.property_id,
    selected_evidence.id,
    selected_record_id,
    'evidence_accepted',
    btrim(p_reason),
    jsonb_build_object('actorType', selected_actor_type)
  );
  perform app_private.append_completion_audit(
    selected_evidence.tenant_id,
    selected_evidence.property_id,
    selected_evidence.id,
    selected_record_id,
    'completion_recorded',
    '核验通过后建立不可变完成记录。',
    jsonb_build_object(
      'supersedesCompletionRecordId',
      p_supersedes_completion_record_id
    )
  );

  return jsonb_build_object(
    'id', selected_record_id,
    'factType', 'completion_record',
    'reviewState', 'accepted',
    'recordStatus', 'active',
    'source', 'real'
  );
end;
$$;

create or replace function public.revoke_completion_record(
  p_completion_record_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_record public.completion_records%rowtype;
  selected_evidence public.completion_evidence%rowtype;
  selected_department_id uuid;
  selected_revocation_id uuid;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception '撤销完成记录必须说明原因。'
      using errcode = '22023';
  end if;
  select record.* into selected_record
  from public.completion_records record
  where record.id = p_completion_record_id
  for update;
  if selected_record.id is null then
    raise exception '未找到完成记录。' using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from public.completion_record_revocations revocation
    where revocation.completion_record_id = selected_record.id
  ) then
    raise exception '完成记录已被撤销，请重新读取。'
      using errcode = 'P0001';
  end if;
  select evidence.* into selected_evidence
  from public.completion_evidence evidence
  where evidence.id = selected_record.completion_evidence_id;
  select fact.department_id into selected_department_id
  from public.employee_fact_versions fact
  where fact.id = selected_record.employee_fact_version_id;

  perform app_private.assert_completion_actor(
    selected_record.property_id,
    selected_department_id,
    selected_evidence.source_type = 'manager_recognition'
  );

  insert into public.completion_record_revocations(
    tenant_id,
    property_id,
    completion_record_id,
    original_completion_evidence_id,
    reason,
    revoked_by
  ) values (
    selected_record.tenant_id,
    selected_record.property_id,
    selected_record.id,
    selected_record.completion_evidence_id,
    btrim(p_reason),
    auth.uid()
  )
  returning id into selected_revocation_id;

  perform app_private.append_completion_audit(
    selected_record.tenant_id,
    selected_record.property_id,
    selected_record.completion_evidence_id,
    selected_record.id,
    'completion_revoked',
    btrim(p_reason),
    jsonb_build_object('revocationId', selected_revocation_id)
  );

  return jsonb_build_object(
    'id', selected_revocation_id,
    'factType', 'completion_record_revocation',
    'completionRecordId', selected_record.id,
    'recordStatus', 'revoked',
    'source', 'real'
  );
end;
$$;

revoke all on function
  public.record_attendance_completion_evidence(uuid,text),
  public.record_external_completion_evidence(
    uuid,uuid,uuid,text,text,date,date,text
  ),
  public.record_manager_recognition_evidence(
    uuid,uuid,uuid,date,text
  ),
  public.review_completion_evidence(uuid,text,text,uuid),
  public.revoke_completion_record(uuid,text)
from public, anon, authenticated;

grant execute on function
  public.read_completion_workspace(uuid),
  public.read_department_completion_workspace(),
  public.record_attendance_completion_evidence(uuid,text),
  public.record_external_completion_evidence(
    uuid,uuid,uuid,text,text,date,date,text
  ),
  public.record_manager_recognition_evidence(
    uuid,uuid,uuid,date,text
  ),
  public.review_completion_evidence(uuid,text,text,uuid),
  public.revoke_completion_record(uuid,text)
to authenticated;
