begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select has_table('public', 'property_brand_assets', 'property brand asset metadata exists');
select results_eq(
  $$select public from storage.buckets where id = 'property-brand-assets'$$,
  array[true],
  'branding bucket is public'
);
select is_empty(
  $$select id from storage.buckets where id = 'property-import-files'$$,
  'private import bucket is not created in Review Stop 2C-A'
);
select results_eq(
  $$select file_size_limit from storage.buckets where id = 'property-brand-assets'$$,
  array[2097152::bigint],
  'branding bucket limits logos to 2 MB'
);
select results_eq(
  $$select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'property_brand_assets_%' and cmd = 'SELECT'$$,
  array[1::bigint],
  'authenticated metadata SELECT exists for management operations, not public retrieval restriction'
);

set local role anon;
select throws_ok('select * from public.property_brand_assets', '42501', null, 'anonymous cannot list branding metadata');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select throws_ok(
  $$insert into public.property_brand_assets (
      id, tenant_id, property_id, object_path, original_file_name, mime_type, byte_size, version
    ) values (
      '60000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011',
      '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/branding/60000000-0000-0000-0000-000000000001/logo-v1.png',
      'logo.png', 'image/png', 100, 1
    )$$,
  '42501', null, 'ordinary member cannot register a branding asset'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select lives_ok(
  $$insert into public.property_brand_assets (
      id, tenant_id, property_id, object_path, original_file_name, mime_type, byte_size, version
    ) values (
      '60000000-0000-0000-0000-000000000011',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011',
      '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/branding/60000000-0000-0000-0000-000000000011/logo-v1.png',
      'synthetic-logo.png', 'image/png', 100, 1
    )$$,
  'property manager registers an asset in the assigned path'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values (
      'property-brand-assets',
      '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/branding/60000000-0000-0000-0000-000000000011/logo-v1.png',
      '00000000-0000-0000-0000-000000000103'
    )$$,
  'property manager writes Storage metadata in the assigned path'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values (
      'property-brand-assets',
      '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000012/branding/60000000-0000-0000-0000-000000000099/logo-v1.png',
      '00000000-0000-0000-0000-000000000103'
    )$$,
  '42501', null, 'property manager cannot write another property path'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values (
      'property-brand-assets',
      '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/imports/60000000-0000-0000-0000-000000000099/employees.xlsx',
      '00000000-0000-0000-0000-000000000103'
    )$$,
  '42501', null, 'private workbook paths are prohibited from branding storage'
);
select throws_ok(
  $$insert into public.property_brand_assets (
      id, tenant_id, property_id, object_path, original_file_name, mime_type, byte_size, version
    ) values (
      '60000000-0000-0000-0000-000000000012',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011',
      '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/branding/60000000-0000-0000-0000-000000000012/logo-v2.xls',
      'employees.xls', 'application/vnd.ms-excel', 100, 2
    )$$,
  '23514', null, 'private file MIME types are rejected from branding metadata'
);
select throws_ok(
  $$insert into public.property_brand_assets (
      id, tenant_id, property_id, object_path, original_file_name, mime_type, byte_size, version
    ) values (
      '60000000-0000-0000-0000-000000000013',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011',
      '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/branding/60000000-0000-0000-0000-000000000013/logo-v2.png',
      'large.png', 'image/png', 2097153, 2
    )$$,
  '23514', null, 'oversized branding files are rejected'
);
select throws_ok(
  $$insert into public.property_brand_assets (
      id, tenant_id, property_id, object_path, original_file_name, mime_type, byte_size, version
    ) values (
      '60000000-0000-0000-0000-000000000014',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011',
      'predictable/logo.png', 'logo.png', 'image/png', 100, 2
    )$$,
  '23514', null, 'branding paths must be property-owned and non-guessable'
);
select lives_ok(
  $$insert into public.property_brand_assets (
      id, tenant_id, property_id, object_path, original_file_name, mime_type, byte_size, version
    ) values (
      '60000000-0000-0000-0000-000000000015',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011',
      '10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/branding/60000000-0000-0000-0000-000000000015/logo-v2.webp',
      'synthetic-logo.webp', 'image/webp', 120, 2
    )$$,
  'a new immutable logo version is registered'
);
select results_eq(
  $$select count(*) from public.property_brand_assets
    where property_id = '20000000-0000-0000-0000-000000000011' and is_current$$,
  array[1::bigint],
  'only one logo version remains current'
);
select ok(
  (select retention_until between now() + interval '29 days' and now() + interval '31 days'
    from public.property_brand_assets where id = '60000000-0000-0000-0000-000000000011'),
  'replaced logo is retained for 30 days'
);
select results_eq(
  $$select logo_url from public.resolve_property_context('demo-a1.example.test')$$,
  $$values ('/storage/v1/object/public/property-brand-assets/10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/branding/60000000-0000-0000-0000-000000000015/logo-v2.webp'::text)$$,
  'hostname resolver returns the current public logo path'
);
select results_eq(
  $$select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'property_brand_assets_%' and cmd in ('INSERT', 'UPDATE', 'DELETE')$$,
  array[3::bigint],
  'RLS controls branding upload, update or move, and delete'
);
select results_eq(
  $$select count(*) from public.property_brand_assets
    where object_path like '%employees%' or mime_type not in ('image/png', 'image/jpeg', 'image/webp')$$,
  array[0::bigint],
  'branding metadata contains no workbook or private file'
);

select * from finish();
rollback;
