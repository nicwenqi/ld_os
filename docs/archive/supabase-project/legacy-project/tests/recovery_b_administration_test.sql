begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

select has_function(
  'public',
  'create_property_backend_account_foundation',
  array['uuid','uuid','text','text','text','text','jsonb'],
  'backend account foundation RPC exists'
);
select has_function(
  'public',
  'update_property_backend_account',
  array['uuid','uuid','bigint','text','text','text','text','jsonb'],
  'backend account update RPC exists'
);
select has_function(
  'public',
  'save_operational_unit',
  array['uuid','uuid','bigint','uuid','uuid','text','text','text','text','integer','boolean'],
  'versioned operational-unit RPC exists'
);
select has_function(
  'public',
  'save_position_family',
  array['uuid','uuid','bigint','text','text','text','text','integer','boolean'],
  'versioned position-family RPC exists'
);
select has_function(
  'public',
  'save_position_with_departments',
  array['uuid','uuid','bigint','uuid','text','text','text','text','boolean','uuid[]'],
  'atomic position RPC exists'
);
select is(
  (
    select proc.proargnames
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname = 'save_operational_unit'
  ),
  array[
    'p_property_id','p_operational_unit_id','p_expected_version',
    'p_department_id','p_parent_operational_unit_id','p_unit_type',
    'p_code','p_name_zh','p_name_en','p_sort_order','p_is_active'
  ]::text[],
  'operational-unit RPC parameter names match the application contract'
);
select is(
  (
    select proc.proargnames
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname = 'save_position_family'
  ),
  array[
    'p_property_id','p_position_family_id','p_expected_version',
    'p_code','p_name_zh','p_name_en','p_description',
    'p_sort_order','p_is_active'
  ]::text[],
  'position-family RPC parameter names match the application contract'
);
select is(
  (
    select proc.proargnames
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname = 'save_position_with_departments'
  ),
  array[
    'p_property_id','p_position_id','p_expected_version',
    'p_position_family_id','p_code','p_name_zh','p_name_en',
    'p_grade_or_band','p_is_active','p_department_ids'
  ]::text[],
  'position RPC parameter names match the application contract'
);

select results_eq(
  $$select code from public.roles where code in ('employee_participant','property_member') and not is_active order by code$$,
  $$values ('employee_participant'::text), ('property_member'::text)$$,
  'obsolete employee and ordinary-member application roles are inactive'
);
select results_eq(
  $$select name_zh from public.roles where code='department_training_admin'$$,
  $$values ('部门培训负责人'::text)$$,
  'department role uses the approved product wording'
);

reset role;
insert into public.user_accounts (
  user_id, auth_user_id, tenant_id, property_id, login_id, account_status, must_change_password
) values (
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000103',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'property-manager',
  'active',
  false
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000108',
  'authenticated',
  'authenticated',
  'department-responsible-a1@example.test',
  extensions.crypt('local-test-only', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  false
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';

select ok(
  (
    select
      result ? 'accountId'
      and not (
        result ?| array[
          'userId','authUserId','email','internalEmail','internalTechnicalIdentity'
        ]
      )
    from (
      select public.create_property_backend_account_foundation(
        '20000000-0000-0000-0000-000000000011'::uuid,
        '00000000-0000-0000-0000-000000000108'::uuid,
        'department-responsible-a1@example.test',
        'department-responsible',
        '部门培训负责人（测试）',
        'department_training_admin',
        '[{"departmentId":"61000000-0000-0000-0000-000000000012","includeDescendants":true}]'::jsonb
      ) result
    ) created
  ),
  'manager creates an account foundation without returning private auth identifiers'
);
select results_eq(
  $$select version from public.user_accounts where login_id='department-responsible'$$,
  array[1::bigint],
  'new backend account starts at version one'
);
select results_eq(
  $$select count(*) from public.role_assignments assignment
    join public.roles role on role.id=assignment.role_id
    where assignment.user_id='00000000-0000-0000-0000-000000000108'
      and assignment.property_id='20000000-0000-0000-0000-000000000011'
      and assignment.status='active'
      and role.code='department_training_admin'$$,
  array[1::bigint],
  'account foundation creates exactly one approved active hotel role'
);
select results_eq(
  $$select count(*) from public.trainer_scopes
    where role_assignment_id in (
      select id from public.role_assignments
      where user_id='00000000-0000-0000-0000-000000000108'
        and property_id='20000000-0000-0000-0000-000000000011'
        and status='active'
    ) and is_active$$,
  array[1::bigint],
  'department role receives its explicit active department scope'
);
select throws_ok(
  $$update public.user_accounts set login_id='browser-bypass'
    where user_id='00000000-0000-0000-0000-000000000108'$$,
  '42501',
  null,
  'direct browser account mutation is revoked'
);
select throws_ok(
  $$select public.update_property_backend_account(
    '20000000-0000-0000-0000-000000000011'::uuid,
    (select id from public.user_accounts where login_id='department-responsible'),
    99,
    'department-responsible',
    '部门培训负责人（测试）',
    'active',
    'department_training_admin',
    '[{"departmentId":"61000000-0000-0000-0000-000000000012","includeDescendants":true}]'::jsonb
  )$$,
  'P5003',
  null,
  'stale account version is rejected'
);

select lives_ok(
  $$select public.save_operational_unit(
    p_property_id => '20000000-0000-0000-0000-000000000011'::uuid,
    p_operational_unit_id => null,
    p_expected_version => 0,
    p_department_id => '61000000-0000-0000-0000-000000000018'::uuid,
    p_parent_operational_unit_id => null,
    p_unit_type => 'venue',
    p_code => 'recovery-b-office',
    p_name_zh => '培训行政办公室',
    p_name_en => 'Training Administration Office',
    p_sort_order => 60,
    p_is_active => true
  )$$,
  'manager creates an operational unit through the named-argument RPC contract'
);
select lives_ok(
  $$select public.save_operational_unit(
    p_property_id => '20000000-0000-0000-0000-000000000011'::uuid,
    p_operational_unit_id => (
      select id from public.operational_units
      where property_id = '20000000-0000-0000-0000-000000000011'
        and code = 'recovery-b-office'
    ),
    p_expected_version => 1,
    p_department_id => '61000000-0000-0000-0000-000000000018'::uuid,
    p_parent_operational_unit_id => null,
    p_unit_type => 'venue',
    p_code => 'recovery-b-office',
    p_name_zh => '培训行政办公室（已更新）',
    p_name_en => 'Training Administration Office',
    p_sort_order => 61,
    p_is_active => true
  )$$,
  'manager updates an operational unit with the authoritative version'
);
select results_eq(
  $$select name_zh || ':' || version::text
    from public.operational_units
    where property_id = '20000000-0000-0000-0000-000000000011'
      and code = 'recovery-b-office'$$,
  $$values ('培训行政办公室（已更新）:2'::text)$$,
  'operational-unit update persists and increments the server version'
);
select throws_ok(
  $$select public.save_operational_unit(
    p_property_id => '20000000-0000-0000-0000-000000000011'::uuid,
    p_operational_unit_id => (
      select id from public.operational_units
      where property_id = '20000000-0000-0000-0000-000000000011'
        and code = 'recovery-b-office'
    ),
    p_expected_version => 1,
    p_department_id => '61000000-0000-0000-0000-000000000018'::uuid,
    p_parent_operational_unit_id => null,
    p_unit_type => 'venue',
    p_code => 'recovery-b-office',
    p_name_zh => '陈旧写入',
    p_name_en => 'Stale Write',
    p_sort_order => 62,
    p_is_active => true
  )$$,
  'P5103',
  null,
  'stale operational-unit update is rejected'
);

select lives_ok(
  $$select public.save_position_family(
    p_property_id => '20000000-0000-0000-0000-000000000011'::uuid,
    p_position_family_id => null,
    p_expected_version => 0,
    p_code => 'recovery-b-family',
    p_name_zh => '培训运营岗位族',
    p_name_en => 'Training Operations',
    p_description => 'Recovery B test family',
    p_sort_order => 60,
    p_is_active => true
  )$$,
  'manager creates a position family through the named-argument RPC contract'
);
select lives_ok(
  $$select public.save_position_family(
    p_property_id => '20000000-0000-0000-0000-000000000011'::uuid,
    p_position_family_id => (
      select id from public.position_families
      where property_id = '20000000-0000-0000-0000-000000000011'
        and code = 'recovery-b-family'
    ),
    p_expected_version => 1,
    p_code => 'recovery-b-family',
    p_name_zh => '培训运营岗位族（已更新）',
    p_name_en => 'Training Operations',
    p_description => 'Updated Recovery B test family',
    p_sort_order => 61,
    p_is_active => true
  )$$,
  'manager updates a position family with the authoritative version'
);
select results_eq(
  $$select name_zh || ':' || version::text
    from public.position_families
    where property_id = '20000000-0000-0000-0000-000000000011'
      and code = 'recovery-b-family'$$,
  $$values ('培训运营岗位族（已更新）:2'::text)$$,
  'position-family update persists and increments the server version'
);
select throws_ok(
  $$select public.save_position_family(
    p_property_id => '20000000-0000-0000-0000-000000000011'::uuid,
    p_position_family_id => (
      select id from public.position_families
      where property_id = '20000000-0000-0000-0000-000000000011'
        and code = 'recovery-b-family'
    ),
    p_expected_version => 1,
    p_code => 'recovery-b-family',
    p_name_zh => '陈旧写入',
    p_name_en => 'Stale Write',
    p_description => null,
    p_sort_order => 62,
    p_is_active => true
  )$$,
  'P5203',
  null,
  'stale position-family update is rejected'
);

select lives_ok(
  $$select public.save_position_with_departments(
    p_property_id => '20000000-0000-0000-0000-000000000011'::uuid,
    p_position_id => null,
    p_expected_version => 0,
    p_position_family_id => (
      select id from public.position_families
      where property_id = '20000000-0000-0000-0000-000000000011'
        and code = 'recovery-b-family'
    ),
    p_code => 'recovery-b-position',
    p_name_zh => '培训运营协调员',
    p_name_en => 'Training Operations Coordinator',
    p_grade_or_band => 'L2',
    p_is_active => true,
    p_department_ids => array[
      '61000000-0000-0000-0000-000000000012'::uuid,
      '61000000-0000-0000-0000-000000000015'::uuid
    ]
  )$$,
  'manager atomically creates a position and official-department assignments'
);
select lives_ok(
  $$select public.save_position_with_departments(
    p_property_id => '20000000-0000-0000-0000-000000000011'::uuid,
    p_position_id => (
      select id from public.positions
      where property_id = '20000000-0000-0000-0000-000000000011'
        and code = 'recovery-b-position'
    ),
    p_expected_version => 1,
    p_position_family_id => (
      select id from public.position_families
      where property_id = '20000000-0000-0000-0000-000000000011'
        and code = 'recovery-b-family'
    ),
    p_code => 'recovery-b-position',
    p_name_zh => '培训运营协调员（已更新）',
    p_name_en => 'Training Operations Coordinator',
    p_grade_or_band => 'L3',
    p_is_active => true,
    p_department_ids => array[
      '61000000-0000-0000-0000-000000000017'::uuid
    ]
  )$$,
  'manager atomically updates a position and replaces its department assignments'
);
select results_eq(
  $$select name_zh || ':' || version::text
    from public.positions
    where property_id = '20000000-0000-0000-0000-000000000011'
      and code = 'recovery-b-position'$$,
  $$values ('培训运营协调员（已更新）:2'::text)$$,
  'position update persists and increments the server version'
);
select results_eq(
  $$select count(*)
    from public.position_department_assignments
    where position_id = (
      select id from public.positions
      where property_id = '20000000-0000-0000-0000-000000000011'
        and code = 'recovery-b-position'
    )
      and department_id = '61000000-0000-0000-0000-000000000017'
      and is_primary$$,
  array[1::bigint],
  'position update replaces assignments atomically and marks the first scope primary'
);
select throws_ok(
  $$select public.save_position_with_departments(
    p_property_id => '20000000-0000-0000-0000-000000000011'::uuid,
    p_position_id => (
      select id from public.positions
      where property_id = '20000000-0000-0000-0000-000000000011'
        and code = 'recovery-b-position'
    ),
    p_expected_version => 1,
    p_position_family_id => (
      select id from public.position_families
      where property_id = '20000000-0000-0000-0000-000000000011'
        and code = 'recovery-b-family'
    ),
    p_code => 'recovery-b-position',
    p_name_zh => '陈旧写入',
    p_name_en => 'Stale Write',
    p_grade_or_band => 'L4',
    p_is_active => true,
    p_department_ids => array[
      '61000000-0000-0000-0000-000000000017'::uuid
    ]
  )$$,
  'P5303',
  null,
  'stale position and department-assignment update is rejected'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000108';
select results_eq(
  $$select name_zh from public.departments order by depth,sort_order,name_zh$$,
  $$values ('房务部'::text), ('前厅部'::text), ('礼宾部'::text), ('前台'::text)$$,
  'department responsible sees breadcrumb ancestors, assigned node, and configured descendants only'
);
select results_eq(
  $$select count(*) from public.department_closure$$,
  array[9::bigint],
  'closure rows expose only relationships between visible department nodes'
);
select results_eq(
  $$select count(*) from public.operational_units$$,
  array[0::bigint],
  'department responsible cannot see operational units in unrelated branches'
);
select results_eq(
  $$select name_zh from public.positions order by name_zh$$,
  $$values ('前厅部经理'::text), ('宾客服务专员'::text), ('礼宾主管'::text)$$,
  'department responsible sees positions assigned inside the configured branch'
);
select results_eq(
  $$select name_zh from public.position_families order by name_zh$$,
  $$values ('一线员工'::text), ('主管人员'::text), ('管理人员'::text)$$,
  'department responsible sees only position families used by visible positions'
);
select throws_ok(
  $$update public.position_families set name_zh='不可修改'$$,
  '42501',
  null,
  'department responsible cannot mutate position families'
);
select throws_ok(
  $$select public.save_operational_unit(
    p_property_id => '20000000-0000-0000-0000-000000000011'::uuid,
    p_operational_unit_id => null,
    p_expected_version => 0,
    p_department_id => '61000000-0000-0000-0000-000000000012'::uuid,
    p_parent_operational_unit_id => null,
    p_unit_type => 'venue',
    p_code => 'forbidden-unit',
    p_name_zh => '不可创建',
    p_name_en => 'Forbidden',
    p_sort_order => 99,
    p_is_active => true
  )$$,
  'P5101',
  null,
  'department responsible cannot call hotel organization save RPCs'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select lives_ok(
  $$select public.update_property_backend_account(
    '20000000-0000-0000-0000-000000000011'::uuid,
    (select id from public.user_accounts where login_id='department-responsible'),
    1,
    'department-responsible',
    '部门培训负责人（测试）',
    'active',
    'department_training_admin',
    '[{"departmentId":"61000000-0000-0000-0000-000000000012","includeDescendants":false}]'::jsonb
  )$$,
  'manager can narrow a department scope with the current version'
);
select results_eq(
  $$select version from public.user_accounts where login_id='department-responsible'$$,
  array[2::bigint],
  'successful account update increments its version'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000108';
select results_eq(
  $$select name_zh from public.departments order by depth,sort_order,name_zh$$,
  $$values ('房务部'::text), ('前厅部'::text)$$,
  'scope without descendants exposes only the assigned node and breadcrumb'
);
select results_eq(
  $$select name_zh from public.positions order by name_zh$$,
  $$values ('前厅部经理'::text)$$,
  'scope without descendants hides child-department positions'
);
select throws_ok(
  $$select public.update_property_backend_account(
    '20000000-0000-0000-0000-000000000011'::uuid,
    (select id from public.user_accounts where login_id='department-responsible'),
    2,
    'department-responsible',
    '部门培训负责人（测试）',
    'active',
    'property_ld_manager',
    '[]'::jsonb
  )$$,
  'P5001',
  null,
  'department responsible cannot widen their own role'
);

reset role;
update public.departments
set is_active = false
where id = '61000000-0000-0000-0000-000000000018';

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$select public.update_property_backend_account(
    '20000000-0000-0000-0000-000000000011'::uuid,
    (select id from public.user_accounts where login_id='department-responsible'),
    2,
    'department-responsible',
    '部门培训负责人（测试）',
    'active',
    'department_training_admin',
    '[{"departmentId":"61000000-0000-0000-0000-000000000018","includeDescendants":true}]'::jsonb
  )$$,
  'P5005',
  null,
  'inactive official departments cannot become an active account scope'
);
select results_eq(
  $$select version from public.user_accounts where login_id='department-responsible'$$,
  array[2::bigint],
  'rejected scope update leaves the authoritative account version unchanged'
);
select throws_ok(
  $$select public.update_property_backend_account(
    '20000000-0000-0000-0000-000000000011'::uuid,
    (select id from public.user_accounts where login_id='property-manager'),
    1,
    'property-manager',
    'Property A1 L&D Manager',
    'disabled',
    'property_ld_manager',
    '[]'::jsonb
  )$$,
  'P5006',
  null,
  'final active hotel L&D manager is protected'
);
select throws_ok(
  $$insert into public.role_assignments(user_id,role_id,tenant_id,property_id,status)
    select '00000000-0000-0000-0000-000000000103',id,
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000011','active'
    from public.roles where code='department_training_admin'$$,
  '42501',
  null,
  'manager cannot bypass the account service with direct role mutation'
);

reset role;
select throws_ok(
  $$insert into public.role_assignments(user_id,role_id,tenant_id,property_id,status)
    select '00000000-0000-0000-0000-000000000103',id,
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000011','active'
    from public.roles where code='department_training_admin'$$,
  '23514',
  null,
  'database integrity prevents two simultaneous approved hotel roles'
);

select * from finish();
rollback;
