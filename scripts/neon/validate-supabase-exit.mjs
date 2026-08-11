#!/usr/bin/env node

/**
 * Local, operator-only final acceptance for the Supabase exit.
 *
 * This file deliberately has no fallback transport: live requests are routed
 * through the authenticated Vercel CLI, business initialization through the
 * existing direct bootstrap operator, and cleanup through an exact-ID
 * transaction.  It never serializes process environments or HTTP bodies.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

export const APPROVED_SUPABASE_EXIT_PREVIEW = Object.freeze({
  commit: "e06832a107566d3b5af40da0adb61c2379366719",
  url: "https://hotel-ld-os-git-codex-canonical-neon-beb82a-nicwenqis-projects.vercel.app",
  projectId: "prj_LWWqjlOsHToxi7cVemxm6xKtw9m1",
  teamId: "team_CB00d6Y3s9dIbPfRHEK46n18",
});

const GATE_NAMES = Object.freeze([
  "PREVIEW_REACHABLE",
  "AUTH_DISPOSABLE_USER",
  "NEON_FIRST_INITIALIZATION",
  "NEON_AUTHORIZATION_AND_SCOPE",
  "ORGANIZATION_PEOPLE_POSITION_EMPLOYEE",
  "PROPERTY_INITIALIZATION",
  "IMPORT_VERCEL_BLOB_COMMIT_REVERT",
  "ZERO_SUPABASE_RUNTIME",
  "FIXTURE_CLEANUP",
  "SUPABASE_SAFE_TO_DELETE",
]);
const REQUIRED_ENVIRONMENT = Object.freeze([
  "NEON_BOOTSTRAP_DATABASE_URL",
  "DATABASE_URL",
  "BLOB_READ_WRITE_TOKEN",
  "VERCEL_ENV",
  "APP_ENV",
  "PREVIEW_PROPERTY_HOSTNAME",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateSupabaseExitPreflight(input) {
  if (!input || typeof input !== "object") failure("SUPABASE_EXIT_PREFLIGHT_INVALID");
  if (cleanText(input.commit) !== APPROVED_SUPABASE_EXIT_PREVIEW.commit) failure("SUPABASE_EXIT_COMMIT_UNAPPROVED");
  if (cleanText(input.previewUrl) !== APPROVED_SUPABASE_EXIT_PREVIEW.url || /(?:^|[.-])production(?:[.-]|$)/i.test(cleanText(input.previewUrl))) failure("SUPABASE_EXIT_PREVIEW_FORBIDDEN");
  const environment = input.environment;
  if (!environment || typeof environment !== "object") failure("SUPABASE_EXIT_ENV_MISSING");
  if (cleanText(environment.APP_ENV) === "production" || cleanText(environment.VERCEL_ENV) !== "preview") failure("SUPABASE_EXIT_PRODUCTION_FORBIDDEN");
  for (const name of REQUIRED_ENVIRONMENT) if (!cleanText(environment[name])) failure("SUPABASE_EXIT_ENV_MISSING");
  if (cleanText(environment.PREVIEW_PROPERTY_HOSTNAME).includes(":") || cleanText(environment.PREVIEW_PROPERTY_HOSTNAME).includes("/")) failure("SUPABASE_EXIT_PREVIEW_HOST_INVALID");
  const source = cleanText(input.activeSource);
  if (!source || /@supabase\/|\bsupabase(?:_|\b)|create(?:Browser|Server)(?:Actor|Admin|Password)?Client/i.test(source)) failure("SUPABASE_EXIT_SOURCE_DRIFT");
  return true;
}

function commitFromMetadata(value) {
  if (!value || typeof value !== "object") return null;
  for (const [key, candidate] of Object.entries(value)) {
    if (["githubCommitSha", "gitCommitSha", "commit", "sha"].includes(key) && typeof candidate === "string" && /^[0-9a-f]{40}$/i.test(candidate)) return candidate.toLowerCase();
    const nested = commitFromMetadata(candidate);
    if (nested) return nested;
  }
  return null;
}

/** Vercel CLI metadata is the authority for the deployed source, not local HEAD. */
export function readApprovedDeploymentCommit(serialized) {
  let metadata;
  try { metadata = JSON.parse(serialized); } catch { failure("SUPABASE_EXIT_DEPLOYMENT_METADATA_INVALID"); }
  const commit = commitFromMetadata(metadata);
  if (!commit) failure("SUPABASE_EXIT_DEPLOYMENT_METADATA_INVALID");
  if (commit !== APPROVED_SUPABASE_EXIT_PREVIEW.commit) failure("SUPABASE_EXIT_COMMIT_UNAPPROVED");
  return commit;
}

export function createSupabaseExitFixture({ authUserId, nonce = randomBytes(8).toString("hex"), hostname = "preview.ldchub.test" } = {}) {
  if (!UUID.test(cleanText(authUserId))) failure("SUPABASE_EXIT_AUTH_USER_INVALID");
  if (!/^[a-f0-9]{8,32}$/i.test(cleanText(nonce)) || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(cleanText(hostname))) failure("SUPABASE_EXIT_FIXTURE_INVALID");
  const ids = Array.from({ length: 16 }, () => randomUUID());
  const [tenantId, propertyId, domainId, profileId, accountId, tenantMembershipId, propertyMembershipId, roleId, roleAssignmentId, settingsId, identityStep, rulesStep, organizationStep, positionsStep, uploadStep, mappingStep] = ids;
  const extra = Array.from({ length: 4 }, () => randomUUID());
  const tag = `acceptance-${nonce.toLowerCase()}`;
  return Object.freeze({
    kind: "supabase-exit-acceptance",
    nonce: nonce.toLowerCase(),
    authUserId,
    tenant: { id: tenantId, code: `acc-${nonce.slice(0, 8).toLowerCase()}`, name: `Acceptance ${nonce.slice(0, 8)}` },
    property: { id: propertyId, code: `acc-${nonce.slice(0, 8).toLowerCase()}`, nameZh: "验收酒店", nameEn: "Acceptance Hotel", countryRegion: "CN", timezone: "Asia/Shanghai", defaultLanguage: "zh-CN" },
    propertyDomain: { id: domainId, hostname: hostname.toLowerCase() },
    manager: { profileId, accountId, tenantMembershipId, propertyMembershipId, roleId, roleAssignmentId, displayName: "Acceptance Manager", email: `${tag}@${hostname.toLowerCase()}`, loginId: tag },
    initialization: { settingsId, steps: { identity: identityStep, rules: rulesStep, organization: organizationStep, positions: positionsStep, upload: uploadStep, mapping: mappingStep, access: extra[0], readiness: extra[1] } },
    developmentSeed: { departmentId: extra[2], positionFamilyId: extra[3], positionId: randomUUID(), positionDepartmentAssignmentId: randomUUID(), employeeId: randomUUID(), employeeIdentifierId: randomUUID() },
    cleanup: Object.freeze({ tenantId, propertyId, authUserId, profileId, accountId, roleAssignmentId, objectPrefix: `imports/${tenantId}/${propertyId}/` }),
  });
}

function initialGates() {
  return Object.fromEntries(GATE_NAMES.map(name => [name, "SKIPPED"]));
}

function codeOf(error) {
  return cleanText(error?.code) || "SUPABASE_EXIT_FAILED";
}

/** Testable lifecycle coordinator. Every path that has a fixture invokes cleanup. */
export async function runSupabaseExitAcceptance(dependencies) {
  const gates = initialGates();
  let fixture;
  let identity;
  let detail = null;
  try {
    await dependencies.preflight();
    gates.PREVIEW_REACHABLE = "PASS";
    identity = await dependencies.createIdentity();
    if (!UUID.test(cleanText(identity?.userId))) failure("SUPABASE_EXIT_AUTH_USER_INVALID");
    fixture = dependencies.fixtureFactory({ authUserId: identity.userId });
    gates.AUTH_DISPOSABLE_USER = "PASS";
    await dependencies.initialize(fixture, identity);
    gates.NEON_FIRST_INITIALIZATION = "PASS";
    await dependencies.validateRuntime(fixture, identity);
    gates.NEON_AUTHORIZATION_AND_SCOPE = "PASS";
    await dependencies.validateBusiness(fixture, identity);
    gates.ORGANIZATION_PEOPLE_POSITION_EMPLOYEE = "PASS";
    await dependencies.validateProperty(fixture, identity);
    gates.PROPERTY_INITIALIZATION = "PASS";
    await dependencies.validateImport(fixture, identity);
    gates.IMPORT_VERCEL_BLOB_COMMIT_REVERT = "PASS";
    await dependencies.validateZeroSupabase(fixture, identity);
    gates.ZERO_SUPABASE_RUNTIME = "PASS";
  } catch (error) {
    detail = codeOf(error);
    for (const name of GATE_NAMES.slice(0, -2)) if (gates[name] === "SKIPPED") gates[name] = "FAIL";
  } finally {
    if (fixture) {
      try {
        await dependencies.cleanup(fixture, identity);
        gates.FIXTURE_CLEANUP = "PASS";
      } catch (error) {
        gates.FIXTURE_CLEANUP = "FAIL";
        detail ??= codeOf(error);
      }
    } else {
      gates.FIXTURE_CLEANUP = "PASS";
    }
  }
  const accepted = detail === null && Object.entries(gates).every(([name, value]) => name === "SUPABASE_SAFE_TO_DELETE" || value === "PASS");
  gates.SUPABASE_SAFE_TO_DELETE = accepted ? "PASS" : "FAIL";
  return { ok: accepted, gates, detail };
}

async function execute(command, args, { cwd = process.cwd(), timeoutMs = 45_000 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", value => { output += value; });
    child.stderr.on("data", value => { output += value; });
    child.once("error", rejectPromise);
    child.once("close", code => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(output);
      else rejectPromise(Object.assign(new Error("SUPABASE_EXIT_OPERATOR_COMMAND_FAILED"), { code: "SUPABASE_EXIT_OPERATOR_COMMAND_FAILED" }));
    });
  });
}

async function projectSource() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const paths = [".env.example", "app/lib/environment.ts", "app/repositories/runtime/load-domain-registry.ts", "app/services/import/neon-import-inspection-boundary.ts"];
  return (await Promise.all(paths.map(path => readFile(resolve(root, path), "utf8")))).join("\n");
}

function fixtureForInitializer(fixture) {
  const { cleanup, kind, nonce, authUserId, ...initializerFixture } = fixture;
  return { seedVersion: "neon-first-development-v1", ...initializerFixture };
}

async function createPreviewIdentity({ request, fixture }) {
  const password = randomBytes(24).toString("base64url");
  const response = await request("/api/auth/sign-up/email", { method: "POST", body: { name: fixture.manager.displayName, email: fixture.manager.email, password } });
  const userId = response?.user?.id;
  if (!UUID.test(cleanText(userId))) failure("SUPABASE_EXIT_AUTH_CREATE_FAILED");
  return { userId, password };
}

async function createVercelRequest({ cookieJar }) {
  return async (path, { method = "GET", body, formFile } = {}) => {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) failure("SUPABASE_EXIT_REQUEST_INVALID");
    const forwarded = ["--max-time", "45", "--silent", "--show-error", "--fail", "--cookie", cookieJar, "--cookie-jar", cookieJar];
    if (method !== "GET") forwarded.push("-X", method);
    if (body !== undefined) forwarded.push("-H", "content-type: application/json", "--data", JSON.stringify(body));
    if (formFile) forwarded.push("-F", `file=@${formFile};type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`);
    const output = await execute("vercel", ["curl", path, "--deployment", APPROVED_SUPABASE_EXIT_PREVIEW.url, "--yes", "--", ...forwarded]);
    try { return JSON.parse(output); } catch { failure("SUPABASE_EXIT_RESPONSE_INVALID"); }
  };
}

async function writeAcceptanceWorkbook(fixture) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Employee Number", "Name", "Department", "Position", "Employment Status"],
    [`IMP-${fixture.nonce.slice(0, 8)}`, "Import Acceptance Employee", "Development Operations", "Development Operations Manager", "active"],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Employee Master");
  const path = `/private/tmp/supabase-exit-${fixture.nonce}.xlsx`;
  XLSX.writeFile(workbook, path, { bookType: "xlsx" });
  return path;
}

async function validateImportWorkflow({ request, fixture }) {
  const workbook = await writeAcceptanceWorkbook(fixture);
  try {
    const inspected = await request("/api/import/inspect", { method: "POST", formFile: workbook });
    const batchId = cleanText(inspected?.batchId);
    if (!UUID.test(batchId)) failure("SUPABASE_EXIT_IMPORT_STAGE_FAILED");
    let workflow = await request(`/api/import/batches/${batchId}/mapping`);
    const mappings = workflow?.mappings?.items;
    if (!Array.isArray(mappings) || mappings.length === 0 || !Number.isSafeInteger(workflow?.decisionVersion)) failure("SUPABASE_EXIT_IMPORT_MAPPING_FAILED");
    workflow = await request(`/api/import/batches/${batchId}/mapping`, { method: "POST", body: {
      expectedDecisionVersion: workflow.decisionVersion,
      decisions: mappings.map(item => ({ mappingId: item.mappingId, mappingStatus: "confirmed", targetField: item.targetField, transformationRule: item.transformationRule ?? { trim: true, preserveText: false } })),
    } });
    const labelDecisions = Array.isArray(workflow?.sourceLabels?.items) ? workflow.sourceLabels.items.map(item => item.resolutionType === "department"
      ? { sourceLabelId: item.sourceLabelId, action: "department", targetDepartmentId: fixture.developmentSeed.departmentId }
      : { sourceLabelId: item.sourceLabelId, action: "position", targetPositionId: fixture.developmentSeed.positionId }) : [];
    if (labelDecisions.length > 0) workflow = await request(`/api/import/batches/${batchId}/labels`, { method: "POST", body: { expectedDecisionVersion: workflow.decisionVersion, decisions: labelDecisions } });
    const issueDecisions = Array.isArray(workflow?.issues?.items) ? workflow.issues.items.filter(item => item.status === "open").map(item => ({ issueId: item.issueId, status: item.severity === "error" ? "excluded" : "ignored", correction: {}, resolutionNote: "acceptance" })) : [];
    if (issueDecisions.length > 0) workflow = await request(`/api/import/batches/${batchId}/issues`, { method: "POST", body: { expectedDecisionVersion: workflow.decisionVersion, decisions: issueDecisions } });
    const preview = await request(`/api/import/batches/${batchId}/preview?decisionVersion=${workflow.decisionVersion}`);
    if (preview?.state !== "ready" || !/^[0-9a-f]{64}$/.test(cleanText(preview.previewHash))) failure("SUPABASE_EXIT_IMPORT_PREVIEW_FAILED");
    const batch = await request(`/api/import/batches/${batchId}`);
    const committed = await request(`/api/import/batches/${batchId}/commit`, { method: "POST", body: { expectedBatchVersion: batch.version, expectedDecisionVersion: preview.decisionVersion, previewHash: preview.previewHash, confirmed: true } });
    if (!UUID.test(cleanText(committed?.commitId))) failure("SUPABASE_EXIT_IMPORT_COMMIT_FAILED");
    const revert = await request(`/api/import/batches/${batchId}/revert`);
    if (revert?.safe !== true || !Number.isSafeInteger(revert?.commitVersion)) failure("SUPABASE_EXIT_IMPORT_REVERT_PREVIEW_FAILED");
    const reverted = await request(`/api/import/batches/${batchId}/revert`, { method: "POST", body: { expectedCommitVersion: revert.commitVersion, confirmed: true } });
    if (reverted?.status !== "reverted") failure("SUPABASE_EXIT_IMPORT_REVERT_FAILED");
  } finally {
    await rm(workbook, { force: true });
  }
}

async function defaultPreflight() {
  validateSupabaseExitPreflight({ commit: APPROVED_SUPABASE_EXIT_PREVIEW.commit, previewUrl: APPROVED_SUPABASE_EXIT_PREVIEW.url, environment: process.env, activeSource: await projectSource() });
  await execute("vercel", ["whoami"]);
  const deployment = await execute("vercel", ["inspect", APPROVED_SUPABASE_EXIT_PREVIEW.url, "--json"]);
  readApprovedDeploymentCommit(deployment);
  const cookieJar = `/private/tmp/supabase-exit-${randomUUID()}.cookies`;
  await writeFile(cookieJar, "", { mode: 0o600 });
  const request = await createVercelRequest({ cookieJar });
  await request("/");
  await execute("node", ["--test", "tests/supabase-exit-source.test.mjs"]);
  return { cookieJar, request };
}

async function defaultCleanup(fixture, identity, context) {
  try {
    if (!identity?.password || !context?.request) failure("SUPABASE_EXIT_AUTH_CLEANUP_UNAVAILABLE");
    await context.request("/api/auth/delete-user", { method: "POST", body: { password: identity.password } });
  } finally {
    await cleanupNeonFixture(fixture);
    if (context?.cookieJar) await rm(context.cookieJar, { force: true });
  }
}

async function cleanupNeonFixture(fixture) {
  const { cleanupSupabaseExitFixture } = await import("./supabase-exit-cleanup-operator.mjs");
  await cleanupSupabaseExitFixture({ connectionString: process.env.NEON_BOOTSTRAP_DATABASE_URL, fixture: fixture.cleanup });
}

/**
 * Live command intentionally stops at the first unavailable approved boundary;
 * it never substitutes direct business runtime for Preview + pooled runtime.
 */
export async function runLiveSupabaseExit() {
  let context;
  const nonce = randomBytes(8).toString("hex");
  try {
    return await runSupabaseExitAcceptance({
    preflight: async () => { context = await defaultPreflight(); },
    createIdentity: async () => {
      const provisional = createSupabaseExitFixture({ authUserId: randomUUID(), nonce, hostname: process.env.PREVIEW_PROPERTY_HOSTNAME });
      const identity = await createPreviewIdentity({ request: context.request, fixture: provisional });
      return identity;
    },
    fixtureFactory: ({ authUserId }) => createSupabaseExitFixture({ authUserId, nonce, hostname: process.env.PREVIEW_PROPERTY_HOSTNAME }),
    initialize: async (fixture) => {
      const { initializeNeonFirstEnvironment } = await import("./neon-first-initialization-operator.mjs");
      const { APPROVED_NEON_FIRST_INITIALIZATION_TARGETS } = await import("./neon-first-initialization-targets.mjs");
      const target = APPROVED_NEON_FIRST_INITIALIZATION_TARGETS[0];
      await initializeNeonFirstEnvironment({ connectionString: process.env.NEON_BOOTSTRAP_DATABASE_URL, target, fixture: fixtureForInitializer(fixture), authUserId: fixture.authUserId, environment: { APP_ENV: "staging" } });
    },
    validateRuntime: async (fixture, identity) => {
      const login = await context.request("/api/auth/login", { method: "POST", body: { loginId: fixture.manager.loginId, password: identity.password } });
      if (!login?.authenticated || login?.role !== "property_ld_manager" || login?.propertyId !== fixture.property.id) failure("SUPABASE_EXIT_NEON_AUTHORIZATION_FAILED");
      const session = await context.request("/api/auth/session");
      if (!session?.authenticated || session?.userId !== fixture.manager.profileId) failure("SUPABASE_EXIT_SESSION_REFRESH_FAILED");
      const property = await context.request("/api/property/context");
      if (!property?.configured || property?.propertyId !== fixture.property.id) failure("SUPABASE_EXIT_PROPERTY_CONTEXT_FAILED");
    },
    validateBusiness: async () => {
      for (const path of ["/api/organization/departments", "/api/organization/positions", "/api/people/employees?limit=1"]) await context.request(path);
    },
    validateProperty: async () => {
      for (const path of ["/api/property", "/api/initialization/access", "/api/initialization/progress"]) await context.request(path);
    },
    validateImport: async fixture => validateImportWorkflow({ request: context.request, fixture }),
    validateZeroSupabase: async () => {
      if (/@supabase|SUPABASE_/i.test(await projectSource())) failure("SUPABASE_EXIT_SOURCE_DRIFT");
    },
      cleanup: (fixture, identity) => defaultCleanup(fixture, identity, context),
    });
  } finally {
    if (context?.cookieJar) await rm(context.cookieJar, { force: true });
  }
}

function printResult(result) {
  for (const gate of GATE_NAMES) process.stdout.write(`${gate}=${result.gates[gate]}\n`);
  process.stdout.write(`RESULT=${result.ok ? "PASS" : "FAIL"}${result.detail ? `:${result.detail}` : ""}\n`);
}

async function main() {
  const command = process.argv[2];
  if (command === "source" && process.argv.length === 3) {
    validateSupabaseExitPreflight({
      commit: APPROVED_SUPABASE_EXIT_PREVIEW.commit,
      previewUrl: APPROVED_SUPABASE_EXIT_PREVIEW.url,
      environment: { APP_ENV: "preview", VERCEL_ENV: "preview", NEON_BOOTSTRAP_DATABASE_URL: "source", DATABASE_URL: "source", BLOB_READ_WRITE_TOKEN: "source", PREVIEW_PROPERTY_HOSTNAME: "preview.ldchub.test" },
      activeSource: await projectSource(),
    });
    process.stdout.write("ZERO_SUPABASE_RUNTIME=PASS\n");
    return;
  }
  if (command === "live" && process.argv.length === 3) {
    const result = await runLiveSupabaseExit();
    printResult(result);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  failure("SUPABASE_EXIT_COMMAND_REQUIRED");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    process.stdout.write(`RESULT=FAIL:${codeOf(error)}\n`);
    process.exitCode = 1;
  });
}
