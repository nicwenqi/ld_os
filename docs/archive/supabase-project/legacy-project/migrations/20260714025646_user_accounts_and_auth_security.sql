create type public.account_status as enum ('invited', 'active', 'suspended', 'disabled');

create table public.user_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  tenant_id uuid not null,
  property_id uuid not null,
  employee_id uuid,
  login_id text not null,
  normalized_login_id text generated always as (lower(btrim(login_id))) stored,
  account_status public.account_status not null default 'invited',
  must_change_password boolean not null default true,
  failed_login_count integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  version bigint not null default 1,
  constraint user_accounts_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties(id, tenant_id) on delete restrict,
  constraint user_accounts_employee_property_fkey
    foreign key (employee_id, tenant_id, property_id)
    references public.employees(id, tenant_id, property_id) on delete restrict,
  constraint user_accounts_property_login_key unique (property_id, normalized_login_id),
  constraint user_accounts_property_auth_key unique (property_id, auth_user_id),
  constraint user_accounts_property_user_key unique (property_id, user_id),
  constraint user_accounts_login_not_blank check (btrim(login_id) <> '' and char_length(btrim(login_id)) <= 80),
  constraint user_accounts_failed_login_count_check check (failed_login_count >= 0),
  constraint user_accounts_version_check check (version > 0)
);

comment on table public.user_accounts is
  'Property-scoped login identity and account status. Memberships, roles and department scopes remain authoritative elsewhere.';
comment on column public.user_accounts.login_id is
  'User-facing identifier, unique after trim/lower normalization inside one property.';
comment on column public.user_accounts.auth_user_id is
  'Private Supabase Auth identity. It must never be returned as a user-facing login identifier.';

create index user_accounts_auth_status_idx on public.user_accounts (auth_user_id, property_id, account_status);
create index user_accounts_property_status_idx on public.user_accounts (property_id, account_status);
create index user_accounts_employee_idx on public.user_accounts (employee_id) where employee_id is not null;

create function app_private.prevent_user_account_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id or new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'account user and auth identity is immutable' using errcode = '23514';
  end if;
  if new.tenant_id is distinct from old.tenant_id or new.property_id is distinct from old.property_id then
    raise exception 'account tenant and property identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function app_private.is_current_account_active(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_accounts account
    join public.profiles profile on profile.id = account.user_id
    join public.property_memberships property_membership
      on property_membership.property_id = account.property_id
      and property_membership.user_id = account.user_id
    join public.tenant_memberships tenant_membership
      on tenant_membership.tenant_id = account.tenant_id
      and tenant_membership.user_id = account.user_id
    where account.auth_user_id = (select auth.uid())
      and account.property_id = p_property_id
      and account.account_status = 'active'
      and (account.locked_until is null or account.locked_until <= now())
      and profile.is_active
      and property_membership.status = 'active'
      and tenant_membership.status = 'active'
  );
$$;

create function app_private.can_manage_user_account(p_tenant_id uuid, p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.is_platform_admin()
    or app_private.is_tenant_admin(p_tenant_id)
    or app_private.has_property_role(p_property_id, 'property_ld_manager');
$$;

revoke execute on function app_private.prevent_user_account_identity_change() from public, anon, authenticated;
revoke execute on function app_private.is_current_account_active(uuid) from public, anon, authenticated;
revoke execute on function app_private.can_manage_user_account(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.is_current_account_active(uuid) to authenticated;
grant execute on function app_private.can_manage_user_account(uuid, uuid) to authenticated;

create trigger user_accounts_immutable_identity before update on public.user_accounts
for each row execute function app_private.prevent_user_account_identity_change();
create trigger user_accounts_updated_at before update on public.user_accounts
for each row execute function app_private.set_updated_at();

revoke all on public.user_accounts from anon, authenticated;
grant select, insert, update on public.user_accounts to authenticated;
grant usage on type public.account_status to authenticated;

alter table public.user_accounts enable row level security;
alter table public.user_accounts force row level security;

create policy user_accounts_select_own_active on public.user_accounts
for select to authenticated
using (
  auth_user_id = (select auth.uid())
  and account_status = 'active'
  and (locked_until is null or locked_until <= now())
  and (select app_private.is_current_account_active(property_id))
);

create policy user_accounts_select_administrator on public.user_accounts
for select to authenticated
using ((select app_private.can_manage_user_account(tenant_id, property_id)));

create policy user_accounts_insert_administrator on public.user_accounts
for insert to authenticated
with check ((select app_private.can_manage_user_account(tenant_id, property_id)));

create policy user_accounts_update_administrator on public.user_accounts
for update to authenticated
using ((select app_private.can_manage_user_account(tenant_id, property_id)))
with check ((select app_private.can_manage_user_account(tenant_id, property_id)));
