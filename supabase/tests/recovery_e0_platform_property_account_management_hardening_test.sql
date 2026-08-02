begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current,
  reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000110',
  'authenticated', 'authenticated', 'platform-account-hardening@example.test',
  extensions.crypt('local-test-only', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false,
  '', '', '', '', '', '', '', ''
);
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current,
  reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000112',
  'authenticated', 'authenticated', 'platform-account-created@accounts.ldchub.cn',
  extensions.crypt('local-test-only', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false,
  '', '', '', '', '', '', '', ''
);
insert into public.profiles (id, email, display_name)
values ('00000000-0000-0000-0000-000000000110', 'platform-account-hardening@example.test', 'Hardening Manager');
insert into public.tenant_memberships (tenant_id, user_id, status)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000110', 'active');
insert into public.property_memberships (tenant_id, property_id, user_id, status)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000110', 'active');
insert into public.role_assignments (user_id, role_id, tenant_id, property_id, status)
select '00000000-0000-0000-0000-000000000110', id, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'active'
from public.roles where code = 'property_ld_manager';
insert into public.user_accounts (id, user_id, auth_user_id, tenant_id, property_id, login_id, account_status, must_change_password)
values ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000110', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'hardening-manager', 'active', false);

select has_function(
  'public', 'platform_record_manager_auth_cleanup_result',
  array['uuid','uuid','text','boolean','text','text'],
  'manager Auth cleanup audit RPC exists'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';

select throws_ok(
  $$select public.platform_prepare_manager_password_reset(
    '20000000-0000-0000-0000-000000000011'::uuid,
    '00000000-0000-0000-0000-000000000111'::uuid,
    1,
    'hotel-role-denied'
  )$$,
  '42501', null,
  'Hotel L&D Manager cannot prepare a platform password reset'
);
select throws_ok(
  $$select public.platform_set_property_manager_status(
    '20000000-0000-0000-0000-000000000011'::uuid,
    '00000000-0000-0000-0000-000000000111'::uuid,
    1,
    'disabled',
    'hotel-role-denied'
  )$$,
  '42501', null,
  'Hotel L&D Manager cannot change a platform-managed Manager account'
);
select throws_ok(
  $$select public.platform_record_manager_auth_cleanup_result(
    '20000000-0000-0000-0000-000000000011'::uuid,
    '00000000-0000-0000-0000-000000000110'::uuid,
    'create', true, 'hotel-role-cleanup-denied', null
  )$$,
  '42501', null,
  'Hotel L&D Manager cannot write Platform Auth cleanup evidence'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000102';
select throws_ok(
  $$select public.platform_list_property_manager_accounts('20000000-0000-0000-0000-000000000011'::uuid)$$,
  '42501', null,
  'Tenant admin has no implicit Platform account-management authority'
);

reset role;
set local role anon;
select throws_ok(
  $$select public.platform_list_properties()$$,
  '42501', null,
  'anonymous callers cannot execute Platform Property RPCs'
);
select throws_ok(
  $$select public.platform_record_manager_auth_cleanup_result(
    '20000000-0000-0000-0000-000000000011'::uuid,
    '00000000-0000-0000-0000-000000000110'::uuid,
    'create', true, 'anonymous-cleanup-denied', null
  )$$,
  '42501', null,
  'anonymous callers cannot write Platform Auth cleanup evidence'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select ok(
  not (
    public.platform_prepare_manager_password_reset(
      '20000000-0000-0000-0000-000000000011'::uuid,
      '00000000-0000-0000-0000-000000000111'::uuid,
      1,
      'platform-reset-shape'
    ) ? 'authUserId'
  ),
  'authenticated Platform caller cannot receive Auth UUID from reset preparation RPC'
);
select is(
  public.platform_record_manager_auth_cleanup_result(
    '20000000-0000-0000-0000-000000000011'::uuid,
    '00000000-0000-0000-0000-000000000110'::uuid,
    'create', false, 'platform-cleanup-evidence', 'AUTH_DELETE_FAILED'
  )->>'recorded',
  'true',
  'Platform caller can record a bounded cleanup-failure compensation event'
);
select ok(
  public.platform_create_property_manager_account(
    '20000000-0000-0000-0000-000000000011'::uuid,
    '00000000-0000-0000-0000-000000000112'::uuid,
    'platform-account-created@accounts.ldchub.cn',
    'hardening-manager-new',
    'New Hardening Manager',
    'platform-create-ambiguous-name-regression'
  ) ? 'accountId',
  'Platform Manager creation resolves the global User ID uniqueness check without ambiguity'
);
select throws_ok(
  $$select count(*) from public.platform_account_management_events$$,
  '42501', null,
  'Platform caller cannot read append-only account-management audit evidence directly'
);

reset role;
select * from finish();
rollback;
