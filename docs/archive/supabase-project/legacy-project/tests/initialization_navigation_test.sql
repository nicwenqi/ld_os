begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

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

select has_function('public','save_property_initialization_navigation',array['uuid','smallint','bigint'],'wizard navigation RPC exists');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select throws_ok(
  $$select public.save_property_initialization_navigation('20000000-0000-0000-0000-000000000011'::uuid,5::smallint,null::bigint)$$,
  'P4021',null,'ordinary member cannot change wizard navigation state'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select lives_ok(
  $$select public.save_property_initialization_step('20000000-0000-0000-0000-000000000011'::uuid,'organization'::text,4::smallint,true,null::text,null::text,null::bigint)$$,
  'manager can establish a confirmed step before navigation'
);
select lives_ok(
  $$select public.save_property_initialization_navigation('20000000-0000-0000-0000-000000000011'::uuid,5::smallint,null::bigint)$$,
  'manager can navigate to readiness review'
);
select results_eq(
  $$select (public.get_property_initialization_progress('20000000-0000-0000-0000-000000000011')->>'lastActiveStep')::int$$,
  array[5],
  'navigation persists the last active step'
);
select results_eq(
  $$select explicitly_confirmed from public.property_initialization_steps where property_id='20000000-0000-0000-0000-000000000011' and step_key='organization'$$,
  array[true],
  'navigation does not clear an existing step confirmation'
);

select * from finish();
rollback;
