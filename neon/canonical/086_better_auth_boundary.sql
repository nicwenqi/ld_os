begin;

create role hotel_ld_auth_service
  login noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication;

grant hotel_ld_auth_service to session_user
  with inherit false, set true, admin false;

create schema app_auth authorization hotel_ld_auth_service;

revoke all on schema public from hotel_ld_auth_service;
revoke all on schema app_private from hotel_ld_auth_service;
revoke all on schema app_auth from public;
revoke all on schema app_auth from hotel_ld_application;
grant usage, create on schema app_auth to hotel_ld_auth_service;
grant connect on database neondb to hotel_ld_auth_service;

alter role hotel_ld_auth_service set search_path = app_auth, pg_catalog;

commit;
