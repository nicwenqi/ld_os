begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- C5-B fixtures are rollback-bound authorization records only. They create no
-- employee or D0-D4 business fact.
reset role;
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
    'c5b-manager', 'active', false
  ),
  (
    '79000000-0000-0000-0000-00000000b102',
    '00000000-0000-0000-0000-000000000104',
    '00000000-0000-0000-0000-000000000104',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000011',
    'c5b-department', 'active', false
  );

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
where role.code = 'department_training_admin';

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
);

select has_function(
  'public', 'get_property_initialization_access_summary', array['uuid'],
  'C5-B exposes one narrow authenticated initialization-access projection'
);

select results_eq(
  $$select count(*)
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'get_property_initialization_access_summary'
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and procedure.proconfig = array['search_path=""']::text[]$$,
  array[1::bigint],
  'the projection is stable SECURITY DEFINER with an empty search path'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_property_initialization_access_summary(uuid)',
    'EXECUTE'
  ),
  'authenticated hotel actors may invoke the bounded projection'
);

select ok(
  not has_function_privilege(
    'anon', 'public.get_property_initialization_access_summary(uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.get_property_initialization_access_summary(uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'public', 'public.get_property_initialization_access_summary(uuid)', 'EXECUTE'
  ),
  'anonymous, technical and PUBLIC roles receive no initialization projection capability'
);

select results_eq(
  $$select count(*)
    from information_schema.role_table_grants
    where grantee = 'service_role'
      and table_schema = 'public'
      and table_name in (
        'user_accounts', 'profiles', 'tenant_memberships',
        'property_memberships', 'roles', 'role_assignments',
        'trainer_scopes', 'employees', 'import_batches',
        'course_versions', 'requirement_versions', 'training_plans',
        'training_sessions', 'attendance_registers', 'completion_records'
      )
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')$$,
  array[0::bigint],
  'C5-B adds no service_role table grant or hotel-business bypass'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';
set local request.jwt.claim.role = 'authenticated';

select is(
  public.get_property_initialization_access_summary(
    '20000000-0000-0000-0000-000000000011'
  ),
  jsonb_build_object(
    'currentManager', jsonb_build_object(
      'displayName', 'Property A1 L&D Manager',
      'loginId', 'c5b-manager',
      'accountStatus', 'active'
    ),
    'activePropertyManagers', 1,
    'activeDepartmentAdministrators', 1,
    'activeDepartmentAdministratorsWithScope', 1,
    'departmentScopesResolved', true,
    'canConfirm', true
  ),
  'manager receives the unchanged initialization readiness projection for their hotel'
);

select throws_ok(
  $$select public.get_property_initialization_access_summary(
    '20000000-0000-0000-0000-000000000012'
  )$$,
  '42501', null,
  'manager cannot project initialization access for another property'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000104';
select throws_ok(
  $$select public.get_property_initialization_access_summary(
    '20000000-0000-0000-0000-000000000011'
  )$$,
  '42501', null,
  'department responsible person cannot read manager-only initialization readiness'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select throws_ok(
  $$select public.get_property_initialization_access_summary(
    '20000000-0000-0000-0000-000000000011'
  )$$,
  '42501', null,
  'platform identity has no hotel initialization authority'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000102';
select throws_ok(
  $$select public.get_property_initialization_access_summary(
    '20000000-0000-0000-0000-000000000011'
  )$$,
  '42501', null,
  'legacy tenant administrator has no implicit hotel initialization authority'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok(
  $$select public.get_property_initialization_access_summary(
    '20000000-0000-0000-0000-000000000011'
  )$$,
  '42501', null,
  'missing authenticated user identity is denied'
);

reset role;
select ok(
  position('employee_fact_versions' in pg_get_functiondef(
    'public.get_property_initialization_access_summary(uuid)'::regprocedure
  )) = 0
  and position('requirement_versions' in pg_get_functiondef(
    'public.get_property_initialization_access_summary(uuid)'::regprocedure
  )) = 0
  and position('training_plans' in pg_get_functiondef(
    'public.get_property_initialization_access_summary(uuid)'::regprocedure
  )) = 0
  and position('training_sessions' in pg_get_functiondef(
    'public.get_property_initialization_access_summary(uuid)'::regprocedure
  )) = 0
  and position('attendance_' in pg_get_functiondef(
    'public.get_property_initialization_access_summary(uuid)'::regprocedure
  )) = 0
  and position('completion_' in pg_get_functiondef(
    'public.get_property_initialization_access_summary(uuid)'::regprocedure
  )) = 0,
  'the initialization projection is independent of D0-D4 facts'
);

select * from finish();
rollback;
