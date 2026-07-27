begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'training_plans', 'D2 stores stable Training Plan identities');
select has_table('public', 'training_plan_versions', 'D2 versions approved planning decisions');
select has_table('public', 'training_plan_items', 'D2 separates immutable plan items');
select has_table(
  'public',
  'training_plan_item_department_terms',
  'D2 stores manager-selected target department terms'
);
select has_table(
  'public',
  'training_plan_item_department_snapshots',
  'approved plans freeze resolved department scope'
);
select has_table('public', 'training_sessions', 'D2 stores stable Session identities');
select has_table(
  'public',
  'training_session_revisions',
  'D2 stores immutable published Session Revisions'
);
select has_table(
  'public',
  'training_session_target_departments',
  'D2 stores explicit Session audience scope'
);
select has_table('public', 'trainer_profiles', 'D2 separates trainers from backend accounts');
select has_table(
  'public',
  'trainer_course_approvals',
  'D2 stores effective Course Version delivery approvals'
);
select has_table('public', 'training_venues', 'D2 stores controlled property venues');
select has_table(
  'public',
  'training_session_trainer_assignments',
  'D2 snapshots trainer assignments per Session Revision'
);
select has_table(
  'public',
  'training_session_resource_confirmations',
  'D2 distinguishes owner attestations from system verification'
);
select has_table(
  'public',
  'session_participant_snapshots',
  'D2 stores publication-time candidate and participant evidence'
);
select has_table(
  'public',
  'attendance_preparation_configs',
  'D2 stops at attendance preparation configuration'
);
select has_table(
  'public',
  'training_session_cancellation_events',
  'D2 cancellations are append-only facts'
);
select has_table(
  'public',
  'training_operation_audit_events',
  'D2 lifecycle and approval evidence is append-only'
);

select has_function(
  'public',
  'read_training_operations_foundation',
  array['uuid'],
  'manager D2 foundation is property-authorized'
);
select has_function(
  'public',
  'read_department_training_operations',
  array[]::text[],
  'department D2 foundation derives property and scope from the actor'
);
select has_function(
  'public',
  'save_training_plan_version_draft',
  array['uuid', 'jsonb', 'bigint'],
  'Plan drafts save as one aggregate'
);
select has_function(
  'public',
  'transition_training_plan_version',
  array['uuid', 'text', 'bigint', 'text'],
  'Plan lifecycle uses one guarded transition'
);
select has_function(
  'public',
  'save_training_session_revision_draft',
  array['uuid', 'jsonb', 'bigint'],
  'Session drafts save as one aggregate'
);
select has_function(
  'public',
  'save_department_training_session_revision_draft',
  array['jsonb', 'bigint'],
  'department Session save derives hotel context server-side'
);
select has_function(
  'public',
  'preview_training_session_participants',
  array['uuid', 'jsonb'],
  'participant preview is explicit and zero-write'
);
select has_function(
  'public',
  'preview_department_training_session_participants',
  array['uuid'],
  'department participant preview accepts no browser-selected property'
);
select has_function(
  'public',
  'publish_training_session_revision',
  array['uuid', 'bigint'],
  'Session publication atomically freezes exact evidence'
);
select has_function(
  'public',
  'cancel_training_session',
  array['uuid', 'bigint', 'text'],
  'Session cancellation uses an append-only event'
);
select has_function(
  'public',
  'save_training_venue',
  array['uuid', 'jsonb', 'bigint'],
  'venue maintenance uses manager authorization and concurrency'
);
select has_function(
  'public',
  'save_trainer_profile',
  array['uuid', 'jsonb', 'bigint'],
  'trainer and Course Version approval save through a manager boundary'
);

select results_eq(
  $$select count(*)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'training_plans',
        'training_plan_versions',
        'training_plan_items',
        'training_plan_item_department_terms',
        'training_plan_item_department_snapshots',
        'training_sessions',
        'training_session_revisions',
        'training_session_target_departments',
        'trainer_profiles',
        'trainer_course_approvals',
        'training_venues',
        'training_session_trainer_assignments',
        'training_session_resource_confirmations',
        'session_participant_snapshots',
        'attendance_preparation_configs',
        'training_session_cancellation_events',
        'training_operation_audit_events'
      )
      and relation.relrowsecurity
      and relation.relforcerowsecurity$$,
  array[17::bigint],
  'all D2 public relations enable and force RLS'
);

select results_eq(
  $$select count(*)
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'public'
      and table_name in (
        'training_plans',
        'training_plan_versions',
        'training_plan_items',
        'training_plan_item_department_terms',
        'training_plan_item_department_snapshots',
        'training_sessions',
        'training_session_revisions',
        'training_session_target_departments',
        'trainer_profiles',
        'trainer_course_approvals',
        'training_venues',
        'training_session_trainer_assignments',
        'training_session_resource_confirmations',
        'session_participant_snapshots',
        'attendance_preparation_configs',
        'training_session_cancellation_events',
        'training_operation_audit_events'
      )
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')$$,
  array[0::bigint],
  'D2 exposes no direct browser mutation grants'
);

select results_eq(
  $$select count(*)
    from pg_constraint constraint_row
    join pg_namespace namespace
      on namespace.oid = constraint_row.connamespace
    where constraint_row.contype = 'f'
      and namespace.nspname = 'public'
      and constraint_row.conrelid::regclass::text in (
        'training_plans',
        'training_plan_versions',
        'training_plan_items',
        'training_plan_item_department_terms',
        'training_plan_item_department_snapshots',
        'training_sessions',
        'training_session_revisions',
        'training_session_target_departments',
        'trainer_profiles',
        'trainer_course_approvals',
        'training_venues',
        'training_session_trainer_assignments',
        'training_session_resource_confirmations',
        'session_participant_snapshots',
        'attendance_preparation_configs',
        'training_session_cancellation_events',
        'training_operation_audit_events'
      )
      and not exists (
        select 1
        from pg_index index_row
        where index_row.indrelid = constraint_row.conrelid
          and index_row.indisvalid
          and index_row.indkey[0] = constraint_row.conkey[1]
      )$$,
  array[0::bigint],
  'every D2 foreign-key path has a leading supporting index'
);

select results_eq(
  $$select count(*)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and relation.relname in (
        'attendance_records',
        'training_completion_records',
        'training_feedback',
        'kpi_actuals',
        'training_forecasts',
        'training_risks',
        'training_interventions',
        'training_health_scores',
        'ai_recommendations',
        'qr_tokens'
      )$$,
  array[0::bigint],
  'D2 creates no attendance, completion, feedback or analytical fact'
);

-- Synthetic local-only actors and D1 facts.
reset role;
insert into public.user_accounts(
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values
  (
    '79000000-0000-0000-0000-00000000f201',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000103',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'd2-manager',
    'active',
    false
  ),
  (
    '79000000-0000-0000-0000-00000000f202',
    '00000000-0000-0000-0000-000000000104',
    '00000000-0000-0000-0000-000000000104',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'd2-department',
    'active',
    false
  );

insert into public.role_assignments(
  id, user_id, role_id, tenant_id, property_id, status, granted_at
)
select
  '70000000-0000-0000-0000-00000000f202',
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
  '71000000-0000-0000-0000-00000000f202',
  '70000000-0000-0000-0000-00000000f202',
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
    '75000000-0000-0000-0000-00000000f201',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'D20001',
    'D2 适用员工',
    '61000000-0000-0000-0000-000000000013',
    '65000000-0000-0000-0000-000000000012',
    '64000000-0000-0000-0000-000000000012',
    current_date - 30,
    'active',
    true,
    true,
    'd2-pgtap'
  ),
  (
    '75000000-0000-0000-0000-00000000f202',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'D20002',
    'D2 证据不足员工',
    '61000000-0000-0000-0000-000000000013',
    '65000000-0000-0000-0000-000000000012',
    '64000000-0000-0000-0000-000000000012',
    current_date - 30,
    'unknown',
    true,
    true,
    'd2-pgtap'
  );

insert into public.courses(
  id, tenant_id, property_id, code, name_zh
) values (
  '72000000-0000-0000-0000-00000000f201',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'D2-FIRE',
  'D2 消防安全课程'
);

insert into public.course_versions(
  id, tenant_id, property_id, course_id, version_number, lifecycle_state,
  name_zh, description, outline, learning_material_version,
  standard_duration_minutes, learning_objectives, capability_tags,
  assessment_criteria, change_reason, continuity_rationale,
  published_by, published_at
) values (
  '72100000-0000-0000-0000-00000000f201',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '72000000-0000-0000-0000-00000000f201',
  1,
  'published',
  'D2 消防安全课程',
  'D2 合成课程描述',
  '预防、灭火器与疏散',
  'D2.1',
  120,
  array['执行消防安全流程'],
  array['消防安全'],
  '完成受控评估',
  'D2 测试首版',
  'D2 测试首版连续性',
  '00000000-0000-0000-0000-000000000103',
  now()
);

insert into public.training_requirements(
  id, tenant_id, property_id, code, name_zh
) values (
  '72200000-0000-0000-0000-00000000f201',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'D2-FIRE-ANNUAL',
  'D2 年度消防安全要求'
);

insert into public.training_requirement_versions(
  id, tenant_id, property_id, training_requirement_id, version_number,
  lifecycle_state, name_zh, purpose, obligation_explanation,
  effective_from, effective_to, change_reason, continuity_rationale
) values (
  '72300000-0000-0000-0000-00000000f201',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '72200000-0000-0000-0000-00000000f201',
  1,
  'draft',
  'D2 年度消防安全要求',
  '验证 D2 不改变 D1 义务',
  '适用员工按认可方式满足年度义务',
  current_date - 30,
  current_date + 365,
  'D2 测试首版',
  'D2 测试首版连续性'
);

insert into public.completion_definitions(
  id, tenant_id, property_id, training_requirement_version_id
) values (
  '72400000-0000-0000-0000-00000000f201',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '72300000-0000-0000-0000-00000000f201'
);

insert into public.accepted_learning_methods(
  id, tenant_id, property_id, completion_definition_id, method_type,
  label_zh, course_version_id
) values (
  '72500000-0000-0000-0000-00000000f201',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '72400000-0000-0000-0000-00000000f201',
  'course_version',
  '完成 D2 消防安全课程',
  '72100000-0000-0000-0000-00000000f201'
);

insert into public.requirement_timing_definitions(
  tenant_id, property_id, training_requirement_version_id,
  timing_type, recurrence_period
) values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '72300000-0000-0000-0000-00000000f201',
  'calendar_recurrence',
  'year'
);

insert into public.eligibility_rule_sets(
  id, tenant_id, property_id, training_requirement_version_id,
  effective_from, effective_to, audience_mode, new_employee_condition,
  employment_statuses
) values (
  '72600000-0000-0000-0000-00000000f201',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '72300000-0000-0000-0000-00000000f201',
  current_date - 30,
  current_date + 365,
  'all_employees',
  'not_evaluated',
  array['active']::public.employee_employment_status[]
);

update public.training_requirement_versions
set
  lifecycle_state = 'effective',
  approved_by = '00000000-0000-0000-0000-000000000103',
  approved_at = now(),
  effective_by = '00000000-0000-0000-0000-000000000103',
  effective_at = now()
where id = '72300000-0000-0000-0000-00000000f201';

create temporary table d2_test_ids(
  key text primary key,
  value uuid not null
) on commit drop;
grant select, insert, update, delete on d2_test_ids to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select throws_ok(
  $$select public.save_training_venue(
    '20000000-0000-0000-0000-000000000011',
    '{"nameZh":"越权场地","locationDescription":"范围外","capacity":10}'::jsonb,
    0
  )$$,
  '42501',
  '仅酒店学习与发展经理可以维护培训资源。',
  'department role cannot create global venue resources'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
insert into d2_test_ids(key, value)
select
  'venue',
  (public.save_training_venue(
    '20000000-0000-0000-0000-000000000011',
    jsonb_build_object(
      'nameZh', '三楼培训室',
      'locationDescription', '行政楼三层',
      'capacity', 30,
      'active', true
    ),
    0
  )->>'id')::uuid;

insert into d2_test_ids(key, value)
select
  'trainer',
  (public.save_trainer_profile(
    '20000000-0000-0000-0000-000000000011',
    jsonb_build_object(
      'type', 'internal_employee',
      'employeeId', '75000000-0000-0000-0000-00000000f201',
      'displayName', 'D2 适用员工',
      'active', true,
      'approvals', jsonb_build_array(jsonb_build_object(
        'courseVersionId', '72100000-0000-0000-0000-00000000f201',
        'effectiveFrom', current_date - 30,
        'effectiveTo', current_date + 365,
        'evidenceNote', '经理确认的课程版本交付授权'
      ))
    ),
    0
  )->>'id')::uuid;

insert into d2_test_ids(key, value)
select
  'plan_version',
  (public.save_training_plan_version_draft(
    '20000000-0000-0000-0000-000000000011',
    jsonb_build_object(
      'code', 'D2-PLAN-2026',
      'nameZh', 'D2 年度培训计划',
      'periodStart', current_date,
      'periodEnd', current_date + 120,
      'purpose', '确认 D2 计划容量',
      'operationalOwnerRoleAssignmentId', (
        select assignment.id
        from public.role_assignments assignment
        join public.roles role on role.id = assignment.role_id
        where assignment.user_id =
          '00000000-0000-0000-0000-000000000103'
          and assignment.property_id =
            '20000000-0000-0000-0000-000000000011'
          and role.code = 'property_ld_manager'
          and assignment.status = 'active'
        limit 1
      ),
      'changeReason', '建立 D2 测试计划',
      'continuityRationale', 'D2 计划首版',
      'items', jsonb_build_array(jsonb_build_object(
        'nameZh', '年度消防安全培训',
        'purposeType', 'requirement_delivery',
        'businessPurpose', '安排要求认可课程',
        'deliveryWindowStart', current_date,
        'deliveryWindowEnd', current_date + 90,
        'plannedSessionCount', 2,
        'plannedSeatCapacity', 40,
        'ownerDepartmentId', '61000000-0000-0000-0000-000000000012',
        'requirementVersionId', '72300000-0000-0000-0000-00000000f201',
        'acceptedLearningMethodId', '72500000-0000-0000-0000-00000000f201',
        'courseVersionId', '72100000-0000-0000-0000-00000000f201',
        'targetDepartments', jsonb_build_array(jsonb_build_object(
          'departmentId', '61000000-0000-0000-0000-000000000012',
          'includeDescendants', true
        ))
      ))
    ),
    0
  )->>'id')::uuid;

select lives_ok(
  format(
    $$select public.transition_training_plan_version(
      %L::uuid, 'review', 1, '提交经理复核'
    )$$,
    (select value from d2_test_ids where key = 'plan_version')
  ),
  'manager can move a valid plan draft to Review'
);
select lives_ok(
  format(
    $$select public.transition_training_plan_version(
      %L::uuid, 'approved', 2, '批准计划容量'
    )$$,
    (select value from d2_test_ids where key = 'plan_version')
  ),
  'manager can approve a valid immutable Plan Version'
);

reset role;
select is(
  (select count(*) from public.training_sessions),
  0::bigint,
  'Plan approval creates no Session'
);
select is(
  (
    select count(*)
    from public.training_plan_item_department_snapshots
  ),
  3::bigint,
  'Plan approval freezes the selected department and its two descendants'
);

select throws_ok(
  format(
    $$update public.training_plan_versions
      set purpose = '试图改写已批准计划'
      where id = %L::uuid$$,
    (select value from d2_test_ids where key = 'plan_version')
  ),
  '23514',
  '已批准培训计划版本不可修改；请创建新版本。',
  'Approved Plan Versions are immutable even to direct SQL'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select throws_ok(
  format(
    $$select public.transition_training_plan_version(
      %L::uuid, 'withdrawn', 3, '部门角色不得撤回'
    )$$,
    (select value from d2_test_ids where key = 'plan_version')
  ),
  '42501',
  '仅酒店学习与发展经理可以维护培训计划。',
  'department role cannot approve or withdraw a hotel plan'
);

reset role;
insert into d2_test_ids(key, value)
select 'plan', version_row.training_plan_id
from public.training_plan_versions version_row
where version_row.id =
  (select value from d2_test_ids where key = 'plan_version');
insert into d2_test_ids(key, value)
select 'plan_item', item.id
from public.training_plan_items item
where item.training_plan_version_id =
  (select value from d2_test_ids where key = 'plan_version')
limit 1;
insert into d2_test_ids(key, value)
select 'trainer_approval', approval.id
from public.trainer_course_approvals approval
where approval.trainer_profile_id =
  (select value from d2_test_ids where key = 'trainer')
limit 1;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
insert into d2_test_ids(key, value)
select
  'session_revision',
  (public.save_training_session_revision_draft(
    '20000000-0000-0000-0000-000000000011',
    jsonb_build_object(
      'code', 'D2-SESSION-001',
      'nameZh', '年度消防安全培训·第一场',
      'purposeType', 'requirement_delivery',
      'planItemId',
        (select value from d2_test_ids where key = 'plan_item'),
      'requirementVersionId', '72300000-0000-0000-0000-00000000f201',
      'acceptedLearningMethodId', '72500000-0000-0000-0000-00000000f201',
      'courseVersionId', '72100000-0000-0000-0000-00000000f201',
      'owningDepartmentId', '61000000-0000-0000-0000-000000000012',
      'operationalOwnerRoleAssignmentId', (
        select assignment.id
        from public.role_assignments assignment
        join public.roles role on role.id = assignment.role_id
        where assignment.user_id =
          '00000000-0000-0000-0000-000000000103'
          and assignment.property_id =
            '20000000-0000-0000-0000-000000000011'
          and role.code = 'property_ld_manager'
        limit 1
      ),
      'startsAt', (current_date + 7)::timestamptz + interval '9 hours',
      'endsAt', (current_date + 7)::timestamptz + interval '11 hours',
      'timezone', 'Asia/Shanghai',
      'capacity', 24,
      'venue', jsonb_build_object(
        'type', 'approved_venue',
        'venueId', (select value from d2_test_ids where key = 'venue')
      ),
      'trainerAssignments', jsonb_build_array(jsonb_build_object(
        'trainerProfileId',
          (select value from d2_test_ids where key = 'trainer'),
        'trainerApprovalId',
          (select value from d2_test_ids where key = 'trainer_approval'),
        'role', 'lead'
      )),
      'targetDepartments', jsonb_build_array(jsonb_build_object(
        'departmentId', '61000000-0000-0000-0000-000000000012',
        'includeDescendants', true
      )),
      'selectedEmployeeIds', jsonb_build_array(
        '75000000-0000-0000-0000-00000000f201'
      ),
      'ownerConfirmations', jsonb_build_array(
        jsonb_build_object('key', 'materials_ready', 'confirmed', true),
        jsonb_build_object('key', 'room_setup_ready', 'confirmed', true)
      ),
      'attendancePreparation', jsonb_build_object(
        'mode', 'qr_or_manual',
        'opensBeforeMinutes', 30,
        'closesAfterMinutes', 30
      )
    ),
    0
  )->>'id')::uuid;

select is(
  (
    public.preview_training_session_participants(
      '20000000-0000-0000-0000-000000000011',
      jsonb_build_object(
        'sessionRevisionId',
          (select value from d2_test_ids where key = 'session_revision')
      )
    )->>'selectedCount'
  )::integer,
  1,
  'participant preview identifies one explicitly selected Eligible employee'
);
select is(
  (
    public.preview_training_session_participants(
      '20000000-0000-0000-0000-000000000011',
      jsonb_build_object(
        'sessionRevisionId',
          (select value from d2_test_ids where key = 'session_revision')
      )
    )->>'unableToDetermineCount'
  )::integer,
  1,
  'participant preview preserves Unable to Determine evidence'
);
reset role;
select is(
  (select count(*) from public.session_participant_snapshots),
  0::bigint,
  'participant preview is zero-write'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select lives_ok(
  format(
    $$select public.publish_training_session_revision(%L::uuid, 1)$$,
    (select value from d2_test_ids where key = 'session_revision')
  ),
  'manager can publish a readiness-complete Session Revision'
);

reset role;
select is(
  (
    select count(*)
    from public.session_participant_snapshots
    where session_revision_id =
      (select value from d2_test_ids where key = 'session_revision')
  ),
  2::bigint,
  'publication stores every evaluated target candidate state'
);
select is(
  (
    select count(*)
    from public.session_participant_snapshots
    where session_revision_id =
      (select value from d2_test_ids where key = 'session_revision')
      and selected
      and eligibility_state = 'eligible'
  ),
  1::bigint,
  'publication selects only the Eligible participant'
);
select is(
  (
    select count(*)
    from public.session_participant_snapshots
    where session_revision_id =
      (select value from d2_test_ids where key = 'session_revision')
      and eligibility_state = 'unable_to_determine'
      and not selected
  ),
  1::bigint,
  'Unable to Determine remains explicit and unselected'
);
select is(
  (
    select count(*)
    from public.employee_fact_dependencies dependency
    where dependency.fact_type = 'session_participant_snapshot'
      and dependency.fact_id in (
        select snapshot.id
        from public.session_participant_snapshots snapshot
        where snapshot.session_revision_id =
          (select value from d2_test_ids where key = 'session_revision')
      )
  ),
  2::bigint,
  'every persisted participant snapshot records its Employee Fact Version dependency'
);

select throws_ok(
  format(
    $$update public.training_session_revisions
      set starts_at = starts_at + interval '1 hour'
      where id = %L::uuid$$,
    (select value from d2_test_ids where key = 'session_revision')
  ),
  '23514',
  '已发布培训场次版本不可修改；请创建新版本。',
  'Published Session Revisions are immutable'
);

insert into d2_test_ids(key, value)
select 'session', revision.training_session_id
from public.training_session_revisions revision
where revision.id =
  (select value from d2_test_ids where key = 'session_revision');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
insert into d2_test_ids(key, value)
select
  'session_revision_v2',
  (public.save_training_session_revision_draft(
    '20000000-0000-0000-0000-000000000011',
    jsonb_build_object(
      'sessionId', (select value from d2_test_ids where key = 'session'),
      'code', 'D2-SESSION-001',
      'nameZh', '年度消防安全培训·第一场（修订）',
      'purposeType', 'requirement_delivery',
      'planItemId',
        (select value from d2_test_ids where key = 'plan_item'),
      'requirementVersionId', '72300000-0000-0000-0000-00000000f201',
      'acceptedLearningMethodId', '72500000-0000-0000-0000-00000000f201',
      'courseVersionId', '72100000-0000-0000-0000-00000000f201',
      'owningDepartmentId', '61000000-0000-0000-0000-000000000012',
      'operationalOwnerRoleAssignmentId', (
        select assignment.id
        from public.role_assignments assignment
        join public.roles role on role.id = assignment.role_id
        where assignment.user_id =
          '00000000-0000-0000-0000-000000000103'
          and assignment.property_id =
            '20000000-0000-0000-0000-000000000011'
          and role.code = 'property_ld_manager'
          and assignment.status = 'active'
        limit 1
      ),
      'startsAt', (current_date + 14)::timestamptz + interval '9 hours',
      'endsAt', (current_date + 14)::timestamptz + interval '11 hours',
      'timezone', 'Asia/Shanghai',
      'capacity', 24,
      'venue', jsonb_build_object(
        'type', 'approved_venue',
        'venueId', (select value from d2_test_ids where key = 'venue')
      ),
      'trainerAssignments', jsonb_build_array(jsonb_build_object(
        'trainerProfileId',
          (select value from d2_test_ids where key = 'trainer'),
        'trainerApprovalId',
          (select value from d2_test_ids where key = 'trainer_approval'),
        'role', 'lead'
      )),
      'targetDepartments', jsonb_build_array(jsonb_build_object(
        'departmentId', '61000000-0000-0000-0000-000000000012',
        'includeDescendants', true
      )),
      'selectedEmployeeIds', jsonb_build_array(
        '75000000-0000-0000-0000-00000000f201'
      ),
      'ownerConfirmations', jsonb_build_array(
        jsonb_build_object('key', 'materials_ready', 'confirmed', true),
        jsonb_build_object('key', 'room_setup_ready', 'confirmed', true)
      ),
      'attendancePreparation', jsonb_build_object(
        'mode', 'manual_only',
        'opensBeforeMinutes', 0,
        'closesAfterMinutes', 30
      )
    ),
    2
  )->>'id')::uuid;

select lives_ok(
  format(
    $$select public.publish_training_session_revision(%L::uuid, 1)$$,
    (select value from d2_test_ids where key = 'session_revision_v2')
  ),
  'manager can publish a new immutable revision under the stable Session identity'
);
reset role;
select is(
  (
    select lifecycle_state
    from public.training_session_revisions
    where id = (select value from d2_test_ids where key = 'session_revision')
  ),
  'superseded',
  'publishing a new revision supersedes rather than rewrites the previous publication'
);
select is(
  (
    select lifecycle_state
    from public.training_session_revisions
    where id = (select value from d2_test_ids where key = 'session_revision_v2')
  ),
  'published',
  'the replacement Session Revision becomes the single current publication'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select lives_ok(
  format(
    $$select public.cancel_training_session(
      (select value from d2_test_ids where key = 'session'),
      4,
      '酒店运营冲突，取消场次'
    )$$,
    (select value from d2_test_ids where key = 'session_revision')
  ),
  'manager cancellation records an append-only reason'
);
reset role;
select is(
  (select count(*) from public.training_session_cancellation_events),
  1::bigint,
  'cancellation creates one immutable event'
);
select is(
  (
    select count(*)
    from public.training_session_revisions
    where id = (select value from d2_test_ids where key = 'session_revision_v2')
      and lifecycle_state = 'published'
  ),
  1::bigint,
  'cancellation does not erase or rewrite the Published Revision'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select throws_ok(
  $$select public.save_department_training_session_revision_draft(
    jsonb_build_object(
      'code', 'D2-OUT-OF-SCOPE',
      'nameZh', '范围外场次',
      'purposeType', 'development_delivery',
      'courseVersionId', '72100000-0000-0000-0000-00000000f201',
      'owningDepartmentId', '61000000-0000-0000-0000-000000000019',
      'operationalOwnerRoleAssignmentId',
        '70000000-0000-0000-0000-00000000f202',
      'startsAt', (current_date + 10)::timestamptz + interval '9 hours',
      'endsAt', (current_date + 10)::timestamptz + interval '11 hours',
      'timezone', 'Asia/Shanghai',
      'capacity', 20,
      'venue', jsonb_build_object(
        'type', 'approved_venue',
        'venueId', (select value from d2_test_ids where key = 'venue')
      ),
      'trainerAssignments', '[]'::jsonb,
      'targetDepartments', jsonb_build_array(jsonb_build_object(
        'departmentId', '61000000-0000-0000-0000-000000000019',
        'includeDescendants', false
      )),
      'selectedEmployeeIds', '[]'::jsonb,
      'ownerConfirmations', '[]'::jsonb,
      'attendancePreparation', jsonb_build_object(
        'mode', 'manual_only',
        'opensBeforeMinutes', 0,
        'closesAfterMinutes', 30
      )
    ), 0
  )$$,
  '42501',
  '场次包含当前账号授权范围外的部门。',
  'department role cannot create a Session in an unrelated branch'
);

select ok(
  jsonb_array_length(
    public.read_department_training_operations()->'scope'
  ) > 0,
  'department projection returns its server-derived authorized scope'
);
select is(
  (
    public.read_department_training_operations()->>'propertyId'
  )::uuid,
  '20000000-0000-0000-0000-000000000011'::uuid,
  'department projection derives the current property without a browser parameter'
);
select is(
  jsonb_array_length(
    public.read_department_training_operations()->'participantCandidates'
  ),
  2,
  'department projection returns only authorized participant identities'
);
select results_eq(
  $$select count(*)
    from jsonb_array_elements(
      public.read_department_training_operations()->'participantCandidates'
    ) candidate
    where (candidate->>'employeeId')::uuid not in (
      '75000000-0000-0000-0000-00000000f201',
      '75000000-0000-0000-0000-00000000f202'
    )$$,
  array[0::bigint],
  'department participant projection does not leak unrelated employee ids'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
insert into d2_test_ids(key, value)
select
  'plan_continuity_draft_revision',
  (public.save_training_session_revision_draft(
    '20000000-0000-0000-0000-000000000011',
    (source.document->'details') || jsonb_build_object(
      'code', 'D2-SESSION-PLAN-CONTINUITY',
      'nameZh', '计划版本延续性测试场次',
      'purposeType', 'requirement_delivery',
      'startsAt', (current_date + 30)::timestamptz + interval '9 hours',
      'endsAt', (current_date + 30)::timestamptz + interval '11 hours',
      'timezone', 'Asia/Shanghai',
      'capacity', 24,
      'owningDepartmentId',
        '61000000-0000-0000-0000-000000000012'
    ),
    0
  )->>'id')::uuid
from (
  select document
  from jsonb_array_elements(
    public.read_training_operations_foundation(
      '20000000-0000-0000-0000-000000000011'
    )->'sessions'
  ) document
  where (document->>'revisionId')::uuid = (
    select value from d2_test_ids where key = 'session_revision_v2'
  )
) source;

insert into d2_test_ids(key, value)
select
  'plan_version_v2',
  (public.save_training_plan_version_draft(
    '20000000-0000-0000-0000-000000000011',
    jsonb_build_object(
      'planId', (
        select value from d2_test_ids where key = 'plan'
      ),
      'code', 'D2-PLAN-2026',
      'nameZh', 'D2 年度培训计划（修订）',
      'periodStart', current_date,
      'periodEnd', current_date + 150,
      'purpose', '修订 D2 计划容量',
      'operationalOwnerRoleAssignmentId', (
        select assignment.id
        from public.role_assignments assignment
        join public.roles role on role.id = assignment.role_id
        where assignment.user_id =
          '00000000-0000-0000-0000-000000000103'
          and assignment.property_id =
            '20000000-0000-0000-0000-000000000011'
          and role.code = 'property_ld_manager'
          and assignment.status = 'active'
        limit 1
      ),
      'changeReason', '调整下一周期计划容量',
      'continuityRationale', '延续同一 D2 酒店计划身份',
      'items', jsonb_build_array(jsonb_build_object(
        'nameZh', '年度消防安全培训修订',
        'purposeType', 'requirement_delivery',
        'businessPurpose', '调整要求认可课程容量',
        'deliveryWindowStart', current_date,
        'deliveryWindowEnd', current_date + 120,
        'plannedSessionCount', 3,
        'plannedSeatCapacity', 60,
        'ownerDepartmentId', '61000000-0000-0000-0000-000000000012',
        'requirementVersionId', '72300000-0000-0000-0000-00000000f201',
        'acceptedLearningMethodId', '72500000-0000-0000-0000-00000000f201',
        'courseVersionId', '72100000-0000-0000-0000-00000000f201',
        'targetDepartments', jsonb_build_array(jsonb_build_object(
          'departmentId', '61000000-0000-0000-0000-000000000012',
          'includeDescendants', true
        ))
      ))
    ),
    1
  )->>'id')::uuid;
select lives_ok(
  format(
    $$select public.transition_training_plan_version(
      %L::uuid, 'review', 1, '提交修订复核'
    )$$,
    (select value from d2_test_ids where key = 'plan_version_v2')
  ),
  'manager can submit a new Plan Version for review'
);
select lives_ok(
  format(
    $$select public.transition_training_plan_version(
      %L::uuid, 'approved', 2, '批准修订计划'
    )$$,
    (select value from d2_test_ids where key = 'plan_version_v2')
  ),
  'manager can approve the replacement Plan Version'
);
reset role;
select is(
  (
    select lifecycle_state
    from public.training_plan_versions
    where id = (select value from d2_test_ids where key = 'plan_version')
  ),
  'superseded',
  'approving a replacement Plan Version supersedes the prior approval'
);
select lives_ok(
  format(
    $statement$
      select public.save_training_session_revision_draft(
        '20000000-0000-0000-0000-000000000011',
        (source.document->'details') || jsonb_build_object(
          'sessionId', source.document->>'id',
          'sessionRevisionId', source.document->>'revisionId',
          'code', source.document->>'code',
          'nameZh', '计划替代后仍可维护的既有场次草稿',
          'purposeType', source.document->>'purposeType',
          'startsAt', source.document->'startsAt',
          'endsAt', source.document->'endsAt',
          'timezone', source.document->>'timezone',
          'capacity', source.document->'capacity',
          'owningDepartmentId', source.document->>'owningDepartmentId'
        ),
        (source.document->>'revisionVersion')::bigint
      )
      from (
        select document
        from jsonb_array_elements(
          public.read_training_operations_foundation(
            '20000000-0000-0000-0000-000000000011'
          )->'sessions'
        ) document
        where (document->>'revisionId')::uuid = %L::uuid
      ) source
    $statement$,
    (
      select value
      from d2_test_ids
      where key = 'plan_continuity_draft_revision'
    )
  ),
  'superseding a Plan Version does not strand an existing Session draft tied to its historical Plan Item'
);
select is(
  (
    select session_row.training_plan_item_id
    from public.training_session_revisions revision
    join public.training_sessions session_row
      on session_row.id = revision.training_session_id
    where revision.id = (
      select value
      from d2_test_ids
      where key = 'plan_continuity_draft_revision'
    )
  ),
  (select value from d2_test_ids where key = 'plan_item'),
  'existing Session maintenance preserves the original immutable Plan Item reference'
);

select * from finish();
rollback;
