import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVED_SUPABASE_EXIT_PREVIEW,
  cleanupSupabaseExitBlobObjects,
  createSupabaseExitFixture,
  readApprovedDeploymentMetadata,
  runSupabaseExitAcceptance,
  validateTrackedWorktreePaths,
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

test("Blob cleanup is exact-prefix only and treats object-not-found as idempotent", async () => {
  const calls = [];
  await cleanupSupabaseExitBlobObjects({
    cleanup: { tenantId: "11111111-1111-4111-8111-111111111111", propertyId: "22222222-2222-4222-8222-222222222222", objectPrefix: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/imports/" },
    token: "redacted",
    blob: {
      list: async input => { calls.push(["list", input]); return calls.filter(([kind]) => kind === "list").length === 1 ? { blobs: [{ url: "https://blob.example/a" }] } : { blobs: [] }; },
      del: async (urls, input) => { calls.push(["del", urls, input]); },
    },
  });
  assert.equal(calls[0][1].prefix, "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/imports/");
  assert.deepEqual(calls[1][1], ["https://blob.example/a"]);
  await cleanupSupabaseExitBlobObjects({ cleanup: { tenantId: "11111111-1111-4111-8111-111111111111", propertyId: "22222222-2222-4222-8222-222222222222", objectPrefix: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/imports/" }, token: "redacted", blob: { list: async () => ({ blobs: [] }), del: async () => { throw new Error("unused"); } } });
  let reads = 0;
  await cleanupSupabaseExitBlobObjects({ cleanup: { tenantId: "11111111-1111-4111-8111-111111111111", propertyId: "22222222-2222-4222-8222-222222222222", objectPrefix: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/imports/" }, token: "redacted", blob: { list: async () => ({ blobs: ++reads === 1 ? [{ url: "https://blob.example/raced" }] : [] }), del: async () => { throw Object.assign(new Error("gone"), { status: 404 }); } } });
});

test("deployment metadata must contain exact local HEAD, branch, owner and Preview target", () => {
  const local = "a".repeat(40);
  const metadata = { projectId: APPROVED_SUPABASE_EXIT_PREVIEW.projectId, teamId: APPROVED_SUPABASE_EXIT_PREVIEW.teamId, target: "preview", readyState: "READY", alias: [APPROVED_SUPABASE_EXIT_PREVIEW.url], gitSource: { sha: local, ref: APPROVED_SUPABASE_EXIT_PREVIEW.branch } };
  assert.equal(readApprovedDeploymentMetadata(JSON.stringify(metadata), { localCommit: local, previewUrl: APPROVED_SUPABASE_EXIT_PREVIEW.url }).commit, local);
  assert.throws(() => readApprovedDeploymentMetadata(JSON.stringify({ ...metadata, gitSource: { sha: "e06832a107566d3b5af40da0adb61c2379366719", ref: APPROVED_SUPABASE_EXIT_PREVIEW.branch } }), { localCommit: local, previewUrl: APPROVED_SUPABASE_EXIT_PREVIEW.url }), /SUPABASE_EXIT_COMMIT_UNAPPROVED|SUPABASE_EXIT_DEPLOYMENT_METADATA_UNAPPROVED/);
  assert.throws(() => readApprovedDeploymentMetadata(JSON.stringify({ ...metadata, gitSource: { sha: "d".repeat(40), ref: APPROVED_SUPABASE_EXIT_PREVIEW.branch } }), { localCommit: local, previewUrl: APPROVED_SUPABASE_EXIT_PREVIEW.url }), /SUPABASE_EXIT_COMMIT_UNAPPROVED|SUPABASE_EXIT_DEPLOYMENT_METADATA_UNAPPROVED/);
  assert.throws(() => readApprovedDeploymentMetadata(JSON.stringify({ ...metadata, gitSource: { sha: local, ref: "codex/other" } }), { localCommit: local, previewUrl: APPROVED_SUPABASE_EXIT_PREVIEW.url }), /SUPABASE_EXIT_DEPLOYMENT_METADATA_UNAPPROVED/);
  assert.throws(() => readApprovedDeploymentMetadata(JSON.stringify({ ...metadata, target: "production" }), { localCommit: local, previewUrl: APPROVED_SUPABASE_EXIT_PREVIEW.url }), /SUPABASE_EXIT_PRODUCTION_FORBIDDEN/);
  assert.throws(() => readApprovedDeploymentMetadata("not-json", { localCommit: local, previewUrl: APPROVED_SUPABASE_EXIT_PREVIEW.url }), /SUPABASE_EXIT_DEPLOYMENT_METADATA_INVALID/);
});

test("preflight accepts exact local HEAD and rejects static self-reference", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./validate-supabase-exit.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /e06832a107566d3b5af40da0adb61c2379366719/);
  assert.doesNotMatch(source, /(?:commit|sha)\s*:\s*["'][0-9a-f]{40}["']/i);
  const local = "b".repeat(40);
  assert.equal(validateSupabaseExitPreflight({ localCommit: local, deploymentCommit: local, branch: APPROVED_SUPABASE_EXIT_PREVIEW.branch, deploymentBranch: APPROVED_SUPABASE_EXIT_PREVIEW.branch, projectId: APPROVED_SUPABASE_EXIT_PREVIEW.projectId, teamId: APPROVED_SUPABASE_EXIT_PREVIEW.teamId, deploymentTarget: "preview", previewUrl: APPROVED_SUPABASE_EXIT_PREVIEW.url, environment: REQUIRED, activeSource: "export const mode = 'neon';" }), true);
  assert.throws(() => validateSupabaseExitPreflight({ localCommit: local, deploymentCommit: local, branch: "codex/other", deploymentBranch: "codex/other", projectId: APPROVED_SUPABASE_EXIT_PREVIEW.projectId, teamId: APPROVED_SUPABASE_EXIT_PREVIEW.teamId, deploymentTarget: "preview", previewUrl: APPROVED_SUPABASE_EXIT_PREVIEW.url, environment: REQUIRED, activeSource: "export const mode = 'neon';" }), /SUPABASE_EXIT_BRANCH_UNAPPROVED/);
});

test("preflight rejects production, unapproved Preview, missing protected inputs, and Supabase drift", () => {
  const valid = {
    localCommit: "c".repeat(40),
    deploymentCommit: "c".repeat(40),
    branch: APPROVED_SUPABASE_EXIT_PREVIEW.branch,
    deploymentBranch: APPROVED_SUPABASE_EXIT_PREVIEW.branch,
    projectId: APPROVED_SUPABASE_EXIT_PREVIEW.projectId,
    teamId: APPROVED_SUPABASE_EXIT_PREVIEW.teamId,
    deploymentTarget: "preview",
    previewUrl: APPROVED_SUPABASE_EXIT_PREVIEW.url,
    environment: REQUIRED,
    activeSource: "export const mode = 'neon';",
  };
  assert.equal(validateSupabaseExitPreflight(valid), true);
  assert.throws(() => validateSupabaseExitPreflight({ ...valid, previewUrl: "https://hotel-ld-os.vercel.app" }), /SUPABASE_EXIT_PREVIEW_FORBIDDEN/);
  assert.throws(() => validateSupabaseExitPreflight({ ...valid, deploymentCommit: "d".repeat(40) }), /SUPABASE_EXIT_COMMIT_UNAPPROVED/);
  assert.throws(() => validateSupabaseExitPreflight({ ...valid, environment: { ...REQUIRED, APP_ENV: "production" } }), /SUPABASE_EXIT_PRODUCTION_FORBIDDEN/);
  assert.throws(() => validateSupabaseExitPreflight({ ...valid, environment: { ...REQUIRED, DATABASE_URL: "" } }), /SUPABASE_EXIT_ENV_MISSING/);
  assert.throws(() => validateSupabaseExitPreflight({ ...valid, activeSource: "import '@supabase/supabase-js';" }), /SUPABASE_EXIT_SOURCE_DRIFT/);
});

test("tracked worktree validation excludes only the progress ledger", () => {
  assert.equal(validateTrackedWorktreePaths(".superpowers/sdd/example/progress.md\n"), true);
  assert.equal(validateTrackedWorktreePaths(""), true);
  assert.throws(() => validateTrackedWorktreePaths("scripts/neon/validate-supabase-exit.mjs"), /SUPABASE_EXIT_WORKTREE_DRIFT/);
  assert.throws(() => validateTrackedWorktreePaths("app/api/import/route.ts\n.superpowers/sdd/example/progress.md"), /SUPABASE_EXIT_WORKTREE_DRIFT/);
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
