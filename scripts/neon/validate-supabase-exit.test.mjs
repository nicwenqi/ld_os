import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVED_SUPABASE_EXIT_PREVIEW,
  createSupabaseExitFixture,
  runSupabaseExitAcceptance,
  validateSupabaseExitPreflight,
} from "./validate-supabase-exit.mjs";

const REQUIRED = Object.freeze({
  NEON_BOOTSTRAP_DATABASE_URL: "postgresql://neondb_owner:redacted@ep-lingering-pine-avbdti90.example/neondb?sslmode=require",
  DATABASE_URL: "postgresql://hotel_ld_application:redacted@ep-lingering-pine-avbdti90-pooler.example/neondb?sslmode=require",
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_preview_store_redacted",
  VERCEL_ENV: "preview",
  APP_ENV: "preview",
  PREVIEW_PROPERTY_HOSTNAME: "preview.ldchub.test",
});

test("preflight rejects production, unapproved Preview, missing protected inputs, and Supabase drift", () => {
  const valid = {
    commit: APPROVED_SUPABASE_EXIT_PREVIEW.commit,
    previewUrl: APPROVED_SUPABASE_EXIT_PREVIEW.url,
    environment: REQUIRED,
    activeSource: "export const mode = 'neon';",
  };
  assert.equal(validateSupabaseExitPreflight(valid), true);
  assert.throws(() => validateSupabaseExitPreflight({ ...valid, previewUrl: "https://hotel-ld-os.vercel.app" }), /SUPABASE_EXIT_PREVIEW_FORBIDDEN/);
  assert.throws(() => validateSupabaseExitPreflight({ ...valid, commit: "deadbeef" }), /SUPABASE_EXIT_COMMIT_UNAPPROVED/);
  assert.throws(() => validateSupabaseExitPreflight({ ...valid, environment: { ...REQUIRED, APP_ENV: "production" } }), /SUPABASE_EXIT_PRODUCTION_FORBIDDEN/);
  assert.throws(() => validateSupabaseExitPreflight({ ...valid, environment: { ...REQUIRED, DATABASE_URL: "" } }), /SUPABASE_EXIT_ENV_MISSING/);
  assert.throws(() => validateSupabaseExitPreflight({ ...valid, activeSource: "import '@supabase/supabase-js';" }), /SUPABASE_EXIT_SOURCE_DRIFT/);
});

test("fixture is unique, acceptance-only, and retains only exact cleanup identifiers", () => {
  const fixture = createSupabaseExitFixture({ authUserId: "05a561ea-1e14-4920-abd1-ff41b9e29bee", nonce: "a1b2c3d4" });
  assert.equal(fixture.kind, "supabase-exit-acceptance");
  assert.equal(fixture.propertyDomain.hostname, "preview.ldchub.test");
  assert.equal(fixture.cleanup.tenantId, fixture.tenant.id);
  assert.equal(fixture.cleanup.propertyId, fixture.property.id);
  assert.equal(fixture.cleanup.authUserId, "05a561ea-1e14-4920-abd1-ff41b9e29bee");
  assert.match(fixture.manager.loginId, /^acceptance-a1b2c3d4$/);
});

test("operator fails closed and always executes exact cleanup after a workflow failure", async () => {
  const calls = [];
  const result = await runSupabaseExitAcceptance({
    preflight: async () => { calls.push("preflight"); },
    createIdentity: async () => { calls.push("identity"); return { userId: "05a561ea-1e14-4920-abd1-ff41b9e29bee", password: "never-output" }; },
    initialize: async () => { calls.push("initialize"); },
    validateRuntime: async () => { calls.push("runtime"); throw Object.assign(new Error("scope denied"), { code: "SCOPE_DENIED" }); },
    cleanup: async (fixture) => { calls.push(["cleanup", fixture.cleanup.propertyId]); },
    fixtureFactory: () => createSupabaseExitFixture({ authUserId: "05a561ea-1e14-4920-abd1-ff41b9e29bee", nonce: "f00dbabe" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.gates.NEON_AUTHORIZATION_AND_SCOPE, "FAIL");
  assert.equal(result.gates.FIXTURE_CLEANUP, "PASS");
  assert.deepEqual(calls.slice(0, 4), ["preflight", "identity", "initialize", "runtime"]);
  assert.equal(calls[4][0], "cleanup");
  assert.equal(result.detail, "SCOPE_DENIED");
  assert.doesNotMatch(JSON.stringify(result), /never-output/);
});

test("operator reports cleanup failure as final failure even when acceptance stages pass", async () => {
  const result = await runSupabaseExitAcceptance({
    preflight: async () => {},
    createIdentity: async () => ({ userId: "05a561ea-1e14-4920-abd1-ff41b9e29bee" }),
    initialize: async () => {},
    validateRuntime: async () => {},
    validateBusiness: async () => {},
    validateProperty: async () => {},
    validateImport: async () => {},
    validateZeroSupabase: async () => {},
    cleanup: async () => { throw Object.assign(new Error("cleanup failed"), { code: "CLEANUP_FAILED" }); },
    fixtureFactory: () => createSupabaseExitFixture({ authUserId: "05a561ea-1e14-4920-abd1-ff41b9e29bee", nonce: "badc0de1" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.gates.FIXTURE_CLEANUP, "FAIL");
  assert.equal(result.gates.SUPABASE_SAFE_TO_DELETE, "FAIL");
  assert.equal(result.detail, "CLEANUP_FAILED");
});
