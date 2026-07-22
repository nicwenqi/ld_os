begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

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

select has_table('public', 'property_domains', 'property_domains exists');
select has_table('public', 'property_settings', 'property_settings exists');
select has_function('public', 'resolve_property_context', array['text'], 'safe hostname resolver exists');

set local role anon;
select results_eq(
  $$select hostname from public.resolve_property_context('DEMO-A1.EXAMPLE.TEST:443')$$,
  $$values ('demo-a1.example.test'::text)$$,
  'resolver normalizes case and port'
);
select is_empty(
  $$select * from public.resolve_property_context('unknown.example.test')$$,
  'unknown hostname is not configured'
);
select throws_ok('select * from public.property_domains', '42501', null, 'anonymous cannot list property domains');
select throws_ok('select * from public.property_settings', '42501', null, 'anonymous cannot list property settings');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select results_eq('select count(*) from public.property_domains', array[1::bigint], 'A1 member reads only the assigned domain');
select results_eq('select count(*) from public.property_settings', array[1::bigint], 'A1 member reads only the assigned settings');
select is_empty(
  $$update public.property_settings set new_employee_days = 30
    where property_id = '20000000-0000-0000-0000-000000000011' returning id$$,
  'ordinary member cannot update settings'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select ok((select app_private.can_manage_property('20000000-0000-0000-0000-000000000011')), 'A1 L&D Manager can manage A1');
select ok(not (select app_private.can_manage_property('20000000-0000-0000-0000-000000000012')), 'A1 L&D Manager cannot manage A2');
select results_eq(
  $$update public.property_settings set new_employee_days = 60
    where property_id = '20000000-0000-0000-0000-000000000011' returning version$$,
  array[2::bigint],
  'property manager updates own settings and version increments'
);
select lives_ok(
  $$update public.properties set brand = 'Synthetic Brand Updated'
    where id = '20000000-0000-0000-0000-000000000011'$$,
  'property manager updates own property identity'
);
select results_eq('select count(*) from public.property_settings', array[1::bigint], 'property manager cannot read A2 settings');

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000102';
select results_eq('select count(*) from public.property_settings', array[2::bigint], 'Tenant A admin reads both Tenant A settings');
select lives_ok(
  $$update public.property_settings set ctc_mandatory = false
    where property_id = '20000000-0000-0000-0000-000000000012'$$,
  'Tenant A admin updates A2 settings'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000106';
select results_eq('select count(*) from public.property_settings', array[1::bigint], 'Tenant B member cannot read Tenant A settings');

reset role;
select throws_ok(
  $$update public.property_settings set new_employee_days = 0
    where property_id = '20000000-0000-0000-0000-000000000011'$$,
  '23514', null, 'new employee days must be positive'
);
select throws_ok(
  $$insert into public.property_domains (tenant_id, property_id, hostname, is_primary)
    values ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000012',
      'wrong-owner.example.test', false)$$,
  '23503', null, 'property context cannot cross tenant and property ownership'
);
select throws_ok(
  $$insert into public.property_domains (tenant_id, property_id, hostname, is_primary, verification_status, is_active)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012',
      'DEMO-A1.EXAMPLE.TEST', false, 'verified', true)$$,
  '23505', null, 'hostnames are unique case-insensitively'
);
select throws_ok(
  $$insert into public.property_domains (tenant_id, property_id, hostname, is_primary, verification_status, is_active)
    values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011',
      'second-a1.example.test', true, 'verified', true)$$,
  '23505', null, 'a property has one primary domain'
);

update public.property_domains set is_active = false
where hostname = 'demo-a2.example.test';
set local role anon;
select is_empty(
  $$select * from public.resolve_property_context('demo-a2.example.test')$$,
  'inactive domain is not resolved'
);

reset role;
update public.properties set status = 'inactive'
where id = '20000000-0000-0000-0000-000000000021';
set local role anon;
select is_empty(
  $$select * from public.resolve_property_context('demo-b1.example.test')$$,
  'inactive property is not resolved'
);

select * from finish();
rollback;
