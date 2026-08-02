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
  '00000000-0000-0000-0000-000000000141',
  'authenticated', 'authenticated', 'password-change-manager@example.test',
  extensions.crypt('local-test-only', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false,
  '', '', '', '', '', '', '', ''
);

insert into public.profiles (id, email, display_name)
values (
  '00000000-0000-0000-0000-000000000141',
  'password-change-manager@example.test',
  'Password Change Manager'
);

insert into public.tenant_memberships (tenant_id, user_id, status)
values (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000141',
  'active'
);

insert into public.property_memberships (tenant_id, property_id, user_id, status)
values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000141',
  'active'
);

insert into public.role_assignments (user_id, role_id, tenant_id, property_id, status)
select
  '00000000-0000-0000-0000-000000000141',
  role.id,
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'active'
from public.roles role
where role.code = 'property_ld_manager';

insert into public.user_accounts (
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values (
  '00000000-0000-0000-0000-000000000142',
  '00000000-0000-0000-0000-000000000141',
  '00000000-0000-0000-0000-000000000141',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'password-change-manager',
  'active', true
);

-- A membership and account without a hotel business role must not become a
-- server-finalizable password transition. This protects the platform plane
-- from satisfying a hotel-account transition by association alone.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current,
  reauthentication_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000143',
  'authenticated', 'authenticated', 'password-change-no-hotel-role@example.test',
  extensions.crypt('local-test-only', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false,
  '', '', '', '', '', '', '', ''
);

insert into public.profiles (id, email, display_name)
values (
  '00000000-0000-0000-0000-000000000143',
  'password-change-no-hotel-role@example.test',
  'No Hotel Role'
);

insert into public.tenant_memberships (tenant_id, user_id, status)
values (
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000143',
  'active'
);

insert into public.property_memberships (tenant_id, property_id, user_id, status)
values (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000143',
  'active'
);

insert into public.user_accounts (
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values (
  '00000000-0000-0000-0000-000000000144',
  '00000000-0000-0000-0000-000000000143',
  '00000000-0000-0000-0000-000000000143',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'password-change-no-hotel-role',
  'active', true
);

select has_table(
  'public', 'hotel_password_change_events',
  'password transitions retain append-only audit evidence'
);
select has_function(
  'public', 'prepare_hotel_password_change', array['text'],
  'an authenticated own-account password-change preflight exists'
);
select has_function(
  'public', 'complete_hotel_password_change', array['uuid', 'uuid', 'bigint'],
  'a server-only password-change completion transition exists'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.prepare_hotel_password_change(text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated', 'public.complete_hotel_password_change(uuid,uuid,bigint)', 'EXECUTE'
  )
  and has_function_privilege(
    'service_role', 'public.complete_hotel_password_change(uuid,uuid,bigint)', 'EXECUTE'),
  'the browser can only prepare its own transition; finalization stays server-only'
);
select ok(
  not has_function_privilege(
    'public', 'public.prepare_hotel_password_change(text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'public', 'public.complete_hotel_password_change(uuid,uuid,bigint)', 'EXECUTE'),
  'neither password transition function retains PUBLIC execution'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000141';
set local request.jwt.claim.role = 'authenticated';

select is(
  public.prepare_hotel_password_change('demo-a1.example.test')->>'accountVersion',
  '1',
  'the authenticated manager can obtain only their current account version'
);
select throws_ok(
  $$select public.prepare_hotel_password_change('demo-a2.example.test')$$,
  '42501', null,
  'an authenticated manager cannot prepare a password change through another Property hostname'
);
select throws_ok(
  $$select public.complete_hotel_password_change(
      '00000000-0000-0000-0000-000000000141'::uuid,
      '20000000-0000-0000-0000-000000000011'::uuid,
      1
    )$$,
  '42501', null,
  'the authenticated browser role cannot clear must_change_password directly'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select public.complete_hotel_password_change(
      '00000000-0000-0000-0000-000000000143'::uuid,
      '20000000-0000-0000-0000-000000000011'::uuid,
      1
    )$$,
  '42501', null,
  'a member without an active hotel role cannot finalize a password transition'
);
select is(
  public.complete_hotel_password_change(
    '00000000-0000-0000-0000-000000000141'::uuid,
    '20000000-0000-0000-0000-000000000011'::uuid,
    1
  )->>'changed',
  'true',
  'the bounded server transition clears the account state only after the Auth update flow reaches completion'
);

reset role;
select ok(
  (select not must_change_password and version = 2
   from public.user_accounts
   where id = '00000000-0000-0000-0000-000000000142'),
  'successful completion clears must_change_password and advances the account version'
);
select ok(
  (select count(*) = 1
   from public.hotel_password_change_events
   where account_id = '00000000-0000-0000-0000-000000000142'
     and was_password_change_required),
  'successful first-password completion has one durable audit record'
);
select throws_ok(
  $$update public.hotel_password_change_events
      set event_type = 'password_change_completed'$$,
  '42501', null,
  'password-change audit evidence is append-only'
);

update public.user_accounts
set must_change_password = true,
    version = 3
where id = '00000000-0000-0000-0000-000000000142';

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select public.complete_hotel_password_change(
      '00000000-0000-0000-0000-000000000141'::uuid,
      '20000000-0000-0000-0000-000000000011'::uuid,
      2
    )$$,
  'P0003', null,
  'a concurrent reset or account change keeps the forced-change state in place'
);

reset role;
select ok(
  (select must_change_password and version = 3
   from public.user_accounts
   where id = '00000000-0000-0000-0000-000000000142'),
  'a stale completion cannot silently override the later account state'
);
select results_eq(
  $$select count(*)
    from information_schema.role_table_grants
    where grantee = 'service_role'
      and table_schema = 'public'
      and table_name in ('user_accounts', 'hotel_password_change_events')
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')$$,
  array[0::bigint],
  'the boundary adds no service_role direct table grant'
);

select * from finish();
rollback;
