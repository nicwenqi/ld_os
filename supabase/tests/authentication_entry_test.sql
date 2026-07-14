begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select has_type('public', 'account_status', 'account status enum exists');
select has_table('public', 'user_accounts', 'user accounts table exists');
select has_column('public', 'user_accounts', 'login_id', 'user-facing login ID is stored');
select has_column('public', 'user_accounts', 'auth_user_id', 'private auth identity is stored');
select col_type_is('public', 'user_accounts', 'login_id', 'text', 'login ID remains text');
select col_is_unique('public', 'user_accounts', array['property_id', 'normalized_login_id'], 'login ID is unique inside a property');

reset role;
insert into public.user_accounts (
  id, user_id, auth_user_id, tenant_id, property_id, login_id, account_status, must_change_password
) values
  ('91000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'property-manager', 'active', false),
  ('91000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000104', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'ordinary-member', 'active', true),
  ('91000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000105', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', 'suspended-member', 'suspended', false),
  ('91000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000106', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021', 'tenant-b-member', 'active', false);

select throws_ok(
  $$insert into public.user_accounts (
      user_id, auth_user_id, tenant_id, property_id, login_id
    ) values (
      '00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000104',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', ' ORDINARY-MEMBER '
    )$$,
  '23505', null, 'normalized login ID collisions are rejected within a property'
);

set local role anon;
select throws_ok('select * from public.user_accounts', '42501', null, 'anonymous cannot read login mappings');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select results_eq(
  'select login_id from public.user_accounts',
  $$values ('ordinary-member'::text)$$,
  'an active user can read only their own account identity'
);
select ok((select app_private.is_current_account_active('20000000-0000-0000-0000-000000000011')), 'active account and membership grant an active session');
select ok(not (select app_private.is_current_account_active('20000000-0000-0000-0000-000000000012')), 'an account is not active outside its property');

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select results_eq('select count(*) from public.user_accounts', array[2::bigint], 'property manager reads accounts only inside assigned property');

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000105';
select results_eq('select count(*) from public.user_accounts', array[0::bigint], 'suspended account cannot read its private mapping');
select ok(not (select app_private.is_current_account_active('20000000-0000-0000-0000-000000000012')), 'suspended account is denied even with an auth session');

reset role;
select throws_ok(
  $$update public.user_accounts set tenant_id = '10000000-0000-0000-0000-000000000002'
      where id = '91000000-0000-0000-0000-000000000104'$$,
  '23514', 'account tenant and property identity is immutable', 'account cannot move to another tenant'
);
select throws_ok(
  $$update public.user_accounts set property_id = '20000000-0000-0000-0000-000000000012'
      where id = '91000000-0000-0000-0000-000000000104'$$,
  '23514', 'account tenant and property identity is immutable', 'account cannot move to another property'
);
select throws_ok(
  $$update public.user_accounts set auth_user_id = '00000000-0000-0000-0000-000000000105'
      where id = '91000000-0000-0000-0000-000000000104'$$,
  '23514', 'account user and auth identity is immutable', 'account cannot move to another auth identity'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select results_eq(
  $$with changed as (
      update public.user_accounts set account_status = 'active'
      where id = '91000000-0000-0000-0000-000000000104'
      returning id
    ) select count(*) from changed$$,
  array[0::bigint], 'ordinary user cannot modify account status'
);
select throws_ok(
  $$insert into public.user_accounts (
      user_id, auth_user_id, tenant_id, property_id, login_id, account_status
    ) values (
      '00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000104',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'self-created', 'active'
    )$$,
  '42501', null, 'ordinary user cannot create an account mapping'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$update public.user_accounts set tenant_id = '10000000-0000-0000-0000-000000000002'
      where id = '91000000-0000-0000-0000-000000000104'$$,
  '23514', 'account tenant and property identity is immutable', 'property manager cannot move an account across tenancy'
);

select * from finish();
rollback;
