insert into public.roles (code, name_zh, name_en, scope_level, permission_codes, is_system, is_active)
values
  ('tenant_admin', '租户管理员', 'Tenant Administrator', 'tenant',
    array['tenant:read', 'property:manage', 'membership:manage', 'role:grant_property'], true, true),
  ('property_ld_manager', '酒店学习与发展经理', 'Property L&D Manager', 'property',
    array['property:read', 'membership:read', 'organization:manage', 'people:manage', 'import:manage'], true, true),
  ('department_training_admin', '部门培训管理员', 'Department Training Administrator', 'department',
    array['property:read', 'people:read_scope', 'training:manage_scope'], true, true),
  ('property_member', '酒店成员', 'Property Member', 'property',
    array['property:read', 'profile:read_self'], true, true),
  ('employee_participant', '员工学员', 'Employee Participant', 'property',
    array['property:read', 'profile:read_self', 'learning:read_self'], true, true)
on conflict (code) do update set
  name_zh = excluded.name_zh,
  name_en = excluded.name_en,
  scope_level = excluded.scope_level,
  permission_codes = excluded.permission_codes,
  is_system = excluded.is_system,
  is_active = excluded.is_active,
  updated_at = now();
