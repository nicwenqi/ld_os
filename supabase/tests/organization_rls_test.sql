begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into public.user_accounts (
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values (
  '79000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000103',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'd0-manager-fixture',
  'active',
  false
);

-- Department administrator exists only inside this rolled-back security test so
-- the accepted 2B.1 fixture counts remain unchanged.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000107',
  'authenticated', 'authenticated', 'department-admin-a1@example.test',
  extensions.crypt('local-test-only', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
);
insert into public.profiles (id, email, display_name) values
  ('00000000-0000-0000-0000-000000000107', 'department-admin-a1@example.test', 'Synthetic Department Administrator');
insert into public.tenant_memberships (tenant_id, user_id, status) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000107', 'active');
insert into public.property_memberships (tenant_id, property_id, user_id, status) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000107', 'active');
insert into public.user_accounts (
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values (
  '79000000-0000-0000-0000-000000000107',
  '00000000-0000-0000-0000-000000000107',
  '00000000-0000-0000-0000-000000000107',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'd0-department-fixture',
  'active',
  false
);
insert into public.role_assignments (id, user_id, role_id, tenant_id, property_id, status, granted_at)
select '70000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000107',
  role.id, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'active', now()
from public.roles role where role.code = 'department_training_admin';
insert into public.trainer_scopes (
  id, role_assignment_id, tenant_id, property_id, department_id, include_descendants, is_active
) values (
  '71000000-0000-0000-0000-000000000107', '70000000-0000-0000-0000-000000000107',
  '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011',
  '61000000-0000-0000-0000-000000000012', true, true
);

select results_eq(
  $$select count(*) from pg_class
    where relnamespace = 'public'::regnamespace
      and relname in ('departments','department_closure','department_aliases','operational_units','operational_unit_aliases','position_families','positions','position_department_assignments','position_aliases')
      and relrowsecurity and relforcerowsecurity$$,
  array[9::bigint],
  'every new public table enables and forces RLS'
);

set local role anon;
select throws_ok('select * from public.departments', '42501', null, 'anonymous cannot read departments');
select throws_ok('select * from public.department_closure', '42501', null, 'anonymous cannot read closure rows');
select throws_ok('select * from public.department_aliases', '42501', null, 'anonymous cannot read department aliases');
select throws_ok('select * from public.operational_units', '42501', null, 'anonymous cannot read operational units');
select throws_ok('select * from public.operational_unit_aliases', '42501', null, 'anonymous cannot read operational unit aliases');
select throws_ok('select * from public.position_families', '42501', null, 'anonymous cannot read position families');
select throws_ok('select * from public.positions', '42501', null, 'anonymous cannot read positions');
select throws_ok('select * from public.position_aliases', '42501', null, 'anonymous cannot read position aliases');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select results_eq('select count(*) from public.departments', array[0::bigint], 'platform provisioner cannot read hotel organization data');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000102';
select results_eq('select count(*) from public.departments', array[0::bigint], 'tenant admin has no implicit hotel organization authority');

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select results_eq('select count(*) from public.departments', array[9::bigint], 'A1 L&D manager reads only A1 departments');
select results_eq('select count(*) from public.operational_units', array[1::bigint], 'A1 L&D manager reads own operational units');
select results_eq('select count(*) from public.position_families', array[5::bigint], 'A1 L&D manager reads own position families');
select lives_ok(
  $$insert into public.department_aliases
    (tenant_id, property_id, source_system, source_value, normalized_source_value, target_department_id, resolution_type, approved_by, approved_at)
    values (
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011',
      'synthetic-workbook', 'Rooms Admin', 'rooms admin', '61000000-0000-0000-0000-000000000011',
      'mapped', auth.uid(), now()
    )$$,
  'A1 L&D manager approves an alias inside A1'
);
select throws_ok(
  $$insert into public.department_aliases
    (tenant_id, property_id, source_system, source_value, normalized_source_value, target_department_id, resolution_type, approved_by, approved_at)
    values (
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012',
      'synthetic-workbook', 'Other', 'other', '61000000-0000-0000-0000-000000000021',
      'mapped', auth.uid(), now()
    )$$,
  '42501', null,
  'A1 L&D manager cannot approve aliases in A2'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000107';
select results_eq('select count(*) from public.departments', array[4::bigint], 'department responsible reads only breadcrumb, assigned branch, and configured descendants');
select results_eq('select count(*) from public.operational_units', array[0::bigint], 'department responsible cannot read unrelated operational units');
select results_eq('select count(*) from public.positions', array[3::bigint], 'department responsible reads positions assigned inside the authorized branch');
select is_empty('select * from public.department_aliases', 'department admin cannot read source mapping administration');
select is_empty('select * from public.position_aliases', 'department admin cannot read position mapping administration');
select throws_ok(
  $$select public.create_department(
    '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', null,
    'department', 'forbidden', '不可创建', 'Forbidden', 99
  )$$,
  '42501', 'ORGANIZATION_FORBIDDEN: property organization manager role required',
  'department admin cannot create departments'
);
select throws_ok(
  $$insert into public.department_aliases
    (tenant_id, property_id, source_system, source_value, normalized_source_value, resolution_type)
    values (
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011',
      'synthetic-workbook', 'Forbidden Mapping', 'forbidden mapping', 'deferred'
    )$$,
  '42501', null,
  'department admin cannot approve or create department aliases'
);
select throws_ok(
  $$update public.positions set name_zh = '不可修改'
    where id = '65000000-0000-0000-0000-000000000011'$$,
  '42501', null,
  'department responsible cannot modify positions directly'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select is_empty('select * from public.departments', 'membership without an approved application role has no organization read');
select is_empty('select * from public.positions', 'membership without an approved application role has no position-management read');

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000105';
select results_eq('select count(*) from public.departments', array[0::bigint], 'A2 member with no organization role cannot read A1 or organization management data');

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000106';
select results_eq('select count(*) from public.departments', array[0::bigint], 'Tenant B ordinary member cannot read Tenant A organization');

reset role;
select throws_ok(
  $$update public.departments set property_id = '20000000-0000-0000-0000-000000000012'
    where id = '61000000-0000-0000-0000-000000000011'$$,
  '23514', 'department tenant and property are immutable',
  'department tenant and property are immutable'
);
select throws_ok(
  $$update public.department_aliases set source_value = 'changed'
    where id = '62000000-0000-0000-0000-000000000011'$$,
  '23514', 'department alias source evidence is immutable',
  'department alias original source value is immutable'
);
select throws_ok(
  $$update public.position_aliases set source_value = 'changed'
    where id = '67000000-0000-0000-0000-000000000011'$$,
  '23514', 'position alias source evidence is immutable',
  'position alias original source value is immutable'
);
select throws_ok(
  $$update public.operational_units set department_id = '61000000-0000-0000-0000-000000000021'
    where id = '63000000-0000-0000-0000-000000000011'$$,
  '23503', null,
  'operational unit cannot move to a cross-property department'
);
select results_eq(
  $$select count(*) from public.position_aliases
    where property_id = '20000000-0000-0000-0000-000000000011'$$,
  array[3::bigint],
  'position aliases remain isolated by property'
);

select * from finish();
rollback;
