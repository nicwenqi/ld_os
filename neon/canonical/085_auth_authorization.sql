begin;
set local role hotel_ld_migration_owner;

create function public.read_neon_authorization_session(p_hostname text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_context_tenant_id uuid;
  v_context_property_id uuid;
  v_property_name_zh text;
  v_property_name_en text;
  v_property_logo_url text;
  v_user_id uuid;
  v_tenant_id uuid;
  v_display_name text;
  v_must_change_password boolean;
  v_role text := 'unauthorized';
  v_scopes jsonb := '[]'::jsonb;
  v_session jsonb;
begin
  perform app_private.assert_actor_context();

  select context.tenant_id, context.property_id, context.name_zh, context.name_en, context.logo_url
    into v_context_tenant_id, v_context_property_id, v_property_name_zh, v_property_name_en, v_property_logo_url
  from public.resolve_neon_property_context(p_hostname) context;
  if v_context_property_id is null
    or v_context_property_id is distinct from app_private.current_actor_property_id() then
    raise exception using errcode = '42501', message = 'NEON_AUTHORIZATION_SCOPE_DENIED';
  end if;

  if app_private.neon_people_actor_is_active() then
    select account.user_id, account.tenant_id, profile.display_name, account.must_change_password
      into v_user_id, v_tenant_id, v_display_name, v_must_change_password
    from public.user_accounts account
    join public.profiles profile
      on profile.id = account.user_id and profile.is_active
    join public.tenant_memberships tenant_membership
      on tenant_membership.tenant_id = account.tenant_id
      and tenant_membership.user_id = account.user_id
      and tenant_membership.status = 'active'
    join public.property_memberships property_membership
      on property_membership.tenant_id = account.tenant_id
      and property_membership.property_id = account.property_id
      and property_membership.user_id = account.user_id
      and property_membership.status = 'active'
    where account.auth_user_id = app_private.current_actor_auth_user_id()
      and account.property_id = app_private.current_actor_property_id()
      and account.tenant_id = v_context_tenant_id
      and account.account_status = 'active'
      and (account.locked_until is null or account.locked_until <= pg_catalog.transaction_timestamp());
  end if;

  if v_user_id is null then
    perform app_private.append_neon_people_read_audit('authorization_session', 0);
    return pg_catalog.jsonb_build_object(
      'tenantId', null,
      'session', pg_catalog.jsonb_build_object(
        'authenticated', false,
        'userId', null,
        'displayName', null,
        'propertyId', null,
        'propertyNameZh', null,
        'propertyNameEn', null,
        'propertyLogoUrl', null,
        'role', 'unauthorized',
        'departmentScopes', '[]'::jsonb,
        'mustChangePassword', false
      )
    );
  end if;

  if exists (
    select 1
    from public.role_assignments assignment
    join public.roles role
      on role.tenant_id = assignment.tenant_id
      and role.id = assignment.role_id
      and role.property_id = assignment.property_id
      and role.code = 'property_ld_manager'
      and role.scope_level = 'property'
      and role.is_active
    where assignment.tenant_id = v_tenant_id
      and assignment.property_id = v_context_property_id
      and assignment.user_id = v_user_id
      and assignment.status = 'active'
  ) then
    v_role := 'property_ld_manager';
  else
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'departmentId', scoped.department_id,
          'departmentNameZh', scoped.name_zh,
          'departmentNameEn', scoped.name_en,
          'breadcrumb', pg_catalog.to_jsonb(scoped.path_names_zh),
          'breadcrumbEn', pg_catalog.to_jsonb(scoped.path_names_en),
          'includeDescendants', scoped.include_descendants
        ) order by scoped.path_ids, scoped.department_id
      ),
      '[]'::jsonb
    ) into v_scopes
    from (
      select department.id as department_id,
        department.name_zh,
        department.name_en,
        department.path_ids,
        department.path_names_zh,
        department.path_names_en,
        pg_catalog.bool_or(scope.include_descendants) as include_descendants
      from public.role_assignments assignment
      join public.roles role
        on role.tenant_id = assignment.tenant_id
        and role.id = assignment.role_id
        and role.property_id = assignment.property_id
        and role.code = 'department_training_admin'
        and role.scope_level = 'department'
        and role.is_active
      join public.trainer_scopes scope
        on scope.tenant_id = assignment.tenant_id
        and scope.property_id = assignment.property_id
        and scope.role_assignment_id = assignment.id
        and scope.is_active
      join public.departments department
        on department.tenant_id = scope.tenant_id
        and department.property_id = scope.property_id
        and department.id = scope.department_id
        and department.is_active
      where assignment.tenant_id = v_tenant_id
        and assignment.property_id = v_context_property_id
        and assignment.user_id = v_user_id
        and assignment.status = 'active'
      group by department.id, department.name_zh, department.name_en,
        department.path_ids, department.path_names_zh, department.path_names_en
    ) scoped;

    if pg_catalog.jsonb_array_length(v_scopes) > 0 then
      v_role := 'department_training_responsible';
    end if;
  end if;

  v_session := pg_catalog.jsonb_build_object(
    'authenticated', true,
    'userId', v_user_id,
    'displayName', v_display_name,
    'propertyId', v_context_property_id,
    'propertyNameZh', v_property_name_zh,
    'propertyNameEn', v_property_name_en,
    'propertyLogoUrl', v_property_logo_url,
    'role', v_role,
    'departmentScopes', v_scopes,
    'mustChangePassword', v_must_change_password
  );
  perform app_private.append_neon_people_read_audit('authorization_session', 1);
  return pg_catalog.jsonb_build_object('tenantId', v_tenant_id, 'session', v_session);
end
$function$;

revoke all on function public.read_neon_authorization_session(text) from public;
grant execute on function public.read_neon_authorization_session(text) to hotel_ld_application;

commit;
