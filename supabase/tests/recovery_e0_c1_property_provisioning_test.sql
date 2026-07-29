begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- This is a disposable local Auth identity. C1 must receive it from the
-- controlled server-side invitation path; the SQL RPC must never create it.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000111',
  'authenticated', 'authenticated', 'c1-manager@example.test',
  extensions.crypt('LocalC1Only2026', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"],"hotel_ld_internal_account":true}'::jsonb,
  '{}'::jsonb,
  false
);

create temporary table c1_handoff (result jsonb not null) on commit drop;
grant insert, select on pg_temp.c1_handoff to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select lives_ok(
  $$insert into pg_temp.c1_handoff(result)
  select public.provision_initial_property_and_manager(
    '10000000-0000-0000-0000-000000000001'::uuid,
    '{
      "code":"c1-pilot",
      "nameZh":"C1 本地试运行酒店",
      "nameEn":"C1 Local Pilot Hotel",
      "brand":"C1 Local Brand",
      "city":"Suzhou",
      "countryRegion":"CN",
      "timezone":"Asia/Shanghai",
      "defaultLanguage":"zh-CN",
      "hostname":"c1-pilot.example.test"
    }'::jsonb,
    '{
      "authUserId":"00000000-0000-0000-0000-000000000111",
      "internalEmail":"c1-manager@example.test",
      "loginId":"c1-manager",
      "displayName":"C1 本地学习与发展经理"
    }'::jsonb
  )$$,
  'active platform provisioner can create only a local Property handoff'
);

reset role;
select set_config(
  'test.c1.property_id',
  (select id::text from public.properties where code = 'c1-pilot'),
  true
);

select results_eq(
  $$select account_status::text from public.user_accounts
    where property_id = current_setting('test.c1.property_id')::uuid$$,
  $$values ('active'::text)$$,
  'the initial manager account is active for the required-password-change handoff'
);
select results_eq(
  $$select must_change_password from public.user_accounts
    where property_id = current_setting('test.c1.property_id')::uuid$$,
  array[true],
  'the initial manager must change the temporary password before ordinary hotel work'
);
select results_eq(
  $$select verification_status::text from public.property_domains
    where property_id = current_setting('test.c1.property_id')::uuid$$,
  $$values ('verified'::text)$$,
  'the committed handoff hostname is resolvable as the initial technical property context'
);
select results_eq(
  $$select evidence->>'accountStatus' from public.platform_provisioning_events
    where property_id = current_setting('test.c1.property_id')::uuid$$,
  $$values ('active'::text)$$,
  'the append-only platform audit records the password-change-required account state'
);
select results_eq(
  $$select evidence->>'domainVerificationStatus' from public.platform_provisioning_events
    where property_id = current_setting('test.c1.property_id')::uuid$$,
  $$values ('verified'::text)$$,
  'the append-only platform audit records the handoff hostname state'
);
select results_eq(
  $$select result ? 'managerDisplayName' from pg_temp.c1_handoff$$,
  array[true],
  'the provisioning handoff exposes a redacted manager display name rather than internal identity data'
);
select ok(
  not exists (
    select 1 from pg_temp.c1_handoff
    where result ? 'managerAuthUserId'
       or result ? 'managerAccountId'
       or result ? 'internalEmail'
  ),
  'the provisioning handoff never exposes internal manager identifiers'
);

select results_eq(
  $$select count(*) from public.employees
    where property_id = current_setting('test.c1.property_id')::uuid$$,
  array[0::bigint],
  'C1 provisioning creates no employee records'
);
select results_eq(
  $$select count(*) from public.departments
    where property_id = current_setting('test.c1.property_id')::uuid$$,
  array[0::bigint],
  'C1 provisioning creates no organization records'
);
select results_eq(
  $$select count(*) from public.courses
    where property_id = current_setting('test.c1.property_id')::uuid$$,
  array[0::bigint],
  'C1 provisioning creates no Course facts'
);
select results_eq(
  $$select count(*) from public.training_requirements
    where property_id = current_setting('test.c1.property_id')::uuid$$,
  array[0::bigint],
  'C1 provisioning creates no Requirement facts'
);
select results_eq(
  $$select count(*) from public.training_plans
    where property_id = current_setting('test.c1.property_id')::uuid$$,
  array[0::bigint],
  'C1 provisioning creates no Plan facts'
);
select results_eq(
  $$select count(*) from public.training_sessions
    where property_id = current_setting('test.c1.property_id')::uuid$$,
  array[0::bigint],
  'C1 provisioning creates no Session facts'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select is_empty(
  $$select * from public.employees
    where property_id = current_setting('test.c1.property_id')::uuid$$,
  'the platform provisioner cannot read the newly provisioned hotel employee surface'
);
select is_empty(
  $$select id from public.user_accounts
    where property_id = current_setting('test.c1.property_id')::uuid$$,
  'the platform provisioner cannot read the newly provisioned manager account through hotel data access'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$select public.provision_initial_property_and_manager(
    '10000000-0000-0000-0000-000000000001'::uuid,
    '{}'::jsonb,
    '{}'::jsonb
  )$$,
  '42501',
  'PLATFORM_PROVISIONER_REQUIRED',
  'a Hotel L&D Manager cannot use the platform provisioning RPC'
);

reset role;
select results_eq(
  $$select count(*) from public.user_accounts
    where property_id = current_setting('test.c1.property_id')::uuid
      and employee_id is not null$$,
  array[0::bigint],
  'the initial manager is never created as an employee-linked backend account'
);
select results_eq(
  $$select count(*) from public.role_assignments assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.property_id = current_setting('test.c1.property_id')::uuid
      and role.code = 'property_ld_manager'
      and assignment.status = 'active'$$,
  array[1::bigint],
  'the handoff creates exactly one active Hotel L&D Manager role'
);

select * from finish();
rollback;
