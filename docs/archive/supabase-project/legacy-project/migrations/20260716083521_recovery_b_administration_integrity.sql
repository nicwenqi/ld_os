-- Recovery B: trusted administration, account authority, scoped organization
-- reads, and versioned organization mutations.

update public.roles
set name_zh = '部门培训负责人',
    name_en = 'Department Training Responsible Person',
    updated_at = now()
where code = 'department_training_admin';

update public.roles
set is_active = false,
    updated_at = now()
where code in ('employee_participant', 'property_member');

alter table public.operational_units
  add column created_by uuid references auth.users(id) on delete set null default auth.uid(),
  add column updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  add column version bigint not null default 1,
  add constraint operational_units_version_check check (version > 0);

alter table public.position_families
  add column created_by uuid references auth.users(id) on delete set null default auth.uid(),
  add column updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  add column version bigint not null default 1,
  add constraint position_families_version_check check (version > 0);

create or replace function app_private.validate_role_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_scope public.role_scope;
  selected_code text;
  selected_active boolean;
begin
  select role.scope_level, role.code, role.is_active
  into selected_scope, selected_code, selected_active
  from public.roles as role
  where role.id = new.role_id;

  if selected_scope is null then
    raise exception 'role must exist' using errcode = '23514';
  end if;
  if new.status = 'active' and not selected_active then
    raise exception 'inactive role cannot be assigned' using errcode = '23514';
  end if;

  if selected_scope = 'tenant' then
    if new.property_id is not null then
      raise exception 'tenant role cannot reference a property' using errcode = '23514';
    end if;
    if new.status = 'active' and not exists (
      select 1
      from public.tenant_memberships membership
      where membership.tenant_id = new.tenant_id
        and membership.user_id = new.user_id
        and membership.status = 'active'
    ) then
      raise exception 'tenant role requires an active tenant membership' using errcode = '23514';
    end if;
  else
    if new.property_id is null then
      raise exception 'property and department roles require a property' using errcode = '23514';
    end if;
    if new.status = 'active' and not exists (
      select 1
      from public.property_memberships membership
      join public.tenant_memberships tenant_membership
        on tenant_membership.tenant_id = membership.tenant_id
       and tenant_membership.user_id = membership.user_id
      where membership.tenant_id = new.tenant_id
        and membership.property_id = new.property_id
        and membership.user_id = new.user_id
        and membership.status = 'active'
        and tenant_membership.status = 'active'
    ) then
      raise exception 'scoped role requires an active property membership' using errcode = '23514';
    end if;
  end if;

  if new.status = 'active'
    and selected_code in ('property_ld_manager', 'department_training_admin')
    and exists (
      select 1
      from public.role_assignments assignment
      join public.roles role on role.id = assignment.role_id
      where assignment.user_id = new.user_id
        and assignment.property_id = new.property_id
        and assignment.status = 'active'
        and role.code in ('property_ld_manager', 'department_training_admin')
        and assignment.id <> new.id
    ) then
    raise exception 'only one active hotel application role is allowed per account and property'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function app_private.validate_trainer_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_active and not exists (
    select 1
    from public.role_assignments assignment
    join public.roles role on role.id = assignment.role_id
    join public.property_memberships property_membership
      on property_membership.property_id = assignment.property_id
     and property_membership.user_id = assignment.user_id
    join public.tenant_memberships tenant_membership
      on tenant_membership.tenant_id = assignment.tenant_id
     and tenant_membership.user_id = assignment.user_id
    join public.departments department
      on department.id = new.department_id
     and department.tenant_id = new.tenant_id
     and department.property_id = new.property_id
    where assignment.id = new.role_assignment_id
      and assignment.tenant_id = new.tenant_id
      and assignment.property_id = new.property_id
      and assignment.status = 'active'
      and role.code = 'department_training_admin'
      and role.scope_level = 'department'
      and role.is_active
      and property_membership.status = 'active'
      and tenant_membership.status = 'active'
      and department.is_active
  ) then
    raise exception 'active trainer scope requires an active department responsible assignment and official department'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app_private.has_department_management_scope(
  p_property_id uuid,
  p_department_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.role_assignments assignment
    join public.roles role on role.id = assignment.role_id
    join public.trainer_scopes scope
      on scope.role_assignment_id = assignment.id
     and scope.property_id = assignment.property_id
     and scope.tenant_id = assignment.tenant_id
    where assignment.user_id = (select auth.uid())
      and assignment.property_id = p_property_id
      and assignment.status = 'active'
      and role.code = 'department_training_admin'
      and role.is_active
      and scope.is_active
      and (
        scope.department_id = p_department_id
        or (
          scope.include_descendants
          and exists (
            select 1
            from public.department_closure closure
            where closure.property_id = p_property_id
              and closure.ancestor_department_id = scope.department_id
              and closure.descendant_department_id = p_department_id
          )
        )
      )
  );
$$;

create or replace function app_private.can_read_department_node(
  p_property_id uuid,
  p_department_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.can_manage_property(p_property_id)
    or app_private.has_department_management_scope(p_property_id, p_department_id)
    or exists (
      select 1
      from public.role_assignments assignment
      join public.roles role on role.id = assignment.role_id
      join public.trainer_scopes scope
        on scope.role_assignment_id = assignment.id
       and scope.property_id = assignment.property_id
       and scope.tenant_id = assignment.tenant_id
      join public.department_closure closure
        on closure.property_id = p_property_id
       and closure.ancestor_department_id = p_department_id
       and closure.descendant_department_id = scope.department_id
      where assignment.user_id = (select auth.uid())
        and assignment.property_id = p_property_id
        and assignment.status = 'active'
        and role.code = 'department_training_admin'
        and role.is_active
        and scope.is_active
    );
$$;

create or replace function app_private.can_read_scoped_position(
  p_property_id uuid,
  p_position_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.can_manage_property(p_property_id)
    or exists (
      select 1
      from public.position_department_assignments assignment
      where assignment.property_id = p_property_id
        and assignment.position_id = p_position_id
        and app_private.has_department_management_scope(
          p_property_id,
          assignment.department_id
        )
    )
    or (
      app_private.is_current_account_active(p_property_id)
      and app_private.has_property_role(
        p_property_id,
        'department_training_admin'
      )
      and exists (
        select 1
        from public.role_assignments assignment
        join public.roles role on role.id = assignment.role_id
        join public.trainer_scopes scope
          on scope.role_assignment_id = assignment.id
         and scope.property_id = assignment.property_id
         and scope.tenant_id = assignment.tenant_id
        where assignment.user_id = (select auth.uid())
          and assignment.property_id = p_property_id
          and assignment.status = 'active'
          and role.code = 'department_training_admin'
          and role.is_active
          and scope.is_active
      )
      and not exists (
        select 1
        from public.position_department_assignments assignment
        where assignment.property_id = p_property_id
          and assignment.position_id = p_position_id
      )
    );
$$;

create or replace function app_private.can_read_scoped_position_family(
  p_property_id uuid,
  p_position_family_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.can_manage_property(p_property_id)
    or exists (
      select 1
      from public.positions position
      where position.property_id = p_property_id
        and position.position_family_id = p_position_family_id
        and app_private.can_read_scoped_position(p_property_id, position.id)
    );
$$;

revoke execute on function app_private.has_department_management_scope(uuid,uuid)
  from public, anon;
revoke execute on function app_private.can_read_department_node(uuid,uuid)
  from public, anon;
revoke execute on function app_private.can_read_scoped_position(uuid,uuid)
  from public, anon;
revoke execute on function app_private.can_read_scoped_position_family(uuid,uuid)
  from public, anon;
grant execute on function app_private.has_department_management_scope(uuid,uuid)
  to authenticated;
grant execute on function app_private.can_read_department_node(uuid,uuid)
  to authenticated;
grant execute on function app_private.can_read_scoped_position(uuid,uuid)
  to authenticated;
grant execute on function app_private.can_read_scoped_position_family(uuid,uuid)
  to authenticated;

create or replace function public.update_department_details(
  p_department_id uuid,
  p_expected_version bigint,
  p_name_zh text,
  p_name_en text,
  p_sort_order integer,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.departments%rowtype;
begin
  select * into current_row
  from public.departments
  where id = p_department_id
  for update;
  if current_row.id is null then
    raise exception 'DEPARTMENT_NOT_FOUND: department no longer exists'
      using errcode = 'P2000';
  end if;
  perform app_private.assert_property_organization_manager(
    current_row.property_id
  );
  if current_row.version <> p_expected_version then
    raise exception 'DEPARTMENT_STALE_VERSION: refresh the organization tree and retry'
      using errcode = 'P2002';
  end if;

  if current_row.is_active and not p_is_active then
    if exists (
      select 1
      from public.department_closure closure
      join public.departments child
        on child.id = closure.descendant_department_id
       and child.property_id = closure.property_id
      where closure.property_id = current_row.property_id
        and closure.ancestor_department_id = current_row.id
        and closure.distance > 0
        and child.is_active
    ) then
      raise exception 'DEPARTMENT_ACTIVE_CHILDREN: deactivate or move active child departments first'
        using errcode = 'P5401';
    end if;
    if exists (
      select 1
      from public.trainer_scopes scope
      where scope.property_id = current_row.property_id
        and scope.department_id = current_row.id
        and scope.is_active
    ) then
      raise exception 'DEPARTMENT_ACTIVE_SCOPES: reassign department responsible-person scopes first'
        using errcode = 'P5402';
    end if;
    if exists (
      select 1
      from public.position_department_assignments assignment
      join public.positions position
        on position.id = assignment.position_id
       and position.property_id = assignment.property_id
      where assignment.property_id = current_row.property_id
        and assignment.department_id = current_row.id
        and position.is_active
    ) then
      raise exception 'DEPARTMENT_ACTIVE_POSITIONS: remove active position assignments first'
        using errcode = 'P5403';
    end if;
    if exists (
      select 1
      from public.operational_units unit
      where unit.property_id = current_row.property_id
        and unit.department_id = current_row.id
        and unit.is_active
    ) then
      raise exception 'DEPARTMENT_ACTIVE_UNITS: deactivate or move active operational units first'
        using errcode = 'P5404';
    end if;
  end if;

  update public.departments
  set name_zh = btrim(p_name_zh),
      name_en = nullif(btrim(p_name_en), ''),
      sort_order = p_sort_order,
      is_active = p_is_active,
      updated_by = auth.uid(),
      version = version + 1
  where id = p_department_id;
  return p_department_id;
end;
$$;

drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments for select to authenticated
using ((select app_private.can_read_department_node(property_id, id)));

drop policy if exists department_closure_select on public.department_closure;
create policy department_closure_select on public.department_closure for select to authenticated
using (
  (select app_private.can_read_department_node(property_id, ancestor_department_id))
  and
  (select app_private.can_read_department_node(property_id, descendant_department_id))
);

drop policy if exists operational_units_select on public.operational_units;
create policy operational_units_select on public.operational_units for select to authenticated
using (
  (select app_private.can_manage_property(property_id))
  or
  (select app_private.has_department_management_scope(property_id, department_id))
);

drop policy if exists positions_select on public.positions;
create policy positions_select on public.positions for select to authenticated
using ((select app_private.can_read_scoped_position(property_id, id)));

drop policy if exists position_families_select on public.position_families;
create policy position_families_select on public.position_families for select to authenticated
using ((select app_private.can_read_scoped_position_family(property_id, id)));

drop policy if exists position_department_assignments_select
  on public.position_department_assignments;
create policy position_department_assignments_select
on public.position_department_assignments for select to authenticated
using (
  (select app_private.can_manage_property(property_id))
  or
  (select app_private.has_department_management_scope(property_id, department_id))
);

create or replace function app_private.count_active_property_managers(
  p_property_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct account.id)::integer
  from public.user_accounts account
  join public.profiles profile
    on profile.id = account.user_id
   and profile.is_active
  join public.tenant_memberships tenant_membership
    on tenant_membership.tenant_id = account.tenant_id
   and tenant_membership.user_id = account.user_id
   and tenant_membership.status = 'active'
  join public.property_memberships property_membership
    on property_membership.property_id = account.property_id
   and property_membership.user_id = account.user_id
   and property_membership.status = 'active'
  join public.role_assignments assignment
    on assignment.property_id = account.property_id
   and assignment.user_id = account.user_id
   and assignment.status = 'active'
  join public.roles role
    on role.id = assignment.role_id
   and role.code = 'property_ld_manager'
   and role.is_active
  where account.property_id = p_property_id
    and account.account_status = 'active'
    and (account.locked_until is null or account.locked_until <= now());
$$;

create or replace function app_private.guard_final_manager_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.account_status = 'active'
    and new.account_status <> 'active'
    and exists (
      select 1
      from public.role_assignments assignment
      join public.roles role on role.id = assignment.role_id
      where assignment.user_id = old.user_id
        and assignment.property_id = old.property_id
        and assignment.status = 'active'
        and role.code = 'property_ld_manager'
        and role.is_active
    )
    and app_private.count_active_property_managers(old.property_id) <= 1 then
    raise exception 'P5006: final active hotel L&D manager is protected'
      using errcode = 'P5006';
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_final_manager_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'active'
    and new.status <> 'active'
    and exists (
      select 1
      from public.roles role
      where role.id = old.role_id
        and role.code = 'property_ld_manager'
        and role.is_active
    )
    and app_private.count_active_property_managers(old.property_id) <= 1 then
    raise exception 'P5006: final active hotel L&D manager is protected'
      using errcode = 'P5006';
  end if;
  return new;
end;
$$;

drop trigger if exists user_accounts_final_manager_guard on public.user_accounts;
create trigger user_accounts_final_manager_guard
before update on public.user_accounts
for each row execute function app_private.guard_final_manager_account();

drop trigger if exists role_assignments_final_manager_guard
  on public.role_assignments;
create trigger role_assignments_final_manager_guard
before update on public.role_assignments
for each row execute function app_private.guard_final_manager_assignment();

revoke execute on function app_private.count_active_property_managers(uuid)
  from public, anon, authenticated;
revoke execute on function app_private.guard_final_manager_account()
  from public, anon, authenticated;
revoke execute on function app_private.guard_final_manager_assignment()
  from public, anon, authenticated;

create or replace function app_private.assert_backend_account_role_and_scopes(
  p_property_id uuid,
  p_role_code text,
  p_scopes jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  scope_count integer;
  distinct_scope_count integer;
begin
  if p_role_code not in ('property_ld_manager', 'department_training_admin') then
    raise exception 'P5004: only approved hotel application roles can be assigned'
      using errcode = 'P5004';
  end if;
  if not exists (
    select 1
    from public.roles role
    where role.code = p_role_code
      and role.is_active
  ) then
    raise exception 'P5004: requested hotel application role is unavailable'
      using errcode = 'P5004';
  end if;
  if jsonb_typeof(coalesce(p_scopes, '[]'::jsonb)) <> 'array' then
    raise exception 'P5005: department scopes must be an array'
      using errcode = 'P5005';
  end if;

  select count(*), count(distinct item->>'departmentId')
  into scope_count, distinct_scope_count
  from jsonb_array_elements(coalesce(p_scopes, '[]'::jsonb)) item;

  if scope_count <> distinct_scope_count then
    raise exception 'P5005: duplicate department scopes are not allowed'
      using errcode = 'P5005';
  end if;
  if p_role_code = 'property_ld_manager' and scope_count <> 0 then
    raise exception 'P5005: hotel L&D managers cannot have department scopes'
      using errcode = 'P5005';
  end if;
  if p_role_code = 'department_training_admin' and scope_count = 0 then
    raise exception 'P5005: department responsible person requires an explicit department scope'
      using errcode = 'P5005';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_scopes, '[]'::jsonb)) item
    left join public.departments department
      on department.id = (item->>'departmentId')::uuid
     and department.property_id = p_property_id
     and department.is_active
    where jsonb_typeof(item) <> 'object'
       or nullif(btrim(item->>'departmentId'), '') is null
       or department.id is null
  ) then
    raise exception 'P5005: every scope must reference an active official department in this hotel'
      using errcode = 'P5005';
  end if;
exception
  when invalid_text_representation then
    raise exception 'P5005: department scope identifier is invalid'
      using errcode = 'P5005';
end;
$$;

create or replace function app_private.backend_account_snapshot(
  p_account_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'accountId', account.id,
    'loginId', account.login_id,
    'displayName', profile.display_name,
    'accountStatus', account.account_status::text,
    'roleCode', role.code,
    'departmentScopes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'departmentId', scope.department_id,
          'departmentNameZh', department.name_zh,
          'includeDescendants', scope.include_descendants
        )
        order by department.sort_order, department.name_zh
      )
      from public.trainer_scopes scope
      join public.departments department on department.id = scope.department_id
      where scope.role_assignment_id = assignment.id
        and scope.is_active
    ), '[]'::jsonb),
    'version', account.version,
    'updatedAt', account.updated_at
  )
  from public.user_accounts account
  join public.profiles profile on profile.id = account.user_id
  join public.role_assignments assignment
    on assignment.user_id = account.user_id
   and assignment.property_id = account.property_id
   and assignment.status = 'active'
  join public.roles role
    on role.id = assignment.role_id
   and role.code in ('property_ld_manager', 'department_training_admin')
   and role.is_active
  where account.id = p_account_id;
$$;

create or replace function public.create_property_backend_account_foundation(
  p_property_id uuid,
  p_auth_user_id uuid,
  p_internal_email text,
  p_login_id text,
  p_display_name text,
  p_role_code text,
  p_scopes jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  property_row public.properties%rowtype;
  selected_role_id uuid;
  created_account_id uuid;
  created_assignment_id uuid;
begin
  select * into property_row
  from public.properties
  where id = p_property_id
  for share;
  if property_row.id is null
    or not app_private.can_manage_property(p_property_id) then
    raise exception 'P5001: account administration access denied'
      using errcode = 'P5001';
  end if;
  perform app_private.assert_backend_account_role_and_scopes(
    p_property_id,
    p_role_code,
    p_scopes
  );
  if not exists (
    select 1 from auth.users where id = p_auth_user_id
  ) then
    raise exception 'P5002: authenticated identity does not exist'
      using errcode = 'P5002';
  end if;
  if nullif(btrim(p_internal_email), '') is null
    or nullif(btrim(p_login_id), '') is null
    or nullif(btrim(p_display_name), '') is null then
    raise exception 'P5002: account identity fields are required'
      using errcode = 'P5002';
  end if;
  if exists (
    select 1
    from public.user_accounts account
    where account.property_id = p_property_id
      and (
        account.user_id = p_auth_user_id
        or account.auth_user_id = p_auth_user_id
        or account.normalized_login_id = lower(btrim(p_login_id))
      )
  ) then
    raise exception 'P5002: backend account already exists'
      using errcode = 'P5002';
  end if;

  insert into public.profiles(id, email, display_name)
  values (
    p_auth_user_id,
    lower(btrim(p_internal_email)),
    btrim(p_display_name)
  )
  on conflict (id) do update
  set display_name = excluded.display_name;

  if exists (
    select 1
    from public.profiles profile
    where profile.id = p_auth_user_id
      and lower(profile.email) <> lower(btrim(p_internal_email))
  ) then
    raise exception 'P5002: internal authenticated identity does not match'
      using errcode = 'P5002';
  end if;

  insert into public.tenant_memberships(
    tenant_id, user_id, status, joined_at, revoked_at, created_by
  )
  values (
    property_row.tenant_id, p_auth_user_id, 'active', now(), null, auth.uid()
  )
  on conflict (tenant_id, user_id) do update
  set status = 'active',
      joined_at = coalesce(public.tenant_memberships.joined_at, now()),
      revoked_at = null,
      updated_at = now();

  insert into public.property_memberships(
    tenant_id, property_id, user_id, status, joined_at, revoked_at, created_by
  )
  values (
    property_row.tenant_id, p_property_id, p_auth_user_id,
    'active', now(), null, auth.uid()
  )
  on conflict (property_id, user_id) do update
  set status = 'active',
      joined_at = coalesce(public.property_memberships.joined_at, now()),
      revoked_at = null,
      updated_at = now();

  select id into selected_role_id
  from public.roles
  where code = p_role_code
    and is_active;

  insert into public.role_assignments(
    user_id, role_id, tenant_id, property_id, status, granted_by, granted_at
  )
  values (
    p_auth_user_id, selected_role_id, property_row.tenant_id,
    p_property_id, 'active', auth.uid(), now()
  )
  returning id into created_assignment_id;

  if p_role_code = 'department_training_admin' then
    insert into public.trainer_scopes(
      role_assignment_id, tenant_id, property_id, department_id,
      include_descendants, is_active, granted_by, granted_at
    )
    select
      created_assignment_id,
      property_row.tenant_id,
      p_property_id,
      (item->>'departmentId')::uuid,
      coalesce((item->>'includeDescendants')::boolean, false),
      true,
      auth.uid(),
      now()
    from jsonb_array_elements(p_scopes) item;
  end if;

  insert into public.user_accounts(
    user_id, auth_user_id, tenant_id, property_id, login_id,
    account_status, must_change_password, created_by, updated_by
  )
  values (
    p_auth_user_id, p_auth_user_id, property_row.tenant_id, p_property_id,
    btrim(p_login_id), 'active', true, auth.uid(), auth.uid()
  )
  returning id into created_account_id;

  return app_private.backend_account_snapshot(created_account_id);
end;
$$;

create or replace function public.update_property_backend_account(
  p_property_id uuid,
  p_account_id uuid,
  p_expected_version bigint,
  p_login_id text,
  p_display_name text,
  p_account_status text,
  p_role_code text,
  p_scopes jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_row public.user_accounts%rowtype;
  current_assignment public.role_assignments%rowtype;
  current_role_code text;
  selected_role_id uuid;
  selected_status public.account_status;
  effective_assignment_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hotel-ld-os:property-account:' || p_property_id::text,
      0
    )
  );

  select * into account_row
  from public.user_accounts
  where id = p_account_id
    and property_id = p_property_id
  for update;
  if account_row.id is null
    or not app_private.can_manage_property(p_property_id)
    or (
      app_private.has_property_role(
        p_property_id,
        'property_ld_manager'
      )
      and not app_private.is_current_account_active(p_property_id)
    ) then
    raise exception 'P5001: account administration access denied'
      using errcode = 'P5001';
  end if;
  if account_row.version <> p_expected_version then
    raise exception 'P5003: account record is stale'
      using errcode = 'P5003';
  end if;
  if nullif(btrim(p_login_id), '') is null
    or nullif(btrim(p_display_name), '') is null then
    raise exception 'P5002: account identity fields are required'
      using errcode = 'P5002';
  end if;
  begin
    selected_status := p_account_status::public.account_status;
  exception
    when invalid_text_representation then
      raise exception 'P5004: unsupported account status'
        using errcode = 'P5004';
  end;
  perform app_private.assert_backend_account_role_and_scopes(
    p_property_id,
    p_role_code,
    p_scopes
  );

  select assignment.*
  into current_assignment
  from public.role_assignments assignment
  join public.roles role on role.id = assignment.role_id
  where assignment.user_id = account_row.user_id
    and assignment.property_id = p_property_id
    and assignment.status = 'active'
    and role.code in ('property_ld_manager', 'department_training_admin')
  order by assignment.created_at desc
  limit 1
  for update of assignment;
  if current_assignment.id is null then
    raise exception 'P5002: active hotel application role is missing'
      using errcode = 'P5002';
  end if;
  select role.code into current_role_code
  from public.roles role
  where role.id = current_assignment.role_id;

  if account_row.user_id = (select auth.uid())
    and current_role_code <> p_role_code then
    raise exception 'account holders cannot widen or replace their own role'
      using errcode = '42501';
  end if;
  if account_row.user_id = (select auth.uid())
    and p_role_code = 'department_training_admin' then
    raise exception 'account holders cannot change their own department scopes'
      using errcode = '42501';
  end if;

  if current_role_code = 'property_ld_manager'
    and (
      p_role_code <> 'property_ld_manager'
      or selected_status <> 'active'
    )
    and app_private.count_active_property_managers(p_property_id) <= 1 then
    raise exception 'P5006: final active hotel L&D manager is protected'
      using errcode = 'P5006';
  end if;

  update public.profiles
  set display_name = btrim(p_display_name)
  where id = account_row.user_id;

  if current_role_code <> p_role_code then
    update public.trainer_scopes
    set is_active = false,
        revoked_at = now(),
        updated_at = now()
    where role_assignment_id = current_assignment.id
      and is_active;

    update public.role_assignments
    set status = 'revoked',
        revoked_at = now(),
        updated_at = now()
    where id = current_assignment.id;

    select id into selected_role_id
    from public.roles
    where code = p_role_code
      and is_active;

    insert into public.role_assignments(
      user_id, role_id, tenant_id, property_id, status, granted_by, granted_at
    )
    values (
      account_row.user_id, selected_role_id, account_row.tenant_id,
      p_property_id, 'active', auth.uid(), now()
    )
    returning id into effective_assignment_id;
  else
    effective_assignment_id := current_assignment.id;
  end if;

  update public.trainer_scopes
  set is_active = false,
      revoked_at = now(),
      updated_at = now()
  where role_assignment_id = effective_assignment_id
    and is_active;

  if p_role_code = 'department_training_admin' then
    insert into public.trainer_scopes(
      role_assignment_id, tenant_id, property_id, department_id,
      include_descendants, is_active, granted_by, granted_at, revoked_at
    )
    select
      effective_assignment_id,
      account_row.tenant_id,
      p_property_id,
      (item->>'departmentId')::uuid,
      coalesce((item->>'includeDescendants')::boolean, false),
      true,
      auth.uid(),
      now(),
      null
    from jsonb_array_elements(p_scopes) item
    on conflict (role_assignment_id, department_id) do update
    set include_descendants = excluded.include_descendants,
        is_active = true,
        granted_by = excluded.granted_by,
        granted_at = excluded.granted_at,
        revoked_at = null,
        updated_at = now();
  end if;

  update public.user_accounts
  set login_id = btrim(p_login_id),
      account_status = selected_status,
      updated_by = auth.uid(),
      version = version + 1
  where id = p_account_id;

  return app_private.backend_account_snapshot(p_account_id);
end;
$$;

create or replace function public.prepare_property_backend_account_password_reset(
  p_property_id uuid,
  p_account_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_row public.user_accounts%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hotel-ld-os:property-account:' || p_property_id::text,
      0
    )
  );

  if not app_private.is_current_account_active(p_property_id)
    or not app_private.has_property_role(
      p_property_id,
      'property_ld_manager'
    ) then
    raise exception 'P5001: account administration access denied'
      using errcode = 'P5001';
  end if;

  select * into account_row
  from public.user_accounts
  where id = p_account_id
    and property_id = p_property_id
  for update;
  if account_row.id is null then
    raise exception 'P5001: account administration access denied'
      using errcode = 'P5001';
  end if;
  if account_row.version <> p_expected_version then
    raise exception 'P5003: account record is stale'
      using errcode = 'P5003';
  end if;
  if not exists (
    select 1
    from public.role_assignments assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.user_id = account_row.user_id
      and assignment.property_id = p_property_id
      and assignment.status = 'active'
      and role.code in (
        'property_ld_manager',
        'department_training_admin'
      )
      and role.is_active
  ) then
    raise exception 'P5002: active hotel application role is missing'
      using errcode = 'P5002';
  end if;

  update public.user_accounts
  set must_change_password = true,
      failed_login_count = 0,
      locked_until = null,
      updated_by = auth.uid(),
      version = version + 1
  where id = p_account_id;

  return app_private.backend_account_snapshot(p_account_id);
end;
$$;

revoke all on function app_private.assert_backend_account_role_and_scopes(uuid,text,jsonb)
  from public, anon, authenticated;
revoke all on function app_private.backend_account_snapshot(uuid)
  from public, anon, authenticated;
revoke all on function public.create_property_backend_account_foundation(uuid,uuid,text,text,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.update_property_backend_account(uuid,uuid,bigint,text,text,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.prepare_property_backend_account_password_reset(uuid,uuid,bigint)
  from public, anon, authenticated;
grant execute on function public.create_property_backend_account_foundation(uuid,uuid,text,text,text,text,jsonb)
  to authenticated;
grant execute on function public.update_property_backend_account(uuid,uuid,bigint,text,text,text,text,jsonb)
  to authenticated;
grant execute on function public.prepare_property_backend_account_password_reset(uuid,uuid,bigint)
  to authenticated;

drop policy if exists user_accounts_insert_administrator on public.user_accounts;
drop policy if exists user_accounts_update_administrator on public.user_accounts;
revoke insert, update on public.user_accounts from authenticated;

drop policy if exists role_assignments_insert on public.role_assignments;
drop policy if exists role_assignments_update on public.role_assignments;
drop policy if exists trainer_scopes_insert on public.trainer_scopes;
drop policy if exists trainer_scopes_update on public.trainer_scopes;
revoke insert, update on public.role_assignments from authenticated;
revoke insert, update on public.trainer_scopes from authenticated;

revoke select on public.user_accounts from authenticated;
grant select (
  id, tenant_id, property_id, employee_id, login_id, normalized_login_id,
  account_status, must_change_password, locked_until, last_login_at,
  created_at, updated_at, version
) on public.user_accounts to authenticated;

revoke select on public.profiles from authenticated;
grant select (
  display_name, full_name, locale, is_active, created_at, updated_at
) on public.profiles to authenticated;

create or replace function public.save_operational_unit(
  p_property_id uuid,
  p_operational_unit_id uuid,
  p_expected_version bigint,
  p_department_id uuid,
  p_parent_operational_unit_id uuid,
  p_unit_type text,
  p_code text,
  p_name_zh text,
  p_name_en text,
  p_sort_order integer,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  property_tenant_id uuid;
  current_row public.operational_units%rowtype;
  saved_id uuid;
begin
  select tenant_id into property_tenant_id
  from public.properties
  where id = p_property_id;
  if property_tenant_id is null
    or not app_private.can_manage_property(p_property_id) then
    raise exception 'P5101: operational unit administration access denied'
      using errcode = 'P5101';
  end if;
  if nullif(btrim(p_name_zh), '') is null then
    raise exception 'P5102: operational unit Chinese name is required'
      using errcode = 'P5102';
  end if;
  if not exists (
    select 1 from public.departments department
    where department.id = p_department_id
      and department.property_id = p_property_id
      and department.is_active
  ) then
    raise exception 'P5102: operational unit requires an active official department'
      using errcode = 'P5102';
  end if;
  if p_parent_operational_unit_id is not null
    and not exists (
      select 1 from public.operational_units parent
      where parent.id = p_parent_operational_unit_id
        and parent.property_id = p_property_id
        and parent.is_active
    ) then
    raise exception 'P5102: parent operational unit is unavailable'
      using errcode = 'P5102';
  end if;
  if p_parent_operational_unit_id is not null
    and not exists (
      select 1 from public.operational_units parent
      where parent.id = p_parent_operational_unit_id
        and parent.property_id = p_property_id
        and parent.department_id = p_department_id
        and parent.is_active
    ) then
    raise exception 'P5102: parent operational unit must belong to the same official department'
      using errcode = 'P5102';
  end if;

  if p_operational_unit_id is null then
    insert into public.operational_units(
      tenant_id, property_id, department_id, parent_operational_unit_id,
      unit_type, code, name_zh, name_en, sort_order, is_active,
      created_by, updated_by
    )
    values (
      property_tenant_id, p_property_id, p_department_id,
      p_parent_operational_unit_id,
      p_unit_type::public.operational_unit_type,
      nullif(lower(btrim(p_code)), ''),
      btrim(p_name_zh),
      nullif(btrim(p_name_en), ''),
      coalesce(p_sort_order, 0),
      coalesce(p_is_active, true),
      auth.uid(),
      auth.uid()
    )
    returning id into saved_id;
  else
    select * into current_row
    from public.operational_units
    where id = p_operational_unit_id
      and property_id = p_property_id
    for update;
    if current_row.id is null then
      raise exception 'P5102: operational unit no longer exists'
        using errcode = 'P5102';
    end if;
    if current_row.version <> p_expected_version then
      raise exception 'P5103: operational unit record is stale'
        using errcode = 'P5103';
    end if;
    if p_parent_operational_unit_id = p_operational_unit_id
      or (
        p_parent_operational_unit_id is not null
        and exists (
          with recursive descendants as (
            select unit.id
            from public.operational_units unit
            where unit.parent_operational_unit_id = p_operational_unit_id
            union all
            select child.id
            from public.operational_units child
            join descendants parent on child.parent_operational_unit_id = parent.id
          )
          select 1 from descendants
          where id = p_parent_operational_unit_id
        )
      ) then
      raise exception 'P5104: operational unit hierarchy cycle is not allowed'
        using errcode = 'P5104';
    end if;

    update public.operational_units
    set department_id = p_department_id,
        parent_operational_unit_id = p_parent_operational_unit_id,
        unit_type = p_unit_type::public.operational_unit_type,
        code = nullif(lower(btrim(p_code)), ''),
        name_zh = btrim(p_name_zh),
        name_en = nullif(btrim(p_name_en), ''),
        sort_order = coalesce(p_sort_order, 0),
        is_active = p_is_active,
        updated_by = auth.uid(),
        version = version + 1
    where id = p_operational_unit_id;
    saved_id := p_operational_unit_id;
  end if;

  return (
    select jsonb_build_object(
      'id', unit.id,
      'tenantId', unit.tenant_id,
      'propertyId', unit.property_id,
      'departmentId', unit.department_id,
      'parentOperationalUnitId', unit.parent_operational_unit_id,
      'unitType', unit.unit_type::text,
      'code', unit.code,
      'nameZh', unit.name_zh,
      'nameEn', unit.name_en,
      'sortOrder', unit.sort_order,
      'isActive', unit.is_active,
      'version', unit.version,
      'updatedAt', unit.updated_at
    )
    from public.operational_units unit
    where unit.id = saved_id
  );
exception
  when invalid_text_representation then
    raise exception 'P5102: unsupported operational unit type'
      using errcode = 'P5102';
end;
$$;

create or replace function public.save_position_family(
  p_property_id uuid,
  p_position_family_id uuid,
  p_expected_version bigint,
  p_code text,
  p_name_zh text,
  p_name_en text,
  p_description text,
  p_sort_order integer,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  property_tenant_id uuid;
  current_row public.position_families%rowtype;
  saved_id uuid;
begin
  select tenant_id into property_tenant_id
  from public.properties
  where id = p_property_id;
  if property_tenant_id is null
    or not app_private.can_manage_property(p_property_id) then
    raise exception 'P5201: position-family administration access denied'
      using errcode = 'P5201';
  end if;
  if nullif(btrim(p_code), '') is null
    or nullif(btrim(p_name_zh), '') is null then
    raise exception 'P5202: position-family code and Chinese name are required'
      using errcode = 'P5202';
  end if;

  if p_position_family_id is null then
    insert into public.position_families(
      tenant_id, property_id, code, name_zh, name_en, description,
      sort_order, is_active, created_by, updated_by
    )
    values (
      property_tenant_id, p_property_id, lower(btrim(p_code)),
      btrim(p_name_zh), nullif(btrim(p_name_en), ''),
      nullif(btrim(p_description), ''), coalesce(p_sort_order, 0),
      coalesce(p_is_active, true), auth.uid(), auth.uid()
    )
    returning id into saved_id;
  else
    select * into current_row
    from public.position_families
    where id = p_position_family_id
      and property_id = p_property_id
    for update;
    if current_row.id is null then
      raise exception 'P5202: position family no longer exists'
        using errcode = 'P5202';
    end if;
    if current_row.version <> p_expected_version then
      raise exception 'P5203: position-family record is stale'
        using errcode = 'P5203';
    end if;
    update public.position_families
    set code = lower(btrim(p_code)),
        name_zh = btrim(p_name_zh),
        name_en = nullif(btrim(p_name_en), ''),
        description = nullif(btrim(p_description), ''),
        sort_order = coalesce(p_sort_order, 0),
        is_active = p_is_active,
        updated_by = auth.uid(),
        version = version + 1
    where id = p_position_family_id;
    saved_id := p_position_family_id;
  end if;

  return (
    select jsonb_build_object(
      'id', family.id,
      'tenantId', family.tenant_id,
      'propertyId', family.property_id,
      'code', family.code,
      'nameZh', family.name_zh,
      'nameEn', family.name_en,
      'description', family.description,
      'sortOrder', family.sort_order,
      'isActive', family.is_active,
      'version', family.version,
      'updatedAt', family.updated_at
    )
    from public.position_families family
    where family.id = saved_id
  );
end;
$$;

create or replace function public.save_position_with_departments(
  p_property_id uuid,
  p_position_id uuid,
  p_expected_version bigint,
  p_position_family_id uuid,
  p_code text,
  p_name_zh text,
  p_name_en text,
  p_grade_or_band text,
  p_is_active boolean,
  p_department_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  property_tenant_id uuid;
  current_row public.positions%rowtype;
  saved_id uuid;
begin
  select tenant_id into property_tenant_id
  from public.properties
  where id = p_property_id;
  if property_tenant_id is null
    or not app_private.can_manage_property(p_property_id) then
    raise exception 'P5301: position administration access denied'
      using errcode = 'P5301';
  end if;
  if nullif(btrim(p_code), '') is null
    or nullif(btrim(p_name_zh), '') is null then
    raise exception 'P5302: position code and Chinese name are required'
      using errcode = 'P5302';
  end if;
  if p_position_family_id is not null and not exists (
    select 1 from public.position_families family
    where family.id = p_position_family_id
      and family.property_id = p_property_id
      and family.is_active
  ) then
    raise exception 'P5302: selected position family is unavailable'
      using errcode = 'P5302';
  end if;
  if cardinality(coalesce(p_department_ids, '{}'::uuid[]))
    <> cardinality(array(
      select distinct department_id
      from unnest(coalesce(p_department_ids, '{}'::uuid[])) department_id
    )) then
    raise exception 'P5302: duplicate department assignments are not allowed'
      using errcode = 'P5302';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_department_ids, '{}'::uuid[])) department_id
    left join public.departments department
      on department.id = department_id
     and department.property_id = p_property_id
     and department.is_active
    where department.id is null
  ) then
    raise exception 'P5302: position departments must be active official departments in this hotel'
      using errcode = 'P5302';
  end if;

  if p_position_id is null then
    insert into public.positions(
      tenant_id, property_id, position_family_id, code, name_zh,
      name_en, grade_or_band, is_active
    )
    values (
      property_tenant_id, p_property_id, p_position_family_id,
      lower(btrim(p_code)), btrim(p_name_zh), nullif(btrim(p_name_en), ''),
      nullif(btrim(p_grade_or_band), ''), coalesce(p_is_active, true)
    )
    returning id into saved_id;
  else
    select * into current_row
    from public.positions
    where id = p_position_id
      and property_id = p_property_id
    for update;
    if current_row.id is null then
      raise exception 'P5302: position no longer exists'
        using errcode = 'P5302';
    end if;
    if current_row.version <> p_expected_version then
      raise exception 'P5303: position record is stale'
        using errcode = 'P5303';
    end if;
    update public.positions
    set position_family_id = p_position_family_id,
        code = lower(btrim(p_code)),
        name_zh = btrim(p_name_zh),
        name_en = nullif(btrim(p_name_en), ''),
        grade_or_band = nullif(btrim(p_grade_or_band), ''),
        is_active = p_is_active
    where id = p_position_id;
    saved_id := p_position_id;
  end if;

  delete from public.position_department_assignments
  where position_id = saved_id;

  insert into public.position_department_assignments(
    tenant_id, property_id, position_id, department_id, is_primary
  )
  select
    property_tenant_id,
    p_property_id,
    saved_id,
    department_id,
    ordinality = 1
  from unnest(coalesce(p_department_ids, '{}'::uuid[]))
    with ordinality assigned(department_id, ordinality);

  return (
    select jsonb_build_object(
      'id', position.id,
      'tenantId', position.tenant_id,
      'propertyId', position.property_id,
      'positionFamilyId', position.position_family_id,
      'code', position.code,
      'nameZh', position.name_zh,
      'nameEn', position.name_en,
      'gradeOrBand', position.grade_or_band,
      'isActive', position.is_active,
      'departmentIds', coalesce((
        select jsonb_agg(assignment.department_id order by assignment.is_primary desc, assignment.department_id)
        from public.position_department_assignments assignment
        where assignment.position_id = position.id
      ), '[]'::jsonb),
      'version', position.version,
      'updatedAt', position.updated_at
    )
    from public.positions position
    where position.id = saved_id
  );
end;
$$;

revoke all on function public.save_operational_unit(uuid,uuid,bigint,uuid,uuid,text,text,text,text,integer,boolean)
  from public, anon, authenticated;
revoke all on function public.save_position_family(uuid,uuid,bigint,text,text,text,text,integer,boolean)
  from public, anon, authenticated;
revoke all on function public.save_position_with_departments(uuid,uuid,bigint,uuid,text,text,text,text,boolean,uuid[])
  from public, anon, authenticated;
grant execute on function public.save_operational_unit(uuid,uuid,bigint,uuid,uuid,text,text,text,text,integer,boolean)
  to authenticated;
grant execute on function public.save_position_family(uuid,uuid,bigint,text,text,text,text,integer,boolean)
  to authenticated;
grant execute on function public.save_position_with_departments(uuid,uuid,bigint,uuid,text,text,text,text,boolean,uuid[])
  to authenticated;

drop policy if exists operational_units_insert on public.operational_units;
drop policy if exists operational_units_update on public.operational_units;
drop policy if exists position_families_insert on public.position_families;
drop policy if exists position_families_update on public.position_families;
drop policy if exists positions_insert on public.positions;
drop policy if exists positions_update on public.positions;
drop policy if exists position_department_assignments_insert
  on public.position_department_assignments;
drop policy if exists position_department_assignments_update
  on public.position_department_assignments;
drop policy if exists position_department_assignments_delete
  on public.position_department_assignments;

revoke insert, update on public.operational_units from authenticated;
revoke insert, update on public.position_families from authenticated;
revoke insert, update on public.positions from authenticated;
revoke insert, update, delete on public.position_department_assignments
  from authenticated;
