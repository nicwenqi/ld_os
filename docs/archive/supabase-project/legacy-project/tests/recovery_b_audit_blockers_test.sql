begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

select has_function(
  'public',
  'prepare_property_backend_account_password_reset',
  array['uuid','uuid','bigint'],
  'manager-only password-reset preparation RPC exists'
);
select ok(
  (
    select
      position(
        'pg_catalog.pg_advisory_xact_lock'
        in pg_get_functiondef(
          'public.update_property_backend_account(uuid,uuid,bigint,text,text,text,text,jsonb)'::regprocedure
        )
      ) > 0
      and position(
        'pg_catalog.pg_advisory_xact_lock'
        in pg_get_functiondef(
          'public.update_property_backend_account(uuid,uuid,bigint,text,text,text,text,jsonb)'::regprocedure
        )
      ) < position(
        'app_private.count_active_property_managers'
        in pg_get_functiondef(
          'public.update_property_backend_account(uuid,uuid,bigint,text,text,text,text,jsonb)'::regprocedure
        )
      )
  ),
  'account updates serialize per property before final-manager evaluation'
);

reset role;
insert into public.user_accounts (
  user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
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
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000107',
    'authenticated',
    'authenticated',
    'department-responsible-audit@example.test',
    extensions.crypt('local-test-only', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000109',
    'authenticated',
    'authenticated',
    'second-manager-audit@example.test',
    extensions.crypt('local-test-only', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    false
  );

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';

select lives_ok(
  $$select public.create_property_backend_account_foundation(
    '20000000-0000-0000-0000-000000000011'::uuid,
    '00000000-0000-0000-0000-000000000107'::uuid,
    'department-responsible-audit@example.test',
    'department-responsible-audit',
    '部门培训负责人（审计）',
    'department_training_admin',
    '[{"departmentId":"61000000-0000-0000-0000-000000000017","includeDescendants":false}]'::jsonb
  )$$,
  'manager creates a valid department responsible account and leaf scope'
);
select lives_ok(
  $$select public.create_property_backend_account_foundation(
    '20000000-0000-0000-0000-000000000011'::uuid,
    '00000000-0000-0000-0000-000000000109'::uuid,
    'second-manager-audit@example.test',
    'second-manager-audit',
    '第二位学习与发展经理',
    'property_ld_manager',
    '[]'::jsonb
  )$$,
  'manager creates a second active hotel L&D manager'
);

reset role;
update public.user_accounts
set must_change_password = false,
    failed_login_count = 4,
    locked_until = now() + interval '2 hours'
where login_id = 'second-manager-audit';

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select ok(
  (
    select
      result->>'accountId' = (
        select id::text
        from public.user_accounts
        where login_id = 'second-manager-audit'
      )
      and (result->>'version')::bigint = 2
      and not (
        result ?| array[
          'userId','authUserId','email','internalEmail','internalTechnicalIdentity'
        ]
      )
    from (
      select public.prepare_property_backend_account_password_reset(
        '20000000-0000-0000-0000-000000000011'::uuid,
        (
          select id
          from public.user_accounts
          where login_id = 'second-manager-audit'
        ),
        1
      ) result
    ) prepared
  ),
  'password-reset preparation increments version and returns only the redacted account snapshot'
);
reset role;
select results_eq(
  $$select must_change_password, failed_login_count, locked_until is null, version
    from public.user_accounts
    where login_id = 'second-manager-audit'$$,
  $$values (true, 0, true, 2::bigint)$$,
  'password-reset preparation clears failure and lock state and requires password change'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$select public.prepare_property_backend_account_password_reset(
    '20000000-0000-0000-0000-000000000011'::uuid,
    (
      select id
      from public.user_accounts
      where login_id = 'second-manager-audit'
    ),
    1
  )$$,
  'P5003',
  null,
  'stale password-reset preparation is rejected'
);
select lives_ok(
  $$select public.update_property_backend_account(
    '20000000-0000-0000-0000-000000000011'::uuid,
    (
      select id
      from public.user_accounts
      where login_id = 'second-manager-audit'
    ),
    2,
    'second-manager-audit',
    '第二位学习与发展经理',
    'disabled',
    'property_ld_manager',
    '[]'::jsonb
  )$$,
  'one of two managers may be disabled through the serialized account RPC'
);
reset role;
select results_eq(
  $$select app_private.count_active_property_managers(
    '20000000-0000-0000-0000-000000000011'
  )$$,
  array[1],
  'serialized demotion leaves exactly one active hotel L&D manager'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$select public.update_property_backend_account(
    '20000000-0000-0000-0000-000000000011'::uuid,
    (
      select id
      from public.user_accounts
      where login_id = 'property-manager'
    ),
    1,
    'property-manager',
    'Property A1 L&D Manager',
    'disabled',
    'property_ld_manager',
    '[]'::jsonb
  )$$,
  'P5006',
  null,
  'the remaining active manager cannot be disabled'
);

select lives_ok(
  $$select public.create_department(
    '10000000-0000-0000-0000-000000000001'::uuid,
    '20000000-0000-0000-0000-000000000011'::uuid,
    null,
    'department',
    'audit-operations',
    '审计运营部',
    'Audit Operations',
    95
  )$$,
  'manager creates an isolated department for dependency checks'
);
select results_eq(
  $$select result->>'tenantId'
    from (
      select public.save_operational_unit(
        p_property_id => '20000000-0000-0000-0000-000000000011'::uuid,
        p_operational_unit_id => null,
        p_expected_version => 0,
        p_department_id => (
          select id from public.departments
          where property_id = '20000000-0000-0000-0000-000000000011'
            and code = 'audit-operations'
        ),
        p_parent_operational_unit_id => null,
        p_unit_type => 'venue',
        p_code => 'audit-operations-office',
        p_name_zh => '审计运营办公室',
        p_name_en => 'Audit Operations Office',
        p_sort_order => 10,
        p_is_active => true
      ) result
    ) saved$$,
  $$values ('10000000-0000-0000-0000-000000000001'::text)$$,
  'operational-unit snapshot includes tenantId'
);
select throws_ok(
  $$select public.save_operational_unit(
    p_property_id => '20000000-0000-0000-0000-000000000011'::uuid,
    p_operational_unit_id => null,
    p_expected_version => 0,
    p_department_id => '61000000-0000-0000-0000-000000000016'::uuid,
    p_parent_operational_unit_id => (
      select id from public.operational_units
      where property_id = '20000000-0000-0000-0000-000000000011'
        and code = 'audit-operations-office'
    ),
    p_unit_type => 'venue',
    p_code => 'cross-department-child',
    p_name_zh => '跨部门子单元',
    p_name_en => 'Cross-department Child',
    p_sort_order => 10,
    p_is_active => true
  )$$,
  'P5102',
  null,
  'an operational-unit parent must belong to the same official department'
);
select results_eq(
  $$select result->>'tenantId'
    from (
      select public.save_position_family(
        p_property_id => '20000000-0000-0000-0000-000000000011'::uuid,
        p_position_family_id => null,
        p_expected_version => 0,
        p_code => 'hotel-wide-audit',
        p_name_zh => '全酒店通用岗位族',
        p_name_en => 'Hotel-wide',
        p_description => 'Recovery B audit fixture',
        p_sort_order => 95,
        p_is_active => true
      ) result
    ) saved$$,
  $$values ('10000000-0000-0000-0000-000000000001'::text)$$,
  'position-family snapshot includes tenantId'
);
select results_eq(
  $$select result->>'tenantId'
    from (
      select public.save_position_with_departments(
        p_property_id => '20000000-0000-0000-0000-000000000011'::uuid,
        p_position_id => null,
        p_expected_version => 0,
        p_position_family_id => (
          select id from public.position_families
          where property_id = '20000000-0000-0000-0000-000000000011'
            and code = 'hotel-wide-audit'
        ),
        p_code => 'hotel-wide-training-coordinator',
        p_name_zh => '全酒店培训协调员',
        p_name_en => 'Hotel-wide Training Coordinator',
        p_grade_or_band => 'L2',
        p_is_active => true,
        p_department_ids => '{}'::uuid[]
      ) result
    ) saved$$,
  $$values ('10000000-0000-0000-0000-000000000001'::text)$$,
  'position snapshot includes tenantId'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000107';
select results_eq(
  $$select name_zh
    from public.positions
    where code = 'hotel-wide-training-coordinator'$$,
  $$values ('全酒店培训协调员'::text)$$,
  'valid department responsible person sees unassigned hotel-wide positions in their property'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select is_empty(
  $$select 1
    from public.positions
    where code = 'hotel-wide-training-coordinator'$$,
  'property membership without an approved role cannot see hotel-wide positions'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000107';
select throws_ok(
  $$select public.prepare_property_backend_account_password_reset(
    '20000000-0000-0000-0000-000000000011'::uuid,
    (
      select id
      from public.user_accounts
      where login_id = 'property-manager'
    ),
    1
  )$$,
  'P5001',
  null,
  'department responsible person cannot prepare backend password resets'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$select public.update_department_details(
    '61000000-0000-0000-0000-000000000011'::uuid,
    1,
    '房务部',
    'Rooms',
    10,
    false
  )$$,
  'P5401',
  null,
  'department with active child departments cannot be deactivated'
);
select throws_ok(
  $$select public.update_department_details(
    '61000000-0000-0000-0000-000000000017'::uuid,
    1,
    '财务部',
    'Finance',
    20,
    false
  )$$,
  'P5402',
  null,
  'department with an active responsible-person scope cannot be deactivated'
);
select throws_ok(
  $$select public.update_department_details(
    '61000000-0000-0000-0000-000000000018'::uuid,
    1,
    '工程部',
    'Engineering',
    30,
    false
  )$$,
  'P5403',
  null,
  'department with an active position assignment cannot be deactivated'
);
select throws_ok(
  $$select public.update_department_details(
    (
      select id from public.departments
      where property_id = '20000000-0000-0000-0000-000000000011'
        and code = 'audit-operations'
    ),
    1,
    '审计运营部',
    'Audit Operations',
    95,
    false
  )$$,
  'P5404',
  null,
  'department with an active operational unit cannot be deactivated'
);
select lives_ok(
  $$select public.update_department_details(
    '61000000-0000-0000-0000-000000000016'::uuid,
    1,
    '楼层',
    'Floor',
    10,
    false
  )$$,
  'dependency-free leaf department can be deactivated'
);
select results_eq(
  $$select is_active from public.departments
    where id = '61000000-0000-0000-0000-000000000016'$$,
  array[false],
  'successful department deactivation persists'
);

select * from finish();
rollback;
