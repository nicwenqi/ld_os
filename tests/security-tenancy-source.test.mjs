import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const migrationsDir = new URL("../supabase/migrations/", import.meta.url);

async function migrationSource() {
  const files = (await readdir(migrationsDir)).filter(file => file.endsWith(".sql")).sort();
  return (await Promise.all(files.map(file => readFile(new URL(file, migrationsDir), "utf8")))).join("\n");
}

test("Checkpoint 2B.1 migration contains only approved foundation tables", async () => {
  const sql = await migrationSource();
  for (const table of [
    "profiles", "platform_memberships", "tenants", "tenant_memberships", "properties",
    "property_memberships", "roles", "role_assignments", "trainer_scopes",
  ]) assert.match(sql, new RegExp(`create table public\\.${table}\\b`, "i"));

  for (const forbidden of ["departments", "employees", "import_batches", "courses", "training_sessions", "kpi_definitions"])
    assert.doesNotMatch(sql, new RegExp(`create table public\\.${forbidden}\\b`, "i"));

  const profilesDefinition = sql.match(/create table public\.profiles \([\s\S]*?\n\);/i)?.[0] || "";
  assert.doesNotMatch(profilesDefinition, /is_platform_admin/i);
});

test("authorization helpers are private, identity-bound, and explicitly granted", async () => {
  const sql = await migrationSource();
  for (const helper of ["is_platform_admin", "is_tenant_member", "is_tenant_admin", "is_property_member", "has_property_role"])
    assert.match(sql, new RegExp(`function app_private\\.${helper}\\(`, "i"));
  assert.match(sql, /set search_path = ''/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.doesNotMatch(sql, /user_metadata/i);
  assert.doesNotMatch(sql, /execute\s+format\s*\(/i);
  assert.match(sql, /revoke execute on all functions in schema app_private from public, anon/i);
});

test("all approved public tables enable RLS without broad authenticated or anonymous policies", async () => {
  const sql = await migrationSource();
  for (const table of [
    "profiles", "platform_memberships", "tenants", "tenant_memberships", "properties",
    "property_memberships", "roles", "role_assignments", "trainer_scopes",
  ]) assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  assert.doesNotMatch(sql, /to\s+(?:authenticated|anon)[\s\S]{0,160}using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /to\s+(?:authenticated|anon)[\s\S]{0,160}with check\s*\(\s*true\s*\)/i);

  const updatePolicies = [...sql.matchAll(/create policy\s+\S+\s+on\s+public\.\S+\s+for update\s+to authenticated([\s\S]*?);/gi)];
  assert.equal(updatePolicies.length, 9);
  for (const [, policy] of updatePolicies) {
    assert.match(policy, /\busing\s*\(/i);
    assert.match(policy, /\bwith check\s*\(/i);
  }
});
