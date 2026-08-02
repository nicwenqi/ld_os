begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table(
  'public',
  'platform_account_management_events',
  'platform account lifecycle audit table exists'
);
select has_function(
  'public', 'platform_list_properties', array[]::text[],
  'platform Property overview RPC exists'
);
select has_function(
  'public', 'platform_list_property_manager_accounts', array['uuid'],
  'platform Property manager account projection RPC exists'
);
select has_function(
  'public', 'platform_create_property_manager_account',
  array['uuid','uuid','text','text','text','text'],
  'platform Manager create RPC exists'
);
select has_function(
  'public', 'platform_prepare_manager_password_reset',
  array['uuid','uuid','bigint','text'],
  'platform password reset preparation RPC exists'
);
select has_function(
  'public', 'platform_record_manager_password_reset_result',
  array['uuid','boolean','text'],
  'platform password reset result RPC exists'
);
select has_function(
  'public', 'platform_set_property_manager_status',
  array['uuid','uuid','bigint','text','text'],
  'platform Manager status RPC exists'
);
select has_function(
  'public', 'platform_replace_property_manager',
  array['uuid','uuid','uuid','text','text','text','text'],
  'platform Manager replacement RPC exists'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'user_accounts'
      and indexname = 'user_accounts_normalized_login_global_uidx'
      and indexdef ilike '%unique%normalized_login_id%'
  ),
  'Manager User ID has a global uniqueness index'
);
select ok(
  coalesce((
    select relrowsecurity and relforcerowsecurity
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'platform_account_management_events'
  ), false),
  'platform account lifecycle audit table enables and forces RLS'
);
select results_eq(
  $$select count(*)
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'platform_account_management_events'
      and grantee in ('anon', 'authenticated', 'service_role')
      and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')$$,
  array[0::bigint],
  'platform account audit table has no direct browser or service-role grants'
);

select results_eq(
  $$select count(*)
    from information_schema.routine_privileges
    where specific_schema = 'public'
      and routine_name like 'platform_%property%'
      and grantee in ('anon', 'service_role')
      and privilege_type = 'EXECUTE'$$,
  array[0::bigint],
  'platform account RPCs are not callable by anonymous or service-role sessions'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';

select ok(
  (select value ? 'propertyId'
   from jsonb_array_elements(public.platform_list_properties()) value
   limit 1),
  'platform admin can read a Property metadata projection'
);
select ok(
  not exists (
    select 1
    from jsonb_array_elements(public.platform_list_properties()) value,
      jsonb_object_keys(value) key
    where key in (
      'employeeId','employees','departments','departmentScopes','scopes',
      'requirements','plans','sessions','attendance','completion',
      'internalEmail','authUserId','targetAuthUserId'
    )
  ),
  'Property projection excludes hotel business data and private Auth identity fields'
);
select ok(
  not exists (
    select 1
    from jsonb_array_elements(public.platform_list_property_manager_accounts(
      '20000000-0000-0000-0000-000000000011'::uuid
    )) value,
      jsonb_object_keys(value) key
    where key in ('internalEmail','authUserId','targetAuthUserId','employeeId','departmentScopes','scopes')
  ),
  'Manager projection excludes internal email, Auth UUID and department scopes'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$select public.platform_list_properties()$$,
  '42501', null,
  'Hotel L&D Manager cannot use Platform Admin Property projection'
);
select throws_ok(
  $$select public.platform_list_property_manager_accounts('20000000-0000-0000-0000-000000000011'::uuid)$$,
  '42501', null,
  'Hotel L&D Manager cannot use Platform account projection'
);

reset role;
select results_eq(
  $$select count(distinct trigger_name)
    from information_schema.triggers
    where trigger_schema = 'public'
      and event_object_table = 'platform_account_management_events'
      and trigger_name = 'platform_account_management_events_append_only'$$,
  array[1::bigint],
  'platform account audit evidence has an append-only trigger'
);

select * from finish();
rollback;
