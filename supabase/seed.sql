-- Local-only synthetic security fixtures. No real hotel, employee, or production user data.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current,
  reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', fixture.id, 'authenticated', 'authenticated',
  fixture.email, extensions.crypt('local-test-only', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false,
  '', '', '', '', '', '', '', ''
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
  ('00000000-0000-0000-0000-000000000103'::uuid, 'property_ld_manager', '10000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000011'::uuid)
) as fixture(user_id, role_code, tenant_id, property_id)
join public.roles on roles.code = fixture.role_code
on conflict do nothing;

insert into public.property_domains (
  id, tenant_id, property_id, hostname, subdomain, is_primary, verification_status, is_active, verified_at
) values
  ('40000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'demo-a1.example.test', 'demo-a1', true, 'verified', true, now()),
  ('40000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', 'demo-a2.example.test', 'demo-a2', true, 'verified', true, now()),
  ('40000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021', 'demo-b1.example.test', 'demo-b1', true, 'verified', true, now())
on conflict (id) do nothing;

insert into public.property_settings (
  id, tenant_id, property_id, new_employee_days, probation_field_meaning,
  employee_status_source, ctc_mandatory, gtc_mandatory, initialization_state
) values
  ('50000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 90, 'confirmation_date', 'manual', true, true, 'in_progress'),
  ('50000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', 90, 'confirmation_date', 'manual', true, true, 'in_progress'),
  ('50000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021', 90, 'confirmation_date', 'manual', true, true, 'in_progress')
on conflict (id) do nothing;

-- Review Stop 2C-B synthetic organization fixtures only.
insert into public.departments (
  id, tenant_id, property_id, parent_id, node_type, code, name_zh, name_en, sort_order
) values
  ('61000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', null, 'division', 'rooms', '房务部', 'Rooms', 10),
  ('61000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '61000000-0000-0000-0000-000000000011', 'department', 'front-office', '前厅部', 'Front Office', 10),
  ('61000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '61000000-0000-0000-0000-000000000012', 'section', 'concierge', '礼宾部', 'Concierge', 10),
  ('61000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '61000000-0000-0000-0000-000000000012', 'section', 'front-desk', '前台', 'Front Desk', 20),
  ('61000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '61000000-0000-0000-0000-000000000011', 'department', 'housekeeping', '客房部', 'Housekeeping', 20),
  ('61000000-0000-0000-0000-000000000016', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '61000000-0000-0000-0000-000000000015', 'team', 'floor', '楼层', 'Floor', 10),
  ('61000000-0000-0000-0000-000000000017', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', null, 'department', 'finance', '财务部', 'Finance', 20),
  ('61000000-0000-0000-0000-000000000018', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', null, 'department', 'engineering', '工程部', 'Engineering', 30),
  ('61000000-0000-0000-0000-000000000019', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', null, 'division', 'food-beverage', '餐饮部', 'Food & Beverage', 40),
  ('61000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', null, 'department', 'finance', '财务部', 'Finance', 10),
  ('61000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000021', null, 'division', 'rooms', '房务部', 'Rooms', 10)
on conflict (id) do nothing;

insert into public.department_aliases (
  id, tenant_id, property_id, source_system, source_value, normalized_source_value,
  target_department_id, resolution_type, approved_by, approved_at, is_active
) values
  ('62000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'synthetic-workbook', 'Rooms Division Administration', 'rooms division administration', '61000000-0000-0000-0000-000000000011', 'mapped', '00000000-0000-0000-0000-000000000103', now(), true),
  ('62000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'synthetic-workbook', 'Floor', 'floor', '61000000-0000-0000-0000-000000000016', 'mapped', '00000000-0000-0000-0000-000000000103', now(), true),
  ('62000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'synthetic-workbook', 'Marketing & Commnuications', 'marketing & commnuications', null, 'deferred', null, null, true),
  ('62000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'synthetic-workbook', 'Pruchasing', 'pruchasing', null, 'ignored', '00000000-0000-0000-0000-000000000103', now(), true)
on conflict (id) do nothing;

insert into public.operational_units (
  id, tenant_id, property_id, department_id, unit_type, code, name_zh, name_en, sort_order
) values (
  '63000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011', '61000000-0000-0000-0000-000000000019',
  'outlet', 'bar-168', '示范酒吧 168', 'Bar 168', 10
) on conflict (id) do nothing;

insert into public.operational_unit_aliases (
  id, tenant_id, property_id, source_system, source_value, normalized_source_value,
  operational_unit_id, approved_by, approved_at, is_active
) values (
  '63100000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011', 'synthetic-workbook', 'Bar 168', 'bar 168',
  '63000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000103', now(), true
) on conflict (id) do nothing;

insert into public.position_families (
  id, tenant_id, property_id, code, name_zh, name_en, description, sort_order
) values
  ('64000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'manager', '管理人员', 'Manager', 'Synthetic leadership family', 10),
  ('64000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'supervisor', '主管人员', 'Supervisor', 'Synthetic supervisory family', 20),
  ('64000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'associate', '一线员工', 'Associate', 'Synthetic operational family', 30),
  ('64000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'culinary', '厨房岗位', 'Culinary', 'Synthetic culinary family', 40),
  ('64000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'engineering', '工程岗位', 'Engineering', 'Synthetic engineering family', 50)
on conflict (id) do nothing;

insert into public.positions (
  id, tenant_id, property_id, position_family_id, code, name_zh, name_en, grade_or_band
) values
  ('65000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '64000000-0000-0000-0000-000000000011', 'front-office-manager', '前厅部经理', 'Front Office Manager', 'M2'),
  ('65000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '64000000-0000-0000-0000-000000000012', 'concierge-supervisor', '礼宾主管', 'Concierge Supervisor', 'S1'),
  ('65000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '64000000-0000-0000-0000-000000000013', 'guest-service-associate', '宾客服务专员', 'Guest Service Associate', 'A2'),
  ('65000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '64000000-0000-0000-0000-000000000015', 'engineer', '工程技工', 'Engineer', 'T2'),
  ('65000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '64000000-0000-0000-0000-000000000014', 'chef-de-partie', '厨房主管', 'Chef de Partie', 'C2')
on conflict (id) do nothing;

insert into public.position_department_assignments (
  tenant_id, property_id, position_id, department_id, is_primary
) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '65000000-0000-0000-0000-000000000011', '61000000-0000-0000-0000-000000000012', true),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '65000000-0000-0000-0000-000000000012', '61000000-0000-0000-0000-000000000013', true),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '65000000-0000-0000-0000-000000000013', '61000000-0000-0000-0000-000000000014', true),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '65000000-0000-0000-0000-000000000014', '61000000-0000-0000-0000-000000000018', true),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '65000000-0000-0000-0000-000000000015', '61000000-0000-0000-0000-000000000019', true)
on conflict (position_id, department_id) do nothing;

insert into public.position_aliases (
  id, tenant_id, property_id, source_system, source_value, normalized_source_value,
  target_position_id, target_position_family_id, external_role_code, external_role_name,
  resolution_status, approved_by, approved_at, is_active
) values
  ('67000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'synthetic-workbook', 'FO Mgr', 'fo mgr', '65000000-0000-0000-0000-000000000011', '64000000-0000-0000-0000-000000000011', null, null, 'mapped', '00000000-0000-0000-0000-000000000103', now(), true),
  ('67000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'synthetic-workbook', 'Guest Service Agent', 'guest service agent', '65000000-0000-0000-0000-000000000013', '64000000-0000-0000-0000-000000000013', null, null, 'mapped', '00000000-0000-0000-0000-000000000103', now(), true),
  ('67000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'synthetic-workbook', 'Legacy Job Label', 'legacy job label', null, null, null, null, 'deferred', null, null, true)
on conflict (id) do nothing;
