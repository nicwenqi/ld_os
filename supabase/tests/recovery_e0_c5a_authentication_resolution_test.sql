begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- C5-A is an authentication boundary only. These rollback-bound fixtures
-- create backend accounts and one department scope, never employee or
-- training-operation facts.
reset role;
insert into public.user_accounts(
  id, user_id, auth_user_id, tenant_id, property_id, login_id,
  account_status, must_change_password
) values
  (
    '79000000-0000-0000-0000-00000000a101',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000103',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'c5a-manager', 'active', false
  ),
  (
    '79000000-0000-0000-0000-00000000a102',
    '00000000-0000-0000-0000-000000000104',
    '00000000-0000-0000-0000-000000000104',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'c5a-department', 'active', false
  ),
  (
    '79000000-0000-0000-0000-00000000a103',
    '00000000-0000-0000-0000-000000000105',
    '00000000-0000-0000-0000-000000000105',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000012',
    'c5a-no-hotel-role', 'active', false
  ),
  (
    '79000000-0000-0000-0000-00000000a104',
    '00000000-0000-0000-0000-000000000106',
    '00000000-0000-0000-0000-000000000106',
    '10000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000021',
    'c5a-suspended', 'suspended', false
  );

insert into public.role_assignments(
  id, user_id, role_id, tenant_id, property_id, status, granted_at
)
select
  '79000000-0000-0000-0000-00000000a201',
  '00000000-0000-0000-0000-000000000104',
  role.id,
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  'active', now()
from public.roles role
where role.code = 'department_training_admin';

insert into public.trainer_scopes(
  id, role_assignment_id, tenant_id, property_id, department_id,
  include_descendants, is_active
) values (
  '79000000-0000-0000-0000-00000000a301',
  '79000000-0000-0000-0000-00000000a201',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000011',
  '61000000-0000-0000-0000-000000000012',
  true, true
);

select has_function(
  'public', 'resolve_hotel_login_identity', array['text', 'text'],
  'C5-A exposes one narrow pre-auth technical identity resolver'
);
select has_function(
  'public', 'resolve_hotel_application_session', array['text'],
  'C5-A exposes one actor-derived hotel session resolver'
);
select has_function(
  'public', 'record_hotel_login_success', array['text'],
  'C5-A exposes one own-account login transition'
);

select results_eq(
  $$select count(*)
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'resolve_hotel_login_identity',
        'resolve_hotel_application_session',
        'record_hotel_login_success'
      )
      and procedure.prosecdef
      and procedure.proconfig = array['search_path=""']::text[]$$,
  array[3::bigint],
  'all three bounded resolvers are SECURITY DEFINER with an empty search path'
);

select ok(
  has_function_privilege(
    'service_role', 'public.resolve_hotel_login_identity(text,text)', 'EXECUTE'
  ),
  'only the server technical role receives the pre-auth resolver capability'
);
select ok(
  not has_function_privilege(
    'anon', 'public.resolve_hotel_login_identity(text,text)', 'EXECUTE'
  ) and not has_function_privilege(
    'authenticated', 'public.resolve_hotel_login_identity(text,text)', 'EXECUTE'
  ),
  'browser roles cannot execute the private User ID mapping'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.resolve_hotel_application_session(text)', 'EXECUTE'
  ) and has_function_privilege(
    'authenticated', 'public.record_hotel_login_success(text)', 'EXECUTE'
  ),
  'authenticated actors receive only their own context and login-transition capabilities'
);
select ok(
  not has_function_privilege(
    'service_role', 'public.resolve_hotel_application_session(text)', 'EXECUTE'
  ) and not has_function_privilege(
    'service_role', 'public.record_hotel_login_success(text)', 'EXECUTE'
  ),
  'service_role cannot substitute for an authenticated hotel actor'
);
select ok(
  not has_function_privilege(
    'public', 'public.resolve_hotel_login_identity(text,text)', 'EXECUTE'
  ) and not has_function_privilege(
    'public', 'public.resolve_hotel_application_session(text)', 'EXECUTE'
  ) and not has_function_privilege(
    'public', 'public.record_hotel_login_success(text)', 'EXECUTE'
  ),
  'none of the C5-A functions retain PUBLIC execution'
);

select results_eq(
  $$select count(*)
    from information_schema.role_table_grants
    where grantee = 'service_role'
      and table_schema = 'public'
      and table_name in (
        'property_domains', 'user_accounts', 'profiles',
        'tenant_memberships', 'property_memberships', 'roles',
        'role_assignments', 'trainer_scopes', 'departments', 'employees',
        'import_batches', 'training_plans', 'training_sessions',
        'attendance_registers', 'completion_records'
      )
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')$$,
  array[0::bigint],
  'C5-A adds no service_role table privilege or business authorization bypass'
);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select is(
  public.resolve_hotel_login_identity('demo-a1.example.test', ' C5A-MANAGER '),
  jsonb_build_object('internalEmail', 'property-a1-ld@example.test'),
  'pre-auth resolution normalizes User ID and returns only the internal Auth email'
);
select is(
  public.resolve_hotel_login_identity('unknown.example.test', 'c5a-manager'),
  null::jsonb,
  'unknown hostname returns no technical identity'
);
select is(
  public.resolve_hotel_login_identity('demo-a1.example.test', 'unknown-user'),
  null::jsonb,
  'unknown User ID is indistinguishable from an unavailable property'
);
select is(
  public.resolve_hotel_login_identity('demo-b1.example.test', 'c5a-suspended'),
  null::jsonb,
  'inactive backend account cannot be resolved for password verification'
);
select throws_ok(
  'select count(*) from public.property_domains', '42501', null,
  'service_role still cannot read property domains directly'
);
select throws_ok(
  'select count(*) from public.user_accounts', '42501', null,
  'service_role still cannot read private backend accounts directly'
);
select throws_ok(
  'select count(*) from public.employees', '42501', null,
  'service_role cannot read employee business data'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
set local request.jwt.claim.role = 'authenticated';

select is(
  public.resolve_hotel_application_session('demo-a1.example.test')->>'role',
  'property_ld_manager',
  'active Hotel L&D Manager resolves from the authenticated actor and exact hostname'
);
select is(
  public.resolve_hotel_application_session('demo-a1.example.test')->>'userId',
  '00000000-0000-0000-0000-000000000103',
  'session identity is derived from auth.uid rather than a caller parameter'
);
select ok(
  not (public.resolve_hotel_application_session('demo-a1.example.test') ? 'internalEmail')
  and not (public.resolve_hotel_application_session('demo-a1.example.test') ? 'authUserId'),
  'authenticated session exposes no internal Auth identity'
);
select is(
  public.resolve_hotel_application_session('demo-a2.example.test'),
  null::jsonb,
  'authenticated manager cannot resolve a session through another property hostname'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select is(
  public.resolve_hotel_application_session('demo-a1.example.test')->>'role',
  'department_training_responsible',
  'department role resolves only from its explicit active hotel assignment'
);
select is(
  jsonb_array_length(
    public.resolve_hotel_application_session('demo-a1.example.test')->'departmentScopes'
  ),
  1,
  'department session returns only its assigned active scope root'
);
select is(
  public.resolve_hotel_application_session('demo-a1.example.test')
    ->'departmentScopes'->0->>'departmentId',
  '61000000-0000-0000-0000-000000000012',
  'department scope is server-derived and property constrained'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select is(
  public.resolve_hotel_application_session('demo-a1.example.test'),
  null::jsonb,
  'platform membership alone never resolves a hotel application session'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000102';
select is(
  public.resolve_hotel_application_session('demo-a1.example.test'),
  null::jsonb,
  'legacy tenant administrator has no implicit hotel session'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000105';
select is(
  public.resolve_hotel_application_session('demo-a2.example.test')->>'role',
  'unauthorized',
  'authenticated backend account without either approved hotel role is explicit unauthorized'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
select is(
  public.record_hotel_login_success('demo-a1.example.test')->>'recorded',
  'true',
  'manager records a login transition only after the full hotel authority resolves'
);

reset role;
select ok(
  (select last_login_at is not null and failed_login_count = 0
   from public.user_accounts
   where id = '79000000-0000-0000-0000-00000000a101'),
  'login transition updates only the authenticated account telemetry'
);
select ok(
  (select last_login_at is null
   from public.user_accounts
   where id = '79000000-0000-0000-0000-00000000a102'),
  'another account remains untouched by the login transition'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
set local request.jwt.claim.role = 'authenticated';
select throws_ok(
  $$select public.record_hotel_login_success('demo-a2.example.test')$$,
  '42501', null,
  'login transition cannot update an account through a different property hostname'
);

reset role;
select ok(
  position('training_plans' in pg_get_functiondef(
    'public.resolve_hotel_application_session(text)'::regprocedure
  )) = 0
  and position('training_sessions' in pg_get_functiondef(
    'public.resolve_hotel_application_session(text)'::regprocedure
  )) = 0
  and position('attendance_' in pg_get_functiondef(
    'public.resolve_hotel_application_session(text)'::regprocedure
  )) = 0
  and position('completion_' in pg_get_functiondef(
    'public.resolve_hotel_application_session(text)'::regprocedure
  )) = 0,
  'C5-A resolution is independent of Plan, Session, Attendance and Completion facts'
);

select * from finish();
rollback;
