import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function source(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

function assertConstrainedEntrypoint(sql, signature) {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const functionName = signature.slice(0, signature.indexOf("("));
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(sql, new RegExp(`set local role hotel_ld_migration_owner;[\\s\\S]*create function public\\.${escaped}`));
  assert.match(sql, new RegExp(`create function public\\.${escaped}[\\s\\S]*?security definer set search_path = ''`));
  assert.match(sql, new RegExp(`revoke all on function public\\.${escapedName}\\(text\\) from public;`));
  assert.match(sql, new RegExp(`grant execute on function public\\.${escapedName}\\(text\\) to hotel_ld_application;`));
  assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${escapedName}\\(text\\) to (?:public|anon|authenticated);`));
}

test("authorization entrypoints retain owner, definer, fixed search_path, and exact ACL", async () => {
  const property = await source("neon/canonical/080_property_initialization.sql");
  const authorization = await source("neon/canonical/085_auth_authorization.sql");

  assertConstrainedEntrypoint(property, "resolve_neon_property_context(p_hostname text)");
  assertConstrainedEntrypoint(authorization, "read_neon_authorization_session(p_hostname text)");
});

test("authorization modules do not widen RLS or raw runtime privileges", async () => {
  const property = await source("neon/canonical/080_property_initialization.sql");
  const authorization = await source("neon/canonical/085_auth_authorization.sql");
  const combined = `${property}\n${authorization}`;

  assert.doesNotMatch(authorization, /create policy|alter policy|drop policy/i);
  assert.doesNotMatch(combined, /grant\s+(?:select|insert|update|delete|truncate|references|trigger|all)\s+on\s+(?:table|all\s+tables|sequence|all\s+sequences|schema)\b[\s\S]*?to\s+hotel_ld_application/i);
  assert.match(combined, /revoke all on (?:public|function|app_private)/i);
});

test("server authorization repository uses only the two constrained Neon entrypoints", async () => {
  const repository = await source("app/repositories/neon/authorization-session-repository.ts");
  const propertyContext = await source("app/lib/neon/property-context.ts");
  assert.match(repository, /resolveNeonPropertyScope\(hostname, database\)/);
  assert.match(propertyContext, /public\.resolve_neon_property_context\(\$1::text\)/);
  assert.match(repository, /public\.read_neon_authorization_session\(\$1::text\)/);
  assert.doesNotMatch(repository, /\.from\s*\(|\.rpc\s*\(|createServerActorClient|createClient\s*\(/);
});

test("request authentication resolves Better Auth identity and re-resolves Neon authority", async () => {
  const requestAuthentication = await source("app/services/request-authentication.ts");
  assert.match(requestAuthentication, /resolveBetterAuthIdentity\(request\)/);
  assert.match(requestAuthentication, /resolveNeonAuthorizationForAuthUser\s*\(/);
  assert.match(requestAuthentication, /isApprovedBackendSession\s*\(/);
  assert.match(requestAuthentication, /mustChangePassword/);
  assert.match(requestAuthentication, /refreshedCookies/);
  assert.doesNotMatch(requestAuthentication, /refreshSession\s*\(|\.from\s*\(|\.rpc\s*\(|supabase/i);
});

test("catalog and runtime validators cover authorization identity, scope, isolation, and raw denial", async () => {
  const manifest = await source("neon/canonical/manifest.json");
  const runtime = await source("scripts/neon/validate-canonical-neon-baseline.mjs");
  assert.match(manifest, /public\.read_neon_authorization_session\(text\)/);
  assert.match(manifest, /public\.resolve_neon_property_context\(text\)/);
  for (const stage of [
    "actor-context-reuse",
    "resolved-actor",
    "manager-reads",
    "department-admin-reads",
    "scope-denials",
    "raw-access-denials",
    "concurrent-isolation",
    "entrypoint-smoke",
  ]) {
    assert.match(runtime, new RegExp(`runCanonicalRuntimeStage\\(\\"${stage}\\"`));
  }
  assert.match(runtime, /runtime_raw_privileges_empty/);
  assert.match(runtime, /withNeonResolvedActorContext/);
  assert.match(runtime, /runtimePool\.connect\(\)/);
});
