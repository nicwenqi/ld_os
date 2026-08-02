begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

select has_table(
  'public', 'platform_bootstrap_events',
  'the first platform-admin bootstrap has an append-only audit table'
);
select has_function(
  'public', 'bootstrap_first_platform_admin', array['uuid', 'text', 'text', 'text'],
  'the first platform-admin bootstrap exposes one bounded RPC'
);
select results_eq(
  $$select count(*)
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.proname = 'bootstrap_first_platform_admin'
       and procedure.prosecdef
       and procedure.proconfig = array['search_path=""']::text[]$$,
  array[1::bigint],
  'the bootstrap RPC is SECURITY DEFINER with an empty search path'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.bootstrap_first_platform_admin(uuid,text,text,text)',
    'EXECUTE'
  ),
  'only service_role receives bootstrap RPC execution'
);

-- The repository's seeded local fixture includes a platform admin for other
-- authorization suites. Remove that fixture inside this test transaction so
-- the one-time bootstrap gate is exercised from its true zero-admin state;
-- rollback restores the shared synthetic seed for every other test file.
reset role;
delete from public.platform_memberships where role_code = 'platform_admin';
delete from public.platform_bootstrap_events;

select set_config('test.bootstrap.properties_before', (select count(*)::text from public.properties), true);
select set_config('test.bootstrap.employees_before', (select count(*)::text from public.employees), true);
select set_config('test.bootstrap.requirements_before', (select count(*)::text from public.training_requirements), true);
select set_config('test.bootstrap.plans_before', (select count(*)::text from public.training_plans), true);
select set_config('test.bootstrap.sessions_before', (select count(*)::text from public.training_sessions), true);
select ok(
  not has_function_privilege('public', 'public.bootstrap_first_platform_admin(uuid,text,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.bootstrap_first_platform_admin(uuid,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.bootstrap_first_platform_admin(uuid,text,text,text)', 'EXECUTE'),
  'browser and public roles cannot invoke bootstrap'
);
select ok(
  not exists (
    select 1
      from information_schema.role_table_grants
     where grantee = 'service_role'
       and table_schema = 'public'
       and table_name = 'platform_bootstrap_events'
  ),
  'bootstrap does not add a service_role table grant'
);
select results_eq(
  $$select relrowsecurity::int + relforcerowsecurity::int * 2
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname = 'platform_bootstrap_events'$$,
  array[3::int],
  'bootstrap audit uses enabled and forced RLS'
);

-- Disposable Auth identity; the test transaction rolls it back.
reset role;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-00000000b001',
  'authenticated', 'authenticated', 'bootstrap-admin@example.test',
  extensions.crypt('BootstrapOnly2026!', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"],"hotel_ld_internal_account":true}'::jsonb,
  '{}'::jsonb,
  false
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select public.bootstrap_first_platform_admin(
    '00000000-0000-0000-0000-00000000b001'::uuid,
    'bootstrap-admin@example.test',
    '首位平台管理员',
    'bootstrap-test-request-1'
  )$$,
  'service_role can complete the first bootstrap transaction'
);
reset role;

select is(
  (select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000b001'),
  1::bigint,
  'bootstrap creates one profile'
);
select is(
  (select count(*) from public.platform_memberships where user_id = '00000000-0000-0000-0000-00000000b001' and role_code = 'platform_admin'),
  1::bigint,
  'bootstrap creates one platform membership'
);
select is(
  (select count(*) from public.platform_bootstrap_events where request_id = 'bootstrap-test-request-1'),
  1::bigint,
  'bootstrap creates one audit record'
);
select ok(
  not exists (
    select 1 from public.platform_bootstrap_events
     where evidence ? 'password' or evidence ? 'secret'
  ),
  'bootstrap audit stores no password or secret'
);

-- A second attempt is rejected permanently, even before a second Auth identity.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select public.bootstrap_first_platform_admin(
    '00000000-0000-0000-0000-00000000b001'::uuid,
    'bootstrap-admin@example.test',
    '首位平台管理员',
    'bootstrap-test-request-2'
  )$$,
  '42501',
  'FIRST_PLATFORM_ADMIN_BOOTSTRAP_CLOSED',
  'bootstrap permanently closes after the first successful audit'
);

set local role anon;
select throws_ok(
  $$select public.bootstrap_first_platform_admin(
    '00000000-0000-0000-0000-00000000b001'::uuid,
    'bootstrap-admin@example.test',
    '首位平台管理员',
    'bootstrap-test-request-anon'
  )$$,
  '42501', null,
  'anonymous callers cannot invoke bootstrap'
);
set local role authenticated;
select throws_ok(
  $$select public.bootstrap_first_platform_admin(
    '00000000-0000-0000-0000-00000000b001'::uuid,
    'bootstrap-admin@example.test',
    '首位平台管理员',
    'bootstrap-test-request-authenticated'
  )$$,
  '42501', null,
  'authenticated browser callers cannot invoke bootstrap'
);

reset role;
select throws_ok(
  $$update public.platform_bootstrap_events
       set display_name = 'changed'
     where request_id = 'bootstrap-test-request-1'$$,
  '42501', null,
  'bootstrap audit is append-only on update'
);
select throws_ok(
  $$delete from public.platform_bootstrap_events
     where request_id = 'bootstrap-test-request-1'$$,
  '42501', null,
  'bootstrap audit is append-only on delete'
);

select is((select count(*) from public.properties), current_setting('test.bootstrap.properties_before')::bigint, 'bootstrap creates no Property');
select is((select count(*) from public.employees), current_setting('test.bootstrap.employees_before')::bigint, 'bootstrap creates no employees');
select is((select count(*) from public.training_requirements), current_setting('test.bootstrap.requirements_before')::bigint, 'bootstrap creates no Requirements');
select is((select count(*) from public.training_plans), current_setting('test.bootstrap.plans_before')::bigint, 'bootstrap creates no Plans');
select is((select count(*) from public.training_sessions), current_setting('test.bootstrap.sessions_before')::bigint, 'bootstrap creates no Sessions');

select * from finish();
rollback;
