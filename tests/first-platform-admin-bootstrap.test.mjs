import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);

async function bootstrapMigration() {
  const files = (await readdir(migrationDirectory)).filter(file =>
    file.endsWith("_first_platform_admin_bootstrap.sql"),
  );
  assert.equal(files.length, 1, "one first-platform-admin bootstrap migration must exist");
  return readFile(new URL(files[0], migrationDirectory), "utf8");
}

test("first platform-admin bootstrap is a service-only one-time RPC", async () => {
  const sql = await bootstrapMigration();
  assert.match(sql, /create table public\.platform_bootstrap_events\b/i);
  assert.match(sql, /create or replace function public\.bootstrap_first_platform_admin\(\s*p_auth_user_id uuid,\s*p_email text,\s*p_display_name text,\s*p_request_id text\s*\)/is);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = ''/i);
  assert.match(sql, /revoke all on function public\.bootstrap_first_platform_admin[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.bootstrap_first_platform_admin[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /grant\s+.*on\s+table[\s\S]*to service_role/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /platform_admin_count|platform_memberships[\s\S]*role_code\s*=\s*'platform_admin'/i);
  assert.match(sql, /platform_bootstrap_events[\s\S]*count|exists\s*\([\s\S]*platform_bootstrap_events/i);
});

test("bootstrap creates only identity linkage and append-only evidence", async () => {
  const sql = await bootstrapMigration();
  for (const table of ["profiles", "platform_memberships", "platform_bootstrap_events"]) {
    assert.match(sql, new RegExp(`insert\\s+into\\s+public\\.${table}\\b`, "i"));
  }
  for (const forbidden of [
    "tenants", "properties", "property_domains", "user_accounts", "employees",
    "courses", "training_requirements", "training_plans", "training_sessions",
    "attendance", "completion",
  ]) {
    assert.doesNotMatch(sql, new RegExp(`insert\\s+into\\s+public\\.${forbidden}\\b`, "i"));
  }
  assert.match(sql, /before update or delete on public\.platform_bootstrap_events/i);
  assert.match(sql, /platform_bootstrap_events[\s\S]*append-only/i);
});

test("bootstrap command uses server Admin API and compensates only a newly created Auth identity", async () => {
  const script = await readFile(new URL("../scripts/bootstrap-first-platform-admin.mjs", import.meta.url), "utf8");
  assert.match(script, /createClient/);
  assert.match(script, /auth\.admin\.createUser/);
  assert.match(script, /rpc\(["']bootstrap_first_platform_admin["']/);
  assert.match(script, /auth\.admin\.deleteUser/);
  assert.match(script, /FIRST_PLATFORM_ADMIN_BOOTSTRAP_CONFIRM/);
  assert.doesNotMatch(script, /from\(["']platform_bootstrap_events["']\)/);
  assert.doesNotMatch(script, /from\(["'](?:tenants|properties|employees|training_plans|training_sessions)["']\)\.(?:insert|update|upsert)/);
  assert.doesNotMatch(script, /SUPABASE_SERVICE_ROLE_KEY/);
});
