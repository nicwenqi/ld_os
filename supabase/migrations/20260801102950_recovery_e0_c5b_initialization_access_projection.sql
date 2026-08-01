-- Recovery E0 C5-B: project initialization account readiness through the
-- authenticated hotel actor. This migration changes no table, RLS policy,
-- initialization business rule, or D0-D4 fact semantics.

create or replace function public.get_property_initialization_access_summary(
  p_property_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_auth_user_id uuid := (select auth.uid());
  current_manager jsonb;
  active_property_managers integer := 0;
  active_department_administrators integer := 0;
  active_department_administrators_with_scope integer := 0;
begin
  if actor_auth_user_id is null
    or not app_private.is_authorized_property_role(
      p_property_id,
      'property_ld_manager'
    ) then
    raise exception 'INITIALIZATION_MANAGER_REQUIRED' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'displayName', profile.display_name,
    'loginId', account.login_id,
    'accountStatus', account.account_status::text
  )
  into current_manager
  from public.user_accounts account
  join public.profiles profile
    on profile.id = account.user_id
   and profile.is_active
  join public.tenant_memberships tenant_membership
    on tenant_membership.tenant_id = account.tenant_id
   and tenant_membership.user_id = account.user_id
   and tenant_membership.status = 'active'
  join public.property_memberships property_membership
    on property_membership.tenant_id = account.tenant_id
   and property_membership.property_id = account.property_id
   and property_membership.user_id = account.user_id
   and property_membership.status = 'active'
  where account.auth_user_id = actor_auth_user_id
    and account.property_id = p_property_id
    and account.account_status = 'active'
    and (account.locked_until is null or account.locked_until <= now());

  with active_assignments as (
    select assignment.id, assignment.user_id, role.code
    from public.user_accounts account
    join public.profiles profile
      on profile.id = account.user_id
     and profile.is_active
    join public.tenant_memberships tenant_membership
      on tenant_membership.tenant_id = account.tenant_id
     and tenant_membership.user_id = account.user_id
     and tenant_membership.status = 'active'
    join public.property_memberships property_membership
      on property_membership.tenant_id = account.tenant_id
     and property_membership.property_id = account.property_id
     and property_membership.user_id = account.user_id
     and property_membership.status = 'active'
    join public.role_assignments assignment
      on assignment.tenant_id = account.tenant_id
     and assignment.property_id = account.property_id
     and assignment.user_id = account.user_id
     and assignment.status = 'active'
    join public.roles role
      on role.id = assignment.role_id
     and role.is_active
     and role.code in ('property_ld_manager', 'department_training_admin')
    where account.property_id = p_property_id
      and account.account_status = 'active'
      and (account.locked_until is null or account.locked_until <= now())
  )
  select
    count(distinct user_id) filter (
      where code = 'property_ld_manager'
    )::integer,
    count(distinct user_id) filter (
      where code = 'department_training_admin'
    )::integer,
    count(distinct user_id) filter (
      where code = 'department_training_admin'
        and exists (
          select 1
          from public.trainer_scopes scope
          where scope.role_assignment_id = active_assignments.id
            and scope.property_id = p_property_id
            and scope.is_active
        )
    )::integer
  into
    active_property_managers,
    active_department_administrators,
    active_department_administrators_with_scope
  from active_assignments;

  return jsonb_build_object(
    'currentManager', current_manager,
    'activePropertyManagers', active_property_managers,
    'activeDepartmentAdministrators', active_department_administrators,
    'activeDepartmentAdministratorsWithScope',
      active_department_administrators_with_scope,
    'departmentScopesResolved',
      active_department_administrators_with_scope = active_department_administrators,
    'canConfirm', active_property_managers > 0
  );
end;
$$;

comment on function public.get_property_initialization_access_summary(uuid) is
  'Manager-only initialization readiness projection derived from the authenticated hotel actor and active account, membership, role and scope facts.';

revoke all on function public.get_property_initialization_access_summary(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.get_property_initialization_access_summary(uuid)
  to authenticated;
