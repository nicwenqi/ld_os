begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select has_table('public','property_initialization_steps','wizard step metadata table exists');
select has_function('public','get_property_initialization_progress',array['uuid'],'wizard progress reader exists');
select has_function('public','save_property_initialization_step',array['uuid','text','smallint','boolean','text','text','bigint'],'wizard step save RPC exists');

set local role anon;
select throws_ok('select * from public.property_initialization_steps','42501',null,'anonymous cannot list wizard progress metadata');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select is_empty('select * from public.property_initialization_steps','ordinary property member cannot read wizard metadata');

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select lives_ok($$select public.save_property_initialization_step('20000000-0000-0000-0000-000000000011'::uuid,'positions'::text,5::smallint,true,null::text,null::text,null::bigint)$$,'property L&D manager can save own wizard confirmation');
select results_eq($$select (public.get_property_initialization_progress('20000000-0000-0000-0000-000000000011')->>'lastActiveStep')::int$$,array[5],'progress returns the persisted last step');
select throws_ok($$select public.save_property_initialization_step('20000000-0000-0000-0000-000000000012'::uuid,'positions'::text,5::smallint,true,null::text,null::text,null::bigint)$$,'P4002',null,'property L&D manager cannot save another property wizard step');

select * from finish();
rollback;
