drop trigger if exists platform_memberships_immutable_scope on public.platform_memberships;
drop trigger if exists tenant_memberships_immutable_scope on public.tenant_memberships;
drop trigger if exists properties_immutable_tenant on public.properties;
drop trigger if exists property_memberships_immutable_scope on public.property_memberships;
drop trigger if exists role_assignments_immutable_scope on public.role_assignments;
drop trigger if exists trainer_scopes_immutable_scope on public.trainer_scopes;

drop function app_private.prevent_scope_identity_change();

create function app_private.prevent_platform_membership_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id or new.role_code is distinct from old.role_code then
    raise exception 'platform membership identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function app_private.prevent_tenant_membership_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.user_id is distinct from old.user_id then
    raise exception 'tenant membership scope is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function app_private.prevent_property_tenant_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'property tenant is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function app_private.prevent_property_membership_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
    or new.property_id is distinct from old.property_id
    or new.user_id is distinct from old.user_id then
    raise exception 'property membership scope is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function app_private.prevent_role_assignment_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id
    or new.role_id is distinct from old.role_id
    or new.tenant_id is distinct from old.tenant_id
    or new.property_id is distinct from old.property_id then
    raise exception 'role assignment identity and scope are immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function app_private.prevent_trainer_scope_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role_assignment_id is distinct from old.role_assignment_id
    or new.tenant_id is distinct from old.tenant_id
    or new.property_id is distinct from old.property_id
    or new.department_id is distinct from old.department_id then
    raise exception 'trainer scope identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function app_private.prevent_platform_membership_identity_change() from public, anon, authenticated;
revoke execute on function app_private.prevent_tenant_membership_identity_change() from public, anon, authenticated;
revoke execute on function app_private.prevent_property_tenant_change() from public, anon, authenticated;
revoke execute on function app_private.prevent_property_membership_identity_change() from public, anon, authenticated;
revoke execute on function app_private.prevent_role_assignment_identity_change() from public, anon, authenticated;
revoke execute on function app_private.prevent_trainer_scope_identity_change() from public, anon, authenticated;

create trigger platform_memberships_immutable_scope before update on public.platform_memberships
for each row execute function app_private.prevent_platform_membership_identity_change();
create trigger tenant_memberships_immutable_scope before update on public.tenant_memberships
for each row execute function app_private.prevent_tenant_membership_identity_change();
create trigger properties_immutable_tenant before update on public.properties
for each row execute function app_private.prevent_property_tenant_change();
create trigger property_memberships_immutable_scope before update on public.property_memberships
for each row execute function app_private.prevent_property_membership_identity_change();
create trigger role_assignments_immutable_scope before update on public.role_assignments
for each row execute function app_private.prevent_role_assignment_identity_change();
create trigger trainer_scopes_immutable_scope before update on public.trainer_scopes
for each row execute function app_private.prevent_trainer_scope_identity_change();
