begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

reset role;
insert into public.user_accounts (
  user_id, auth_user_id, tenant_id, property_id, login_id, account_status, must_change_password
) values (
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000103',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'property-manager',
  'active',
  false
);
update public.properties
set brand='Synthetic Brand', city='Shanghai', timezone='Asia/Shanghai'
where id='20000000-0000-0000-0000-000000000011';
update public.positions
set is_active=false
where property_id='20000000-0000-0000-0000-000000000011';

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';

select lives_ok(
  $$select public.complete_property_initialization(
    '20000000-0000-0000-0000-000000000011'::uuid,
    (select version from public.property_settings where property_id='20000000-0000-0000-0000-000000000011')
  )$$,
  'minimal activation completes without active positions, workbook, or resolved mappings'
);
select results_eq(
  $$select initialization_state::text from public.property_settings
    where property_id='20000000-0000-0000-0000-000000000011'$$,
  $$values ('ready'::text)$$,
  'completed activation is ready'
);
select results_eq(
  $$select initialization_last_active_step from public.property_settings
    where property_id='20000000-0000-0000-0000-000000000011'$$,
  array[5::smallint],
  'finite activation finishes at review step five'
);
select results_eq(
  $$select public.get_property_initialization_progress('20000000-0000-0000-0000-000000000011'::uuid)->>'state'$$,
  $$values ('ready'::text)$$,
  'progress response exposes the authoritative activation state'
);
select lives_ok(
  $$select public.save_property_initialization_step(
    '20000000-0000-0000-0000-000000000011'::uuid,
    'organization',
    2::smallint,
    true,
    null,
    null,
    (select version from public.property_settings where property_id='20000000-0000-0000-0000-000000000011')
  )$$,
  'completed activation remains reviewable'
);
select results_eq(
  $$select initialization_state::text from public.property_settings
    where property_id='20000000-0000-0000-0000-000000000011'$$,
  $$values ('ready'::text)$$,
  'reviewing a completed activation never regresses it to in progress'
);
select throws_ok(
  $$select public.save_property_initialization_navigation(
    '20000000-0000-0000-0000-000000000011'::uuid,
    6::smallint,
    (select version from public.property_settings where property_id='20000000-0000-0000-0000-000000000011')
  )$$,
  'P4020',
  null,
  'finite activation rejects navigation beyond step five'
);

reset role;
update public.properties
set brand='Synthetic Brand', city='Shanghai', timezone='Asia/Shanghai'
where id='20000000-0000-0000-0000-000000000012';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000102';
select throws_ok(
  $$select public.complete_property_initialization(
    '20000000-0000-0000-0000-000000000012'::uuid,
    (select version from public.property_settings where property_id='20000000-0000-0000-0000-000000000012')
  )$$,
  'P4017',
  null,
  'activation requires an active hotel L&D manager account'
);

reset role;
update public.departments
set is_active=false
where property_id='20000000-0000-0000-0000-000000000011';
update public.property_settings
set initialization_state='in_progress',
    initialization_completed_at=null,
    initialization_completed_by=null
where property_id='20000000-0000-0000-0000-000000000011';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select throws_ok(
  $$select public.complete_property_initialization(
    '20000000-0000-0000-0000-000000000011'::uuid,
    (select version from public.property_settings where property_id='20000000-0000-0000-0000-000000000011')
  )$$,
  'P4013',
  null,
  'activation requires at least one active official department'
);

reset role;
select results_eq(
  $$select count(*) from public.user_accounts account
    join public.employees employee on employee.id=account.employee_id$$,
  array[0::bigint],
  'employee records do not automatically receive backend accounts'
);

select * from finish();
rollback;
