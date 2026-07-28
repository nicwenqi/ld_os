begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table(
  'public',
  'attendance_registers',
  'D3 stores one controlled register per immutable Session Revision'
);
select has_table(
  'public',
  'attendance_register_events',
  'D3 preserves append-only register lifecycle evidence'
);
select has_table(
  'public',
  'attendance_evidence',
  'D3 separates evidence from observations and determinations'
);
select has_table(
  'public',
  'attendance_observations',
  'D3 stores immutable QR and Manual Witness observations'
);
select has_table(
  'public',
  'attendance_determinations',
  'D3 stores append-only authorized attendance decisions'
);
select has_table(
  'public',
  'attendance_determination_observations',
  'D3 links every determination to its evidence observations'
);
select has_table(
  'public',
  'attendance_checkin_grants',
  'D3 stores revocable hashed public check-in grants'
);
select has_table(
  'public',
  'attendance_checkin_attempts',
  'D3 stores privacy-minimized public attempt evidence'
);

select has_function(
  'public',
  'read_attendance_workspace',
  array['uuid'],
  'manager attendance read is property-authorized'
);
select has_function(
  'public',
  'read_department_attendance_workspace',
  array[]::text[],
  'department attendance read derives property and scope server-side'
);
select has_function(
  'public',
  'open_attendance_register',
  array['uuid', 'bigint'],
  'attendance opens against one immutable Session Revision'
);
select has_function(
  'public',
  'issue_attendance_checkin_grant',
  array['uuid', 'bigint'],
  'QR access uses an explicit revocable grant'
);
select has_function(
  'public',
  'submit_attendance_checkin',
  array['text', 'text', 'text', 'text'],
  'public check-in accepts only opaque token and exact identity evidence'
);
select has_function(
  'public',
  'record_attendance_determination',
  array['uuid', 'uuid', 'text', 'text', 'uuid[]', 'bigint'],
  'authorized attendance decisions use explicit evidence and concurrency'
);
select has_function(
  'public',
  'add_supplemental_participant_snapshot',
  array['uuid', 'uuid', 'text', 'boolean', 'boolean', 'bigint'],
  'supplemental participant inclusion is a governed snapshot operation'
);
select has_function(
  'public',
  'begin_attendance_reconciliation',
  array['uuid', 'bigint'],
  'register reconciliation uses an explicit lifecycle transition'
);
select has_function(
  'public',
  'close_attendance_register',
  array['uuid', 'bigint', 'text'],
  'register closure is explicit and version checked'
);
select has_function(
  'public',
  'reopen_attendance_register',
  array['uuid', 'bigint', 'text'],
  'closed attendance can only be corrected after an audited reopen'
);

select results_eq(
  $$select count(*)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'attendance_registers',
        'attendance_register_events',
        'attendance_evidence',
        'attendance_observations',
        'attendance_determinations',
        'attendance_determination_observations',
        'attendance_checkin_grants',
        'attendance_checkin_attempts'
      )
      and relation.relrowsecurity
      and relation.relforcerowsecurity$$,
  array[8::bigint],
  'all D3 public relations enable and force RLS'
);

select results_eq(
  $$select count(*)
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'public'
      and table_name in (
        'attendance_registers',
        'attendance_register_events',
        'attendance_evidence',
        'attendance_observations',
        'attendance_determinations',
        'attendance_determination_observations',
        'attendance_checkin_grants',
        'attendance_checkin_attempts'
      )
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')$$,
  array[0::bigint],
  'D3 exposes no direct browser table access'
);

select results_eq(
  $$select count(*)
    from pg_constraint constraint_row
    join pg_namespace namespace
      on namespace.oid = constraint_row.connamespace
    where constraint_row.contype = 'f'
      and namespace.nspname = 'public'
      and constraint_row.conrelid::regclass::text in (
        'session_participant_snapshots',
        'attendance_registers',
        'attendance_register_events',
        'attendance_evidence',
        'attendance_observations',
        'attendance_determinations',
        'attendance_determination_observations',
        'attendance_checkin_grants',
        'attendance_checkin_attempts'
      )
      and not exists (
        select 1
        from pg_index index_row
        where index_row.indrelid = constraint_row.conrelid
          and index_row.indisvalid
          and index_row.indkey[0] = constraint_row.conkey[1]
      )$$,
  array[0::bigint],
  'every D3 foreign-key path has a leading supporting index'
);

select function_privs_are(
  'public',
  'submit_attendance_checkin',
  array['text', 'text', 'text', 'text'],
  'anon',
  array['EXECUTE'],
  'anonymous QR participants can call only the narrow submission function'
);

select results_eq(
  $$select count(*)
    from information_schema.routine_privileges
    where grantee = 'anon'
      and specific_schema = 'public'
      and routine_name in (
        'read_attendance_workspace',
        'read_department_attendance_workspace',
        'open_attendance_register',
        'issue_attendance_checkin_grant',
        'record_attendance_determination',
        'add_supplemental_participant_snapshot',
        'begin_attendance_reconciliation',
        'close_attendance_register',
        'reopen_attendance_register'
      )
      and privilege_type = 'EXECUTE'$$,
  array[0::bigint],
  'anonymous requests cannot call authenticated attendance operations'
);

select results_eq(
  $$select count(*)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and relation.relname in (
        'attendance_scores',
        'attendance_rates',
        'work_time_records',
        'shift_attendance',
        'payroll_attendance',
        'training_completion_records',
        'completion_evidence',
        'requirement_fulfillment',
        'kpi_actuals',
        'training_forecasts',
        'training_health_scores',
        'training_risks',
        'ai_recommendations'
      )$$,
  array[0::bigint],
  'D3 creates no HR attendance, completion or analytical facts'
);

-- Local synthetic actors and one immutable D2 delivery.
reset role;
insert into public.user_accounts(
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values
  (
    '79000000-0000-0000-0000-00000000f301',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000103',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'd3-manager',
    'active',
    false
  ),
  (
    '79000000-0000-0000-0000-00000000f302',
    '00000000-0000-0000-0000-000000000104',
    '00000000-0000-0000-0000-000000000104',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'd3-department',
    'active',
    false
  );

insert into public.role_assignments(
  id, user_id, role_id, tenant_id, property_id, status, granted_at
)
select
  '70000000-0000-0000-0000-00000000f302',
  '00000000-0000-0000-0000-000000000104',
  role.id,
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'active',
  now()
from public.roles role
where role.code = 'department_training_admin';

insert into public.trainer_scopes(
  id, role_assignment_id, tenant_id, property_id, department_id,
  include_descendants, is_active
) values (
  '71000000-0000-0000-0000-00000000f302',
  '70000000-0000-0000-0000-00000000f302',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '61000000-0000-0000-0000-000000000012',
  true,
  true
);

insert into public.employees(
  id, tenant_id, property_id, employee_number, name_zh, department_id,
  position_id, position_family_id, hire_date, employment_status,
  is_new_employee, is_active, source_system
) values
  (
    '75000000-0000-0000-0000-00000000f301',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'D30001',
    'D3 二维码员工',
    '61000000-0000-0000-0000-000000000013',
    '65000000-0000-0000-0000-000000000012',
    '64000000-0000-0000-0000-000000000012',
    current_date - 20,
    'active',
    true,
    true,
    'd3-pgtap'
  ),
  (
    '75000000-0000-0000-0000-00000000f302',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'D30002',
    'D3 人工见证员工',
    '61000000-0000-0000-0000-000000000013',
    '65000000-0000-0000-0000-000000000012',
    '64000000-0000-0000-0000-000000000012',
    current_date - 40,
    'active',
    false,
    true,
    'd3-pgtap'
  ),
  (
    '75000000-0000-0000-0000-00000000f303',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'D30003',
    'D3 未登记员工',
    '61000000-0000-0000-0000-000000000013',
    '65000000-0000-0000-0000-000000000012',
    '64000000-0000-0000-0000-000000000012',
    current_date - 80,
    'active',
    false,
    true,
    'd3-pgtap'
  ),
  (
    '75000000-0000-0000-0000-00000000f304',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'D30004',
    'D3 追加员工',
    '61000000-0000-0000-0000-000000000013',
    '65000000-0000-0000-0000-000000000012',
    '64000000-0000-0000-0000-000000000012',
    current_date - 60,
    'active',
    false,
    true,
    'd3-pgtap'
  ),
  (
    '75000000-0000-0000-0000-00000000f305',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'D30005',
    'D3 范围外员工',
    '61000000-0000-0000-0000-000000000019',
    '65000000-0000-0000-0000-000000000011',
    '64000000-0000-0000-0000-000000000011',
    current_date - 90,
    'active',
    false,
    true,
    'd3-pgtap'
  );

insert into public.courses(
  id, tenant_id, property_id, code, name_zh
) values (
  '72000000-0000-0000-0000-00000000f301',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'D3-COURSE',
  'D3 合成培训课程'
);

insert into public.course_versions(
  id, tenant_id, property_id, course_id, version_number, lifecycle_state,
  name_zh, description, outline, learning_material_version,
  standard_duration_minutes, learning_objectives, capability_tags,
  assessment_criteria, change_reason, continuity_rationale,
  published_by, published_at
) values (
  '72100000-0000-0000-0000-00000000f301',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '72000000-0000-0000-0000-00000000f301',
  1,
  'published',
  'D3 合成培训课程',
  '仅用于 D3 本地事务测试',
  '现场培训交付',
  'D3.1',
  60,
  array['完成现场培训交付'],
  array['现场培训'],
  'D3 不产生 Completion',
  '建立 D3 测试课程版本',
  '保持同一课程身份',
  '00000000-0000-0000-0000-000000000103',
  now()
);

insert into public.training_sessions(
  id, tenant_id, property_id, code, name_zh, purpose_type,
  course_version_id, owning_department_id,
  operational_owner_role_assignment_id, current_state
)
select
  '73000000-0000-0000-0000-00000000f301',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'D3-SESSION-001',
  'D3 现场培训',
  'development_delivery',
  '72100000-0000-0000-0000-00000000f301',
  '61000000-0000-0000-0000-000000000012',
  assignment.id,
  'draft'
from public.role_assignments assignment
join public.roles role on role.id = assignment.role_id
where assignment.user_id = '00000000-0000-0000-0000-000000000103'
  and assignment.property_id = '20000000-0000-0000-0000-000000000011'
  and assignment.status = 'active'
  and role.code = 'property_ld_manager'
limit 1;

insert into public.training_session_revisions(
  id, tenant_id, property_id, training_session_id, revision_number,
  lifecycle_state, name_zh, starts_at, ends_at, timezone, capacity,
  venue_type, venue_name_snapshot, venue_location_snapshot,
  venue_capacity_snapshot, selected_employee_ids, published_by, published_at
) values (
  '73100000-0000-0000-0000-00000000f301',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '73000000-0000-0000-0000-00000000f301',
  1,
  'draft',
  'D3 现场培训',
  now() + interval '15 minutes',
  now() + interval '75 minutes',
  'Asia/Shanghai',
  20,
  'other_location',
  '酒店培训室',
  '酒店三层',
  20,
  array[
    '75000000-0000-0000-0000-00000000f301',
    '75000000-0000-0000-0000-00000000f302',
    '75000000-0000-0000-0000-00000000f303',
    '75000000-0000-0000-0000-00000000f305'
  ]::uuid[],
  '00000000-0000-0000-0000-000000000103',
  now()
);

insert into public.training_session_target_departments(
  tenant_id, property_id, session_revision_id, department_id,
  include_descendants
) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '73100000-0000-0000-0000-00000000f301',
  '61000000-0000-0000-0000-000000000012',
  true
);

insert into public.attendance_preparation_configs(
  tenant_id, property_id, session_revision_id, preparation_mode,
  opens_before_minutes, closes_after_minutes
) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '73100000-0000-0000-0000-00000000f301',
  'qr_or_manual',
  30,
  30
);

update public.training_session_revisions
set lifecycle_state = 'published'
where id = '73100000-0000-0000-0000-00000000f301';

update public.training_sessions
set
  current_revision_id = '73100000-0000-0000-0000-00000000f301',
  current_state = 'published'
where id = '73000000-0000-0000-0000-00000000f301';

insert into public.session_participant_snapshots(
  id, tenant_id, property_id, session_revision_id, employee_id,
  employee_fact_version_id, employee_number_snapshot,
  employee_name_snapshot, department_id_snapshot, eligibility_state,
  selected, evaluated_on
)
select
  case employee.id
    when '75000000-0000-0000-0000-00000000f301'::uuid
      then '73200000-0000-0000-0000-00000000f301'::uuid
    when '75000000-0000-0000-0000-00000000f302'::uuid
      then '73200000-0000-0000-0000-00000000f302'::uuid
    when '75000000-0000-0000-0000-00000000f303'::uuid
      then '73200000-0000-0000-0000-00000000f303'::uuid
    else '73200000-0000-0000-0000-00000000f305'::uuid
  end,
  employee.tenant_id,
  employee.property_id,
  '73100000-0000-0000-0000-00000000f301',
  employee.id,
  fact.id,
  employee.employee_number,
  employee.name_zh,
  employee.department_id,
  'not_evaluated',
  true,
  current_date
from public.employees employee
join lateral (
  select fact_row.id
  from public.employee_fact_versions fact_row
  where fact_row.employee_id = employee.id
  order by fact_row.effective_date desc, fact_row.employee_version desc
  limit 1
) fact on true
where employee.id in (
  '75000000-0000-0000-0000-00000000f301',
  '75000000-0000-0000-0000-00000000f302',
  '75000000-0000-0000-0000-00000000f303',
  '75000000-0000-0000-0000-00000000f305'
);

insert into public.employee_fact_dependencies(
  tenant_id, property_id, employee_id, employee_fact_version_id,
  fact_type, fact_id
)
select
  snapshot.tenant_id,
  snapshot.property_id,
  snapshot.employee_id,
  snapshot.employee_fact_version_id,
  'session_participant_snapshot',
  snapshot.id
from public.session_participant_snapshots snapshot
where snapshot.session_revision_id =
  '73100000-0000-0000-0000-00000000f301';

create temporary table d3_test_ids(
  key text primary key,
  value uuid not null
) on commit drop;
create temporary table d3_test_text(
  key text primary key,
  value text not null
) on commit drop;
grant select, insert, update, delete on d3_test_ids to authenticated, anon;
grant select, insert, update, delete on d3_test_text to authenticated, anon;

create or replace function pg_temp.capture_attendance_grant(
  p_register_id uuid,
  p_expected_version bigint
)
returns boolean
language plpgsql
as $$
declare
  result jsonb;
begin
  result := public.issue_attendance_checkin_grant(
    p_register_id,
    p_expected_version
  );
  insert into d3_test_text(key, value)
  values ('token', result->>'token');
  return true;
exception when others then
  return false;
end;
$$;

create or replace function pg_temp.capture_public_checkin(
  p_token text,
  p_employee_number text,
  p_employee_name text,
  p_idempotency_key text
)
returns text
language plpgsql
as $$
begin
  return public.submit_attendance_checkin(
    p_token,
    p_employee_number,
    p_employee_name,
    p_idempotency_key
  )->>'outcome';
exception when others then
  return 'test_error';
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select lives_ok(
  $$select public.open_attendance_register(
    '73100000-0000-0000-0000-00000000f301',
    1
  )$$,
  'manager can open attendance for the current published Session Revision'
);

reset role;
insert into d3_test_ids(key, value)
select 'register', register_row.id
from public.attendance_registers register_row
where register_row.session_revision_id =
  '73100000-0000-0000-0000-00000000f301';
select is(
  (select count(*) from public.attendance_registers),
  1::bigint,
  'opening creates one register for the immutable published Session Revision'
);
select is(
  (select count(*) from public.attendance_register_events),
  1::bigint,
  'opening records one immutable register event'
);

select throws_ok(
  $$insert into public.training_session_revisions(
      tenant_id, property_id, training_session_id, revision_number,
      lifecycle_state, name_zh, starts_at, ends_at, timezone, capacity,
      venue_type, venue_name_snapshot, venue_location_snapshot,
      venue_capacity_snapshot
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000011',
      '73000000-0000-0000-0000-00000000f301',
      2,
      'draft',
      '不应允许的新修订',
      now() + interval '1 day',
      now() + interval '1 day 1 hour',
      'Asia/Shanghai',
      20,
      'other_location',
      '酒店培训室',
      '酒店三层',
      20
    )$$,
  '23514',
  '出勤登记已开放，不能再建立或发布替代场次修订。',
  'opening attendance locks the delivered Session Revision'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select ok(
  pg_temp.capture_attendance_grant(
    (select value from d3_test_ids where key = 'register'),
    1
  ),
  'manager can issue a purpose-bound QR check-in grant'
);
select throws_ok(
  format(
    $$select public.issue_attendance_checkin_grant(
      %L::uuid,
      1
    )$$,
    (select value from d3_test_ids where key = 'register')
  ),
  'P0001',
  '出勤登记版本已变化，请刷新后重试。',
  'stale attendance versions return a non-retryable business conflict'
);

reset role;
select is(
  (select count(*) from public.attendance_checkin_grants),
  1::bigint,
  'issuing a QR link stores one controlled grant'
);
select isnt(
  (
    select grant_row.token_hash
    from public.attendance_checkin_grants grant_row
    limit 1
  ),
  (select value from d3_test_text where key = 'token'),
  'the opaque QR token is never stored in plaintext'
);

set local role anon;
select is(
  pg_temp.capture_public_checkin(
    (select value from d3_test_text where key = 'token'),
    'D30001',
    'D3 二维码员工',
    'd3-attempt-1'
  ),
  'accepted',
  'valid exact identity creates a QR Observation'
);
select is(
  pg_temp.capture_public_checkin(
    (select value from d3_test_text where key = 'token'),
    'D30001',
    'D3 二维码员工',
    'd3-attempt-1'
  ),
  'already_recorded',
  'the same idempotency key never creates duplicate attendance facts'
);
select is(
  pg_temp.capture_public_checkin(
    (select value from d3_test_text where key = 'token'),
    'D39999',
    '不存在员工',
    'd3-attempt-invalid'
  ),
  'unable_to_check_in',
  'unmatched identity returns only the generic public outcome'
);
with distinct_attempts as materialized (
  select pg_temp.capture_public_checkin(
    (select value from d3_test_text where key = 'token'),
    'INVALID-' || attempt_number::text,
    '不存在员工' || attempt_number::text,
    'd3-attempt-distinct-' || attempt_number::text
  ) as outcome
  from generate_series(1, 20) attempt_number
)
select is(
  (
    select count(*)
    from distinct_attempts
    where outcome = 'unable_to_check_in'
  ),
  20::bigint,
  'distinct participants are not blocked by one register-wide QR attempt cap'
);
reset role;
select is(
  (select count(*) from public.attendance_checkin_attempts),
  22::bigint,
  'privacy-minimized attempts remain auditable without globally blocking a normal session'
);

select is(
  (select count(*) from public.attendance_observations),
  1::bigint,
  'QR submission creates one Observation'
);
select is(
  (select count(*) from public.attendance_determinations),
  0::bigint,
  'QR Observation never creates an Attendance Determination'
);
select is(
  (
    select count(*)
    from public.attendance_checkin_attempts attempt
    where attempt.identity_hash in ('D39999', '不存在员工')
  ),
  0::bigint,
  'failed public identity input is never stored in plaintext'
);
insert into d3_test_ids(key, value)
select 'qr_observation', observation.id
from public.attendance_observations observation
where observation.participant_snapshot_id =
  '73200000-0000-0000-0000-00000000f301'
limit 1;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select lives_ok(
  format(
    $$select public.begin_attendance_reconciliation(
      %L::uuid,
      3
    )$$,
    (select value from d3_test_ids where key = 'register')
  ),
  'manager can begin explicit attendance reconciliation'
);
select throws_ok(
  format(
    $$select public.close_attendance_register(
      %L::uuid,
      4,
      '尝试在未核对二维码观察时关闭'
    )$$,
    (select value from d3_test_ids where key = 'register')
  ),
  '23514',
  '仍有签到或现场观察尚未形成出勤判定。',
  'an unreviewed QR Observation blocks register closure'
);

select lives_ok(
  format(
    $$select public.record_attendance_determination(
      %L::uuid,
      '73200000-0000-0000-0000-00000000f301',
      'present',
      '经理核对二维码签到回执',
      array[%L::uuid],
      4
    )$$,
    (select value from d3_test_ids where key = 'register'),
    (select value from d3_test_ids where key = 'qr_observation')
  ),
  'manager can determine Present from the QR Observation without creating Completion'
);

select lives_ok(
  format(
    $$select public.record_attendance_determination(
      %L::uuid,
      '73200000-0000-0000-0000-00000000f302',
      'absent',
      '现场点名确认未到',
      array[]::uuid[],
      5
    )$$,
    (select value from d3_test_ids where key = 'register')
  ),
  'Manual Witness atomically records evidence and an Absent determination'
);

select lives_ok(
  format(
    $$select public.record_attendance_determination(
      %L::uuid,
      '73200000-0000-0000-0000-00000000f302',
      'excused_absence',
      '部门确认员工因酒店运营获准缺席',
      array[]::uuid[],
      6
    )$$,
    (select value from d3_test_ids where key = 'register')
  ),
  'a correction appends an Excused Absence determination'
);

select throws_ok(
  format(
    $$select public.record_attendance_determination(
      %L::uuid,
      '73200000-0000-0000-0000-00000000f303',
      'late',
      'D3 不允许迟到评分状态',
      array[]::uuid[],
      7
    )$$,
    (select value from d3_test_ids where key = 'register')
  ),
  '22023',
  '出勤判定必须是出席、缺席、获准缺席或无法判断。',
  'database boundary rejects a fifth attendance determination'
);

reset role;
select is(
  (
    select count(*)
    from public.attendance_determinations
    where participant_snapshot_id =
      '73200000-0000-0000-0000-00000000f302'
  ),
  2::bigint,
  'correction preserves both the original and replacement determination'
);
select isnt(
  (
    select latest.supersedes_determination_id
    from public.attendance_determinations latest
    where latest.participant_snapshot_id =
      '73200000-0000-0000-0000-00000000f302'
    order by latest.determination_number desc
    limit 1
  ),
  null::uuid,
  'the replacement determination explicitly points to its predecessor'
);
select is(
  (
    select count(*)
    from public.employee_fact_dependencies dependency
    where dependency.fact_type in (
      'attendance_observation',
      'attendance_determination'
    )
  ),
  6::bigint,
  'every Observation and Determination preserves Employee Fact Version dependency'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select lives_ok(
  format(
    $$select public.close_attendance_register(
      %L::uuid,
      7,
      '已核对现有证据，未登记员工保持未形成判定'
    )$$,
    (select value from d3_test_ids where key = 'register')
  ),
  'manager can close after evidence reconciliation'
);

reset role;
select is(
  (
    select lifecycle_state
    from public.attendance_registers
    where id = (select value from d3_test_ids where key = 'register')
  ),
  'closed',
  'register reaches Closed without inventing missing attendance'
);
select is(
  (
    select count(*)
    from public.session_participant_snapshots snapshot
    where snapshot.session_revision_id =
      '73100000-0000-0000-0000-00000000f301'
      and snapshot.selected
      and not exists (
        select 1
        from public.attendance_determinations determination
        where determination.participant_snapshot_id = snapshot.id
      )
  ),
  2::bigint,
  'Closed permits selected participants with no Attendance Determination'
);

select throws_ok(
  $$update public.attendance_observations
    set requires_review = true$$,
  '42501',
  'ATTENDANCE_FACT_APPEND_ONLY',
  'Attendance Observations are append-only even for direct SQL'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select lives_ok(
  format(
    $$select public.reopen_attendance_register(
      %L::uuid,
      8,
      '收到新的现场补充证据'
    )$$,
    (select value from d3_test_ids where key = 'register')
  ),
  'manager can reopen a closed register with an audited reason'
);

select lives_ok(
  format(
    $$select public.add_supplemental_participant_snapshot(
      %L::uuid,
      '75000000-0000-0000-0000-00000000f304',
      '现场新增，经培训负责人确认',
      false,
      true,
      9
    )$$,
    (select value from d3_test_ids where key = 'register')
  ),
  'manager can add one governed Supplemental Participant Snapshot'
);

reset role;
select is(
  (
    select count(*)
    from public.session_participant_snapshots snapshot
    where snapshot.employee_id =
      '75000000-0000-0000-0000-00000000f304'
      and snapshot.snapshot_origin = 'supplemental'
      and snapshot.inclusion_reason =
        '现场新增，经培训负责人确认'
      and snapshot.supplemental_authorized_by =
        '00000000-0000-0000-0000-000000000103'
      and not snapshot.affects_requirement_eligibility
      and snapshot.requires_follow_up
  ),
  1::bigint,
  'Supplemental snapshot persists reason, authorizer, eligibility impact and follow-up'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select throws_ok(
  format(
    $$select public.record_attendance_determination(
      %L::uuid,
      '73200000-0000-0000-0000-00000000f305',
      'present',
      '部门角色尝试修改范围外员工',
      array[]::uuid[],
      10
    )$$,
    (select value from d3_test_ids where key = 'register')
  ),
  '42501',
  '无权管理此参与人的出勤事实。',
  'department role cannot write an out-of-scope participant'
);

reset role;
insert into public.attendance_evidence(
  id,
  tenant_id,
  property_id,
  attendance_register_id,
  participant_snapshot_id,
  evidence_type,
  source_summary,
  integrity_hash
) values (
  '73400000-0000-0000-0000-00000000f399',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  (select value from d3_test_ids where key = 'register'),
  '73200000-0000-0000-0000-00000000f301',
  'manual_witness',
  '仅用于验证跨员工事实版本被数据库拒绝',
  'd3-lineage-mismatch-evidence'
);
select throws_ok(
  format(
    $$insert into public.attendance_observations(
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
        '10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000011',
        %L::uuid,
        '73200000-0000-0000-0000-00000000f301',
        (
          select employee_fact_version_id
          from public.session_participant_snapshots
          where id = '73200000-0000-0000-0000-00000000f302'
        ),
        '73400000-0000-0000-0000-00000000f399',
        'manual_witness',
        now(),
        true,
        false,
        'invalid-lineage'
      )$$,
    (select value from d3_test_ids where key = 'register')
  ),
  '23514',
  'ATTENDANCE_FACT_LINEAGE_MISMATCH',
  'database rejects an Observation using another employee fact version'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select is(
  (
    public.read_attendance_workspace(
      '20000000-0000-0000-0000-000000000011'
    )->>'role'
  ),
  'manager',
  'manager read returns the hotel-wide attendance workspace'
);
select is(
  jsonb_array_length(
    public.read_attendance_workspace(
      '20000000-0000-0000-0000-000000000011'
    )->'registers'->0->'participants'
  ),
  5,
  'manager sees every selected participant in the hotel register'
);
select is(
  (
    public.read_attendance_workspace(
      '20000000-0000-0000-0000-000000000011'
    )->'boundary'->>'completion'
  ),
  'unavailable',
  'attendance read truthfully keeps Completion unavailable'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select is(
  (
    public.read_department_attendance_workspace()->>'role'
  ),
  'department',
  'department read derives the active authorized scope server-side'
);
select is(
  jsonb_array_length(
    public.read_department_attendance_workspace()
      ->'registers'->0->'participants'
  ),
  4,
  'department read excludes the out-of-scope participant snapshot'
);
select throws_ok(
  $$select public.read_attendance_workspace(
      '20000000-0000-0000-0000-000000000011'
    )$$,
  '42501',
  '只有学习与发展经理可以查看酒店出勤工作台。',
  'department role cannot call the hotel-wide attendance read directly'
);

select lives_ok(
  format(
    $$select public.record_attendance_determination(
      %L::uuid,
      '73200000-0000-0000-0000-00000000f303',
      'unable_to_determine',
      '部门负责人确认现场证据仍不足',
      array[]::uuid[],
      10
    )$$,
    (select value from d3_test_ids where key = 'register')
  ),
  'department role can determine attendance for an in-scope participant'
);
select throws_ok(
  format(
    $$select public.begin_attendance_reconciliation(
      %L::uuid,
      11
    )$$,
    (select value from d3_test_ids where key = 'register')
  ),
  '42501',
  '只有场次运营负责人可以开放或关闭本场出勤登记。',
  'a scoped department actor cannot take over register lifecycle ownership'
);

reset role;
select * from finish();
rollback;
