begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Structure and browser security -----------------------------------------

select has_table('public', 'completion_evidence',
  'D4 stores immutable source evidence separately from Completion');
select has_table('public', 'completion_attendance_sources',
  'Attendance evidence preserves exact D2 and D3 lineage');
select has_table('public', 'completion_external_sources',
  'external evidence has an explicit business structure');
select has_table('public', 'completion_manager_recognition_sources',
  'manager recognition has a controlled equivalency structure');
select has_table('public', 'completion_evidence_reviews',
  'evidence requires one explicit authorized review');
select has_table('public', 'completion_records',
  'accepted evidence creates an immutable Completion fact');
select has_table('public', 'completion_record_revocations',
  'revocation preserves the original Completion fact');
select has_table('public', 'completion_audit_events',
  'D4 retains one append-only audit chain');

select has_function('public', 'read_completion_workspace', array['uuid'],
  'Manager read is property authorized');
select has_function('public', 'read_department_completion_workspace',
  array[]::text[], 'Department read derives property and scope server-side');
select has_function(
  'public',
  'record_attendance_completion_evidence',
  array['uuid', 'text'],
  'Attendance evidence derives all immutable lineage from one determination'
);
select has_function(
  'public',
  'record_external_completion_evidence',
  array['uuid', 'uuid', 'uuid', 'text', 'text', 'date', 'date', 'text'],
  'external evidence uses explicit source fields'
);
select has_function(
  'public',
  'record_manager_recognition_evidence',
  array['uuid', 'uuid', 'uuid', 'date', 'text'],
  'manager recognition uses an explicit equivalency decision'
);
select has_function(
  'public',
  'review_completion_evidence',
  array['uuid', 'text', 'text', 'uuid'],
  'evidence review is separate from evidence recording'
);
select has_function(
  'public',
  'revoke_completion_record',
  array['uuid', 'text'],
  'Completion revocation is a reasoned append-only operation'
);

select results_eq(
  $$select count(*)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'completion_evidence',
        'completion_attendance_sources',
        'completion_external_sources',
        'completion_manager_recognition_sources',
        'completion_evidence_reviews',
        'completion_records',
        'completion_record_revocations',
        'completion_audit_events'
      )
      and relation.relrowsecurity
      and relation.relforcerowsecurity$$,
  array[8::bigint],
  'all D4 public relations enable and force RLS'
);

select results_eq(
  $$select count(*)
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'public'
      and table_name like 'completion_%'
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')$$,
  array[0::bigint],
  'D4 exposes no direct browser table access'
);

select results_eq(
  $$select count(*)
    from information_schema.routine_privileges
    where grantee = 'anon'
      and specific_schema = 'public'
      and routine_name in (
        'read_completion_workspace',
        'read_department_completion_workspace',
        'record_attendance_completion_evidence',
        'record_external_completion_evidence',
        'record_manager_recognition_evidence',
        'review_completion_evidence',
        'revoke_completion_record'
      )
      and privilege_type = 'EXECUTE'$$,
  array[0::bigint],
  'anonymous users cannot read or mutate Completion facts'
);

select results_eq(
  $$select count(*)
    from pg_constraint constraint_row
    join pg_namespace namespace
      on namespace.oid = constraint_row.connamespace
    where constraint_row.contype = 'f'
      and namespace.nspname = 'public'
      and constraint_row.conrelid::regclass::text in (
        'completion_evidence',
        'completion_attendance_sources',
        'completion_external_sources',
        'completion_manager_recognition_sources',
        'completion_evidence_reviews',
        'completion_records',
        'completion_record_revocations',
        'completion_audit_events'
      )
      and not exists (
        select 1
        from pg_index index_row
        where index_row.indrelid = constraint_row.conrelid
          and index_row.indisvalid
          and index_row.indkey[0] = constraint_row.conkey[1]
      )$$,
  array[0::bigint],
  'every D4 foreign-key path has a leading supporting index'
);

select results_eq(
  $$select count(*)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and relation.relname in (
        'training_assignments',
        'training_due_tasks',
        'training_reminders',
        'training_notifications',
        'training_feedback',
        'training_surveys',
        'kpi_actuals',
        'training_health_scores',
        'training_forecasts',
        'training_risks',
        'ai_recommendations',
        'employee_performance_scores'
      )$$,
  array[0::bigint],
  'D4 creates no Assignment, feedback, analytics, AI, or HR facts'
);

-- Synthetic local-only lineage -------------------------------------------

reset role;
insert into public.user_accounts(
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values
  (
    '89000000-0000-0000-0000-00000000d401',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000103',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'd4-manager',
    'active',
    false
  ),
  (
    '89000000-0000-0000-0000-00000000d402',
    '00000000-0000-0000-0000-000000000104',
    '00000000-0000-0000-0000-000000000104',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'd4-department',
    'active',
    false
  );

insert into public.role_assignments(
  id, user_id, role_id, tenant_id, property_id, status, granted_at
)
select
  '89100000-0000-0000-0000-00000000d402',
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
  '89200000-0000-0000-0000-00000000d402',
  '89100000-0000-0000-0000-00000000d402',
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
    '85000000-0000-0000-0000-00000000d401',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'D40001',
    'D4 范围内员工',
    '61000000-0000-0000-0000-000000000013',
    '65000000-0000-0000-0000-000000000012',
    '64000000-0000-0000-0000-000000000012',
    current_date - 80,
    'active',
    false,
    true,
    'd4-pgtap'
  ),
  (
    '85000000-0000-0000-0000-00000000d402',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'D40002',
    'D4 无法判断员工',
    '61000000-0000-0000-0000-000000000013',
    '65000000-0000-0000-0000-000000000012',
    '64000000-0000-0000-0000-000000000012',
    current_date - 60,
    'active',
    false,
    true,
    'd4-pgtap'
  ),
  (
    '85000000-0000-0000-0000-00000000d403',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'D40003',
    'D4 范围外员工',
    '61000000-0000-0000-0000-000000000019',
    '65000000-0000-0000-0000-000000000011',
    '64000000-0000-0000-0000-000000000011',
    current_date - 120,
    'active',
    false,
    true,
    'd4-pgtap'
  );

insert into public.courses(
  id, tenant_id, property_id, code, name_zh
) values (
  '82000000-0000-0000-0000-00000000d401',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'D4-FIRE',
  'D4 消防安全课程'
);

insert into public.course_versions(
  id, tenant_id, property_id, course_id, version_number, lifecycle_state,
  name_zh, description, outline, learning_material_version,
  standard_duration_minutes, learning_objectives, capability_tags,
  assessment_criteria, change_reason, continuity_rationale,
  published_by, published_at
) values (
  '82100000-0000-0000-0000-00000000d401',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '82000000-0000-0000-0000-00000000d401',
  1,
  'published',
  'D4 消防安全课程',
  '用于 D4 完成证据验证',
  '消防与疏散实操',
  'D4.1',
  60,
  array['掌握消防与疏散操作'],
  array['消防安全'],
  '按课程版本标准完成核验',
  '建立 D4 测试课程',
  '保持同一消防课程身份',
  '00000000-0000-0000-0000-000000000103',
  now()
);

insert into public.training_requirements(
  id, tenant_id, property_id, code, name_zh
) values (
  '82200000-0000-0000-0000-00000000d401',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'D4-FIRE-REQ',
  'D4 年度消防要求'
);

insert into public.training_requirement_versions(
  id, tenant_id, property_id, training_requirement_id, version_number,
  lifecycle_state, name_zh, purpose, obligation_explanation,
  effective_from, change_reason, continuity_rationale
) values (
  '82300000-0000-0000-0000-00000000d401',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '82200000-0000-0000-0000-00000000d401',
  1,
  'draft',
  'D4 年度消防要求 2026',
  '建立年度消防能力义务',
  '员工可通过认可课程、外部证书或经理等价认定完成',
  current_date - 30,
  '建立 D4 测试要求版本',
  '保持同一消防义务身份'
);

insert into public.completion_definitions(
  id, tenant_id, property_id, training_requirement_version_id
) values (
  '82400000-0000-0000-0000-00000000d401',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '82300000-0000-0000-0000-00000000d401'
);

insert into public.accepted_learning_methods(
  id, tenant_id, property_id, completion_definition_id, method_type,
  label_zh, course_version_id, certificate_type, issuer_criteria,
  evidence_description, validity_months, assessment_name, pass_criteria,
  approval_standard, sort_order
) values
  (
    '82500000-0000-0000-0000-00000000d401',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '82400000-0000-0000-0000-00000000d401',
    'course_version',
    '参加 D4 消防安全课程',
    '82100000-0000-0000-0000-00000000d401',
    null, null, null, null, null, null, null, 1
  ),
  (
    '82500000-0000-0000-0000-00000000d402',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '82400000-0000-0000-0000-00000000d401',
    'external_certificate',
    '认可外部消防证书',
    null,
    '酒店认可消防证书',
    '经酒店审核的发证机构',
    '证书编号、发证机构和有效期',
    12,
    null, null, null, 2
  ),
  (
    '82500000-0000-0000-0000-00000000d403',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '82400000-0000-0000-0000-00000000d401',
    'manager_equivalency',
    '经理等价认定',
    null, null, null,
    '依据经批准标准核对等价学习经历',
    null, null, null,
    '必须由酒店学习与发展经理逐项核对',
    3
  ),
  (
    '82500000-0000-0000-0000-00000000d404',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '82400000-0000-0000-0000-00000000d401',
    'assessment',
    '受控消防考核',
    null, null, null,
    '受控考核结果',
    null,
    '消防实操考核',
    '按批准标准通过',
    null,
    4
  );

update public.training_requirement_versions
set
  lifecycle_state = 'effective',
  approved_by = '00000000-0000-0000-0000-000000000103',
  approved_at = now(),
  effective_by = '00000000-0000-0000-0000-000000000103',
  effective_at = now()
where id = '82300000-0000-0000-0000-00000000d401';

insert into public.training_sessions(
  id, tenant_id, property_id, code, name_zh, purpose_type,
  training_requirement_version_id, accepted_learning_method_id,
  course_version_id, owning_department_id,
  operational_owner_role_assignment_id, current_state
)
select
  '83000000-0000-0000-0000-00000000d401',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'D4-SESSION-001',
  'D4 消防安全交付',
  'requirement_delivery',
  '82300000-0000-0000-0000-00000000d401',
  '82500000-0000-0000-0000-00000000d401',
  '82100000-0000-0000-0000-00000000d401',
  '61000000-0000-0000-0000-000000000012',
  assignment.id,
  'published'
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
  '83100000-0000-0000-0000-00000000d401',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '83000000-0000-0000-0000-00000000d401',
  1,
  'published',
  'D4 消防安全交付',
  now() - interval '2 hours',
  now() - interval '1 hour',
  'Asia/Shanghai',
  20,
  'other_location',
  '酒店培训室',
  '酒店三层',
  20,
  array[
    '85000000-0000-0000-0000-00000000d401',
    '85000000-0000-0000-0000-00000000d402'
  ]::uuid[],
  '00000000-0000-0000-0000-000000000103',
  now() - interval '1 day'
);

update public.training_sessions
set current_revision_id = '83100000-0000-0000-0000-00000000d401'
where id = '83000000-0000-0000-0000-00000000d401';

insert into public.session_participant_snapshots(
  id, tenant_id, property_id, session_revision_id, employee_id,
  employee_fact_version_id, employee_number_snapshot,
  employee_name_snapshot, department_id_snapshot, eligibility_state,
  selected, evaluated_on
)
select
  case employee.id
    when '85000000-0000-0000-0000-00000000d401'::uuid
      then '83200000-0000-0000-0000-00000000d401'::uuid
    else '83200000-0000-0000-0000-00000000d402'::uuid
  end,
  employee.tenant_id,
  employee.property_id,
  '83100000-0000-0000-0000-00000000d401',
  employee.id,
  fact.id,
  employee.employee_number,
  employee.name_zh,
  employee.department_id,
  'eligible',
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
  '85000000-0000-0000-0000-00000000d401',
  '85000000-0000-0000-0000-00000000d402'
);

insert into public.attendance_registers(
  id, tenant_id, property_id, session_revision_id, lifecycle_state,
  version, opened_by, opened_at, closed_by, closed_at, closure_reason
) values (
  '84000000-0000-0000-0000-00000000d401',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '83100000-0000-0000-0000-00000000d401',
  'closed',
  4,
  '00000000-0000-0000-0000-000000000103',
  now() - interval '2 hours',
  '00000000-0000-0000-0000-000000000103',
  now() - interval '30 minutes',
  'D4 测试登记册证据已核对'
);

insert into public.attendance_evidence(
  id, tenant_id, property_id, attendance_register_id,
  participant_snapshot_id, evidence_type, source_summary, integrity_hash,
  recorded_by, recorded_at
) values
  (
    '84100000-0000-0000-0000-00000000d401',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '84000000-0000-0000-0000-00000000d401',
    '83200000-0000-0000-0000-00000000d401',
    'manual_witness',
    'D4 现场出席核对',
    repeat('a', 64),
    '00000000-0000-0000-0000-000000000103',
    now() - interval '1 hour'
  ),
  (
    '84100000-0000-0000-0000-00000000d402',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '84000000-0000-0000-0000-00000000d401',
    '83200000-0000-0000-0000-00000000d402',
    'manual_witness',
    'D4 无法确认现场情况',
    repeat('b', 64),
    '00000000-0000-0000-0000-000000000103',
    now() - interval '1 hour'
  );

insert into public.attendance_observations(
  id, tenant_id, property_id, attendance_register_id,
  participant_snapshot_id, employee_fact_version_id,
  attendance_evidence_id, observation_source, observed_at, received_at,
  within_capture_window, requires_review, idempotency_key, created_by
)
select
  case snapshot.id
    when '83200000-0000-0000-0000-00000000d401'::uuid
      then '84200000-0000-0000-0000-00000000d401'::uuid
    else '84200000-0000-0000-0000-00000000d402'::uuid
  end,
  snapshot.tenant_id,
  snapshot.property_id,
  '84000000-0000-0000-0000-00000000d401',
  snapshot.id,
  snapshot.employee_fact_version_id,
  case snapshot.id
    when '83200000-0000-0000-0000-00000000d401'::uuid
      then '84100000-0000-0000-0000-00000000d401'::uuid
    else '84100000-0000-0000-0000-00000000d402'::uuid
  end,
  'manual_witness',
  now() - interval '1 hour',
  now() - interval '1 hour',
  true,
  false,
  'd4-observation-' || right(snapshot.employee_number_snapshot, 1),
  '00000000-0000-0000-0000-000000000103'
from public.session_participant_snapshots snapshot
where snapshot.id in (
  '83200000-0000-0000-0000-00000000d401',
  '83200000-0000-0000-0000-00000000d402'
);

insert into public.attendance_determinations(
  id, tenant_id, property_id, attendance_register_id,
  participant_snapshot_id, employee_fact_version_id,
  determination_number, determination, reason, decided_by, decided_at
)
select
  case snapshot.id
    when '83200000-0000-0000-0000-00000000d401'::uuid
      then '84300000-0000-0000-0000-00000000d401'::uuid
    else '84300000-0000-0000-0000-00000000d402'::uuid
  end,
  snapshot.tenant_id,
  snapshot.property_id,
  '84000000-0000-0000-0000-00000000d401',
  snapshot.id,
  snapshot.employee_fact_version_id,
  1,
  case snapshot.id
    when '83200000-0000-0000-0000-00000000d401'::uuid then 'present'
    else 'unable_to_determine'
  end,
  case snapshot.id
    when '83200000-0000-0000-0000-00000000d401'::uuid
      then '现场证据确认出席'
    else '证据不足，无法判断'
  end,
  '00000000-0000-0000-0000-000000000103',
  now() - interval '45 minutes'
from public.session_participant_snapshots snapshot
where snapshot.id in (
  '83200000-0000-0000-0000-00000000d401',
  '83200000-0000-0000-0000-00000000d402'
);

insert into public.attendance_determination_observations(
  tenant_id, property_id, attendance_register_id,
  attendance_determination_id, attendance_observation_id
) values
  (
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '84000000-0000-0000-0000-00000000d401',
    '84300000-0000-0000-0000-00000000d401',
    '84200000-0000-0000-0000-00000000d401'
  ),
  (
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '84000000-0000-0000-0000-00000000d401',
    '84300000-0000-0000-0000-00000000d402',
    '84200000-0000-0000-0000-00000000d402'
  );

create temporary table d4_ids(
  key text primary key,
  value uuid not null
) on commit drop;
grant select, insert, update, delete on d4_ids to authenticated;

create or replace function pg_temp.capture_d4(
  p_key text,
  p_value jsonb
)
returns boolean
language plpgsql
as $$
begin
  insert into d4_ids(key, value)
  values (p_key, (p_value->>'id')::uuid)
  on conflict (key) do update set value = excluded.value;
  return true;
end;
$$;

-- Fact behavior -----------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';

select ok(
  pg_temp.capture_d4(
    'attendance_evidence',
    public.record_attendance_completion_evidence(
      '84300000-0000-0000-0000-00000000d401',
      '关闭登记册后核对出席判定与课程交付'
    )
  ),
  'Manager can record Present Attendance as evidence without creating Completion'
);

select throws_ok(
  $$select public.record_attendance_completion_evidence(
      '84300000-0000-0000-0000-00000000d402',
      'Unable to Determine 不得成为完成'
    )$$,
  '23514',
  '只有出席判定可以作为完成证据来源。',
  'Unable to Determine never becomes Completion Evidence'
);

reset role;
select is((select count(*) from public.completion_evidence), 1::bigint,
  'recording Attendance evidence creates one source fact');
select is((select count(*) from public.completion_records), 0::bigint,
  'evidence recording alone creates no Completion Record');
select is(
  (
    select count(*)
    from public.completion_evidence evidence
    join public.completion_attendance_sources source
      on source.completion_evidence_id = evidence.id
    where evidence.training_requirement_version_id =
        '82300000-0000-0000-0000-00000000d401'
      and evidence.accepted_learning_method_id =
        '82500000-0000-0000-0000-00000000d401'
      and evidence.course_version_id =
        '82100000-0000-0000-0000-00000000d401'
      and source.session_revision_id =
        '83100000-0000-0000-0000-00000000d401'
      and source.participant_snapshot_id =
        '83200000-0000-0000-0000-00000000d401'
      and source.attendance_determination_id =
        '84300000-0000-0000-0000-00000000d401'
  ),
  1::bigint,
  'Attendance evidence preserves Requirement, method, Course, Session, participant and determination'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select ok(
  pg_temp.capture_d4(
    'attendance_record',
    public.review_completion_evidence(
      (select value from d4_ids where key = 'attendance_evidence'),
      'accepted',
      '出席证据与课程版本及完成方式一致',
      null
    )
  ),
  'explicit accepted review creates a Completion Record'
);

select throws_ok(
  format(
    $$select public.review_completion_evidence(
      %L::uuid,
      'accepted',
      '不应重复核验',
      null
    )$$,
    (select value from d4_ids where key = 'attendance_evidence')
  ),
  'P0001',
  '完成证据已被其他用户核验，请重新读取。',
  'one immutable evidence row can be reviewed only once'
);

reset role;
select is((select count(*) from public.completion_records), 1::bigint,
  'accepted review creates exactly one Completion Record');
select is(
  (
    select count(*)
    from public.employee_fact_dependencies
    where fact_type in ('completion_evidence', 'completion_record')
  ),
  2::bigint,
  'Completion evidence and record preserve D0 Employee Fact dependencies'
);

-- Department-scoped external evidence and Manager-only recognition --------

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select ok(
  pg_temp.capture_d4(
    'external_evidence',
    public.record_external_completion_evidence(
      '85000000-0000-0000-0000-00000000d401',
      '82300000-0000-0000-0000-00000000d401',
      '82500000-0000-0000-0000-00000000d402',
      '酒店认可发证机构',
      'CERT-D4-001',
      current_date,
      current_date + 360,
      '部门负责人已核对证书编号与有效期'
    )
  ),
  'Department role can record external evidence inside event-time scope'
);

select throws_ok(
  $$select public.record_external_completion_evidence(
      '85000000-0000-0000-0000-00000000d403',
      '82300000-0000-0000-0000-00000000d401',
      '82500000-0000-0000-0000-00000000d402',
      '酒店认可发证机构',
      'CERT-D4-OUT',
      current_date,
      current_date + 360,
      '不应允许跨部门'
    )$$,
  '42501',
  '无权管理此员工在证据发生时的完成事实。',
  'Department role cannot create cross-scope Completion evidence'
);

select throws_ok(
  $$select public.record_manager_recognition_evidence(
      '85000000-0000-0000-0000-00000000d401',
      '82300000-0000-0000-0000-00000000d401',
      '82500000-0000-0000-0000-00000000d403',
      current_date,
      '部门账号不得进行经理等价认定'
    )$$,
  '42501',
  '经理等价认定仅限酒店学习与发展经理。',
  'Department role cannot create Manager Recognition'
);

select ok(
  pg_temp.capture_d4(
    'external_rejection',
    public.review_completion_evidence(
      (select value from d4_ids where key = 'external_evidence'),
      'rejected',
      '证书有效期超过已批准方法定义，需要重新提交',
      null
    )
  ),
  'Department role can reject in-scope evidence without creating Completion'
);

reset role;
select is(
  (
    select count(*)
    from public.completion_records record
    join public.completion_evidence evidence
      on evidence.id = record.completion_evidence_id
    where evidence.source_type = 'external_evidence'
  ),
  0::bigint,
  'rejected evidence creates no Completion Record'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select ok(
  pg_temp.capture_d4(
    'recognition_evidence',
    public.record_manager_recognition_evidence(
      '85000000-0000-0000-0000-00000000d403',
      '82300000-0000-0000-0000-00000000d401',
      '82500000-0000-0000-0000-00000000d403',
      current_date,
      '依据批准标准核对员工既有消防资质与现场经历'
    )
  ),
  'Manager can record controlled equivalency recognition'
);

select ok(
  pg_temp.capture_d4(
    'recognition_record',
    public.review_completion_evidence(
      (select value from d4_ids where key = 'recognition_evidence'),
      'accepted',
      '认定依据符合该 Requirement Version 的等价标准',
      null
    )
  ),
  'Manager can explicitly accept Manager Recognition'
);

select throws_ok(
  $$select public.record_external_completion_evidence(
      '85000000-0000-0000-0000-00000000d401',
      '82300000-0000-0000-0000-00000000d401',
      '82500000-0000-0000-0000-00000000d404',
      '不适用',
      'ASSESSMENT-NOT-EXTERNAL',
      current_date,
      null,
      '不得把 assessment 伪装成外部证据'
    )$$,
  '23514',
  '所选完成方式不是外部证书方法。',
  'D4 does not disguise an unsupported Assessment as external evidence'
);

-- Revocation, correction, immutable history and reads ---------------------

select ok(
  pg_temp.capture_d4(
    'revocation',
    public.revoke_completion_record(
      (select value from d4_ids where key = 'attendance_record'),
      '发现课程交付证据引用错误，需要保留原记录并撤销'
    )
  ),
  'Manager can revoke with a reason while retaining original evidence'
);

select ok(
  pg_temp.capture_d4(
    'replacement_external_evidence',
    public.record_external_completion_evidence(
      '85000000-0000-0000-0000-00000000d401',
      '82300000-0000-0000-0000-00000000d401',
      '82500000-0000-0000-0000-00000000d402',
      '酒店认可发证机构',
      'CERT-D4-REPLACEMENT',
      current_date,
      current_date + 300,
      '用于替代已撤销完成记录的新证据'
    )
  ),
  'correction starts with new append-only evidence'
);

select ok(
  pg_temp.capture_d4(
    'replacement_record',
    public.review_completion_evidence(
      (select value from d4_ids where key = 'replacement_external_evidence'),
      'accepted',
      '新证据符合外部证书完成标准',
      (select value from d4_ids where key = 'attendance_record')
    )
  ),
  'replacement Completion explicitly references the revoked predecessor'
);

reset role;
select is((select count(*) from public.completion_record_revocations), 1::bigint,
  'revocation is one append-only fact');
select is(
  (
    select supersedes_completion_record_id
    from public.completion_records
    where id = (select value from d4_ids where key = 'replacement_record')
  ),
  (select value from d4_ids where key = 'attendance_record'),
  'correction preserves an explicit supersession relationship'
);
select is(
  (
    select count(*)
    from public.completion_audit_events
    where event_type in (
      'evidence_recorded', 'evidence_accepted', 'evidence_rejected',
      'completion_recorded', 'completion_revoked'
    )
  ),
  12::bigint,
  'every D4 transition remains in the immutable audit chain'
);

select throws_ok(
  $$update public.completion_records
    set completed_on = current_date - 99$$,
  '42501',
  'COMPLETION_FACT_APPEND_ONLY',
  'Completion Records cannot be modified in place'
);
select throws_ok(
  $$delete from public.completion_evidence$$,
  '42501',
  'COMPLETION_FACT_APPEND_ONLY',
  'Completion Evidence cannot be deleted'
);

insert into public.employee_fact_versions(
  tenant_id, property_id, employee_id, employee_version, effective_date,
  employee_number, name_zh, department_id, position_id, position_family_id,
  hire_date, employment_status, is_active, new_employee_days_rule,
  source_type, change_kinds, reason, before_snapshot, after_snapshot,
  recorded_by
)
select
  fact.tenant_id,
  fact.property_id,
  fact.employee_id,
  fact.employee_version + 1,
  current_date + 1,
  fact.employee_number,
  fact.name_zh,
  '61000000-0000-0000-0000-000000000019',
  fact.position_id,
  fact.position_family_id,
  fact.hire_date,
  fact.employment_status,
  fact.is_active,
  fact.new_employee_days_rule,
  'manual_correction',
  array['department_transfer'],
  'D4 验证后续转岗不改写历史完成事实',
  fact.after_snapshot,
  jsonb_set(fact.after_snapshot, '{departmentId}',
    to_jsonb('61000000-0000-0000-0000-000000000019'::text)),
  '00000000-0000-0000-0000-000000000103'
from public.employee_fact_versions fact
where fact.id = (
  select evidence.employee_fact_version_id
  from public.completion_evidence evidence
  where evidence.id = (select value from d4_ids where key = 'attendance_evidence')
);

select is(
  (
    select record.employee_fact_version_id
    from public.completion_records record
    where record.id = (select value from d4_ids where key = 'attendance_record')
  ),
  (
    select evidence.employee_fact_version_id
    from public.completion_evidence evidence
    where evidence.id = (select value from d4_ids where key = 'attendance_evidence')
  ),
  'later employee department changes do not rewrite historical Completion'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select is(
  public.read_completion_workspace(
    '20000000-0000-0000-0000-000000000011'
  )->>'role',
  'manager',
  'Manager receives the hotel-wide authorized Completion projection'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select is(
  public.read_department_completion_workspace()->>'role',
  'department',
  'Department receives the server-derived scoped Completion projection'
);
select ok(
  jsonb_typeof(
    public.read_department_completion_workspace()
      ->'scope'->0->'breadcrumb'
  ) = 'array'
  and jsonb_array_length(
    public.read_department_completion_workspace()
      ->'scope'->0->'breadcrumb'
  ) > 0,
  'Department Completion scope includes a renderable business breadcrumb'
);
select is(
  jsonb_array_length(
    public.read_department_completion_workspace()->'records'
  ),
  2,
  'Department projection includes only event-time in-scope Completion records'
);
select is(
  (
    select count(*)
    from jsonb_array_elements(
      public.read_department_completion_workspace()->'records'
    ) row
    where row->>'employeeName' = 'D4 范围外员工'
  ),
  0::bigint,
  'Department Completion projection never leaks cross-scope employees'
);

select * from finish();
rollback;
