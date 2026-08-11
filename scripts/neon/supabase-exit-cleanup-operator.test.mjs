import assert from "node:assert/strict";
import test from "node:test";

import { cleanupSupabaseExitFixture, validateSupabaseExitCleanup } from "./supabase-exit-cleanup-operator.mjs";

const fixture = Object.freeze({
  tenantId: "11111111-1111-4111-8111-111111111111",
  propertyId: "22222222-2222-4222-8222-222222222222",
  authUserId: "33333333-3333-4333-8333-333333333333",
  profileId: "44444444-4444-4444-8444-444444444444",
  accountId: "55555555-5555-4555-8555-555555555555",
  roleAssignmentId: "66666666-6666-4666-8666-666666666666",
  objectPrefix: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/imports/",
});

test("cleanup validates the exact non-production direct bootstrap boundary", () => {
  const target = { environment: "staging", projectId: "withered-bar-40598816", branchId: "br-wispy-flower-avd4hssa", endpointId: "ep-lingering-pine-avbdti90", database: "neondb", directHostPrefix: "ep-lingering-pine-avbdti90." };
  assert.equal(validateSupabaseExitCleanup({ fixture, target, connectionString: "postgresql://neondb_owner:redacted@ep-lingering-pine-avbdti90.example/neondb?sslmode=require" }), true);
  assert.throws(() => validateSupabaseExitCleanup({ fixture: { ...fixture, objectPrefix: "imports/*" }, target, connectionString: "postgresql://neondb_owner:redacted@ep-lingering-pine-avbdti90.example/neondb?sslmode=require" }), /SUPABASE_EXIT_CLEANUP_FIXTURE_INVALID/);
  assert.throws(() => validateSupabaseExitCleanup({ fixture, target: { ...target, environment: "production" }, connectionString: "postgresql://neondb_owner:redacted@ep-lingering-pine-avbdti90.example/neondb?sslmode=require" }), /SUPABASE_EXIT_CLEANUP_TARGET_FORBIDDEN/);
});

test("cleanup is one transaction, exact-ID scoped, terminalizes retained history, and never SET ROLE", async () => {
  const calls = [];
  const client = { query: async (sql, values = []) => { calls.push([sql, values]); return /as terminal/i.test(sql) ? { rows: [{ terminal: true }] } : { rowCount: 0, rows: [] }; }, release() {} };
  const target = { environment: "staging", projectId: "withered-bar-40598816", branchId: "br-wispy-flower-avd4hssa", endpointId: "ep-lingering-pine-avbdti90", database: "neondb", directHostPrefix: "ep-lingering-pine-avbdti90." };
  const result = await cleanupSupabaseExitFixture({ fixture, target, connectionString: "postgresql://neondb_owner:redacted@ep-lingering-pine-avbdti90.example/neondb?sslmode=require", client });
  assert.equal(result.status, "terminalized");
  assert.equal(calls[0][0], "begin");
  assert.equal(calls.at(-1)[0], "commit");
  const sql = calls.map(([statement]) => statement).join("\n");
  assert.doesNotMatch(sql, /set\s+(?:local\s+)?role/i);
  assert.match(sql, /update public\.properties set status = 'inactive'/i);
  assert.match(sql, /import_commits.*status <> 'reverted'/i);
  assert.ok(calls.filter(([, values]) => values.includes(fixture.tenantId) || values.includes(fixture.propertyId) || values.includes(fixture.profileId)).length > 10);
});

test("retained append-only audit is valid cleanup evidence, not a cleanup failure", async () => {
  const calls = [];
  const client = { query: async (sql, values = []) => { calls.push([sql, values]); return /import_activity_events/.test(sql) ? { rows: [{ count: 4 }] } : /as terminal/i.test(sql) ? { rows: [{ terminal: true }] } : { rowCount: 1, rows: [] }; }, release() {} };
  const target = { environment: "staging", projectId: "withered-bar-40598816", branchId: "br-wispy-flower-avd4hssa", endpointId: "ep-lingering-pine-avbdti90", database: "neondb", directHostPrefix: "ep-lingering-pine-avbdti90." };
  const result = await cleanupSupabaseExitFixture({ fixture, target, connectionString: "postgresql://neondb_owner:redacted@ep-lingering-pine-avbdti90.example/neondb?sslmode=require", client });
  assert.equal(result.status, "terminalized");
  assert.equal(result.auditRetained, true);
  assert.equal(calls.at(-1)[0], "commit");
});
