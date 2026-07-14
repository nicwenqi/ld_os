begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select has_column('public','department_aliases','source_batch_id','department source labels retain batch audit');
select has_column('public','department_aliases','source_sheet','department source labels retain sheet audit');
select has_column('public','department_aliases','source_row_count','department source labels retain impact count');
select has_column('public','position_aliases','source_batch_id','position source labels retain batch audit');
select has_column('public','position_aliases','source_sheet','position source labels retain sheet audit');
select has_column('public','position_aliases','source_row_count','position source labels retain impact count');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select is_empty('select * from public.department_aliases','ordinary member cannot inspect department source labels');
select is_empty('select * from public.position_aliases','ordinary member cannot inspect position source labels');

select * from finish();
rollback;
