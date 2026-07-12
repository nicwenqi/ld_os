-- Local-only synthetic security fixtures. No real hotel, employee, or production user data.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
)
select
  '00000000-0000-0000-0000-000000000000', fixture.id, 'authenticated', 'authenticated',
  fixture.email, extensions.crypt('local-test-only', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
from (values
  ('00000000-0000-0000-0000-000000000101'::uuid, 'platform-admin@example.test'),
  ('00000000-0000-0000-0000-000000000102'::uuid, 'tenant-a-admin@example.test'),
  ('00000000-0000-0000-0000-000000000103'::uuid, 'property-a1-ld@example.test'),
  ('00000000-0000-0000-0000-000000000104'::uuid, 'property-a1-member@example.test'),
  ('00000000-0000-0000-0000-000000000105'::uuid, 'property-a2-member@example.test'),
  ('00000000-0000-0000-0000-000000000106'::uuid, 'property-b1-member@example.test')
) as fixture(id, email)
on conflict (id) do nothing;

insert into public.profiles (id, email, display_name) values
  ('00000000-0000-0000-0000-000000000101', 'platform-admin@example.test', 'Platform Admin'),
  ('00000000-0000-0000-0000-000000000102', 'tenant-a-admin@example.test', 'Tenant A Admin'),
  ('00000000-0000-0000-0000-000000000103', 'property-a1-ld@example.test', 'Property A1 L&D Manager'),
  ('00000000-0000-0000-0000-000000000104', 'property-a1-member@example.test', 'Property A1 Member'),
  ('00000000-0000-0000-0000-000000000105', 'property-a2-member@example.test', 'Property A2 Member'),
  ('00000000-0000-0000-0000-000000000106', 'property-b1-member@example.test', 'Tenant B Member')
on conflict (id) do nothing;

insert into public.platform_memberships (user_id, role_code, is_active, granted_at) values
  ('00000000-0000-0000-0000-000000000101', 'platform_admin', true, now())
on conflict (user_id, role_code) do nothing;

insert into public.tenants (id, code, name, status) values
  ('10000000-0000-0000-0000-000000000001', 'tenant-a', 'Synthetic Tenant A', 'active'),
  ('10000000-0000-0000-0000-000000000002', 'tenant-b', 'Synthetic Tenant B', 'active')
on conflict (id) do nothing;

insert into public.properties (id, tenant_id, code, name_zh, name_en, status) values
  ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'a1', '测试酒店 A1', 'Synthetic Property A1', 'active'),
  ('20000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 'a2', '测试酒店 A2', 'Synthetic Property A2', 'active'),
  ('20000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000002', 'b1', '测试酒店 B1', 'Synthetic Property B1', 'active')
on conflict (id) do nothing;

insert into public.tenant_memberships (tenant_id, user_id, status) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000102', 'active'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000103', 'active'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000104', 'active'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000105', 'active'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000106', 'active')
on conflict (tenant_id, user_id) do nothing;

insert into public.property_memberships (tenant_id, property_id, user_id, status) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000103', 'active'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000104', 'active'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000105', 'active'),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000106', 'active')
on conflict (property_id, user_id) do nothing;

insert into public.role_assignments (user_id, role_id, tenant_id, property_id, status, granted_at)
select fixture.user_id, roles.id, fixture.tenant_id, fixture.property_id, 'active', now()
from (values
  ('00000000-0000-0000-0000-000000000102'::uuid, 'tenant_admin', '10000000-0000-0000-0000-000000000001'::uuid, null::uuid),
  ('00000000-0000-0000-0000-000000000103'::uuid, 'property_ld_manager', '10000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000011'::uuid),
  ('00000000-0000-0000-0000-000000000104'::uuid, 'property_member', '10000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000011'::uuid),
  ('00000000-0000-0000-0000-000000000105'::uuid, 'property_member', '10000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000012'::uuid),
  ('00000000-0000-0000-0000-000000000106'::uuid, 'property_member', '10000000-0000-0000-0000-000000000002'::uuid, '20000000-0000-0000-0000-000000000021'::uuid)
) as fixture(user_id, role_code, tenant_id, property_id)
join public.roles on roles.code = fixture.role_code
on conflict do nothing;
