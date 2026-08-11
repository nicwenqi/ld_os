import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import { validateBetterAuthBoundarySource } from "./validate-better-auth-boundary.mjs";

const secureBoundary = `
begin;
create role hotel_ld_auth_service login noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
grant hotel_ld_auth_service to session_user with inherit false, set true, admin false;
create schema app_auth authorization hotel_ld_auth_service;
revoke all on schema public from hotel_ld_auth_service;
revoke all on schema app_private from hotel_ld_auth_service;
revoke all on schema app_auth from public;
revoke all on schema app_auth from hotel_ld_application;
grant usage, create on schema app_auth to hotel_ld_auth_service;
grant connect on database neondb to hotel_ld_auth_service;
alter role hotel_ld_auth_service set search_path = app_auth, pg_catalog;
commit;
`;

test("Better Auth boundary grants its service role only the isolated auth schema", () => {
  assert.deepEqual(validateBetterAuthBoundarySource(secureBoundary), {
    schema: "app_auth",
    role: "hotel_ld_auth_service",
  });
});

test("Better Auth boundary rejects a business grant or application access to app_auth", () => {
  assert.throws(
    () => validateBetterAuthBoundarySource(`${secureBoundary}\ngrant select on public.employees to hotel_ld_auth_service;`),
    /AUTH_SERVICE_BUSINESS_PRIVILEGE/,
  );
  assert.throws(
    () => validateBetterAuthBoundarySource(`${secureBoundary}\ngrant usage on schema app_auth to hotel_ld_application;`),
    /APPLICATION_AUTH_SCHEMA_PRIVILEGE/,
  );
});

test("Better Auth boundary rejects role membership and unsafe role attributes", () => {
  assert.throws(
    () => validateBetterAuthBoundarySource(secureBoundary.replace("noinherit", "inherit")),
    /AUTH_SERVICE_ROLE_SECURITY/,
  );
  assert.throws(
    () => validateBetterAuthBoundarySource(`${secureBoundary}\ngrant hotel_ld_application to hotel_ld_auth_service;`),
    /AUTH_SERVICE_ROLE_MEMBERSHIP/,
  );
});

test("Better Auth boundary permits only bootstrap-session SET membership needed for schema ownership", () => {
  const missingBootstrapSet = secureBoundary.replace(
    "grant hotel_ld_auth_service to session_user with inherit false, set true, admin false;\n",
    "",
  );
  assert.throws(
    () => validateBetterAuthBoundarySource(missingBootstrapSet),
    /AUTH_SERVICE_BOOTSTRAP_MEMBERSHIP/,
  );
  assert.doesNotThrow(() => validateBetterAuthBoundarySource(secureBoundary));
});

test("Better Auth migrations keep credential and session tables private to app_auth", async () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../neon/canonical");
  const source = await readFile(join(root, "087_better_auth_tables.sql"), "utf8");
  for (const table of ["auth_user", "auth_session", "auth_account", "auth_verification"]) {
    assert.match(source, new RegExp(`create table app_auth\\.${table}\\b`, "i"));
  }
  assert.match(source, /set local role hotel_ld_auth_service/i);
  assert.doesNotMatch(source, /\b(?:public|app_private)\./i);
  assert.doesNotMatch(source, /grant\s+.*\s+to\s+hotel_ld_application/i);
});
