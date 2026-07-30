begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- C2 uses only the repository-owned synthetic local fixture.  Every row made
-- below is rolled back: no employee or training-operational fact is created.
insert into public.user_accounts (
  user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values (
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000103',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'c2-manager', 'active', false
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000108',
  'authenticated', 'authenticated', 'c2-department@example.test',
  extensions.crypt('local-c2-only', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
);

update public.properties
set brand = 'C2 Synthetic Brand', city = 'Suzhou', timezone = 'Asia/Shanghai'
where id = '20000000-0000-0000-0000-000000000011';

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';

select lives_ok(
  $$select public.create_department(
    '10000000-0000-0000-0000-000000000001'::uuid,
    '20000000-0000-0000-0000-000000000011'::uuid,
    null, 'department', 'c2-pilot-dept', 'C2 试运行部门', 'C2 Pilot Department', 99
  )$$,
  'Hotel L&D Manager can explicitly create an official department through the authorized RPC'
);
select set_config(
  'test.c2.department_id',
  (select id::text from public.departments
    where property_id = '20000000-0000-0000-0000-000000000011'
      and code = 'c2-pilot-dept'),
  true
);
select lives_ok(
  $$select public.create_department(
    '10000000-0000-0000-0000-000000000001'::uuid,
    '20000000-0000-0000-0000-000000000011'::uuid,
    current_setting('test.c2.department_id')::uuid,
    'section', 'c2-pilot-child', 'C2 试运行小组', 'C2 Pilot Section', 10
  )$$,
  'Hotel L&D Manager can explicitly create a child department without inferred structure'
);
select set_config(
  'test.c2.child_department_id',
  (select id::text from public.departments
    where property_id = '20000000-0000-0000-0000-000000000011'
      and code = 'c2-pilot-child'),
  true
);
select ok(
  exists (
    select 1 from public.department_closure
    where ancestor_department_id = current_setting('test.c2.department_id')::uuid
      and descendant_department_id = current_setting('test.c2.child_department_id')::uuid
      and distance = 1
  ),
  'the server-maintained closure records the confirmed descendant relationship'
);

select lives_ok(
  $$select public.create_property_backend_account_foundation(
    '20000000-0000-0000-0000-000000000011'::uuid,
    '00000000-0000-0000-0000-000000000108'::uuid,
    'c2-department@example.test', 'c2-department', 'C2 部门培训负责人',
    'department_training_admin',
    jsonb_build_array(jsonb_build_object(
      'departmentId', current_setting('test.c2.department_id'),
      'includeDescendants', true
    ))
  )$$,
  'Hotel L&D Manager creates a department responsible person with an explicit server-owned scope'
);
select results_eq(
  $$select count(*) from public.trainer_scopes scope
    join public.role_assignments assignment on assignment.id = scope.role_assignment_id
    where assignment.user_id = '00000000-0000-0000-0000-000000000108'
      and scope.department_id = current_setting('test.c2.department_id')::uuid
      and scope.include_descendants and scope.is_active$$,
  array[1::bigint],
  'the department responsible person has exactly the approved parent-and-descendant scope'
);
select lives_ok(
  $$select public.complete_property_initialization(
    '20000000-0000-0000-0000-000000000011'::uuid,
    (select version from public.property_settings
      where property_id = '20000000-0000-0000-0000-000000000011')
  )$$,
  'activation completes only after confirmed property, manager and official-organization facts exist'
);
select results_eq(
  $$select initialization_state::text from public.property_settings
    where property_id = '20000000-0000-0000-0000-000000000011'$$,
  $$values ('ready'::text)$$,
  'the persisted activation state is the authoritative ready fact'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000108';
select ok(
  app_private.has_authorized_department_scope(
    '20000000-0000-0000-0000-000000000011'::uuid,
    current_setting('test.c2.department_id')::uuid
  ),
  'department responsible person can resolve the explicitly assigned branch'
);
select ok(
  app_private.has_authorized_department_scope(
    '20000000-0000-0000-0000-000000000011'::uuid,
    current_setting('test.c2.child_department_id')::uuid
  ),
  'descendant scope is resolved on the server through the closure table'
);
select ok(
  not app_private.has_authorized_department_scope(
    '20000000-0000-0000-0000-000000000011'::uuid,
    '61000000-0000-0000-0000-000000000015'::uuid
  ),
  'department responsible person cannot resolve an unrelated department'
);
select throws_ok(
  $$select public.create_department(
    '10000000-0000-0000-0000-000000000001'::uuid,
    '20000000-0000-0000-0000-000000000011'::uuid,
    null, 'department', 'c2-forbidden', '禁止创建', 'Forbidden', 999
  )$$,
  '42501', 'ORGANIZATION_FORBIDDEN: property organization manager role required',
  'department responsible person cannot change the official organization'
);
select throws_ok(
  $$select public.complete_property_initialization(
    '20000000-0000-0000-0000-000000000011'::uuid,
    (select version from public.property_settings
      where property_id = '20000000-0000-0000-0000-000000000011')
  )$$,
  'P4010', null,
  'department responsible person cannot complete hotel activation'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select is_empty(
  $$select id from public.departments
    where property_id = '20000000-0000-0000-0000-000000000011'$$,
  'platform provisioner cannot read hotel organization after C2 activation'
);

reset role;
select results_eq(
  $$select count(*) from public.employees
    where property_id = '20000000-0000-0000-0000-000000000011'$$,
  array[0::bigint],
  'C2 creates no employee or Employee Fact Version baseline'
);
select results_eq(
  $$select count(*) from public.training_requirements
    where property_id = '20000000-0000-0000-0000-000000000011'$$,
  array[0::bigint],
  'C2 creates no Requirement or later training-operational fact'
);
select results_eq(
  $$select count(*) from public.training_sessions
    where property_id = '20000000-0000-0000-0000-000000000011'$$,
  array[0::bigint],
  'C2 creates no Session, Attendance, or Completion fact'
);

select * from finish();
rollback;
