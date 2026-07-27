-- Recovery D3: independent Attendance Fact foundation.
-- Attendance answers only whether a snapshotted employee participated in an
-- immutable training delivery. It creates no HR attendance, Completion,
-- Requirement fulfillment, KPI, Health, Forecast, Risk, intervention or AI
-- fact.

alter table public.session_participant_snapshots
  add column snapshot_origin text not null default 'published_roster',
  add column inclusion_reason text,
  add column supplemental_authorized_by uuid
    references auth.users(id) on delete set null,
  add column affects_requirement_eligibility boolean,
  add column requires_follow_up boolean;

alter table public.session_participant_snapshots
  add constraint participant_snapshots_origin_check check (
    snapshot_origin in ('published_roster', 'supplemental')
  ),
  add constraint participant_snapshots_scope_key
    unique (id, tenant_id, property_id),
  add constraint participant_snapshots_supplemental_shape_check check (
    (
      snapshot_origin = 'published_roster'
      and inclusion_reason is null
      and supplemental_authorized_by is null
      and affects_requirement_eligibility is null
      and requires_follow_up is null
    )
    or (
      snapshot_origin = 'supplemental'
      and btrim(coalesce(inclusion_reason, '')) <> ''
      and supplemental_authorized_by is not null
      and affects_requirement_eligibility is not null
      and requires_follow_up is not null
    )
  );

create table public.attendance_registers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  session_revision_id uuid not null,
  lifecycle_state text not null default 'open',
  version bigint not null default 1,
  opened_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  closure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_registers_revision_fkey
    foreign key (session_revision_id, tenant_id, property_id)
    references public.training_session_revisions(id, tenant_id, property_id)
    on delete restrict,
  constraint attendance_registers_scope_key
    unique (id, tenant_id, property_id),
  constraint attendance_registers_revision_key
    unique (session_revision_id),
  constraint attendance_registers_state_check check (
    lifecycle_state in ('open', 'reconciling', 'closed')
  ),
  constraint attendance_registers_version_check check (version > 0),
  constraint attendance_registers_closure_shape_check check (
    (
      lifecycle_state = 'closed'
      and closed_at is not null
      and btrim(coalesce(closure_reason, '')) <> ''
    )
    or (
      lifecycle_state <> 'closed'
      and closed_at is null
      and closure_reason is null
    )
  )
);

create table public.attendance_register_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  attendance_register_id uuid not null,
  event_type text not null,
  from_state text,
  to_state text not null,
  reason text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint attendance_register_events_register_fkey
    foreign key (attendance_register_id, tenant_id, property_id)
    references public.attendance_registers(id, tenant_id, property_id)
    on delete restrict,
  constraint attendance_register_events_state_check check (
    (from_state is null or from_state in ('open', 'reconciling', 'closed'))
    and to_state in ('open', 'reconciling', 'closed')
  ),
  constraint attendance_register_events_type_check check (
    event_type in (
      'opened', 'reconciliation_started', 'closed', 'reopened',
      'checkin_grant_issued', 'checkin_grant_revoked',
      'supplemental_participant_added'
    )
  ),
  constraint attendance_register_events_reason_check check (
    btrim(reason) <> ''
  ),
  constraint attendance_register_events_evidence_check check (
    jsonb_typeof(evidence) = 'object'
  )
);

create table public.attendance_evidence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  attendance_register_id uuid not null,
  participant_snapshot_id uuid not null,
  evidence_type text not null,
  source_summary text not null,
  integrity_hash text not null,
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  constraint attendance_evidence_register_fkey
    foreign key (attendance_register_id, tenant_id, property_id)
    references public.attendance_registers(id, tenant_id, property_id)
    on delete restrict,
  constraint attendance_evidence_participant_fkey
    foreign key (participant_snapshot_id, tenant_id, property_id)
    references public.session_participant_snapshots(id, tenant_id, property_id)
    on delete restrict,
  constraint attendance_evidence_type_check check (
    evidence_type in ('qr_server_receipt', 'manual_witness')
  ),
  constraint attendance_evidence_summary_check check (
    btrim(source_summary) <> ''
  ),
  constraint attendance_evidence_hash_check check (
    btrim(integrity_hash) <> ''
  )
);

create table public.attendance_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  attendance_register_id uuid not null,
  participant_snapshot_id uuid not null,
  employee_fact_version_id uuid not null,
  attendance_evidence_id uuid not null,
  observation_source text not null,
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  within_capture_window boolean not null,
  requires_review boolean not null default false,
  idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  constraint attendance_observations_register_fkey
    foreign key (attendance_register_id, tenant_id, property_id)
    references public.attendance_registers(id, tenant_id, property_id)
    on delete restrict,
  constraint attendance_observations_participant_fkey
    foreign key (participant_snapshot_id, tenant_id, property_id)
    references public.session_participant_snapshots(id, tenant_id, property_id)
    on delete restrict,
  constraint attendance_observations_fact_version_fkey
    foreign key (employee_fact_version_id)
    references public.employee_fact_versions(id) on delete restrict,
  constraint attendance_observations_evidence_fkey
    foreign key (attendance_evidence_id)
    references public.attendance_evidence(id) on delete restrict,
  constraint attendance_observations_source_check check (
    observation_source in ('qr_self_check_in', 'manual_witness')
  ),
  constraint attendance_observations_time_check check (
    received_at >= observed_at - interval '24 hours'
  ),
  constraint attendance_observations_idempotency_check check (
    btrim(idempotency_key) <> ''
  ),
  constraint attendance_observations_idempotency_key
    unique (attendance_register_id, idempotency_key)
);

create table public.attendance_determinations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  attendance_register_id uuid not null,
  participant_snapshot_id uuid not null,
  employee_fact_version_id uuid not null,
  determination_number integer not null,
  determination text not null,
  reason text not null,
  supersedes_determination_id uuid,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz not null default now(),
  constraint attendance_determinations_register_fkey
    foreign key (attendance_register_id, tenant_id, property_id)
    references public.attendance_registers(id, tenant_id, property_id)
    on delete restrict,
  constraint attendance_determinations_participant_fkey
    foreign key (participant_snapshot_id, tenant_id, property_id)
    references public.session_participant_snapshots(id, tenant_id, property_id)
    on delete restrict,
  constraint attendance_determinations_fact_version_fkey
    foreign key (employee_fact_version_id)
    references public.employee_fact_versions(id) on delete restrict,
  constraint attendance_determinations_supersedes_fkey
    foreign key (supersedes_determination_id)
    references public.attendance_determinations(id) on delete restrict,
  constraint attendance_determinations_value_check check (
    determination in (
      'present', 'absent', 'excused_absence', 'unable_to_determine'
    )
  ),
  constraint attendance_determinations_number_check check (
    determination_number > 0
  ),
  constraint attendance_determinations_reason_check check (
    btrim(reason) <> ''
  ),
  constraint attendance_determinations_lineage_key
    unique (
      attendance_register_id,
      participant_snapshot_id,
      determination_number
    )
);

create table public.attendance_determination_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  attendance_register_id uuid not null,
  attendance_determination_id uuid not null,
  attendance_observation_id uuid not null,
  created_at timestamptz not null default now(),
  constraint determination_observations_register_fkey
    foreign key (attendance_register_id, tenant_id, property_id)
    references public.attendance_registers(id, tenant_id, property_id)
    on delete restrict,
  constraint determination_observations_determination_fkey
    foreign key (attendance_determination_id)
    references public.attendance_determinations(id) on delete restrict,
  constraint determination_observations_observation_fkey
    foreign key (attendance_observation_id)
    references public.attendance_observations(id) on delete restrict,
  constraint determination_observations_key
    unique (attendance_determination_id, attendance_observation_id)
);

create table public.attendance_checkin_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  attendance_register_id uuid not null,
  token_hash text not null,
  lifecycle_state text not null default 'active',
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  version bigint not null default 1,
  issued_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  constraint attendance_checkin_grants_register_fkey
    foreign key (attendance_register_id, tenant_id, property_id)
    references public.attendance_registers(id, tenant_id, property_id)
    on delete restrict,
  constraint attendance_checkin_grants_hash_key unique (token_hash),
  constraint attendance_checkin_grants_scope_key
    unique (id, tenant_id, property_id),
  constraint attendance_checkin_grants_state_check check (
    lifecycle_state in ('active', 'revoked', 'expired')
  ),
  constraint attendance_checkin_grants_window_check check (
    valid_until > valid_from
  ),
  constraint attendance_checkin_grants_version_check check (version > 0),
  constraint attendance_checkin_grants_revocation_check check (
    (
      lifecycle_state = 'revoked'
      and revoked_at is not null
    )
    or (
      lifecycle_state <> 'revoked'
      and revoked_at is null
      and revoked_by is null
    )
  )
);

create table public.attendance_checkin_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  attendance_register_id uuid not null,
  attendance_checkin_grant_id uuid not null,
  participant_snapshot_id uuid,
  idempotency_key text not null,
  identity_hash text not null,
  outcome text not null,
  attempted_at timestamptz not null default now(),
  constraint attendance_checkin_attempts_register_fkey
    foreign key (attendance_register_id, tenant_id, property_id)
    references public.attendance_registers(id, tenant_id, property_id)
    on delete restrict,
  constraint attendance_checkin_attempts_grant_fkey
    foreign key (attendance_checkin_grant_id, tenant_id, property_id)
    references public.attendance_checkin_grants(id, tenant_id, property_id)
    on delete restrict,
  constraint attendance_checkin_attempts_participant_fkey
    foreign key (participant_snapshot_id, tenant_id, property_id)
    references public.session_participant_snapshots(id, tenant_id, property_id)
    on delete restrict,
  constraint attendance_checkin_attempts_idempotency_check check (
    btrim(idempotency_key) <> ''
  ),
  constraint attendance_checkin_attempts_identity_check check (
    btrim(identity_hash) <> ''
  ),
  constraint attendance_checkin_attempts_outcome_check check (
    outcome in ('accepted', 'already_recorded', 'unable_to_check_in')
  ),
  constraint attendance_checkin_attempts_idempotency_key
    unique (attendance_checkin_grant_id, idempotency_key)
);

create index attendance_registers_property_idx
  on public.attendance_registers(property_id);
create index attendance_registers_revision_idx
  on public.attendance_registers(session_revision_id);
create index attendance_register_events_register_idx
  on public.attendance_register_events(attendance_register_id);
create index attendance_evidence_register_idx
  on public.attendance_evidence(attendance_register_id);
create index attendance_evidence_participant_idx
  on public.attendance_evidence(participant_snapshot_id);
create index attendance_observations_register_idx
  on public.attendance_observations(attendance_register_id);
create index attendance_observations_participant_idx
  on public.attendance_observations(participant_snapshot_id);
create index attendance_observations_fact_version_idx
  on public.attendance_observations(employee_fact_version_id);
create index attendance_observations_evidence_idx
  on public.attendance_observations(attendance_evidence_id);
create index attendance_determinations_register_idx
  on public.attendance_determinations(attendance_register_id);
create index attendance_determinations_participant_idx
  on public.attendance_determinations(participant_snapshot_id);
create index attendance_determinations_fact_version_idx
  on public.attendance_determinations(employee_fact_version_id);
create index attendance_determinations_supersedes_idx
  on public.attendance_determinations(supersedes_determination_id);
create index determination_observations_register_idx
  on public.attendance_determination_observations(attendance_register_id);
create index determination_observations_determination_idx
  on public.attendance_determination_observations(
    attendance_determination_id
  );
create index determination_observations_observation_idx
  on public.attendance_determination_observations(
    attendance_observation_id
  );
create index attendance_checkin_grants_register_idx
  on public.attendance_checkin_grants(attendance_register_id);
create index attendance_checkin_attempts_register_idx
  on public.attendance_checkin_attempts(attendance_register_id);
create index attendance_checkin_attempts_grant_idx
  on public.attendance_checkin_attempts(attendance_checkin_grant_id);
create index attendance_checkin_attempts_participant_idx
  on public.attendance_checkin_attempts(participant_snapshot_id);
create index attendance_checkin_attempts_rate_idx
  on public.attendance_checkin_attempts(
    attendance_checkin_grant_id,
    attempted_at desc
  );

alter table public.attendance_registers enable row level security;
alter table public.attendance_registers force row level security;
alter table public.attendance_register_events enable row level security;
alter table public.attendance_register_events force row level security;
alter table public.attendance_evidence enable row level security;
alter table public.attendance_evidence force row level security;
alter table public.attendance_observations enable row level security;
alter table public.attendance_observations force row level security;
alter table public.attendance_determinations enable row level security;
alter table public.attendance_determinations force row level security;
alter table public.attendance_determination_observations
  enable row level security;
alter table public.attendance_determination_observations
  force row level security;
alter table public.attendance_checkin_grants enable row level security;
alter table public.attendance_checkin_grants force row level security;
alter table public.attendance_checkin_attempts enable row level security;
alter table public.attendance_checkin_attempts force row level security;

revoke all on
  public.attendance_registers,
  public.attendance_register_events,
  public.attendance_evidence,
  public.attendance_observations,
  public.attendance_determinations,
  public.attendance_determination_observations,
  public.attendance_checkin_grants,
  public.attendance_checkin_attempts
from public, anon, authenticated;

create or replace function app_private.validate_attendance_fact_lineage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'attendance_evidence' then
    if not exists (
      select 1
      from public.attendance_registers register_row
      join public.session_participant_snapshots snapshot
        on snapshot.id = new.participant_snapshot_id
       and snapshot.session_revision_id = register_row.session_revision_id
       and snapshot.tenant_id = register_row.tenant_id
       and snapshot.property_id = register_row.property_id
      where register_row.id = new.attendance_register_id
        and register_row.tenant_id = new.tenant_id
        and register_row.property_id = new.property_id
        and snapshot.selected
    ) then
      raise exception 'ATTENDANCE_FACT_LINEAGE_MISMATCH'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'attendance_observations' then
    if not exists (
      select 1
      from public.attendance_registers register_row
      join public.session_participant_snapshots snapshot
        on snapshot.id = new.participant_snapshot_id
       and snapshot.session_revision_id = register_row.session_revision_id
       and snapshot.employee_fact_version_id =
         new.employee_fact_version_id
       and snapshot.tenant_id = register_row.tenant_id
       and snapshot.property_id = register_row.property_id
      join public.employee_fact_versions fact
        on fact.id = new.employee_fact_version_id
       and fact.employee_id = snapshot.employee_id
      join public.attendance_evidence evidence
        on evidence.id = new.attendance_evidence_id
       and evidence.attendance_register_id = register_row.id
       and evidence.participant_snapshot_id = snapshot.id
      where register_row.id = new.attendance_register_id
        and register_row.tenant_id = new.tenant_id
        and register_row.property_id = new.property_id
        and snapshot.selected
    ) then
      raise exception 'ATTENDANCE_FACT_LINEAGE_MISMATCH'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'attendance_determinations' then
    if not exists (
      select 1
      from public.attendance_registers register_row
      join public.session_participant_snapshots snapshot
        on snapshot.id = new.participant_snapshot_id
       and snapshot.session_revision_id = register_row.session_revision_id
       and snapshot.employee_fact_version_id =
         new.employee_fact_version_id
       and snapshot.tenant_id = register_row.tenant_id
       and snapshot.property_id = register_row.property_id
      join public.employee_fact_versions fact
        on fact.id = new.employee_fact_version_id
       and fact.employee_id = snapshot.employee_id
      where register_row.id = new.attendance_register_id
        and register_row.tenant_id = new.tenant_id
        and register_row.property_id = new.property_id
        and snapshot.selected
    ) then
      raise exception 'ATTENDANCE_FACT_LINEAGE_MISMATCH'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'attendance_determination_observations' then
    if not exists (
      select 1
      from public.attendance_determinations determination
      join public.attendance_observations observation
        on observation.id = new.attendance_observation_id
       and observation.attendance_register_id =
         determination.attendance_register_id
       and observation.participant_snapshot_id =
         determination.participant_snapshot_id
       and observation.employee_fact_version_id =
         determination.employee_fact_version_id
      where determination.id = new.attendance_determination_id
        and determination.attendance_register_id =
          new.attendance_register_id
        and determination.tenant_id = new.tenant_id
        and determination.property_id = new.property_id
    ) then
      raise exception 'ATTENDANCE_FACT_LINEAGE_MISMATCH'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'attendance_checkin_attempts' then
    if not exists (
      select 1
      from public.attendance_registers register_row
      join public.attendance_checkin_grants grant_row
        on grant_row.id = new.attendance_checkin_grant_id
       and grant_row.attendance_register_id = register_row.id
       and grant_row.tenant_id = register_row.tenant_id
       and grant_row.property_id = register_row.property_id
      where register_row.id = new.attendance_register_id
        and register_row.tenant_id = new.tenant_id
        and register_row.property_id = new.property_id
        and (
          new.participant_snapshot_id is null
          or exists (
            select 1
            from public.session_participant_snapshots snapshot
            where snapshot.id = new.participant_snapshot_id
              and snapshot.session_revision_id =
                register_row.session_revision_id
              and snapshot.selected
          )
        )
    ) then
      raise exception 'ATTENDANCE_FACT_LINEAGE_MISMATCH'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger attendance_evidence_lineage
before insert on public.attendance_evidence
for each row execute function
  app_private.validate_attendance_fact_lineage();
create trigger attendance_observations_lineage
before insert on public.attendance_observations
for each row execute function
  app_private.validate_attendance_fact_lineage();
create trigger attendance_determinations_lineage
before insert on public.attendance_determinations
for each row execute function
  app_private.validate_attendance_fact_lineage();
create trigger attendance_determination_observations_lineage
before insert on public.attendance_determination_observations
for each row execute function
  app_private.validate_attendance_fact_lineage();
create trigger attendance_checkin_attempts_lineage
before insert on public.attendance_checkin_attempts
for each row execute function
  app_private.validate_attendance_fact_lineage();

create or replace function app_private.attendance_participants_document(
  p_attendance_register_id uuid,
  p_session_revision_id uuid,
  p_property_id uuid,
  p_department_scoped boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'participantSnapshotId', snapshot.id,
      'snapshotOrigin', snapshot.snapshot_origin,
      'employeeFactVersionId', snapshot.employee_fact_version_id,
      'employeeNumber', snapshot.employee_number_snapshot,
      'employeeName', snapshot.employee_name_snapshot,
      'departmentId', snapshot.department_id_snapshot,
      'departmentName', department.name_zh,
      'eligibilityState', snapshot.eligibility_state,
      'observations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', observation.id,
          'source', observation.observation_source,
          'observedAt', observation.observed_at,
          'receivedAt', observation.received_at,
          'requiresReview', observation.requires_review,
          'evidenceType', evidence.evidence_type
        ) order by observation.received_at, observation.id)
        from public.attendance_observations observation
        join public.attendance_evidence evidence
          on evidence.id = observation.attendance_evidence_id
        where observation.attendance_register_id =
          p_attendance_register_id
          and observation.participant_snapshot_id = snapshot.id
      ), '[]'::jsonb),
      'currentDetermination', (
        select jsonb_build_object(
          'id', determination.id,
          'determination', determination.determination,
          'reason', determination.reason,
          'decidedAt', determination.decided_at,
          'decidedByName', profile.display_name,
          'supersedesId', determination.supersedes_determination_id,
          'evidenceObservationIds', coalesce((
            select jsonb_agg(link.attendance_observation_id)
            from public.attendance_determination_observations link
            where link.attendance_determination_id = determination.id
          ), '[]'::jsonb)
        )
        from public.attendance_determinations determination
        left join public.user_accounts account
          on account.auth_user_id = determination.decided_by
         and account.property_id = p_property_id
        left join public.profiles profile on profile.id = account.user_id
        where determination.attendance_register_id =
          p_attendance_register_id
          and determination.participant_snapshot_id = snapshot.id
        order by determination.determination_number desc
        limit 1
      ),
      'needsReview', (
        not exists (
          select 1
          from public.attendance_determinations determination
          where determination.attendance_register_id =
            p_attendance_register_id
            and determination.participant_snapshot_id = snapshot.id
        )
        or exists (
          select 1
          from public.attendance_observations observation
          where observation.attendance_register_id =
            p_attendance_register_id
            and observation.participant_snapshot_id = snapshot.id
            and (
              observation.requires_review
              or not exists (
                select 1
                from public.attendance_determination_observations link
                where link.attendance_observation_id = observation.id
              )
            )
        )
      ),
      'inclusionReason', snapshot.inclusion_reason,
      'affectsRequirementEligibility',
        snapshot.affects_requirement_eligibility,
      'requiresFollowUp', snapshot.requires_follow_up
    )
    order by snapshot.employee_number_snapshot
  ), '[]'::jsonb)
  from public.session_participant_snapshots snapshot
  left join public.departments department
    on department.id = snapshot.department_id_snapshot
  where snapshot.session_revision_id = p_session_revision_id
    and snapshot.selected
    and (
      not p_department_scoped
      or (
        snapshot.department_id_snapshot is not null
        and app_private.has_authorized_department_scope(
          p_property_id,
          snapshot.department_id_snapshot
        )
      )
    );
$$;

create or replace function app_private.attendance_registers_document(
  p_property_id uuid,
  p_department_scoped boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', register_row.id,
      'sessionId', session_row.id,
      'sessionRevisionId', revision.id,
      'sessionName', revision.name_zh,
      'sessionCode', session_row.code,
      'startsAt', revision.starts_at,
      'endsAt', revision.ends_at,
      'venueName', revision.venue_name_snapshot,
      'owningDepartmentId', session_row.owning_department_id,
      'owningDepartmentName', department.name_zh,
      'operationalOwnerRoleAssignmentId',
        session_row.operational_owner_role_assignment_id,
      'preparationMode', preparation.preparation_mode,
      'state', coalesce(register_row.lifecycle_state, 'prepared'),
      'version', coalesce(register_row.version, revision.version),
      'openedAt', register_row.opened_at,
      'closedAt', register_row.closed_at,
      'canManage', (
        app_private.is_training_manager(p_property_id)
        or (
          p_department_scoped
          and app_private.has_authorized_department_scope(
            p_property_id,
            session_row.owning_department_id
          )
        )
      ),
      'canCloseRegister', (
        app_private.is_training_manager(p_property_id)
        or exists (
          select 1
          from public.user_accounts account
          join public.role_assignments assignment
            on assignment.user_id = account.user_id
           and assignment.id =
             session_row.operational_owner_role_assignment_id
           and assignment.status = 'active'
          where account.auth_user_id = auth.uid()
            and account.property_id = p_property_id
            and account.account_status = 'active'
            and (
              account.locked_until is null
              or account.locked_until <= now()
            )
        )
      ),
      'participants',
        app_private.attendance_participants_document(
          register_row.id,
          revision.id,
          p_property_id,
          p_department_scoped
        ),
      'counts', jsonb_build_object(
        'participantCount', (
          select count(*)
          from public.session_participant_snapshots snapshot
          where snapshot.session_revision_id = revision.id
            and snapshot.selected
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
        'observedCount', (
          select count(distinct observation.participant_snapshot_id)
          from public.attendance_observations observation
          join public.session_participant_snapshots snapshot
            on snapshot.id = observation.participant_snapshot_id
          where observation.attendance_register_id = register_row.id
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
        'determinedCount', (
          select count(distinct determination.participant_snapshot_id)
          from public.attendance_determinations determination
          join public.session_participant_snapshots snapshot
            on snapshot.id = determination.participant_snapshot_id
          where determination.attendance_register_id = register_row.id
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
        'unrecordedCount', (
          select count(*)
          from public.session_participant_snapshots snapshot
          where snapshot.session_revision_id = revision.id
            and snapshot.selected
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
            and not exists (
              select 1
              from public.attendance_observations observation
              where observation.attendance_register_id = register_row.id
                and observation.participant_snapshot_id = snapshot.id
            )
            and not exists (
              select 1
              from public.attendance_determinations determination
              where determination.attendance_register_id =
                register_row.id
                and determination.participant_snapshot_id = snapshot.id
            )
        ),
        'unresolvedObservationCount', (
          select count(*)
          from public.attendance_observations observation
          join public.session_participant_snapshots snapshot
            on snapshot.id = observation.participant_snapshot_id
          where observation.attendance_register_id = register_row.id
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
            and not exists (
              select 1
              from public.attendance_determination_observations link
              where link.attendance_observation_id = observation.id
            )
        ),
        'brokenEvidenceCount', (
          select count(*)
          from public.attendance_determinations determination
          join public.session_participant_snapshots snapshot
            on snapshot.id = determination.participant_snapshot_id
          where determination.attendance_register_id = register_row.id
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
            and not exists (
              select 1
              from public.attendance_determination_observations link
              where link.attendance_determination_id = determination.id
            )
        )
      )
    )
    order by revision.starts_at, session_row.code
  ), '[]'::jsonb)
  from public.training_sessions session_row
  join public.training_session_revisions revision
    on revision.id = session_row.current_revision_id
   and revision.lifecycle_state = 'published'
  join public.attendance_preparation_configs preparation
    on preparation.session_revision_id = revision.id
  join public.departments department
    on department.id = session_row.owning_department_id
  left join public.attendance_registers register_row
    on register_row.session_revision_id = revision.id
  where session_row.property_id = p_property_id
    and session_row.current_state = 'published'
    and not exists (
      select 1
      from public.training_session_cancellation_events cancellation
      where cancellation.training_session_id = session_row.id
    )
    and (
      not p_department_scoped
      or app_private.has_authorized_department_scope(
        p_property_id,
        session_row.owning_department_id
      )
    );
$$;

create or replace function public.read_attendance_workspace(
  p_property_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_property_name text;
begin
  if app_private.assert_training_property_actor(p_property_id) <> 'manager'
  then
    raise exception '只有学习与发展经理可以查看酒店出勤工作台。'
      using errcode = '42501';
  end if;
  select property.name_zh into selected_property_name
  from public.properties property
  where property.id = p_property_id;
  return jsonb_build_object(
    'propertyId', p_property_id,
    'propertyName', selected_property_name,
    'source', 'real',
    'role', 'manager',
    'registers',
      app_private.attendance_registers_document(p_property_id, false),
    'boundary', jsonb_build_object(
      'attendance', 'real',
      'feedback', 'unavailable',
      'completion', 'unavailable',
      'kpi', 'unavailable'
    )
  );
end;
$$;

create or replace function public.read_department_attendance_workspace()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_property_id uuid;
  selected_property_name text;
begin
  selected_property_id := app_private.current_training_property();
  if selected_property_id is null
    or not app_private.is_training_department_actor(selected_property_id)
  then
    raise exception '仅部门培训负责人可以查看部门出勤工作台。'
      using errcode = '42501';
  end if;
  select property.name_zh into selected_property_name
  from public.properties property
  where property.id = selected_property_id;
  return jsonb_build_object(
    'propertyId', selected_property_id,
    'propertyName', selected_property_name,
    'source', 'real',
    'role', 'department',
    'scope', coalesce((
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
    ), '[]'::jsonb),
    'registers',
      app_private.attendance_registers_document(
        selected_property_id,
        true
      ),
    'boundary', jsonb_build_object(
      'attendance', 'real',
      'feedback', 'unavailable',
      'completion', 'unavailable',
      'kpi', 'unavailable'
    )
  );
end;
$$;

create or replace function app_private.assert_attendance_session_actor(
  p_session_revision_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_property_id uuid;
  selected_department_id uuid;
  selected_owner_user_id uuid;
  selected_actor_user_id uuid;
  actor_type text;
begin
  select
    revision.property_id,
    session_row.owning_department_id,
    owner_assignment.user_id
  into
    selected_property_id,
    selected_department_id,
    selected_owner_user_id
  from public.training_session_revisions revision
  join public.training_sessions session_row
    on session_row.id = revision.training_session_id
  join public.role_assignments owner_assignment
    on owner_assignment.id =
      session_row.operational_owner_role_assignment_id
  where revision.id = p_session_revision_id;

  if selected_property_id is null then
    raise exception '未找到培训场次修订。' using errcode = 'P0002';
  end if;

  actor_type :=
    app_private.assert_training_property_actor(selected_property_id);
  if actor_type = 'manager' then
    return actor_type;
  end if;

  perform app_private.assert_department_in_actor_scope(
    selected_property_id,
    selected_department_id
  );
  select account.user_id into selected_actor_user_id
  from public.user_accounts account
  where account.auth_user_id = auth.uid()
    and account.property_id = selected_property_id
    and account.account_status = 'active'
    and (
      account.locked_until is null
      or account.locked_until <= now()
    )
  limit 1;
  if selected_actor_user_id is distinct from selected_owner_user_id then
    raise exception '只有场次运营负责人可以开放或关闭本场出勤登记。'
      using errcode = '42501';
  end if;
  return actor_type;
end;
$$;

create or replace function app_private.block_revision_after_attendance_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_session_id uuid;
begin
  selected_session_id := new.training_session_id;
  if exists (
    select 1
    from public.attendance_registers register_row
    join public.training_session_revisions delivered_revision
      on delivered_revision.id = register_row.session_revision_id
    where delivered_revision.training_session_id = selected_session_id
      and (
        tg_op = 'INSERT'
        or new.id <> delivered_revision.id
      )
  ) then
    raise exception
      '出勤登记已开放，不能再建立或发布替代场次修订。'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger attendance_locks_session_revision
before insert or update on public.training_session_revisions
for each row execute function
  app_private.block_revision_after_attendance_lock();

create or replace function app_private.reject_attendance_fact_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ATTENDANCE_FACT_APPEND_ONLY'
    using errcode = '42501';
end;
$$;

create trigger attendance_register_events_append_only
before update or delete on public.attendance_register_events
for each row execute function
  app_private.reject_attendance_fact_mutation();
create trigger attendance_evidence_append_only
before update or delete on public.attendance_evidence
for each row execute function
  app_private.reject_attendance_fact_mutation();
create trigger attendance_observations_append_only
before update or delete on public.attendance_observations
for each row execute function
  app_private.reject_attendance_fact_mutation();
create trigger attendance_determinations_append_only
before update or delete on public.attendance_determinations
for each row execute function
  app_private.reject_attendance_fact_mutation();
create trigger attendance_determination_observations_append_only
before update or delete on public.attendance_determination_observations
for each row execute function
  app_private.reject_attendance_fact_mutation();
create trigger attendance_checkin_attempts_append_only
before update or delete on public.attendance_checkin_attempts
for each row execute function
  app_private.reject_attendance_fact_mutation();

create or replace function app_private.assert_attendance_participant_actor(
  p_attendance_register_id uuid,
  p_participant_snapshot_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_property_id uuid;
  selected_department_id uuid;
  selected_actor_type text;
begin
  select
    register_row.property_id,
    snapshot.department_id_snapshot
  into
    selected_property_id,
    selected_department_id
  from public.attendance_registers register_row
  join public.session_participant_snapshots snapshot
    on snapshot.id = p_participant_snapshot_id
   and snapshot.session_revision_id = register_row.session_revision_id
   and snapshot.tenant_id = register_row.tenant_id
   and snapshot.property_id = register_row.property_id
  where register_row.id = p_attendance_register_id
    and snapshot.selected;

  if selected_property_id is null then
    raise exception '未找到本登记册中的参与人快照。'
      using errcode = 'P0002';
  end if;

  selected_actor_type :=
    app_private.assert_training_property_actor(selected_property_id);
  if selected_actor_type = 'manager' then
    return selected_actor_type;
  end if;
  if selected_department_id is null
    or not app_private.has_authorized_department_scope(
      selected_property_id,
      selected_department_id
    )
  then
    raise exception '无权管理此参与人的出勤事实。'
      using errcode = '42501';
  end if;
  return selected_actor_type;
end;
$$;

create or replace function public.open_attendance_register(
  p_session_revision_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_tenant_id uuid;
  selected_property_id uuid;
  selected_register_id uuid;
  selected_actor_type text;
begin
  selected_actor_type :=
    app_private.assert_attendance_session_actor(p_session_revision_id);

  select revision.tenant_id, revision.property_id
  into selected_tenant_id, selected_property_id
  from public.training_session_revisions revision
  join public.training_sessions session_row
    on session_row.id = revision.training_session_id
  join public.attendance_preparation_configs preparation
    on preparation.session_revision_id = revision.id
  where revision.id = p_session_revision_id
    and revision.lifecycle_state = 'published'
    and revision.version = p_expected_version
    and session_row.current_revision_id = revision.id
    and session_row.current_state = 'published'
    and not exists (
      select 1
      from public.training_session_cancellation_events cancellation
      where cancellation.training_session_id = session_row.id
    );

  if selected_property_id is null then
    if exists (
      select 1
      from public.training_session_revisions revision
      where revision.id = p_session_revision_id
    ) then
      raise exception '场次修订版本已变化，请刷新后重试。'
        using errcode = '40001';
    end if;
    raise exception '未找到可开放出勤的已发布场次。'
      using errcode = 'P0002';
  end if;

  insert into public.attendance_registers(
    tenant_id,
    property_id,
    session_revision_id,
    lifecycle_state,
    opened_by
  ) values (
    selected_tenant_id,
    selected_property_id,
    p_session_revision_id,
    'open',
    auth.uid()
  )
  returning id into selected_register_id;

  insert into public.attendance_register_events(
    tenant_id,
    property_id,
    attendance_register_id,
    event_type,
    from_state,
    to_state,
    reason,
    actor_user_id,
    evidence
  ) values (
    selected_tenant_id,
    selected_property_id,
    selected_register_id,
    'opened',
    null,
    'open',
    '开放场次出勤登记',
    auth.uid(),
    jsonb_build_object(
      'sessionRevisionId', p_session_revision_id,
      'actorType', selected_actor_type
    )
  );

  return jsonb_build_object(
    'registerId', selected_register_id,
    'version', 1,
    'state', 'open',
    'source', 'real'
  );
end;
$$;

create or replace function public.issue_attendance_checkin_grant(
  p_attendance_register_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_register public.attendance_registers%rowtype;
  selected_revision public.training_session_revisions%rowtype;
  selected_preparation public.attendance_preparation_configs%rowtype;
  raw_token text;
  hashed_token text;
  selected_valid_from timestamptz;
  selected_valid_until timestamptz;
  selected_version bigint;
begin
  select register_row.* into selected_register
  from public.attendance_registers register_row
  where register_row.id = p_attendance_register_id
  for update;
  if selected_register.id is null then
    raise exception '未找到出勤登记册。' using errcode = 'P0002';
  end if;
  perform app_private.assert_attendance_session_actor(
    selected_register.session_revision_id
  );
  if selected_register.lifecycle_state <> 'open' then
    raise exception '只有开放中的出勤登记可以生成签到二维码。'
      using errcode = '23514';
  end if;
  if selected_register.version <> p_expected_version then
    raise exception '出勤登记版本已变化，请刷新后重试。'
      using errcode = '40001';
  end if;

  select revision.* into selected_revision
  from public.training_session_revisions revision
  where revision.id = selected_register.session_revision_id;
  select preparation.* into selected_preparation
  from public.attendance_preparation_configs preparation
  where preparation.session_revision_id = selected_revision.id;
  if selected_preparation.preparation_mode <> 'qr_or_manual' then
    raise exception '本场次仅允许人工登记，不能生成签到二维码。'
      using errcode = '23514';
  end if;

  selected_valid_from := selected_revision.starts_at -
    make_interval(mins => selected_preparation.opens_before_minutes);
  selected_valid_until := selected_revision.ends_at +
    make_interval(mins => selected_preparation.closes_after_minutes);
  if selected_valid_until <= now() then
    raise exception '本场签到窗口已经结束。' using errcode = '23514';
  end if;

  update public.attendance_checkin_grants grant_row
  set
    lifecycle_state = 'revoked',
    version = grant_row.version + 1,
    revoked_by = auth.uid(),
    revoked_at = now()
  where grant_row.attendance_register_id = selected_register.id
    and grant_row.lifecycle_state = 'active';

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  hashed_token := encode(
    extensions.digest(raw_token, 'sha256'),
    'hex'
  );
  insert into public.attendance_checkin_grants(
    tenant_id,
    property_id,
    attendance_register_id,
    token_hash,
    lifecycle_state,
    valid_from,
    valid_until,
    issued_by
  ) values (
    selected_register.tenant_id,
    selected_register.property_id,
    selected_register.id,
    hashed_token,
    'active',
    selected_valid_from,
    selected_valid_until,
    auth.uid()
  );

  update public.attendance_registers register_row
  set
    version = register_row.version + 1,
    updated_at = now()
  where register_row.id = selected_register.id
    and register_row.version = p_expected_version
  returning version into selected_version;
  if selected_version is null then
    raise exception '出勤登记版本已变化，请刷新后重试。'
      using errcode = '40001';
  end if;

  insert into public.attendance_register_events(
    tenant_id,
    property_id,
    attendance_register_id,
    event_type,
    from_state,
    to_state,
    reason,
    actor_user_id,
    evidence
  ) values (
    selected_register.tenant_id,
    selected_register.property_id,
    selected_register.id,
    'checkin_grant_issued',
    'open',
    'open',
    '生成并轮换受限签到凭证',
    auth.uid(),
    jsonb_build_object(
      'validFrom', selected_valid_from,
      'validUntil', selected_valid_until
    )
  );

  return jsonb_build_object(
    'registerId', selected_register.id,
    'version', selected_version,
    'token', raw_token,
    'expiresAt', selected_valid_until,
    'state', 'open',
    'source', 'real'
  );
end;
$$;

create or replace function public.submit_attendance_checkin(
  p_token text,
  p_employee_number text,
  p_employee_name text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_grant public.attendance_checkin_grants%rowtype;
  selected_register public.attendance_registers%rowtype;
  selected_snapshot public.session_participant_snapshots%rowtype;
  existing_outcome text;
  identity_evidence_hash text;
  evidence_id uuid;
  observation_id uuid;
  normalized_number text;
  normalized_name text;
begin
  if btrim(coalesce(p_token, '')) = ''
    or btrim(coalesce(p_employee_number, '')) = ''
    or btrim(coalesce(p_employee_name, '')) = ''
    or btrim(coalesce(p_idempotency_key, '')) = ''
  then
    return jsonb_build_object(
      'outcome', 'unable_to_check_in',
      'message', '无法完成签到，请核对信息或联系培训负责人。'
    );
  end if;

  select grant_row.* into selected_grant
  from public.attendance_checkin_grants grant_row
  where grant_row.token_hash = encode(
      extensions.digest(p_token, 'sha256'),
      'hex'
    )
    and grant_row.lifecycle_state = 'active'
    and now() between grant_row.valid_from and grant_row.valid_until
  limit 1;
  if selected_grant.id is null then
    return jsonb_build_object(
      'outcome', 'unable_to_check_in',
      'message', '无法完成签到，请核对信息或联系培训负责人。'
    );
  end if;

  select register_row.* into selected_register
  from public.attendance_registers register_row
  where register_row.id = selected_grant.attendance_register_id
    and register_row.lifecycle_state = 'open'
  for update;
  if selected_register.id is null then
    return jsonb_build_object(
      'outcome', 'unable_to_check_in',
      'message', '无法完成签到，请核对信息或联系培训负责人。'
    );
  end if;

  select attempt.outcome into existing_outcome
  from public.attendance_checkin_attempts attempt
  where attempt.attendance_checkin_grant_id = selected_grant.id
    and attempt.idempotency_key = p_idempotency_key;
  if existing_outcome is not null then
    return jsonb_build_object(
      'outcome',
      case
        when existing_outcome = 'accepted' then 'already_recorded'
        else existing_outcome
      end,
      'message',
      case
        when existing_outcome = 'accepted'
          then '签到信息已提交，无需重复操作。'
        else '无法完成签到，请核对信息或联系培训负责人。'
      end
    );
  end if;

  normalized_number := lower(btrim(p_employee_number));
  normalized_name := lower(regexp_replace(
    btrim(p_employee_name),
    '\s+',
    '',
    'g'
  ));
  identity_evidence_hash := encode(
    extensions.digest(
      selected_grant.id::text || ':' ||
      normalized_number || ':' || normalized_name,
      'sha256'
    ),
    'hex'
  );
  if (
    select count(*)
    from public.attendance_checkin_attempts attempt
    where attempt.attendance_checkin_grant_id = selected_grant.id
      and attempt.identity_hash = identity_evidence_hash
      and attempt.attempted_at >= now() - interval '5 minutes'
  ) >= 5 then
    return jsonb_build_object(
      'outcome', 'unable_to_check_in',
      'message', '请求过于频繁，请稍后再试或联系培训负责人。'
    );
  end if;

  select snapshot.* into selected_snapshot
  from public.session_participant_snapshots snapshot
  where snapshot.session_revision_id =
      selected_register.session_revision_id
    and snapshot.selected
    and lower(btrim(snapshot.employee_number_snapshot)) =
      normalized_number
    and lower(regexp_replace(
      btrim(snapshot.employee_name_snapshot),
      '\s+',
      '',
      'g'
    )) = normalized_name
  limit 1;

  if selected_snapshot.id is null then
    insert into public.attendance_checkin_attempts(
      tenant_id,
      property_id,
      attendance_register_id,
      attendance_checkin_grant_id,
      idempotency_key,
      identity_hash,
      outcome
    ) values (
      selected_register.tenant_id,
      selected_register.property_id,
      selected_register.id,
      selected_grant.id,
      p_idempotency_key,
      identity_evidence_hash,
      'unable_to_check_in'
    );
    return jsonb_build_object(
      'outcome', 'unable_to_check_in',
      'message', '无法完成签到，请核对信息或联系培训负责人。'
    );
  end if;

  if exists (
    select 1
    from public.attendance_observations observation
    where observation.attendance_register_id = selected_register.id
      and observation.participant_snapshot_id = selected_snapshot.id
      and observation.observation_source = 'qr_self_check_in'
  ) then
    insert into public.attendance_checkin_attempts(
      tenant_id,
      property_id,
      attendance_register_id,
      attendance_checkin_grant_id,
      participant_snapshot_id,
      idempotency_key,
      identity_hash,
      outcome
    ) values (
      selected_register.tenant_id,
      selected_register.property_id,
      selected_register.id,
      selected_grant.id,
      selected_snapshot.id,
      p_idempotency_key,
      identity_evidence_hash,
      'already_recorded'
    );
    return jsonb_build_object(
      'outcome', 'already_recorded',
      'message', '签到信息已提交，无需重复操作。'
    );
  end if;

  insert into public.attendance_evidence(
    tenant_id,
    property_id,
    attendance_register_id,
    participant_snapshot_id,
    evidence_type,
    source_summary,
    integrity_hash
  ) values (
    selected_register.tenant_id,
    selected_register.property_id,
    selected_register.id,
    selected_snapshot.id,
    'qr_server_receipt',
    '服务器接受的场次二维码自助签到回执',
    encode(
      extensions.digest(
        selected_grant.id::text || ':' ||
        selected_snapshot.id::text || ':' ||
        p_idempotency_key || ':' || now()::text,
        'sha256'
      ),
      'hex'
    )
  )
  returning id into evidence_id;

  insert into public.attendance_observations(
    tenant_id,
    property_id,
    attendance_register_id,
    participant_snapshot_id,
    employee_fact_version_id,
    attendance_evidence_id,
    observation_source,
    observed_at,
    within_capture_window,
    requires_review,
    idempotency_key
  ) values (
    selected_register.tenant_id,
    selected_register.property_id,
    selected_register.id,
    selected_snapshot.id,
    selected_snapshot.employee_fact_version_id,
    evidence_id,
    'qr_self_check_in',
    now(),
    true,
    false,
    p_idempotency_key
  )
  returning id into observation_id;

  insert into public.employee_fact_dependencies(
    tenant_id,
    property_id,
    employee_id,
    employee_fact_version_id,
    fact_type,
    fact_id
  ) values (
    selected_register.tenant_id,
    selected_register.property_id,
    selected_snapshot.employee_id,
    selected_snapshot.employee_fact_version_id,
    'attendance_observation',
    observation_id
  );

  insert into public.attendance_checkin_attempts(
    tenant_id,
    property_id,
    attendance_register_id,
    attendance_checkin_grant_id,
    participant_snapshot_id,
    idempotency_key,
    identity_hash,
    outcome
  ) values (
    selected_register.tenant_id,
    selected_register.property_id,
    selected_register.id,
    selected_grant.id,
    selected_snapshot.id,
    p_idempotency_key,
    identity_evidence_hash,
    'accepted'
  );

  update public.attendance_registers register_row
  set
    version = register_row.version + 1,
    updated_at = now()
  where register_row.id = selected_register.id;

  return jsonb_build_object(
    'outcome', 'accepted',
    'message', '签到 Observation 已接收，最终出勤仍需授权人员核对。'
  );
end;
$$;

create or replace function public.record_attendance_determination(
  p_attendance_register_id uuid,
  p_participant_snapshot_id uuid,
  p_determination text,
  p_reason text,
  p_evidence_observation_ids uuid[],
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_register public.attendance_registers%rowtype;
  selected_snapshot public.session_participant_snapshots%rowtype;
  selected_previous_id uuid;
  selected_number integer;
  selected_version bigint;
  selected_observation_ids uuid[];
  selected_observation_id uuid;
  selected_evidence_id uuid;
  selected_determination_id uuid;
  selected_actor_type text;
begin
  if p_determination not in (
    'present', 'absent', 'excused_absence', 'unable_to_determine'
  ) then
    raise exception '出勤判定必须是出席、缺席、获准缺席或无法判断。'
      using errcode = '22023';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception '出勤判定必须说明核对依据。'
      using errcode = '22023';
  end if;

  select register_row.* into selected_register
  from public.attendance_registers register_row
  where register_row.id = p_attendance_register_id
  for update;
  if selected_register.id is null then
    raise exception '未找到出勤登记册。' using errcode = 'P0002';
  end if;
  if selected_register.version <> p_expected_version then
    raise exception '出勤登记版本已变化，请刷新后重试。'
      using errcode = '40001';
  end if;
  if selected_register.lifecycle_state = 'closed' then
    raise exception '登记册已关闭，请由经理重新开启后更正。'
      using errcode = '23514';
  end if;

  selected_actor_type :=
    app_private.assert_attendance_participant_actor(
      selected_register.id,
      p_participant_snapshot_id
    );
  select snapshot.* into selected_snapshot
  from public.session_participant_snapshots snapshot
  where snapshot.id = p_participant_snapshot_id
    and snapshot.session_revision_id =
      selected_register.session_revision_id
    and snapshot.selected;

  selected_observation_ids :=
    coalesce(p_evidence_observation_ids, array[]::uuid[]);
  if cardinality(selected_observation_ids) = 0 then
    insert into public.attendance_evidence(
      tenant_id,
      property_id,
      attendance_register_id,
      participant_snapshot_id,
      evidence_type,
      source_summary,
      integrity_hash,
      recorded_by
    ) values (
      selected_register.tenant_id,
      selected_register.property_id,
      selected_register.id,
      selected_snapshot.id,
      'manual_witness',
      '授权人员现场核对：' || btrim(p_reason),
      encode(
        extensions.digest(
          selected_register.id::text || ':' ||
          selected_snapshot.id::text || ':' ||
          btrim(p_reason) || ':' || clock_timestamp()::text,
          'sha256'
        ),
        'hex'
      ),
      auth.uid()
    )
    returning id into selected_evidence_id;

    insert into public.attendance_observations(
      tenant_id,
      property_id,
      attendance_register_id,
      participant_snapshot_id,
      employee_fact_version_id,
      attendance_evidence_id,
      observation_source,
      observed_at,
      within_capture_window,
      requires_review,
      idempotency_key,
      created_by
    ) values (
      selected_register.tenant_id,
      selected_register.property_id,
      selected_register.id,
      selected_snapshot.id,
      selected_snapshot.employee_fact_version_id,
      selected_evidence_id,
      'manual_witness',
      now(),
      true,
      false,
      'manual:' || extensions.gen_random_uuid()::text,
      auth.uid()
    )
    returning id into selected_observation_id;
    selected_observation_ids := array[selected_observation_id];

    insert into public.employee_fact_dependencies(
      tenant_id,
      property_id,
      employee_id,
      employee_fact_version_id,
      fact_type,
      fact_id
    ) values (
      selected_register.tenant_id,
      selected_register.property_id,
      selected_snapshot.employee_id,
      selected_snapshot.employee_fact_version_id,
      'attendance_observation',
      selected_observation_id
    );
  elsif (
    select count(distinct observation.id)
    from public.attendance_observations observation
    where observation.id = any(selected_observation_ids)
      and observation.attendance_register_id = selected_register.id
      and observation.participant_snapshot_id = selected_snapshot.id
      and observation.employee_fact_version_id =
        selected_snapshot.employee_fact_version_id
  ) <> cardinality(selected_observation_ids) then
    raise exception '所选现场证据不属于此参与人或当前登记册。'
      using errcode = '22023';
  end if;

  select
    determination.id,
    determination.determination_number
  into selected_previous_id, selected_number
  from public.attendance_determinations determination
  where determination.attendance_register_id = selected_register.id
    and determination.participant_snapshot_id = selected_snapshot.id
  order by determination.determination_number desc
  limit 1;
  selected_number := coalesce(selected_number, 0) + 1;

  insert into public.attendance_determinations(
    tenant_id,
    property_id,
    attendance_register_id,
    participant_snapshot_id,
    employee_fact_version_id,
    determination_number,
    determination,
    reason,
    supersedes_determination_id,
    decided_by
  ) values (
    selected_register.tenant_id,
    selected_register.property_id,
    selected_register.id,
    selected_snapshot.id,
    selected_snapshot.employee_fact_version_id,
    selected_number,
    p_determination,
    btrim(p_reason),
    selected_previous_id,
    auth.uid()
  )
  returning id into selected_determination_id;

  foreach selected_observation_id in array selected_observation_ids loop
    insert into public.attendance_determination_observations(
      tenant_id,
      property_id,
      attendance_register_id,
      attendance_determination_id,
      attendance_observation_id
    ) values (
      selected_register.tenant_id,
      selected_register.property_id,
      selected_register.id,
      selected_determination_id,
      selected_observation_id
    );
  end loop;

  insert into public.employee_fact_dependencies(
    tenant_id,
    property_id,
    employee_id,
    employee_fact_version_id,
    fact_type,
    fact_id
  ) values (
    selected_register.tenant_id,
    selected_register.property_id,
    selected_snapshot.employee_id,
    selected_snapshot.employee_fact_version_id,
    'attendance_determination',
    selected_determination_id
  );

  update public.attendance_registers register_row
  set
    version = register_row.version + 1,
    updated_at = now()
  where register_row.id = selected_register.id
    and register_row.version = p_expected_version
  returning version into selected_version;
  if selected_version is null then
    raise exception '出勤登记版本已变化，请刷新后重试。'
      using errcode = '40001';
  end if;

  return jsonb_build_object(
    'registerId', selected_register.id,
    'participantSnapshotId', selected_snapshot.id,
    'determinationId', selected_determination_id,
    'determination', p_determination,
    'determinationNumber', selected_number,
    'version', selected_version,
    'state', selected_register.lifecycle_state,
    'actorType', selected_actor_type,
    'source', 'real'
  );
end;
$$;

create or replace function public.add_supplemental_participant_snapshot(
  p_attendance_register_id uuid,
  p_employee_id uuid,
  p_inclusion_reason text,
  p_affects_requirement_eligibility boolean,
  p_requires_follow_up boolean,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_register public.attendance_registers%rowtype;
  selected_revision public.training_session_revisions%rowtype;
  selected_session public.training_sessions%rowtype;
  selected_fact public.employee_fact_versions%rowtype;
  selected_employee public.employees%rowtype;
  selected_snapshot_id uuid;
  selected_version bigint;
  selected_evaluation_date date;
  selected_eligibility_state text := 'not_evaluated';
  selected_eligibility_document jsonb;
begin
  if btrim(coalesce(p_inclusion_reason, '')) = '' then
    raise exception '现场补充参与人必须说明加入原因。'
      using errcode = '22023';
  end if;
  if p_affects_requirement_eligibility is null
    or p_requires_follow_up is null
  then
    raise exception '必须明确适用性影响与后续复核要求。'
      using errcode = '22023';
  end if;

  select register_row.* into selected_register
  from public.attendance_registers register_row
  where register_row.id = p_attendance_register_id
  for update;
  if selected_register.id is null then
    raise exception '未找到出勤登记册。' using errcode = 'P0002';
  end if;
  perform app_private.assert_attendance_session_actor(
    selected_register.session_revision_id
  );
  if selected_register.lifecycle_state <> 'open' then
    raise exception '只有开放中的登记册可以补充现场参与人。'
      using errcode = '23514';
  end if;
  if selected_register.version <> p_expected_version then
    raise exception '出勤登记版本已变化，请刷新后重试。'
      using errcode = '40001';
  end if;

  select revision.* into selected_revision
  from public.training_session_revisions revision
  where revision.id = selected_register.session_revision_id;
  select session_row.* into selected_session
  from public.training_sessions session_row
  where session_row.id = selected_revision.training_session_id;
  selected_evaluation_date :=
    (selected_revision.starts_at at time zone selected_revision.timezone)::date;

  select employee.* into selected_employee
  from public.employees employee
  where employee.id = p_employee_id
    and employee.tenant_id = selected_register.tenant_id
    and employee.property_id = selected_register.property_id;
  if selected_employee.id is null then
    raise exception '未找到本酒店员工。' using errcode = 'P0002';
  end if;
  select fact.* into selected_fact
  from public.employee_fact_versions fact
  where fact.employee_id = selected_employee.id
    and fact.tenant_id = selected_register.tenant_id
    and fact.property_id = selected_register.property_id
    and fact.effective_date <= selected_evaluation_date
  order by fact.effective_date desc, fact.employee_version desc
  limit 1;
  if selected_fact.id is null then
    raise exception '员工缺少场次日期的可信事实版本。'
      using errcode = '22023';
  end if;
  if selected_fact.department_id is null then
    raise exception '员工缺少场次日期的部门归属，不能现场加入。'
      using errcode = '22023';
  end if;
  if not app_private.is_training_manager(selected_register.property_id)
    and not app_private.has_authorized_department_scope(
      selected_register.property_id,
      selected_fact.department_id
    )
  then
    raise exception '无权将授权范围外员工加入本场出勤登记。'
      using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.session_participant_snapshots snapshot
    where snapshot.session_revision_id = selected_revision.id
      and snapshot.employee_id = selected_employee.id
  ) then
    raise exception '此员工已经在场次参与人快照中。'
      using errcode = '23505';
  end if;
  if (
    select count(*)
    from public.session_participant_snapshots snapshot
    where snapshot.session_revision_id = selected_revision.id
      and snapshot.selected
  ) >= selected_revision.capacity then
    raise exception '场次参与人数已达到容量上限。'
      using errcode = '23514';
  end if;

  if selected_session.purpose_type = 'requirement_delivery' then
    selected_eligibility_document :=
      public.evaluate_learning_requirement_eligibility(
        selected_register.property_id,
        selected_session.training_requirement_version_id,
        selected_evaluation_date,
        selected_fact.employee_number,
        1,
        10
      );
    select item->>'result' into selected_eligibility_state
    from jsonb_array_elements(
      coalesce(selected_eligibility_document->'rows', '[]'::jsonb)
    ) item
    where item->>'employeeId' = selected_employee.id::text
    limit 1;
    if selected_eligibility_state is distinct from 'eligible' then
      raise exception
        '要求交付场次只允许加入适用性评估为“适用”的员工。'
        using errcode = '23514';
    end if;
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
    evaluated_on,
    snapshot_origin,
    inclusion_reason,
    supplemental_authorized_by,
    affects_requirement_eligibility,
    requires_follow_up
  ) values (
    selected_register.tenant_id,
    selected_register.property_id,
    selected_revision.id,
    selected_employee.id,
    selected_fact.id,
    selected_fact.employee_number,
    coalesce(
      nullif(selected_fact.name_zh, ''),
      nullif(selected_fact.name_en, ''),
      '姓名未提供'
    ),
    selected_fact.department_id,
    selected_eligibility_state,
    '[]'::jsonb,
    true,
    selected_evaluation_date,
    'supplemental',
    btrim(p_inclusion_reason),
    auth.uid(),
    p_affects_requirement_eligibility,
    p_requires_follow_up
  )
  returning id into selected_snapshot_id;

  insert into public.employee_fact_dependencies(
    tenant_id,
    property_id,
    employee_id,
    employee_fact_version_id,
    fact_type,
    fact_id
  ) values (
    selected_register.tenant_id,
    selected_register.property_id,
    selected_employee.id,
    selected_fact.id,
    'session_participant_snapshot',
    selected_snapshot_id
  );

  update public.attendance_registers register_row
  set
    version = register_row.version + 1,
    updated_at = now()
  where register_row.id = selected_register.id
    and register_row.version = p_expected_version
  returning version into selected_version;
  if selected_version is null then
    raise exception '出勤登记版本已变化，请刷新后重试。'
      using errcode = '40001';
  end if;

  insert into public.attendance_register_events(
    tenant_id,
    property_id,
    attendance_register_id,
    event_type,
    from_state,
    to_state,
    reason,
    actor_user_id,
    evidence
  ) values (
    selected_register.tenant_id,
    selected_register.property_id,
    selected_register.id,
    'supplemental_participant_added',
    'open',
    'open',
    btrim(p_inclusion_reason),
    auth.uid(),
    jsonb_build_object(
      'participantSnapshotId', selected_snapshot_id,
      'employeeFactVersionId', selected_fact.id,
      'affectsRequirementEligibility',
        p_affects_requirement_eligibility,
      'requiresFollowUp', p_requires_follow_up
    )
  );

  return jsonb_build_object(
    'registerId', selected_register.id,
    'participantSnapshotId', selected_snapshot_id,
    'version', selected_version,
    'state', 'open',
    'source', 'real'
  );
end;
$$;

create or replace function public.begin_attendance_reconciliation(
  p_attendance_register_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_register public.attendance_registers%rowtype;
  selected_version bigint;
begin
  select register_row.* into selected_register
  from public.attendance_registers register_row
  where register_row.id = p_attendance_register_id
  for update;
  if selected_register.id is null then
    raise exception '未找到出勤登记册。' using errcode = 'P0002';
  end if;
  perform app_private.assert_attendance_session_actor(
    selected_register.session_revision_id
  );
  if selected_register.lifecycle_state <> 'open' then
    raise exception '只有开放中的登记册可以进入核对。'
      using errcode = '23514';
  end if;
  if selected_register.version <> p_expected_version then
    raise exception '出勤登记版本已变化，请刷新后重试。'
      using errcode = '40001';
  end if;

  update public.attendance_registers register_row
  set
    lifecycle_state = 'reconciling',
    version = register_row.version + 1,
    updated_at = now()
  where register_row.id = selected_register.id
    and register_row.version = p_expected_version
  returning version into selected_version;

  insert into public.attendance_register_events(
    tenant_id,
    property_id,
    attendance_register_id,
    event_type,
    from_state,
    to_state,
    reason,
    actor_user_id
  ) values (
    selected_register.tenant_id,
    selected_register.property_id,
    selected_register.id,
    'reconciliation_started',
    'open',
    'reconciling',
    '开始核对现场出勤事实',
    auth.uid()
  );

  return jsonb_build_object(
    'registerId', selected_register.id,
    'version', selected_version,
    'state', 'reconciling',
    'source', 'real'
  );
end;
$$;

create or replace function public.close_attendance_register(
  p_attendance_register_id uuid,
  p_expected_version bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_register public.attendance_registers%rowtype;
  selected_version bigint;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception '关闭登记册必须说明核对结论。'
      using errcode = '22023';
  end if;
  select register_row.* into selected_register
  from public.attendance_registers register_row
  where register_row.id = p_attendance_register_id
  for update;
  if selected_register.id is null then
    raise exception '未找到出勤登记册。' using errcode = 'P0002';
  end if;
  perform app_private.assert_attendance_session_actor(
    selected_register.session_revision_id
  );
  if selected_register.lifecycle_state <> 'reconciling' then
    raise exception '登记册必须先进入核对状态才能关闭。'
      using errcode = '23514';
  end if;
  if selected_register.version <> p_expected_version then
    raise exception '出勤登记版本已变化，请刷新后重试。'
      using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.attendance_observations observation
    where observation.attendance_register_id = selected_register.id
      and not exists (
        select 1
        from public.attendance_determination_observations link
        join public.attendance_determinations determination
          on determination.id = link.attendance_determination_id
        where link.attendance_observation_id = observation.id
          and link.attendance_register_id = selected_register.id
          and determination.participant_snapshot_id =
            observation.participant_snapshot_id
      )
  ) then
    raise exception '仍有签到或现场观察尚未形成出勤判定。'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.attendance_determinations determination
    where determination.attendance_register_id = selected_register.id
      and not exists (
        select 1
        from public.attendance_determination_observations link
        where link.attendance_determination_id = determination.id
      )
  ) then
    raise exception '仍有出勤判定缺少必要证据链。'
      using errcode = '23514';
  end if;

  update public.attendance_checkin_grants grant_row
  set
    lifecycle_state = 'revoked',
    version = grant_row.version + 1,
    revoked_by = auth.uid(),
    revoked_at = now()
  where grant_row.attendance_register_id = selected_register.id
    and grant_row.lifecycle_state = 'active';

  update public.attendance_registers register_row
  set
    lifecycle_state = 'closed',
    version = register_row.version + 1,
    closed_by = auth.uid(),
    closed_at = now(),
    closure_reason = btrim(p_reason),
    updated_at = now()
  where register_row.id = selected_register.id
    and register_row.version = p_expected_version
  returning version into selected_version;

  insert into public.attendance_register_events(
    tenant_id,
    property_id,
    attendance_register_id,
    event_type,
    from_state,
    to_state,
    reason,
    actor_user_id
  ) values (
    selected_register.tenant_id,
    selected_register.property_id,
    selected_register.id,
    'closed',
    'reconciling',
    'closed',
    btrim(p_reason),
    auth.uid()
  );

  return jsonb_build_object(
    'registerId', selected_register.id,
    'version', selected_version,
    'state', 'closed',
    'source', 'real'
  );
end;
$$;

create or replace function public.reopen_attendance_register(
  p_attendance_register_id uuid,
  p_expected_version bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_register public.attendance_registers%rowtype;
  selected_version bigint;
  selected_actor_type text;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception '重新开启登记册必须说明原因。'
      using errcode = '22023';
  end if;
  select register_row.* into selected_register
  from public.attendance_registers register_row
  where register_row.id = p_attendance_register_id
  for update;
  if selected_register.id is null then
    raise exception '未找到出勤登记册。' using errcode = 'P0002';
  end if;
  selected_actor_type :=
    app_private.assert_training_property_actor(
      selected_register.property_id
    );
  if selected_actor_type <> 'manager' then
    raise exception '只有学习与发展经理可以重新开启已关闭登记册。'
      using errcode = '42501';
  end if;
  if selected_register.lifecycle_state <> 'closed' then
    raise exception '只有已关闭登记册可以重新开启。'
      using errcode = '23514';
  end if;
  if selected_register.version <> p_expected_version then
    raise exception '出勤登记版本已变化，请刷新后重试。'
      using errcode = '40001';
  end if;

  update public.attendance_registers register_row
  set
    lifecycle_state = 'open',
    version = register_row.version + 1,
    closed_by = null,
    closed_at = null,
    closure_reason = null,
    updated_at = now()
  where register_row.id = selected_register.id
    and register_row.version = p_expected_version
  returning version into selected_version;

  insert into public.attendance_register_events(
    tenant_id,
    property_id,
    attendance_register_id,
    event_type,
    from_state,
    to_state,
    reason,
    actor_user_id
  ) values (
    selected_register.tenant_id,
    selected_register.property_id,
    selected_register.id,
    'reopened',
    'closed',
    'open',
    btrim(p_reason),
    auth.uid()
  );

  return jsonb_build_object(
    'registerId', selected_register.id,
    'version', selected_version,
    'state', 'open',
    'source', 'real'
  );
end;
$$;

revoke all on function
  app_private.assert_attendance_session_actor(uuid),
  app_private.assert_attendance_participant_actor(uuid,uuid),
  app_private.block_revision_after_attendance_lock(),
  app_private.reject_attendance_fact_mutation(),
  app_private.validate_attendance_fact_lineage(),
  app_private.attendance_participants_document(uuid,uuid,uuid,boolean),
  app_private.attendance_registers_document(uuid,boolean)
from public, anon, authenticated;

revoke all on function
  public.read_attendance_workspace(uuid),
  public.read_department_attendance_workspace(),
  public.open_attendance_register(uuid,bigint),
  public.issue_attendance_checkin_grant(uuid,bigint),
  public.submit_attendance_checkin(text,text,text,text),
  public.record_attendance_determination(
    uuid,uuid,text,text,uuid[],bigint
  ),
  public.add_supplemental_participant_snapshot(
    uuid,uuid,text,boolean,boolean,bigint
  ),
  public.begin_attendance_reconciliation(uuid,bigint),
  public.close_attendance_register(uuid,bigint,text),
  public.reopen_attendance_register(uuid,bigint,text)
from public, anon, authenticated;

grant execute on function
  public.read_attendance_workspace(uuid),
  public.read_department_attendance_workspace(),
  public.open_attendance_register(uuid,bigint),
  public.issue_attendance_checkin_grant(uuid,bigint),
  public.record_attendance_determination(
    uuid,uuid,text,text,uuid[],bigint
  ),
  public.add_supplemental_participant_snapshot(
    uuid,uuid,text,boolean,boolean,bigint
  ),
  public.begin_attendance_reconciliation(uuid,bigint),
  public.close_attendance_register(uuid,bigint,text),
  public.reopen_attendance_register(uuid,bigint,text)
to authenticated;

grant execute on function
  public.submit_attendance_checkin(text,text,text,text)
to anon, authenticated;

comment on table public.attendance_registers is
  'D3 control projection for one immutable Session Revision; not Completion.';
comment on table public.attendance_observations is
  'D3 observed check-in or manual witness evidence; not a determination.';
comment on table public.attendance_determinations is
  'D3 authorized attendance decision; never Completion or KPI.';
