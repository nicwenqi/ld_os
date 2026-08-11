import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVED_SUPABASE_EXIT_PREVIEW,
  cleanupSupabaseExitBlobObjects,
  createProtectedPreviewRequest,
  createSupabaseExitFixture,
  execute,
  readApprovedDeploymentMetadata,
  runSupabaseExitAcceptance,
  validateTrackedWorktreePaths,
  validateSupabaseExitPreflight,
} from "./validate-supabase-exit.mjs";

const REQUIRED = Object.freeze({
  NEON_BOOTSTRAP_DATABASE_URL: "postgresql://neondb_owner:redacted@ep-lingering-pine-avbdti90.example/neondb?sslmode=require",
  DATABASE_URL: "postgresql://hotel_ld_application:redacted@ep-lingering-pine-avbdti90-pooler.example/neondb?sslmode=require",
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_preview_store_redacted",
  VERCEL_AUTOMATION_BYPASS_SECRET: "vercel_automation_bypass_preview_redacted",
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
  const previewHostname = new URL(APPROVED_SUPABASE_EXIT_PREVIEW.url).hostname;
  const metadata = { projectId: APPROVED_SUPABASE_EXIT_PREVIEW.projectId, teamId: APPROVED_SUPABASE_EXIT_PREVIEW.teamId, target: "preview", readyState: "READY", alias: [previewHostname], gitSource: { sha: local, ref: APPROVED_SUPABASE_EXIT_PREVIEW.branch } };
  assert.equal(readApprovedDeploymentMetadata(JSON.stringify(metadata), { localCommit: local, previewUrl: APPROVED_SUPABASE_EXIT_PREVIEW.url }).commit, local);
  assert.equal(readApprovedDeploymentMetadata(JSON.stringify({ ...metadata, alias: [previewHostname] }), { localCommit: local, previewUrl: `https://${previewHostname}` }).commit, local);
  assert.throws(() => readApprovedDeploymentMetadata(JSON.stringify({ ...metadata, alias: ["other.example"] }), { localCommit: local, previewUrl: APPROVED_SUPABASE_EXIT_PREVIEW.url }), /SUPABASE_EXIT_DEPLOYMENT_METADATA_UNAPPROVED/);
  assert.throws(() => readApprovedDeploymentMetadata(JSON.stringify({ ...metadata, alias: [`x.${previewHostname}`] }), { localCommit: local, previewUrl: APPROVED_SUPABASE_EXIT_PREVIEW.url }), /SUPABASE_EXIT_DEPLOYMENT_METADATA_UNAPPROVED/);
  assert.throws(() => readApprovedDeploymentMetadata(JSON.stringify({ ...metadata, alias: [`${previewHostname}.evil.example`] }), { localCommit: local, previewUrl: APPROVED_SUPABASE_EXIT_PREVIEW.url }), /SUPABASE_EXIT_DEPLOYMENT_METADATA_UNAPPROVED/);
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

test("child-process diagnostics identify operation and never expose secrets", async () => {
  const secret = "operator-secret-must-not-appear";
  const captureFailure = async action => {
    let captured;
    try { await action(); } catch (error) { captured = error; }
    assert.ok(captured);
    return captured;
  };
  const previewFailure = await captureFailure(() => execute(process.execPath, ["-e", `process.stderr.write(${JSON.stringify(secret)}); process.exit(17)`], { operation: "PREVIEW_PROBE", timeoutMs: 1_000 }));
  const inspectError = await captureFailure(() => execute(process.execPath, ["-e", `process.stderr.write(${JSON.stringify(secret)}); process.exit(23)`], { operation: "VERCEL_INSPECT", timeoutMs: 1_000 }));
  const timeoutError = await captureFailure(() => execute(process.execPath, ["-e", "setTimeout(() => {}, 5_000)"], { operation: "RUNTIME_VALIDATION", timeoutMs: 20 }));
  assert.equal(previewFailure.code, "SUPABASE_EXIT_OPERATOR_COMMAND_FAILED:PREVIEW_PROBE:EXIT_17");
  assert.equal(inspectError.code, "SUPABASE_EXIT_OPERATOR_COMMAND_FAILED:VERCEL_INSPECT:EXIT_23");
  assert.equal(timeoutError.code, "SUPABASE_EXIT_OPERATOR_TIMEOUT:RUNTIME_VALIDATION");
  assert.doesNotMatch(JSON.stringify({ previewFailure, inspectError, timeoutError }), new RegExp(secret));
});

test("protected direct Preview transport sends bypass header and retains only in-memory cookies", async () => {
  const calls = [];
  const bypassSecret = "protected-bypass-value";
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), headers: new Headers(options.headers) });
    return {
      ok: true,
      status: 200,
      headers: { getSetCookie: () => ["better-auth.session_token=opaque-session; Path=/; HttpOnly"] },
      text: async () => JSON.stringify({ ok: true }),
    };
  };
  const request = createProtectedPreviewRequest({ bypassSecret, fetchImpl });
  assert.deepEqual(await request("/", { operation: "PREVIEW_PROBE" }), { ok: true });
  assert.deepEqual(await request("/api/auth/session", { operation: "AUTH_SESSION" }), { ok: true });
  assert.equal(calls[0].url, `${APPROVED_SUPABASE_EXIT_PREVIEW.url}/`);
  assert.equal(calls[0].headers.get("x-vercel-protection-bypass"), bypassSecret);
  assert.equal(calls[0].headers.get("x-vercel-set-bypass-cookie"), "true");
  assert.equal(calls[1].headers.get("cookie"), "better-auth.session_token=opaque-session");
  assert.doesNotMatch(JSON.stringify(await request("/api/auth/session", { operation: "AUTH_SESSION" })), new RegExp(bypassSecret));
});

test("first protected Preview request follows one same-origin 307 only after storing its bypass cookie", async () => {
  const bypassSecret = "protected-bypass-value";
  const bypassCookie = "vercel-protection=opaque-bypass-cookie";
  const calls = [];
  const request = createProtectedPreviewRequest({
    bypassSecret,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) {
        return {
          ok: false,
          status: 307,
          headers: { get: name => name === "location" ? `${APPROVED_SUPABASE_EXIT_PREVIEW.url}/` : null, getSetCookie: () => [`${bypassCookie}; Path=/; HttpOnly`] },
          text: async () => "",
        };
      }
      return { ok: true, status: 200, headers: { getSetCookie: () => [] }, text: async () => JSON.stringify({ ok: true }) };
    },
  });
  assert.deepEqual(await request("/", { operation: "PREVIEW_PROBE" }), { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(calls[1].url, `${APPROVED_SUPABASE_EXIT_PREVIEW.url}/`);
  assert.equal(new Headers(calls[1].options.headers).get("cookie"), bypassCookie);
  assert.equal(new Headers(calls[1].options.headers).get("x-vercel-protection-bypass"), bypassSecret);
  assert.doesNotMatch(JSON.stringify({ calls: calls.map(({ url, options }) => ({ url, method: options.method })) }), new RegExp(`${bypassSecret}|${bypassCookie}`));
});

test("protected Preview bootstrap rejects a 307 without a Set-Cookie", async () => {
  const request = createProtectedPreviewRequest({
    bypassSecret: "protected-bypass-value",
    fetchImpl: async () => ({ ok: false, status: 307, headers: { get: name => name === "location" ? `${APPROVED_SUPABASE_EXIT_PREVIEW.url}/` : null, getSetCookie: () => [] }, text: async () => "" }),
  });
  await assert.rejects(() => request("/", { operation: "PREVIEW_PROBE" }), error => error.code === "SUPABASE_EXIT_BYPASS_COOKIE_MISSING");
});

test("protected Preview bootstrap rejects a second same-origin 307 redirect", async () => {
  let calls = 0;
  const request = createProtectedPreviewRequest({
    bypassSecret: "protected-bypass-value",
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: false,
        status: 307,
        headers: { get: name => name === "location" ? `${APPROVED_SUPABASE_EXIT_PREVIEW.url}/` : null, getSetCookie: () => calls === 1 ? ["vercel-protection=opaque; Path=/; HttpOnly"] : [] },
        text: async () => "",
      };
    },
  });
  await assert.rejects(() => request("/", { operation: "PREVIEW_PROBE" }), error => error.code === "SUPABASE_EXIT_BYPASS_REDIRECT_LOOP");
});

for (const [name, location] of [
  ["cross-origin", "https://other-preview.example/"],
  ["Vercel SSO", "https://vercel.com/sso-api/login"],
]) {
  test(`protected Preview bootstrap rejects ${name} redirect`, async () => {
    const request = createProtectedPreviewRequest({
      bypassSecret: "protected-bypass-value",
      fetchImpl: async () => ({ ok: false, status: 307, headers: { get: key => key === "location" ? location : null, getSetCookie: () => ["vercel-protection=opaque; Path=/; HttpOnly"] }, text: async () => "" }),
    });
    await assert.rejects(() => request("/", { operation: "PREVIEW_PROBE" }), error => error.code === "SUPABASE_EXIT_BYPASS_REDIRECT_FORBIDDEN");
  });
}

test("Preview transport stays direct when HTTPS_PROXY is absent", async () => {
  let fetchOptions;
  const request = createProtectedPreviewRequest({
    bypassSecret: "protected-bypass-value",
    httpsProxy: "",
    ProxyAgentImpl: () => { throw new Error("must-not-create-proxy-agent"); },
    fetchImpl: async (_url, options) => {
      fetchOptions = options;
      return { ok: true, status: 200, headers: { getSetCookie: () => [] }, text: async () => JSON.stringify({ ok: true }) };
    },
  });
  await request("/", { operation: "PREVIEW_PROBE" });
  assert.equal(Object.hasOwn(fetchOptions, "dispatcher"), false);
});

test("Preview transport uses an explicit HTTPS proxy dispatcher and preserves bypass headers", async () => {
  const bypassSecret = "protected-bypass-value";
  const proxyUrl = "http://127.0.0.1:7897";
  const dispatcher = { kind: "proxy-dispatcher" };
  let createdWith;
  const calls = [];
  const request = createProtectedPreviewRequest({
    bypassSecret,
    httpsProxy: proxyUrl,
    ProxyAgentImpl: function ProxyAgentImpl(url) {
      createdWith = url;
      return dispatcher;
    },
    fetchImpl: async (_url, options) => {
      calls.push(options);
      return { ok: true, status: 200, headers: { getSetCookie: () => ["better-auth.session_token=opaque; Path=/; HttpOnly"] }, text: async () => JSON.stringify({ ok: true }) };
    },
  });
  assert.deepEqual(await request("/", { operation: "PREVIEW_PROBE" }), { ok: true });
  assert.deepEqual(await request("/api/auth/session", { operation: "AUTH_SESSION" }), { ok: true });
  assert.equal(createdWith, proxyUrl);
  assert.equal(calls[0].dispatcher, dispatcher);
  assert.equal(new Headers(calls[0].headers).get("x-vercel-protection-bypass"), bypassSecret);
  assert.equal(new Headers(calls[1].headers).get("cookie"), "better-auth.session_token=opaque");
  assert.doesNotMatch(JSON.stringify({ calls, createdWith }), new RegExp(bypassSecret));
});

test("Preview transport rejects a malformed HTTPS_PROXY without exposing it", () => {
  const proxySecret = "http://proxy-user:proxy-password@ bad host";
  assert.throws(
    () => createProtectedPreviewRequest({ bypassSecret: "protected-bypass-value", httpsProxy: proxySecret }),
    error => error.code === "SUPABASE_EXIT_PROXY_INVALID" && !String(error.code).includes(proxySecret),
  );
});

test("direct Preview transport fails closed for missing bypass secret and wrong or Production host", () => {
  assert.throws(() => createProtectedPreviewRequest({ bypassSecret: "" }), /SUPABASE_EXIT_BYPASS_SECRET_MISSING/);
  assert.throws(() => createProtectedPreviewRequest({ bypassSecret: "redacted", baseUrl: "https://wrong-preview.example" }), /SUPABASE_EXIT_PREVIEW_FORBIDDEN/);
  assert.throws(() => createProtectedPreviewRequest({ bypassSecret: "redacted", baseUrl: "https://hotel-ld-os.vercel.app" }), /SUPABASE_EXIT_PREVIEW_FORBIDDEN/);
});

test("direct Preview transport exposes only a stable operation code when fetch fails", async () => {
  const bypassSecret = "protected-bypass-value";
  const proxySecret = "http://proxy-user:proxy-password@127.0.0.1:7897";
  const request = createProtectedPreviewRequest({
    bypassSecret,
    httpsProxy: proxySecret,
    ProxyAgentImpl: function ProxyAgentImpl() { return { close() {} }; },
    fetchImpl: async () => { throw new Error(`${bypassSecret}:${proxySecret}`); },
  });
  await assert.rejects(
    () => request("/", { operation: "PREVIEW_PROBE" }),
    error => error.code === "SUPABASE_EXIT_PREVIEW_REQUEST_FAILED:PREVIEW_PROBE"
      && !String(error.code).includes(bypassSecret)
      && !String(error.code).includes(proxySecret),
  );
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

test("child failure after fixture creation still runs cleanup with stable operation detail", async () => {
  const calls = [];
  const result = await runSupabaseExitAcceptance({
    preflight: async () => {},
    createIdentity: async () => ({ userId: "05a561ea-1e14-4920-abd1-ff41b9e29bee", password: "never-output" }),
    initialize: async () => {},
    validateRuntime: async () => execute(process.execPath, ["-e", "process.exit(31)"], { operation: "RUNTIME_VALIDATION", timeoutMs: 1_000 }),
    cleanup: async fixture => { calls.push(fixture.cleanup.propertyId); },
    fixtureFactory: () => createSupabaseExitFixture({ authUserId: "05a561ea-1e14-4920-abd1-ff41b9e29bee", nonce: "c0ffee11" }),
  });
  assert.equal(result.detail, "SUPABASE_EXIT_OPERATOR_COMMAND_FAILED:RUNTIME_VALIDATION:EXIT_31");
  assert.equal(result.gates.FIXTURE_CLEANUP, "PASS");
  assert.equal(calls.length, 1);
});

test("pre-fixture child failure leaves cleanup PASS", async () => {
  const result = await runSupabaseExitAcceptance({
    preflight: async () => execute(process.execPath, ["-e", "process.exit(37)"], { operation: "PREVIEW_PROBE", timeoutMs: 1_000 }),
    createIdentity: async () => { throw new Error("must-not-run"); },
    cleanup: async () => { throw new Error("must-not-run"); },
  });
  assert.equal(result.detail, "SUPABASE_EXIT_OPERATOR_COMMAND_FAILED:PREVIEW_PROBE:EXIT_37");
  assert.equal(result.gates.FIXTURE_CLEANUP, "PASS");
  assert.equal(result.ok, false);
});
