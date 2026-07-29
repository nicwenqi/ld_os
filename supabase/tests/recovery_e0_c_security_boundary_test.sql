begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- The seed provides the manager's membership and role. C0 must preserve
-- existing manager behavior once its active backend account exists.
reset role;
insert into public.user_accounts(
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values (
  '79000000-0000-0000-0000-00000000c001',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000103',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'c0-manager',
  'active',
  false
);

-- C0 exposes one platform-plane capability without making it a hotel role.
select has_function(
  'app_private',
  'is_platform_provisioner',
  array[]::text[],
  'C0 exposes a platform-only provisioning predicate'
);
select has_function(
  'app_private',
  'assert_platform_provisioner',
  array[]::text[],
  'C0 exposes a platform-only provisioning assertion'
);
select has_function(
  'public',
  'provision_initial_property_and_manager',
  array['uuid', 'jsonb', 'jsonb'],
  'C0 exposes one narrow Property-and-initial-manager provisioning RPC'
);
select has_table(
  'public',
  'platform_provisioning_events',
  'C0 retains append-only platform provisioning audit evidence'
);

-- The synthetic platform administrator from seed.sql has no hotel account,
-- membership or hotel role. Platform membership alone must grant no hotel
-- business authority.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';

select results_eq(
  'select count(*) from public.property_settings',
  array[0::bigint],
  'platform administrator cannot read hotel business settings'
);
select results_eq(
  'select count(*) from public.departments',
  array[0::bigint],
  'platform administrator cannot read hotel organization data'
);
select results_eq(
  'select count(*) from public.positions',
  array[0::bigint],
  'platform administrator cannot read hotel position data'
);
select results_eq(
  'select count(*) from public.user_accounts',
  array[0::bigint],
  'platform administrator cannot read hotel backend account data'
);
select results_eq(
  'select count(*) from public.role_assignments',
  array[0::bigint],
  'platform administrator cannot read hotel role assignments'
);
select results_eq(
  'select count(*) from public.trainer_scopes',
  array[0::bigint],
  'platform administrator cannot read hotel department scopes'
);
select results_eq(
  'select count(*) from public.employees',
  array[0::bigint],
  'platform administrator cannot read employee business data'
);
select results_eq(
  'select count(*) from public.import_batches',
  array[0::bigint],
  'platform administrator cannot read employee import data'
);

select results_eq(
  $$with changed as (
      update public.property_settings
      set new_employee_days = 91
      where property_id = '20000000-0000-0000-0000-000000000011'
      returning id
    )
    select count(*) from changed$$,
  array[0::bigint],
  'platform administrator cannot modify hotel configuration'
);
select throws_ok(
  $$select public.save_property_initialization_navigation(
    '20000000-0000-0000-0000-000000000011', 1::smallint, null::bigint
  )$$,
  'P4021', null,
  'platform administrator cannot advance hotel activation'
);
select throws_ok(
  $$select public.create_property_backend_account_foundation(
    '20000000-0000-0000-0000-000000000011',
    '00000000-0000-0000-0000-000000000101',
    'platform-admin@example.test',
    'platform-admin',
    'Platform',
    'property_ld_manager',
    '[]'::jsonb
  )$$,
  'P5001', null,
  'platform administrator cannot grant itself a hotel role through account administration'
);

select ok(
  not app_private.can_manage_property_brand_object(
    '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/branding/90000000-0000-0000-0000-000000000001/logo-v1.png'
  ),
  'platform administrator cannot manage hotel brand Storage objects'
);
select ok(
  not app_private.can_manage_property_import_object(
    '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/81000000-0000-0000-0000-000000000001/workbook.xlsx'
  ),
  'platform administrator cannot manage private employee workbook objects'
);

-- Tenant-admin is legacy infrastructure only, not implicit hotel authority.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000102';
select results_eq(
  'select count(*) from public.property_settings',
  array[0::bigint],
  'tenant administrator has no implicit hotel settings access'
);
select results_eq(
  'select count(*) from public.departments',
  array[0::bigint],
  'tenant administrator has no implicit hotel organization access'
);
select throws_ok(
  $$select public.save_property_initialization_navigation(
    '20000000-0000-0000-0000-000000000011', 1::smallint, null::bigint
  )$$,
  'P4021', null,
  'tenant administrator cannot advance hotel activation'
);

-- Existing hotel-plane roles keep their prior capability. This test does not
-- create any employee or D1-D4 fact.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select ok(
  app_private.can_manage_property('20000000-0000-0000-0000-000000000011'),
  'active Hotel L&D Manager retains hotel administration authority'
);
select results_eq(
  'select count(*) from public.property_settings',
  array[1::bigint],
  'active Hotel L&D Manager can still read its own hotel settings'
);

reset role;

select ok(
  coalesce((
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'platform_provisioning_events'
  ), false),
  'platform provisioning audit evidence enables and forces RLS'
);
select results_eq(
  $$select count(*)
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'platform_provisioning_events'
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')$$,
  array[0::bigint],
  'browser roles cannot mutate platform provisioning audit evidence directly'
);
select results_eq(
  $$select count(*)
    from information_schema.routine_privileges
    where grantee = 'anon'
      and specific_schema = 'public'
      and routine_name = 'provision_initial_property_and_manager'
      and privilege_type = 'EXECUTE'$$,
  array[0::bigint],
  'anonymous callers cannot execute the provisioning RPC'
);

select * from finish();
rollback;
