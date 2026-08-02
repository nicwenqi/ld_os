-- Completes a hotel user's own password transition after Supabase Auth has
-- accepted the new password. It intentionally does not alter C0/C5 authority:
-- the preflight is actor-derived, while the final state transition is callable
-- only by the server's existing secret-key boundary.

create table public.hotel_password_change_events (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  account_id uuid not null references public.user_accounts(id) on delete restrict,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  event_type text not null check (event_type = 'password_change_completed'),
  account_version_before bigint not null,
  account_version_after bigint not null,
  was_password_change_required boolean not null,
  occurred_at timestamptz not null default now(),
  constraint hotel_password_change_events_version_check
    check (account_version_after = account_version_before + 1)
);

create index hotel_password_change_events_account_idx
  on public.hotel_password_change_events(account_id, occurred_at desc);

alter table public.hotel_password_change_events enable row level security;
alter table public.hotel_password_change_events force row level security;
revoke all on public.hotel_password_change_events from public, anon, authenticated, service_role;

create or replace function app_private.reject_hotel_password_change_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'hotel password-change audit evidence is append-only'
    using errcode = '42501';
end;
$$;

revoke all on function app_private.reject_hotel_password_change_event_mutation()
  from public, anon, authenticated, service_role;

create trigger hotel_password_change_events_append_only
before update or delete on public.hotel_password_change_events
for each row execute function app_private.reject_hotel_password_change_event_mutation();

create or replace function public.prepare_hotel_password_change(
  p_hostname text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_session jsonb;
  account_row public.user_accounts%rowtype;
begin
  resolved_session := public.resolve_hotel_application_session(p_hostname);
  if resolved_session is null
    or resolved_session->>'role' not in (
      'property_ld_manager',
      'department_training_responsible'
    ) then
    raise exception 'AUTHORIZED_HOTEL_SESSION_REQUIRED' using errcode = '42501';
  end if;

  select account.*
    into account_row
  from public.user_accounts account
  where account.auth_user_id = (select auth.uid())
    and account.property_id = (resolved_session->>'propertyId')::uuid
    and account.account_status = 'active'
    and (account.locked_until is null or account.locked_until <= now())
  for update;

  if account_row.id is null then
    raise exception 'AUTHORIZED_HOTEL_SESSION_REQUIRED' using errcode = '42501';
  end if;

  return jsonb_build_object('accountVersion', account_row.version);
end;
$$;

comment on function public.prepare_hotel_password_change(text) is
  'Authenticated own-account password-change preflight. It returns only the caller''s optimistic account version and cannot change account state.';

create or replace function public.complete_hotel_password_change(
  p_auth_user_id uuid,
  p_property_id uuid,
  p_expected_account_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_row public.user_accounts%rowtype;
  previous_required boolean;
begin
  if p_auth_user_id is null or p_property_id is null or p_expected_account_version < 1 then
    raise exception 'PASSWORD_CHANGE_INPUT_INVALID' using errcode = '22023';
  end if;

  select account.*
    into account_row
  from public.user_accounts account
  join public.tenant_memberships tenant_membership
    on tenant_membership.tenant_id = account.tenant_id
   and tenant_membership.user_id = account.user_id
   and tenant_membership.status = 'active'
  join public.property_memberships property_membership
    on property_membership.tenant_id = account.tenant_id
   and property_membership.property_id = account.property_id
   and property_membership.user_id = account.user_id
   and property_membership.status = 'active'
  join public.profiles profile
    on profile.id = account.user_id
   and profile.is_active
  where account.auth_user_id = p_auth_user_id
    and account.property_id = p_property_id
    and account.account_status = 'active'
    and (account.locked_until is null or account.locked_until <= now())
    and exists (
      select 1
      from public.role_assignments assignment
      join public.roles role
        on role.id = assignment.role_id
       and role.is_active
      where assignment.user_id = account.user_id
        and assignment.tenant_id = account.tenant_id
        and assignment.property_id = account.property_id
        and assignment.status = 'active'
        and (
          role.code = 'property_ld_manager'
          or (
            role.code = 'department_training_admin'
            and exists (
              select 1
              from public.trainer_scopes scope
              where scope.role_assignment_id = assignment.id
                and scope.tenant_id = assignment.tenant_id
                and scope.property_id = assignment.property_id
                and scope.is_active
            )
          )
        )
    )
  for update of account;

  if account_row.id is null then
    raise exception 'AUTHORIZED_HOTEL_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if account_row.version <> p_expected_account_version then
    raise exception 'PASSWORD_CHANGE_ACCOUNT_STALE' using errcode = 'P0003';
  end if;

  previous_required := account_row.must_change_password;
  update public.user_accounts account
  set must_change_password = false,
      failed_login_count = 0,
      locked_until = null,
      updated_by = p_auth_user_id,
      version = account.version + 1
  where account.id = account_row.id;

  insert into public.hotel_password_change_events(
    tenant_id,
    property_id,
    account_id,
    actor_user_id,
    event_type,
    account_version_before,
    account_version_after,
    was_password_change_required
  ) values (
    account_row.tenant_id,
    account_row.property_id,
    account_row.id,
    account_row.user_id,
    'password_change_completed',
    account_row.version,
    account_row.version + 1,
    previous_required
  );

  return jsonb_build_object(
    'changed', true,
    'accountVersion', account_row.version + 1
  );
end;
$$;

comment on function public.complete_hotel_password_change(uuid,uuid,bigint) is
  'Server-only finalization after Supabase Auth accepts a password update. Version conflict leaves must_change_password unchanged and requires a fresh authenticated retry.';

revoke all on function public.prepare_hotel_password_change(text)
  from public, anon, service_role;
revoke all on function public.complete_hotel_password_change(uuid,uuid,bigint)
  from public, anon, authenticated;

grant execute on function public.prepare_hotel_password_change(text)
  to authenticated;
grant execute on function public.complete_hotel_password_change(uuid,uuid,bigint)
  to service_role;
