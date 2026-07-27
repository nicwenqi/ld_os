begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public', 'courses', 'D1 stores stable Course identities');
select has_table(
  'public',
  'course_versions',
  'D1 separates versioned content and capability identity'
);
select has_table(
  'public',
  'training_requirements',
  'D1 stores stable hotel business obligations'
);
select has_table(
  'public',
  'training_requirement_versions',
  'D1 versions effective hotel obligations'
);
select has_table(
  'public',
  'completion_definitions',
  'D1 separates obligation from completion definition'
);
select has_table(
  'public',
  'accepted_learning_methods',
  'D1 records approved ways an obligation may later be satisfied'
);
select has_table(
  'public',
  'requirement_timing_definitions',
  'D1 stores deterministic timing definitions'
);
select has_table(
  'public',
  'eligibility_rule_sets',
  'D1 stores effective-dated explicit eligibility rules'
);
select has_table(
  'public',
  'eligibility_rule_departments',
  'D1 stores explicit department and descendant terms'
);
select has_table(
  'public',
  'eligibility_rule_positions',
  'D1 stores explicit position terms'
);
select has_table(
  'public',
  'eligibility_rule_position_families',
  'D1 stores explicit position-family terms'
);
select has_table(
  'public',
  'learning_requirement_audit_events',
  'D1 retains append-only version-governance evidence'
);

select has_function(
  'public',
  'read_learning_requirement_foundation',
  array['uuid'],
  'manager foundation is read through an authorized projection'
);
select has_function(
  'public',
  'save_course_version_draft',
  array['uuid', 'jsonb', 'bigint'],
  'manager course drafts use one transactional RPC'
);
select has_function(
  'public',
  'transition_course_version',
  array['uuid', 'text', 'bigint', 'text'],
  'course lifecycle uses one guarded transition boundary'
);
select has_function(
  'public',
  'save_requirement_version_draft',
  array['uuid', 'jsonb', 'bigint'],
  'manager requirement drafts save as one aggregate'
);
select has_function(
  'public',
  'transition_requirement_version',
  array['uuid', 'text', 'bigint', 'text'],
  'requirement lifecycle uses one guarded transition boundary'
);
select has_function(
  'public',
  'evaluate_learning_requirement_eligibility',
  array['uuid', 'uuid', 'date', 'text', 'integer', 'integer'],
  'D1 exposes point-in-time eligibility without assignment facts'
);
select has_function(
  'public',
  'read_department_learning_requirements',
  array[]::text[],
  'department requirements are exposed through a scope-derived projection'
);

select results_eq(
  $$select count(*)
    from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'public'
      and table_name in (
        'courses',
        'course_versions',
        'training_requirements',
        'training_requirement_versions',
        'completion_definitions',
        'accepted_learning_methods',
        'requirement_timing_definitions',
        'eligibility_rule_sets',
        'eligibility_rule_departments',
        'eligibility_rule_positions',
        'eligibility_rule_position_families',
        'learning_requirement_audit_events'
      )
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')$$,
  array[0::bigint],
  'D1 exposes no direct client mutation privileges'
);

select results_eq(
  $$select count(*)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'courses',
        'course_versions',
        'training_requirements',
        'training_requirement_versions',
        'completion_definitions',
        'accepted_learning_methods',
        'requirement_timing_definitions',
        'eligibility_rule_sets',
        'eligibility_rule_departments',
        'eligibility_rule_positions',
        'eligibility_rule_position_families',
        'learning_requirement_audit_events'
      )
      and relation.relrowsecurity
      and relation.relforcerowsecurity$$,
  array[12::bigint],
  'all D1 public relations enable and force RLS'
);

select results_eq(
  $$select count(*)
    from pg_constraint constraint_row
    join pg_namespace namespace
      on namespace.oid = constraint_row.connamespace
    where constraint_row.contype = 'f'
      and namespace.nspname = 'public'
      and constraint_row.conrelid::regclass::text in (
        'courses',
        'course_versions',
        'training_requirements',
        'training_requirement_versions',
        'completion_definitions',
        'accepted_learning_methods',
        'requirement_timing_definitions',
        'eligibility_rule_sets',
        'eligibility_rule_departments',
        'eligibility_rule_positions',
        'eligibility_rule_position_families',
        'learning_requirement_audit_events'
      )
      and not exists (
        select 1
        from pg_index index_row
        where index_row.indrelid = constraint_row.conrelid
          and index_row.indisvalid
          and index_row.indkey[0] = constraint_row.conkey[1]
      )$$,
  array[0::bigint],
  'every D1 foreign-key path has a leading supporting index'
);

select results_eq(
  $$select count(*)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and relation.relname in (
        'training_assignments',
        'attendance_records',
        'completion_records',
        'training_feedback',
        'kpi_actuals',
        'training_forecasts',
        'training_risks',
        'training_interventions'
  )$$,
  array[0::bigint],
  'D1 contracts remain free of assignment, execution and analytical facts'
);

reset role;
insert into public.user_accounts(
  id,
  user_id,
  auth_user_id,
  tenant_id,
  property_id,
  login_id,
  account_status,
  must_change_password
) values
  (
    '79000000-0000-0000-0000-00000000e101',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000103',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'd1-manager',
    'active',
    false
  ),
  (
    '79000000-0000-0000-0000-00000000e102',
    '00000000-0000-0000-0000-000000000104',
    '00000000-0000-0000-0000-000000000104',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'd1-department',
    'active',
    false
  );

insert into public.role_assignments(
  id,
  user_id,
  role_id,
  tenant_id,
  property_id,
  status,
  granted_at
)
select
  '70000000-0000-0000-0000-00000000e102',
  '00000000-0000-0000-0000-000000000104',
  role.id,
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'active',
  now()
from public.roles role
where role.code = 'department_training_admin';

insert into public.trainer_scopes(
  id,
  role_assignment_id,
  tenant_id,
  property_id,
  department_id,
  include_descendants,
  is_active
) values (
  '71000000-0000-0000-0000-00000000e102',
  '70000000-0000-0000-0000-00000000e102',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '61000000-0000-0000-0000-000000000012',
  true,
  true
);

insert into public.employees(
  id,
  tenant_id,
  property_id,
  employee_number,
  name_zh,
  department_id,
  position_id,
  position_family_id,
  hire_date,
  employment_status,
  is_new_employee,
  is_active,
  source_system
) values (
  '75000000-0000-0000-0000-00000000e101',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'D10001',
  'D1 合成员工',
  '61000000-0000-0000-0000-000000000013',
  '65000000-0000-0000-0000-000000000012',
  '64000000-0000-0000-0000-000000000012',
  current_date - 10,
  'active',
  true,
  true,
  'd1-pgtap'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select throws_ok(
  $$select public.save_course_version_draft(
    '20000000-0000-0000-0000-000000000011',
    '{}'::jsonb,
    0
  )$$,
  '42501',
  '仅酒店学习与发展经理可以维护培训要求。',
  'department role cannot mutate Course or Requirement foundations'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select is(
  (
    public.save_course_version_draft(
      '20000000-0000-0000-0000-000000000011',
      jsonb_build_object(
        'code', 'FIRE-SAFETY',
        'nameZh', '消防安全与应急响应',
        'nameEn', 'Fire Safety and Emergency Response',
        'description', '酒店消防安全基础课程。',
        'outline', '预防、灭火器与疏散流程。',
        'learningMaterialVersion', '2026.1',
        'standardDurationMinutes', 120,
        'learningObjectives', jsonb_build_array(
          '正确使用灭火器',
          '执行酒店疏散流程'
        ),
        'capabilityTags', jsonb_build_array('消防安全', '应急响应'),
        'assessmentCriteria', '完成知识与受控实操评估。',
        'changeReason', '建立首个课程版本',
        'continuityRationale', '首个版本属于消防安全课程主体',
        'impactReviewRequired', false,
        'impactNote', '首个版本'
      ),
      0
    )
  )->>'state',
  'draft',
  'manager creates a complete Course Version draft'
);

select throws_ok(
  $$select public.save_course_version_draft(
    '20000000-0000-0000-0000-000000000011',
    jsonb_build_object(
      'courseVersionId',
      public.read_learning_requirement_foundation(
        '20000000-0000-0000-0000-000000000011'
      )#>>'{courses,0,id}'
    ),
    0
  )$$,
  '40001',
  '课程版本已被其他用户更新，请重新读取后重试。',
  'course drafts reject stale optimistic versions'
);

select is(
  (
    public.transition_course_version(
      (
        public.read_learning_requirement_foundation(
          '20000000-0000-0000-0000-000000000011'
        )#>>'{courses,0,id}'
      )::uuid,
      'review',
      1,
      null
    )
  )->>'state',
  'review',
  'Course Draft enters Review'
);

select is(
  (
    public.transition_course_version(
      (
        public.read_learning_requirement_foundation(
          '20000000-0000-0000-0000-000000000011'
        )#>>'{courses,0,id}'
      )::uuid,
      'published',
      2,
      null
    )
  )->>'state',
  'published',
  'Course Review publishes through the guarded lifecycle'
);

select is(
  (
    public.save_requirement_version_draft(
      '20000000-0000-0000-0000-000000000011',
      jsonb_build_object(
        'code', 'FIRE-ANNUAL',
        'nameZh', '年度消防安全要求',
        'nameEn', 'Annual Fire Safety Requirement',
        'purpose', '确保适用员工掌握酒店消防安全要求。',
        'obligationExplanation', '酒店要求适用员工按认可方式满足年度消防义务。',
        'effectiveFrom', (current_date - 1)::text,
        'effectiveTo', (current_date + 364)::text,
        'changeReason', '建立首个批准版本',
        'continuityRationale', '酒店年度消防义务首版',
        'timing', jsonb_build_object(
          'type', 'calendar_recurrence',
          'period', 'year'
        ),
        'completionDefinition', jsonb_build_object(
          'satisfactionOperator', 'any_one',
          'methods', jsonb_build_array(jsonb_build_object(
            'type', 'course_version',
            'labelZh', '完成已发布消防课程',
            'courseVersionId',
            public.read_learning_requirement_foundation(
              '20000000-0000-0000-0000-000000000011'
            )#>>'{courses,0,id}'
          ))
        ),
        'ruleSets', jsonb_build_array(jsonb_build_object(
          'effectiveFrom', (current_date - 1)::text,
          'effectiveTo', (current_date + 364)::text,
          'audienceMode', 'structured_scope',
          'departments', jsonb_build_array(jsonb_build_object(
            'departmentId', '61000000-0000-0000-0000-000000000012',
            'includeDescendants', true
          )),
          'positionIds', '[]'::jsonb,
          'positionFamilyIds', '[]'::jsonb,
          'newEmployeeCondition', 'not_evaluated',
          'employmentStatuses', jsonb_build_array('active')
        ))
      ),
      0
    )
  )->>'state',
  'draft',
  'manager saves Requirement, Completion Definition, method, timing, and Rule Set atomically'
);

select is(
  (
    public.transition_requirement_version(
      (
        public.read_learning_requirement_foundation(
          '20000000-0000-0000-0000-000000000011'
        )#>>'{requirements,0,id}'
      )::uuid,
      'approved',
      1,
      null
    )
  )->>'state',
  'approved',
  'complete Requirement Draft can be Approved'
);

select is(
  (
    public.transition_requirement_version(
      (
        public.read_learning_requirement_foundation(
          '20000000-0000-0000-0000-000000000011'
        )#>>'{requirements,0,id}'
      )::uuid,
      'effective',
      2,
      null
    )
  )->>'state',
  'effective',
  'approved Requirement activates on or after its effective date'
);

select is(
  (
    public.evaluate_learning_requirement_eligibility(
      '20000000-0000-0000-0000-000000000011',
      (
        public.read_learning_requirement_foundation(
          '20000000-0000-0000-0000-000000000011'
        )#>>'{requirements,0,id}'
      )::uuid,
      current_date,
      null,
      1,
      50
    )#>>'{rows,0,result}'
  ),
  'eligible',
  'manager point-in-time evaluation uses department descendants and employee facts'
);

select isnt(
  (
    public.evaluate_learning_requirement_eligibility(
      '20000000-0000-0000-0000-000000000011',
      (
        public.read_learning_requirement_foundation(
          '20000000-0000-0000-0000-000000000011'
        )#>>'{requirements,0,id}'
      )::uuid,
      current_date,
      null,
      1,
      50
    )#>>'{rows,0,evidence,employeeFactVersionId}'
  ),
  null,
  'eligibility evidence retains the Employee Fact Version reference'
);

reset role;
select results_eq(
  $$select count(*) from public.employee_fact_dependencies
    where fact_type like 'd1%'$$,
  array[0::bigint],
  'D1 eligibility evaluation persists no assignment, completion, or employee obligation fact'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select is(
  (
    public.read_department_learning_requirements()
      #>>'{requirements,0,state}'
  ),
  'effective',
  'department role reads only Effective Requirement Versions in server-derived scope'
);

select is(
  (
    public.evaluate_learning_requirement_eligibility(
      '20000000-0000-0000-0000-000000000011',
      (
        public.read_department_learning_requirements()
          #>>'{requirements,0,id}'
      )::uuid,
      current_date,
      null,
      1,
      50
    )#>>'{rows,0,employeeNumber}'
  ),
  'D10001',
  'department evaluation returns only an employee in the authorized descendant branch'
);

select throws_ok(
  $$select public.evaluate_learning_requirement_eligibility(
    '20000000-0000-0000-0000-000000000012',
    (
      public.read_department_learning_requirements()
        #>>'{requirements,0,id}'
    )::uuid,
    current_date,
    null,
    1,
    50
  )$$,
  '42501',
  '无权查看此酒店的适用性评估。',
  'department role cannot evaluate an unrelated property'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select is(
  (
    public.save_course_version_draft(
      '20000000-0000-0000-0000-000000000011',
      jsonb_build_object(
        'courseId',
        public.read_learning_requirement_foundation(
          '20000000-0000-0000-0000-000000000011'
        )#>>'{courses,0,courseId}',
        'code', 'FIRE-SAFETY',
        'nameZh', '消防安全与应急响应',
        'nameEn', 'Fire Safety and Emergency Response',
        'description', '酒店消防安全课程的下一内容版本。',
        'outline', '预防、灭火器、疏散与复盘流程。',
        'learningMaterialVersion', '2027.1',
        'standardDurationMinutes', 150,
        'learningObjectives', jsonb_build_array(
          '正确使用灭火器',
          '执行并复盘酒店疏散流程'
        ),
        'capabilityTags', jsonb_build_array('消防安全', '应急响应'),
        'assessmentCriteria', '完成知识、实操与疏散复盘评估。',
        'changeReason', '准备下一年度课程内容',
        'continuityRationale', '能力主线仍属于同一消防安全课程主体',
        'impactReviewRequired', true,
        'impactNote', '由经理在未来运营阶段复核，不改写历史完成'
      ),
      (
        public.read_learning_requirement_foundation(
          '20000000-0000-0000-0000-000000000011'
        )#>>'{courses,0,identityVersion}'
      )::bigint
    )
  )->>'versionNumber',
  '2',
  'manager can create a new draft version under the stable Course identity'
);

select is(
  (
    public.save_requirement_version_draft(
      '20000000-0000-0000-0000-000000000011',
      jsonb_build_object(
        'requirementId',
        public.read_learning_requirement_foundation(
          '20000000-0000-0000-0000-000000000011'
        )#>>'{requirements,0,requirementId}',
        'code', 'FIRE-ANNUAL',
        'nameZh', '年度消防安全要求',
        'nameEn', 'Annual Fire Safety Requirement',
        'purpose', '准备下一年度酒店消防安全义务。',
        'obligationExplanation', '酒店要求适用员工按认可方式满足年度消防义务。',
        'effectiveFrom', (current_date + 365)::text,
        'effectiveTo', (current_date + 729)::text,
        'changeReason', '准备下一年度义务版本',
        'continuityRationale', '消防安全年度业务义务保持连续',
        'timing', jsonb_build_object(
          'type', 'calendar_recurrence',
          'period', 'year'
        ),
        'completionDefinition', jsonb_build_object(
          'satisfactionOperator', 'any_one',
          'methods', jsonb_build_array(jsonb_build_object(
            'type', 'course_version',
            'labelZh', '完成当前已发布消防课程',
            'courseVersionId',
            public.read_learning_requirement_foundation(
              '20000000-0000-0000-0000-000000000011'
            )#>>'{courses,1,id}'
          ))
        ),
        'ruleSets', jsonb_build_array(jsonb_build_object(
          'effectiveFrom', (current_date + 365)::text,
          'effectiveTo', (current_date + 729)::text,
          'audienceMode', 'all_employees',
          'departments', '[]'::jsonb,
          'positionIds', '[]'::jsonb,
          'positionFamilyIds', '[]'::jsonb,
          'newEmployeeCondition', 'not_evaluated',
          'employmentStatuses', jsonb_build_array('active')
        ))
      ),
      (
        public.read_learning_requirement_foundation(
          '20000000-0000-0000-0000-000000000011'
        )#>>'{requirements,0,identityVersion}'
      )::bigint
    )
  )->>'versionNumber',
  '2',
  'manager can create a future draft under the stable Requirement identity'
);

reset role;
select throws_ok(
  $$update public.course_versions
    set description = '不允许覆盖已发布内容'
    where lifecycle_state = 'published'$$,
  '23514',
  '已发布课程版本不可修改；请创建新版本。',
  'Published Course Version content is immutable even outside client grants'
);

select throws_ok(
  $$delete from public.learning_requirement_audit_events
    where aggregate_type = 'course'$$,
  '42501',
  '培训要求审计记录为只增证据，不能修改或删除。',
  'D1 audit evidence is append-only'
);

select * from finish();
rollback;
