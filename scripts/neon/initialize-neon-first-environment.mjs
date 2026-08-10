#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { initializeNeonFirstEnvironment } from "./neon-first-initialization-operator.mjs";

const SAFE_EVIDENCE_ROOTS = ["/private/tmp/", "/tmp/"];

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function isSafeEvidencePath(value) {
  return typeof value === "string" && SAFE_EVIDENCE_ROOTS.some((root) => value.startsWith(root));
}

export function parseInitializationArgs(argv) {
  const args = { targetFile: null, fixtureFile: null, authUserId: null, dryRun: false, evidenceFile: "/private/tmp/neon-first-initialization-evidence.json" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target-file") args.targetFile = argv[++index];
    else if (arg === "--fixture") args.fixtureFile = argv[++index];
    else if (arg === "--auth-user-id") args.authUserId = argv[++index];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--evidence-file") args.evidenceFile = argv[++index];
    else fail("NEON_FIRST_INIT_ARGUMENT_INVALID");
  }
  if (!args.targetFile || !args.fixtureFile) fail("NEON_FIRST_INIT_INPUT_FILE_REQUIRED");
  if (!args.authUserId) fail("NEON_FIRST_INIT_AUTH_USER_REQUIRED");
  if (!isSafeEvidencePath(args.evidenceFile)) fail("NEON_FIRST_INIT_EVIDENCE_PATH_FORBIDDEN");
  return args;
}

export function createInitializationEvidence(result, target) {
  const allowed = ["status", "created", "requestId", "authUserId", "tenantId", "propertyId", "profileId", "roleAssignmentId", "seedVersion", "mode"];
  const evidence = Object.fromEntries(allowed.filter((key) => key in result).map((key) => [key, result[key]]));
  return { ...evidence, target, credentialsRecorded: false };
}

async function defaultReadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function runInitializationCommand({ args, environment = process.env, readJson = defaultReadJson, initialize = initializeNeonFirstEnvironment }) {
  const connectionString = environment.NEON_BOOTSTRAP_DATABASE_URL;
  if (!connectionString) fail("NEON_FIRST_INIT_BOOTSTRAP_URL_REQUIRED");
  const [target, fixture] = await Promise.all([readJson(args.targetFile), readJson(args.fixtureFile)]);
  const result = await initialize({ connectionString, target, fixture, authUserId: args.authUserId, environment, dryRun: args.dryRun });
  return { status: result.status, created: result.created, requestId: result.requestId, authUserId: result.authUserId, tenantId: result.tenantId, propertyId: result.propertyId, profileId: result.profileId, roleAssignmentId: result.roleAssignmentId, seedVersion: result.seedVersion, mode: args.dryRun ? "dry-run" : "apply", credentialsRecorded: false };
}

async function main() {
  const args = parseInitializationArgs(process.argv.slice(2));
  const result = await runInitializationCommand({ args });
  const target = await defaultReadJson(args.targetFile);
  const evidence = createInitializationEvidence(result, target);
  await writeFile(args.evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ...result, evidenceFile: args.evidenceFile })}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error?.code || "NEON_FIRST_INIT_FAILED"}\n`);
    process.exitCode = 1;
  });
}
