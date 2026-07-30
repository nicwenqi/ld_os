begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- C4 reuses the approved D1 aggregate. It creates one synthetic Requirement
-- only inside this rollback-bound test: no Course, Plan, Session, Attendance,
-- Completion, assignment, or real hotel business fact is created.
reset role;
insert into public.user_accounts(
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values
  (
    '79000000-0000-0000-0000-00000000c401',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000103',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'c4-requirement-manager', 'active', false
  ),
  (
    '79000000-0000-0000-0000-00000000c402',
    '00000000-0000-0000-0000-000000000104',
    '00000000-0000-0000-0000-000000000104',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'c4-department-user', 'active', false
  );

insert into public.role_assignments(
  id, user_id, role_id, tenant_id, property_id, status, granted_at
)
select
  '70000000-0000-0000-0000-00000000c402',
  '00000000-0000-0000-0000-000000000104', role.id,
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011', 'active', now()
from public.roles role
where role.code = 'department_training_admin';

insert into public.trainer_scopes(
  id, role_assignment_id, tenant_id, property_id, department_id,
  include_descendants, is_active
) values (
  '71000000-0000-0000-0000-00000000c402',
  '70000000-0000-0000-0000-00000000c402',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '61000000-0000-0000-0000-000000000012', true, true
);

-- The three synthetic employees make the tri-state contract observable.
-- The D0 trigger creates one Employee Fact Version per controlled insert.
insert into public.employees(
  id, tenant_id, property_id, employee_number, name_zh, department_id,
  position_id, position_family_id, hire_date, employment_status,
  is_new_employee, is_active, source_system
) values
  (
    '75000000-0000-0000-0000-00000000c401',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011', 'C4-ELIGIBLE', 'C4 适用员工',
    '61000000-0000-0000-0000-000000000013',
    '65000000-0000-0000-0000-000000000012',
    '64000000-0000-0000-0000-000000000012', current_date - 30,
    'active', true, true, 'c4-pgtap'
  ),
  (
    '75000000-0000-0000-0000-00000000c402',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011', 'C4-NOT-APPLICABLE', 'C4 不适用员工',
    '61000000-0000-0000-0000-000000000013',
    '65000000-0000-0000-0000-000000000012',
    '64000000-0000-0000-0000-000000000012', current_date - 30,
    'inactive', false, false, 'c4-pgtap'
  ),
  (
    '75000000-0000-0000-0000-00000000c403',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011', 'C4-UNKNOWN', 'C4 无法判断员工',
    null, null, null, current_date - 30, 'unknown', false, false, 'c4-pgtap'
  );

select results_eq(
  $$select count(*) from public.employee_fact_versions
    where employee_id in (
      '75000000-0000-0000-0000-00000000c401',
      '75000000-0000-0000-0000-00000000c402',
      '75000000-0000-0000-0000-00000000c403'
    )$$,
  array[3::bigint],
  'C4 eligibility source employees each retain a D0 Employee Fact Version'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select throws_ok(
  $$select public.save_requirement_version_draft(
    '20000000-0000-0000-0000-000000000011', '{}'::jsonb, 0
  )$$,
  '42501', '仅酒店学习与发展经理可以维护培训要求。',
  'Department Training Responsible Person cannot create hotel-level Requirements'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select throws_ok(
  $$select public.read_learning_requirement_foundation(
    '20000000-0000-0000-0000-000000000011'
  )$$,
  '42501', '仅酒店学习与发展经理可以维护培训要求。',
  'platform identity has no hotel Requirement business access'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select is(
  (
    public.save_requirement_version_draft(
      '20000000-0000-0000-0000-000000000011',
      jsonb_build_object(
        'code', 'FIRE-ANNUAL-PILOT',
        'nameZh', '消防安全年度培训',
        'nameEn', 'Annual Fire Safety Requirement',
        'purpose', '明确 Pilot 范围内适用员工的年度消防安全业务义务。',
        'obligationExplanation', '适用员工必须以经理认可的完成方式满足消防安全年度要求。',
        'effectiveFrom', current_date::text,
        'effectiveTo', (current_date + 364)::text,
        'changeReason', '建立第一项受控 Pilot 培训要求',
        'continuityRationale', '首版明确酒店消防安全年度业务义务，不生成培训执行事实。',
        'timing', jsonb_build_object(
          'type', 'calendar_recurrence', 'period', 'year'
        ),
        'completionDefinition', jsonb_build_object(
          'satisfactionOperator', 'any_one',
          'methods', jsonb_build_array(jsonb_build_object(
            'type', 'external_certificate',
            'labelZh', '认可消防外部证书',
            'certificateType', '消防安全认可证书',
            'issuerCriteria', '由酒店认可的签发机构出具且证书在有效期内',
            'evidenceDescription', '证书编号、签发机构和有效期必须留存',
            'validityMonths', 12
          ))
        ),
        'ruleSets', jsonb_build_array(jsonb_build_object(
          'effectiveFrom', current_date::text,
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
      ), 0
    )
  )->>'state',
  'draft',
  'Hotel L&D Manager explicitly creates the first Pilot Requirement without creating a Course'
);

-- The protected aggregate is verified through its manager RPC above. Reset
-- only to inspect its persisted internal links; direct browser selects remain
-- unavailable by design.
reset role;
select results_eq(
  $$select count(*) from public.completion_definitions definition
    join public.training_requirement_versions version_row
      on version_row.id = definition.training_requirement_version_id
    where version_row.property_id = '20000000-0000-0000-0000-000000000011'
      and version_row.name_zh = '消防安全年度培训'$$,
  array[1::bigint],
  'Requirement Version retains one Completion Definition'
);
select results_eq(
  $$select method.method_type::text, method.certificate_type
    from public.accepted_learning_methods method
    join public.completion_definitions definition
      on definition.id = method.completion_definition_id
    join public.training_requirement_versions version_row
      on version_row.id = definition.training_requirement_version_id
    where version_row.property_id = '20000000-0000-0000-0000-000000000011'
      and version_row.name_zh = '消防安全年度培训'$$,
  $$values ('external_certificate'::text, '消防安全认可证书'::text)$$,
  'Requirement Version references an existing accepted Learning Method, not a Course Version'
);
select results_eq(
  $$select count(*) from public.eligibility_rule_sets rules
    join public.training_requirement_versions version_row
      on version_row.id = rules.training_requirement_version_id
    where version_row.property_id = '20000000-0000-0000-0000-000000000011'
      and version_row.name_zh = '消防安全年度培训'$$,
  array[1::bigint],
  'Requirement Version retains its effective Eligibility Rule Set'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select is(
  (
    public.transition_requirement_version(
      (public.read_learning_requirement_foundation(
        '20000000-0000-0000-0000-000000000011'
      )#>>'{requirements,0,id}')::uuid,
      'approved', 1, null
    )
  )->>'state',
  'approved',
  'the controlled Requirement Version moves from Draft to Approved'
);
select is(
  (
    public.transition_requirement_version(
      (public.read_learning_requirement_foundation(
        '20000000-0000-0000-0000-000000000011'
      )#>>'{requirements,0,id}')::uuid,
      'effective', 2, null
    )
  )->>'state',
  'effective',
  'the manager explicitly makes the approved Requirement Version effective'
);

select is(
  (
    public.evaluate_learning_requirement_eligibility(
      '20000000-0000-0000-0000-000000000011',
      (public.read_learning_requirement_foundation(
        '20000000-0000-0000-0000-000000000011'
      )#>>'{requirements,0,id}')::uuid,
      current_date, 'C4-ELIGIBLE', 1, 10
    )#>>'{rows,0,result}'
  ),
  'eligible',
  'employee in the explicit department branch is Eligible at the evaluation date'
);
select isnt(
  (
    public.evaluate_learning_requirement_eligibility(
      '20000000-0000-0000-0000-000000000011',
      (public.read_learning_requirement_foundation(
        '20000000-0000-0000-0000-000000000011'
      )#>>'{requirements,0,id}')::uuid,
      current_date, 'C4-ELIGIBLE', 1, 10
    )#>>'{rows,0,evidence,employeeFactVersionId}'
  ),
  null,
  'Eligibility Evaluation preserves the Employee Fact Version reference'
);
select is(
  (
    public.evaluate_learning_requirement_eligibility(
      '20000000-0000-0000-0000-000000000011',
      (public.read_learning_requirement_foundation(
        '20000000-0000-0000-0000-000000000011'
      )#>>'{requirements,0,id}')::uuid,
      current_date, 'C4-NOT-APPLICABLE', 1, 10
    )#>>'{rows,0,result}'
  ),
  'not_applicable',
  'employee with an explicit non-matching status is Not Applicable, not silently excluded'
);
select is(
  (
    public.evaluate_learning_requirement_eligibility(
      '20000000-0000-0000-0000-000000000011',
      (public.read_learning_requirement_foundation(
        '20000000-0000-0000-0000-000000000011'
      )#>>'{requirements,0,id}')::uuid,
      current_date, 'C4-UNKNOWN', 1, 10
    )#>>'{rows,0,result}'
  ),
  'unable_to_determine',
  'missing department remains Unable To Determine and is never converted to Not Applicable'
);
select ok(
  (
    public.evaluate_learning_requirement_eligibility(
      '20000000-0000-0000-0000-000000000011',
      (public.read_learning_requirement_foundation(
        '20000000-0000-0000-0000-000000000011'
      )#>>'{requirements,0,id}')::uuid,
      current_date, 'C4-UNKNOWN', 1, 10
    )#>'{rows,0,evidence,missingEvidence}'
  ) ? '缺少部门归属',
  'Unable To Determine retains the business-readable missing-evidence reason'
);

reset role;
select throws_ok(
  $$update public.training_requirement_versions
      set purpose = '不允许改写已生效义务'
    where property_id = '20000000-0000-0000-0000-000000000011'
      and name_zh = '消防安全年度培训'$$,
  '23514', '已批准或已生效的培训要求版本不可修改；请创建新版本。',
  'Effective Requirement Version is immutable and preserves historical meaning'
);
select results_eq(
  $$select count(*) from public.training_plans
    where property_id = '20000000-0000-0000-0000-000000000011'$$,
  array[0::bigint],
  'C4 creates no Training Plan fact'
);
select results_eq(
  $$select count(*) from public.training_sessions
    where property_id = '20000000-0000-0000-0000-000000000011'$$,
  array[0::bigint],
  'C4 creates no Session fact'
);
select results_eq(
  $$select count(*) from public.attendance_registers
    where property_id = '20000000-0000-0000-0000-000000000011'$$,
  array[0::bigint],
  'C4 creates no Attendance fact'
);
select results_eq(
  $$select count(*) from public.completion_records
    where property_id = '20000000-0000-0000-0000-000000000011'$$,
  array[0::bigint],
  'C4 creates no Completion fact'
);
select results_eq(
  $$select count(*) from public.employee_fact_dependencies
    where fact_type like 'd1%'$$,
  array[0::bigint],
  'point-in-time Eligibility Evaluation persists no employee obligation or assignment fact'
);

select * from finish();
rollback;
