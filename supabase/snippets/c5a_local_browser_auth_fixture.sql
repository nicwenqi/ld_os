-- Disposable local-only C5-A browser fixture.
-- It creates backend authentication bindings and one department scope only.
-- It creates no employee, Course, Requirement, Plan, Session, Attendance or
-- Completion fact and must be destroyed with `supabase stop --no-backup`.

update auth.users
set encrypted_password = extensions.crypt(
      :'c5a_password', extensions.gen_salt('bf')
    ),
    confirmation_token = '',
    recovery_token = '',
    email_change_token_new = '',
    email_change = '',
    phone_change = '',
    phone_change_token = '',
    email_change_token_current = '',
    reauthentication_token = '',
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    updated_at = now()
where id in (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000104'
);

insert into auth.identities(
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  user_row.id,
  user_row.id,
  user_row.email,
  jsonb_build_object(
    'sub', user_row.id::text,
    'email', user_row.email,
    'email_verified', true,
    'phone_verified', false
  ),
  'email', now(), now(), now()
from auth.users user_row
where user_row.id in (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000104'
)
on conflict (provider_id, provider) do update
set identity_data = excluded.identity_data,
    updated_at = now();

insert into public.user_accounts(
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values
  (
    '79000000-0000-0000-0000-00000000b101',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000103',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'c5a-manager', 'active', false
  ),
  (
    '79000000-0000-0000-0000-00000000b102',
    '00000000-0000-0000-0000-000000000104',
    '00000000-0000-0000-0000-000000000104',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'c5a-department', 'active', false
  )
on conflict (property_id, normalized_login_id) do update
set account_status = 'active', must_change_password = false;

insert into public.role_assignments(
  id, user_id, role_id, tenant_id, property_id, status, granted_at
)
select
  '79000000-0000-0000-0000-00000000b201',
  '00000000-0000-0000-0000-000000000104',
  role.id,
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'active', now()
from public.roles role
where role.code = 'department_training_admin'
on conflict do nothing;

insert into public.trainer_scopes(
  id, role_assignment_id, tenant_id, property_id, department_id,
  include_descendants, is_active
) values (
  '79000000-0000-0000-0000-00000000b301',
  '79000000-0000-0000-0000-00000000b201',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '61000000-0000-0000-0000-000000000012',
  true, true
)
on conflict (role_assignment_id, department_id) do update
set include_descendants = excluded.include_descendants,
    is_active = true,
    revoked_at = null;
