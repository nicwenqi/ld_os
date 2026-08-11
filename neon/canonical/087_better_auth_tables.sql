begin;

set local role hotel_ld_auth_service;

create table app_auth.auth_user (
  id uuid primary key,
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table app_auth.auth_session (
  id uuid primary key,
  expires_at timestamptz not null,
  token text not null unique,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  ip_address text,
  user_agent text,
  user_id uuid not null references app_auth.auth_user(id) on delete cascade
);

create index auth_session_user_id_idx on app_auth.auth_session(user_id);

create table app_auth.auth_account (
  id uuid primary key,
  account_id text not null,
  provider_id text not null,
  user_id uuid not null references app_auth.auth_user(id) on delete cascade,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index auth_account_user_id_idx on app_auth.auth_account(user_id);

create table app_auth.auth_verification (
  id uuid primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index auth_verification_identifier_idx on app_auth.auth_verification(identifier);

revoke all on all tables in schema app_auth from public;
revoke all on all sequences in schema app_auth from public;
revoke all on all tables in schema app_auth from hotel_ld_application;
revoke all on all sequences in schema app_auth from hotel_ld_application;

commit;
