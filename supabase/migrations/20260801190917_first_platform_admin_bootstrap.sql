-- First Platform Admin Bootstrap
--
-- This is a control-plane capability only. It creates no Property, hotel
-- account, employee, or D0-D4 fact. The Auth identity is created by the
-- server-only bootstrap command; this RPC creates only its authorization
-- linkage and append-only bootstrap evidence.

create table public.platform_bootstrap_events (
  id uuid primary key default extensions.gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  email text not null,
  display_name text not null,
  request_id text not null,
  request_hash text not null,
  event_type text not null default 'first_platform_admin_bootstrapped',
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint platform_bootstrap_events_request_id_key unique (request_id),
  constraint platform_bootstrap_events_email_check check (btrim(email) <> ''),
  constraint platform_bootstrap_events_display_name_check check (btrim(display_name) <> ''),
  constraint platform_bootstrap_events_request_hash_check check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint platform_bootstrap_events_type_check check (event_type = 'first_platform_admin_bootstrapped'),
  constraint platform_bootstrap_events_evidence_check check (jsonb_typeof(evidence) = 'object')
);

create index platform_bootstrap_events_occurred_idx
  on public.platform_bootstrap_events(occurred_at desc);

alter table public.platform_bootstrap_events enable row level security;
alter table public.platform_bootstrap_events force row level security;
revoke all on public.platform_bootstrap_events from public, anon, authenticated, service_role;

create or replace function app_private.reject_platform_bootstrap_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'first platform admin bootstrap evidence is append-only'
    using errcode = '42501';
end;
$$;

revoke all on function app_private.reject_platform_bootstrap_event_mutation()
  from public, anon, authenticated, service_role;

create trigger platform_bootstrap_events_append_only
before update or delete on public.platform_bootstrap_events
for each row execute function app_private.reject_platform_bootstrap_event_mutation();

create or replace function public.bootstrap_first_platform_admin(
  p_auth_user_id uuid,
  p_email text,
  p_display_name text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  normalized_display_name text := btrim(coalesce(p_display_name, ''));
  normalized_request_id text := btrim(coalesce(p_request_id, ''));
  auth_email text;
  audit_id uuid;
  request_hash text;
begin
  if coalesce((select auth.jwt()->>'role'), '') <> 'service_role' then
    raise exception 'FIRST_PLATFORM_ADMIN_BOOTSTRAP_SERVER_ONLY' using errcode = '42501';
  end if;

  if p_auth_user_id is null
    or normalized_email = ''
    or normalized_display_name = ''
    or normalized_request_id = ''
    or char_length(normalized_email) > 320
    or char_length(normalized_display_name) > 160
    or char_length(normalized_request_id) > 120 then
    raise exception 'FIRST_PLATFORM_ADMIN_BOOTSTRAP_INPUT_INVALID' using errcode = '22023';
  end if;

  select lower(auth_identity.email)
    into auth_email
    from auth.users auth_identity
   where auth_identity.id = p_auth_user_id;

  if auth_email is null or auth_email <> normalized_email then
    raise exception 'FIRST_PLATFORM_ADMIN_BOOTSTRAP_AUTH_IDENTITY_MISMATCH' using errcode = '22023';
  end if;

  -- Serialize the global first-run check. The audit row remains the durable
  -- one-time marker even if the first admin is later revoked.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hotel_ld_first_platform_admin_bootstrap', 0)
  );

  if exists (
    select 1
      from public.platform_memberships membership
     where membership.role_code = 'platform_admin'
  ) or exists (
    select 1
      from public.platform_bootstrap_events event
  ) then
    raise exception 'FIRST_PLATFORM_ADMIN_BOOTSTRAP_CLOSED' using errcode = '42501';
  end if;

  request_hash := encode(
    extensions.digest(
      p_auth_user_id::text || '|' || normalized_email || '|' ||
      normalized_display_name || '|' || normalized_request_id,
      'sha256'
    ),
    'hex'
  );

  insert into public.profiles(id, email, display_name, full_name, is_active)
  values (
    p_auth_user_id, normalized_email, normalized_display_name,
    normalized_display_name, true
  );

  insert into public.platform_memberships(
    user_id, role_code, is_active, granted_by, granted_at
  ) values (
    p_auth_user_id, 'platform_admin', true, null, now()
  );

  insert into public.platform_bootstrap_events(
    auth_user_id, email, display_name, request_id, request_hash, evidence
  ) values (
    p_auth_user_id,
    normalized_email,
    normalized_display_name,
    normalized_request_id,
    request_hash,
    jsonb_build_object(
      'bootstrapVersion', 1,
      'roleCode', 'platform_admin',
      'authIdentityCreatedOutsideTransaction', true,
      'propertyCreated', false,
      'hotelManagerCreated', false,
      'employeeFactsCreated', false,
      'trainingFactsCreated', false
    )
  )
  returning id into audit_id;

  return jsonb_build_object(
    'bootstrapState', 'completed',
    'roleCode', 'platform_admin',
    'auditId', audit_id
  );
end;
$$;

comment on function public.bootstrap_first_platform_admin(uuid, text, text, text) is
  'One-time server-only creation of the first platform_admin authorization linkage. It never creates a Property, hotel account, employee, or training fact.';

revoke all on function public.bootstrap_first_platform_admin(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.bootstrap_first_platform_admin(uuid, text, text, text)
  to service_role;
