begin;

create role hotel_ld_migration_owner
  nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication;

create role hotel_ld_application
  login noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication;

grant hotel_ld_migration_owner to session_user
  with inherit false, set true, admin false;

create schema app_private authorization hotel_ld_migration_owner;
alter schema public owner to hotel_ld_migration_owner;

revoke all on schema app_private from public;
revoke create on schema public from public;

alter default privileges for role hotel_ld_migration_owner
  revoke execute on functions from public;

commit;
