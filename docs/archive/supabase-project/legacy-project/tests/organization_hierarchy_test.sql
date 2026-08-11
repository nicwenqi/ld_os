begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

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

select has_table('public', 'departments', 'departments exists');
select has_table('public', 'department_closure', 'department_closure exists');
select has_table('public', 'department_aliases', 'department_aliases exists');
select has_table('public', 'operational_units', 'operational_units exists');
select has_table('public', 'operational_unit_aliases', 'operational_unit_aliases exists');
select has_table('public', 'position_families', 'position_families exists');
select has_table('public', 'positions', 'positions exists');
select has_table('public', 'position_department_assignments', 'position_department_assignments exists');
select has_table('public', 'position_aliases', 'position_aliases exists');
select has_function('public', 'create_department', array['uuid','uuid','uuid','text','text','text','text','integer'], 'department creation RPC exists');
select has_function('public', 'update_department_details', array['uuid','bigint','text','text','integer','boolean'], 'department update RPC exists');
select has_function('public', 'preview_department_move', array['uuid','uuid'], 'move preview RPC exists');
select has_function('public', 'reparent_department', array['uuid','uuid','bigint'], 'atomic reparent RPC exists');

select results_eq(
  $$select count(*) from public.department_closure where ancestor_department_id = '61000000-0000-0000-0000-000000000011'$$,
  array[6::bigint],
  'Rooms closure contains itself and five descendants'
);
select results_eq(
  $$select distance from public.department_closure
    where ancestor_department_id = '61000000-0000-0000-0000-000000000011'
      and descendant_department_id = '61000000-0000-0000-0000-000000000013'$$,
  array[2],
  'closure stores correct ancestor distance'
);
select results_eq(
  $$select depth from public.departments where id = '61000000-0000-0000-0000-000000000016'$$,
  array[2],
  'arbitrary-depth leaf stores depth'
);
select results_eq(
  $$select path_ids from public.departments where id = '61000000-0000-0000-0000-000000000016'$$,
  $$values (array[
    '61000000-0000-0000-0000-000000000011'::uuid,
    '61000000-0000-0000-0000-000000000015'::uuid,
    '61000000-0000-0000-0000-000000000016'::uuid
  ]::uuid[])$$,
  'department path preserves the full arbitrary-depth hierarchy'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select lives_ok(
  $$select public.create_department(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    null,
    'department', 'quality', '质量管理', 'Quality', 90
  )$$,
  'property L&D manager creates a top-level department'
);
select lives_ok(
  $$select public.create_department(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    '61000000-0000-0000-0000-000000000014',
    'team', 'night-desk', '夜班前台', 'Night Desk', 10
  )$$,
  'property L&D manager creates a child department'
);
select results_eq(
  $$select count(*) from public.department_closure closure
    join public.departments department on department.id = closure.descendant_department_id
    where department.code = 'night-desk'$$,
  array[4::bigint],
  'new child receives self and all ancestor closure rows'
);
select lives_ok(
  $$select public.update_department_details(
    '61000000-0000-0000-0000-000000000016', 1, '楼层', 'Floor', 10, false
  )$$,
  'department can be deactivated without deleting hierarchy history'
);
select results_eq(
  $$select count(*) from public.department_closure
    where descendant_department_id = '61000000-0000-0000-0000-000000000016'$$,
  array[3::bigint],
  'deactivation leaves closure rows intact'
);
select lives_ok(
  $$select public.update_department_details(
    '61000000-0000-0000-0000-000000000016', 2, '楼层', 'Floor', 10, true
  )$$,
  'department can be reactivated with the next version token'
);
select results_eq(
  $$select count(*) from public.department_closure
    where descendant_department_id = '61000000-0000-0000-0000-000000000016'$$,
  array[3::bigint],
  'reactivation also leaves closure rows intact'
);
select throws_ok(
  $$select public.reparent_department(
    '61000000-0000-0000-0000-000000000012',
    '61000000-0000-0000-0000-000000000013', 1
  )$$,
  'P2003', 'DEPARTMENT_CYCLE: target parent is inside the moving subtree',
  'moving a department under its descendant is rejected'
);
select throws_ok(
  $$select public.reparent_department(
    '61000000-0000-0000-0000-000000000012',
    '61000000-0000-0000-0000-000000000012', 1
  )$$,
  'P2004', 'DEPARTMENT_SELF_PARENT: department cannot be its own parent',
  'self-parenting is rejected'
);
select throws_ok(
  $$select public.reparent_department(
    '61000000-0000-0000-0000-000000000012',
    '61000000-0000-0000-0000-000000000021', 1
  )$$,
  'P2001', 'DEPARTMENT_PARENT_SCOPE: target parent must belong to the same property',
  'cross-property parenting is rejected'
);
select throws_ok(
  $$select public.reparent_department(
    '61000000-0000-0000-0000-000000000014',
    '61000000-0000-0000-0000-000000000015', 999
  )$$,
  'P2002', 'DEPARTMENT_STALE_VERSION: refresh the organization tree and retry',
  'stale version token is rejected'
);

select lives_ok(
  $$select public.reparent_department(
    '61000000-0000-0000-0000-000000000012',
    '61000000-0000-0000-0000-000000000018', 1
  )$$,
  'Front Office subtree can be moved transactionally under Engineering'
);
select results_eq(
  $$select path_ids from public.departments where id = '61000000-0000-0000-0000-000000000013'$$,
  $$values (array[
    '61000000-0000-0000-0000-000000000018'::uuid,
    '61000000-0000-0000-0000-000000000012'::uuid,
    '61000000-0000-0000-0000-000000000013'::uuid
  ]::uuid[])$$,
  'descendant paths are rebuilt with the moved subtree'
);
select results_eq(
  $$select distance from public.department_closure
    where ancestor_department_id = '61000000-0000-0000-0000-000000000018'
      and descendant_department_id = '61000000-0000-0000-0000-000000000013'$$,
  array[2],
  'closure rows connect new ancestors to every moved descendant'
);
select is_empty(
  $$select 1 from public.department_closure
    where ancestor_department_id = '61000000-0000-0000-0000-000000000011'
      and descendant_department_id = '61000000-0000-0000-0000-000000000013'$$,
  'old external ancestor closure rows are removed'
);
select results_eq(
  $$select count(*) from public.department_closure
    where ancestor_department_id = '61000000-0000-0000-0000-000000000015'$$,
  array[2::bigint],
  'unrelated sibling subtree closure remains unchanged'
);

select results_eq(
  $$select target_department_id from public.department_aliases
    where property_id = '20000000-0000-0000-0000-000000000011'
      and source_system = 'synthetic-workbook'
      and normalized_source_value = 'rooms division administration'
      and is_active$$,
  array['61000000-0000-0000-0000-000000000011'::uuid],
  'approved active department aliases are reusable'
);
select results_eq(
  $$select resolution_type::text from public.department_aliases
    where source_value in ('Marketing & Commnuications', 'Pruchasing') order by source_value$$,
  $$values ('deferred'::text), ('ignored'::text)$$,
  'deferred and ignored source labels remain auditable'
);
select throws_ok(
  $$insert into public.position_department_assignments
      (tenant_id, property_id, position_id, department_id, is_primary)
    values (
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000011',
      '65000000-0000-0000-0000-000000000011',
      '61000000-0000-0000-0000-000000000021', false
    )$$,
  '42501', null,
  'direct position assignment mutation is revoked in favor of the versioned administration RPC'
);

select * from finish();
rollback;
