begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

-- Synthetic identities from supabase/seed.sql.
-- 101 platform admin; 102 Tenant A admin; 103 A1 L&D Manager;
-- 104 A1 member; 105 A2 member; 106 B1 member.
do $$
begin
  perform set_config(
    'test.property_ld_manager_role_id',
    (select id::text from public.roles where code = 'property_ld_manager'),
    true
  );
end
$$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select ok((select app_private.is_platform_admin()), 'platform admin is resolved from platform_memberships');
select results_eq('select count(*) from public.tenants', array[2::bigint], 'platform admin can read every tenant');
select results_eq('select count(*) from public.properties', array[3::bigint], 'platform admin can read every property');

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000102';
select ok(not (select app_private.is_platform_admin()), 'tenant admin is not a platform admin');
select ok((select app_private.is_tenant_admin('10000000-0000-0000-0000-000000000001')), 'Tenant A admin helper is true for Tenant A');
select ok(not (select app_private.is_tenant_admin('10000000-0000-0000-0000-000000000002')), 'Tenant A admin helper is false for Tenant B');
select results_eq(
  'select code from public.tenants order by code',
  $$values ('tenant-a'::text)$$,
  'Tenant A admin cannot read Tenant B'
);
select results_eq(
  'select code from public.properties order by code',
  $$values ('a1'::text), ('a2'::text)$$,
  'Tenant A admin can read both Tenant A properties'
);
select results_eq('select count(*) from public.property_memberships', array[3::bigint], 'Tenant A admin can read Tenant A property memberships only');

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select ok((select app_private.is_property_member('20000000-0000-0000-0000-000000000011')), 'A1 ordinary member belongs to A1');
select ok(not (select app_private.is_property_member('20000000-0000-0000-0000-000000000012')), 'A1 ordinary member does not belong to A2');
select results_eq(
  'select code from public.properties order by code',
  $$values ('a1'::text)$$,
  'A1 member cannot read A2 property identity'
);
select results_eq('select count(*) from public.property_memberships', array[1::bigint], 'A1 member cannot read A2 private memberships');
select results_eq('select count(*) from public.profiles', array[1::bigint], 'ordinary member can read only their own profile');
select results_eq('select count(*) from public.role_assignments', array[0::bigint], 'property membership alone does not create an application role');
select throws_ok(
  $$update public.profiles set email = 'changed@example.test'
    where id = '00000000-0000-0000-0000-000000000104'$$,
  '42501', null,
  'ordinary member cannot change profile security email'
);
select throws_ok(
  $$update public.profiles set is_active = false
    where id = '00000000-0000-0000-0000-000000000104'$$,
  '42501', null,
  'ordinary member cannot reactivate or deactivate profile security state'
);

select throws_ok(
  $$insert into public.role_assignments (user_id, role_id, tenant_id, property_id, status)
    values (
      '00000000-0000-0000-0000-000000000104',
      current_setting('test.property_ld_manager_role_id')::uuid,
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000011',
      'active'
    )$$,
  '42501', null, 'ordinary member cannot create role assignments'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select ok((select app_private.has_property_role('20000000-0000-0000-0000-000000000011', 'property_ld_manager')), 'A1 L&D Manager role helper is true');
select results_eq('select count(*) from public.property_memberships', array[2::bigint], 'A1 L&D Manager can read A1 memberships only');
select throws_ok(
  $$insert into public.role_assignments (user_id, role_id, tenant_id, status)
    select '00000000-0000-0000-0000-000000000103', id,
      '10000000-0000-0000-0000-000000000001', 'active'
    from public.roles where code = 'tenant_admin'$$,
  '42501', null, 'Property L&D Manager cannot escalate to tenant admin'
);
select throws_ok(
  $$insert into public.platform_memberships (user_id, role_code, is_active)
    values ('00000000-0000-0000-0000-000000000103', 'platform_admin', true)$$,
  '42501', null, 'Property L&D Manager cannot escalate to platform admin'
);

reset role;
select throws_ok(
  $$update public.property_memberships
      set property_id = '20000000-0000-0000-0000-000000000012'
    where user_id = '00000000-0000-0000-0000-000000000104'$$,
  '23514', null, 'tenant and property scope columns are immutable'
);

update public.property_memberships set status = 'revoked', revoked_at = now()
where user_id = '00000000-0000-0000-0000-000000000105';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000105';
select results_eq('select count(*) from public.properties', array[0::bigint], 'revoked property membership removes property access');

reset role;
update public.tenant_memberships set status = 'revoked', revoked_at = now()
where user_id = '00000000-0000-0000-0000-000000000106';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000106';
select results_eq('select count(*) from public.tenants', array[0::bigint], 'revoked tenant membership removes tenant access');
select results_eq('select count(*) from public.properties', array[0::bigint], 'revoked tenant membership also removes property access');

reset role;
update public.property_memberships set status = 'suspended'
where user_id = '00000000-0000-0000-0000-000000000104';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select results_eq('select count(*) from public.properties', array[0::bigint], 'suspended membership removes property access');

reset role;
set local role anon;
select throws_ok('select * from public.tenants', '42501', null, 'anonymous cannot list tenants');
select throws_ok('select * from public.properties', '42501', null, 'anonymous cannot list properties');
select throws_ok('select * from public.profiles', '42501', null, 'anonymous cannot list profiles');
select throws_ok('select * from public.platform_memberships', '42501', null, 'anonymous cannot list platform memberships');
select throws_ok('select * from public.tenant_memberships', '42501', null, 'anonymous cannot list tenant memberships');
select throws_ok('select * from public.property_memberships', '42501', null, 'anonymous cannot list property memberships');
select throws_ok('select * from public.roles', '42501', null, 'anonymous cannot list roles');
select throws_ok('select * from public.role_assignments', '42501', null, 'anonymous cannot list role assignments');
select throws_ok('select * from public.trainer_scopes', '42501', null, 'anonymous cannot list trainer scopes');

reset role;
update public.platform_memberships set is_active = false, revoked_at = now()
where user_id = '00000000-0000-0000-0000-000000000101';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select ok(not (select app_private.is_platform_admin()), 'platform access is removed when platform_membership is inactive');

select * from finish();
rollback;
