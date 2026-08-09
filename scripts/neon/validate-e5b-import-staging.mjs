#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const E5B_PROJECT = "delicate-wind-06430851";
export const E5B_CHILD_BRANCH = "br-icy-scene-aukkzv69";
export const E5B_CHILD_ENDPOINT = "ep-frosty-math-audxlq88";
export const E5B_PRODUCTION_BRANCH = "br-twilight-leaf-azmowo1k";
export const E5B_PRODUCTION_ENDPOINT = "ep-wild-wave-azjmgdif";
export const E5B_DATABASE = "neondb";
export const E5B_BOOTSTRAP_ROLE = "neondb_owner";
export const E5B_RUNTIME_ROLE = "hotel_ld_application";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CANONICAL = join(ROOT, "neon", "canonical");
const COMMANDS = new Set([
  "source",
  "dry-run",
  "apply",
  "catalog",
  "runtime",
  "storage-runtime",
]);

export const E5B_MIGRATIONS = Object.freeze([
  "090_import_staging_schema.sql",
  "091_import_saga_entrypoints.sql",
  "092_import_staging_entrypoints.sql",
]);

export const E5B_ENTRYPOINT_SIGNATURES = Object.freeze([
  "public.create_neon_import_upload_intent(text,uuid,text,text,text,bigint,text,text)",
  "public.record_neon_import_object_uploaded(text,uuid,bigint)",
  "public.record_neon_import_object_verification(text,uuid,bigint,text,bigint,text,text,text)",
  "public.mark_neon_import_cleanup_pending(text,uuid,bigint,text)",
  "public.claim_neon_import_cleanup(text,uuid,integer,uuid)",
  "public.complete_neon_import_cleanup(text,uuid,uuid,uuid)",
  "public.fail_neon_import_cleanup(text,uuid,uuid,uuid,text,timestamptz)",
  "public.get_neon_import_workflow(text,uuid)",
  "public.list_neon_import_history(text)",
  "public.begin_neon_import_staging(text,uuid,bigint,jsonb)",
  "public.append_neon_import_sheets(text,uuid,jsonb)",
  "public.append_neon_import_field_mappings(text,uuid,jsonb)",
  "public.append_neon_import_source_rows(text,uuid,jsonb)",
  "public.append_neon_import_issues(text,uuid,jsonb)",
  "public.append_neon_import_source_labels(text,uuid,jsonb)",
  "public.finalize_neon_import_staging(text,uuid,bigint,jsonb,text)",
]);

const REQUIRED_SERVER_FILES = Object.freeze([
  "app/repositories/contracts/import-staging-repository.ts",
  "app/repositories/neon/import-staging-repository.ts",
  "app/services/neon-import-staging-authorization.ts",
  "app/services/import/storage-object-verification.ts",
  "app/services/import/storage-saga-coordinator.ts",
  "app/services/import/storage-cleanup-executor.ts",
  "app/services/import/neon-import-inspection-boundary.ts",
  "app/api/import/batches/route.ts",
  "app/api/import/batches/[id]/route.ts",
  "app/api/import/batches/input.ts",
]);

export function assertE5bConnectionTarget(raw, kind) {
  if (kind !== "bootstrap" && kind !== "runtime") {
    throw new Error("E5B_IMPORT_STAGING_CONNECTION_KIND_INVALID");
  }
  const requiredRole = kind === "bootstrap" ? E5B_BOOTSTRAP_ROLE : E5B_RUNTIME_ROLE;
  return approvedConnection(raw, requiredRole, kind === "runtime", kind);
}

export function assertE5bBootstrapUrl(raw) {
  return assertE5bConnectionTarget(raw, "bootstrap");
}

export function assertE5bRuntimeUrl(raw) {
  return assertE5bConnectionTarget(raw, "runtime");
}

export async function validateE5bImportStagingSource({ root = ROOT } = {}) {
  const canonical = join(root, "neon", "canonical");
  const migrationPaths = E5B_MIGRATIONS.map(file => join(canonical, file));
  const serverPaths = REQUIRED_SERVER_FILES.map(file => join(root, file));

  if (!(await everyExists([...migrationPaths, ...serverPaths]))) {
    throw new Error("E5B_IMPORT_STAGING_SOURCE_CONTRACT_MISSING");
  }

  const [migrations, serverSources, inspectRoute] = await Promise.all([
    Promise.all(migrationPaths.map(path => readFile(path, "utf8"))),
    Promise.all(serverPaths.map(path => readFile(path, "utf8"))),
    readFile(join(root, "app/api/import/inspect/route.ts"), "utf8"),
  ]);
  const sql = stripSqlComments(migrations.join("\n"));
  const server = serverSources.join("\n");

  if (!/begin;[\s\S]*commit;\s*$/i.test(migrations[0])
    || !/begin;[\s\S]*commit;\s*$/i.test(migrations[1])
    || !/begin;[\s\S]*commit;\s*$/i.test(migrations[2])) {
    failSource("E5B_IMPORT_STAGING_TRANSACTION_BOUNDARY");
  }
  for (const signature of E5B_ENTRYPOINT_SIGNATURES) {
    const routine = routineSource(sql, signature);
    if (!routine
      || !/security definer/i.test(routine)
      || !/set search_path\s*=\s*''/i.test(routine)
      || !new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${escape(signature)}\\s+from\\s+public`, "i").test(sql)
      || !new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${escape(signature)}\\s+to\\s+hotel_ld_application`, "i").test(sql)) {
      failSource("E5B_IMPORT_STAGING_ENTRYPOINT_SECURITY", signature);
    }
  }
  for (const table of [
    "public.import_batches",
    "public.import_sheets",
    "public.import_source_rows",
    "public.import_field_mappings",
    "public.import_issues",
    "public.import_source_label_resolutions",
    "app_private.import_storage_operations",
    "app_private.import_activity_events",
  ]) {
    if (!new RegExp(`alter\\s+table\\s+${escape(table)}\\s+enable\\s+row\\s+level\\s+security`, "i").test(sql)) {
      failSource("E5B_IMPORT_STAGING_RLS_MISSING", table);
    }
    if (!new RegExp(`alter\\s+table\\s+${escape(table)}\\s+force\\s+row\\s+level\\s+security`, "i").test(sql)) {
      failSource("E5B_IMPORT_STAGING_FORCE_RLS_MISSING", table);
    }
  }
  if (hasUnsafeRawApplicationPrivilege(sql)) {
    failSource("E5B_IMPORT_STAGING_RAW_APPLICATION_GRANT");
  }
  if (hasUnsafeDefaultApplicationPrivilege(sql)) {
    failSource("E5B_IMPORT_STAGING_DEFAULT_PRIVILEGE_GRANT");
  }
  if (/\bcreate\s+schema(?:\s+if\s+not\s+exists)?\s+"?(?:auth|storage)"?\b/i.test(sql)
    || /(?:^|[^\w"])"?(?:auth|storage)"?\s*\.\s*"?[a-z_][\w$]*"?/i.test(sql)
    || /(?:commit_neon_import|revert_neon_import|legacy_import)/i.test(sql)) {
    failSource("E5B_IMPORT_STAGING_LEGACY_COMPATIBILITY_OBJECT");
  }
  if (!/download\(/.test(server)
    || !/createHash\(["']sha256["']\)/.test(server)
    || !/timingSafeEqual/.test(server)
    || !/contentDerivedMimeType/.test(server)) {
    failSource("E5B_IMPORT_STAGING_READBACK_VERIFICATION_MISSING");
  }
  if (!inspectRoute.includes('actorClient.rpc(\n        "stage_employee_import"')) {
    failSource("E5B_IMPORT_STAGING_INSPECT_RPC_CONTRACT_CHANGED");
  }
  if (/DATABASE_URL|NEON_BOOTSTRAP_DATABASE_URL|from\s+["']pg["']/.test(serverSources.filter((_, index) => REQUIRED_SERVER_FILES[index].startsWith("app/api/")).join("\n"))) {
    failSource("E5B_IMPORT_STAGING_BROWSER_OR_API_DATABASE_CREDENTIAL");
  }
  return {
    modules: E5B_MIGRATIONS,
    entrypoints: E5B_ENTRYPOINT_SIGNATURES.length,
    inspectionRpcPreserved: true,
    storageVerification: "read-back-sha256-size-content-mime",
  };
}

async function main() {
  const command = process.argv[2];
  if (!COMMANDS.has(command)) throw new Error("E5B_IMPORT_STAGING_COMMAND_REQUIRED");

  // Source validation is deliberately first: an incomplete E5B boundary must
  // never cause an environment read or database connection attempt.
  const source = await validateE5bImportStagingSource();
  if (command === "source") return output(command, source);

  const values = await environmentValues();
  const connection = command === "runtime" || command === "storage-runtime"
    ? assertE5bRuntimeUrl(required(values, "DATABASE_URL"))
    : assertE5bBootstrapUrl(required(values, "NEON_BOOTSTRAP_DATABASE_URL"));
  throw new Error(`E5B_IMPORT_STAGING_${command.toUpperCase().replace(/-/g, "_")}_NOT_IMPLEMENTED:${connection.kind}`);
}

async function everyExists(paths) {
  const found = await Promise.all(paths.map(async path => {
    try { await access(path); return true; }
    catch { return false; }
  }));
  return found.every(Boolean);
}

function routineSource(source, signature) {
  const [qualifiedName, expectedArguments] = splitSignature(signature);
  const marker = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+${escape(qualifiedName)}\\s*\\(([^)]*)\\)`,
    "gi",
  );
  let match;
  while ((match = marker.exec(source))) {
    if (argumentIdentity(match[1]) !== expectedArguments) continue;
    const following = /\ncreate\s+(?:or\s+replace\s+)?function\s+/gi;
    following.lastIndex = marker.lastIndex;
    const next = following.exec(source);
    return source.slice(match.index, next ? next.index : source.length);
  }
  return "";
}

function splitSignature(signature) {
  const opening = signature.indexOf("(");
  return [
    signature.slice(0, opening),
    argumentIdentity(signature.slice(opening + 1, -1)),
  ];
}

function argumentIdentity(argumentsSource) {
  const knownTypes = new Set(["text", "uuid", "bigint", "integer", "jsonb", "timestamptz"]);
  if (!argumentsSource.trim()) return "";
  return argumentsSource.split(",").map(argument => {
    const tokens = argument
      .replace(/\s*=\s*[\s\S]*$/, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    while (["in", "out", "inout", "variadic"].includes(tokens[0]?.toLowerCase())) tokens.shift();
    if (tokens.length > 1 && knownTypes.has(tokens.at(-1)?.toLowerCase())) tokens.shift();
    return tokens.join(" ").toLowerCase();
  }).join(",");
}

/**
 * Remove SQL line/block comments before source assertions. The canonical
 * modules do not use nested block comments; preserving newlines keeps routine
 * boundaries stable for the declaration matcher.
 */
function stripSqlComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\r\n]*/g, "");
}

/**
 * The application role must receive functions only. Scan complete GRANT
 * statements so a comma list, schema/sequence grant, GROUP, or quoted role
 * cannot hide a raw privilege from the validator.
 */
export function hasUnsafeRawApplicationPrivilege(source) {
  const sql = stripSqlComments(source);
  for (const statement of sql.match(/\bgrant\b[\s\S]*?;/gi) ?? []) {
    const match = statement.match(/^\s*grant\s+[\s\S]*?\bon\s+(?:(table|sequence|schema)\s+)?([\s\S]*?)\s+\bto\b\s+([\s\S]*?);\s*$/i);
    if (!match) continue;
    const [, kind = "table", objects, grantees] = match;
    if (!mentionsApplicationRole(grantees)) continue;
    if (/^\s*function\b/i.test(objects) || /^\s*all\s+functions\b/i.test(objects)) continue;
    if (/^\s*all\s+(?:tables|sequences)\s+in\s+schema\s+"?(?:public|app_private)"?\s*$/i.test(objects)) return true;
    if (kind.toLowerCase() === "schema") {
      if (/(?:^|,)\s*"?(?:public|app_private)"?\s*(?:,|$)/i.test(objects)) return true;
      continue;
    }
    if (objects.split(",").some(object => /^\s*"?(?:public|app_private)"?\s*\./i.test(object))) return true;
  }
  return false;
}

export function hasUnsafeDefaultApplicationPrivilege(source) {
  const sql = stripSqlComments(source);
  for (const statement of sql.match(/\balter\s+default\s+privileges\b[\s\S]*?;/gi) ?? []) {
    if (!/\bin\s+schema\s+"?(?:public|app_private)"?(?=\s|;|$)/i.test(statement)) continue;
    const grant = statement.match(/\bgrant\s+[\s\S]*?\bon\s+(tables|sequences)\s+to\s+([\s\S]*?);\s*$/i);
    if (grant && mentionsApplicationRole(grant[2])) return true;
  }
  return false;
}

function mentionsApplicationRole(value) {
  return /(?:^|[,\s])(?:group\s+|role\s+)?"?hotel_ld_application"?(?=$|[,\s])/i.test(value.trim());
}

function approvedConnection(raw, role, pooled, kind) {
  if (typeof raw !== "string" || raw.includes(E5B_PRODUCTION_BRANCH) || raw.includes(E5B_PRODUCTION_ENDPOINT)) {
    throw new Error("E5B_IMPORT_STAGING_PRODUCTION_DENIED");
  }
  let url;
  try { url = new URL(raw); }
  catch { throw new Error("E5B_IMPORT_STAGING_URL_INVALID"); }

  const host = url.hostname.toLowerCase();
  const labels = host.split(".");
  const neonDomain = host.endsWith(".neon.tech") && labels.length >= 3;
  const direct = neonDomain && labels[0] === E5B_CHILD_ENDPOINT;
  const pooler = neonDomain && labels[0] === `${E5B_CHILD_ENDPOINT}-pooler`;
  if (!direct && !pooler) throw new Error("E5B_IMPORT_STAGING_CHILD_ENDPOINT_REQUIRED");
  if (url.pathname.replace(/^\//, "") !== E5B_DATABASE) throw new Error("E5B_IMPORT_STAGING_DATABASE_DENIED");
  if (decodeURIComponent(url.username) !== role) throw new Error(`E5B_IMPORT_STAGING_${role.toUpperCase()}_REQUIRED`);
  if (pooler !== pooled) {
    throw new Error(pooled
      ? "E5B_IMPORT_STAGING_POOLED_RUNTIME_REQUIRED"
      : "E5B_IMPORT_STAGING_DIRECT_BOOTSTRAP_REQUIRED");
  }
  return {
    project: E5B_PROJECT,
    branch: E5B_CHILD_BRANCH,
    endpoint: E5B_CHILD_ENDPOINT,
    database: E5B_DATABASE,
    role,
    pooled,
    kind,
  };
}

async function environmentValues() {
  let source;
  try { source = await readFile(process.env.E5B_IMPORT_STAGING_ENV_FILE ?? ".env.local", "utf8"); }
  catch { throw new Error("E5B_IMPORT_STAGING_ENVIRONMENT_MISSING"); }
  return Object.fromEntries(source.split(/\r?\n/)
    .map(line => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, "")]));
}

function required(values, key) {
  const value = values[key]?.trim();
  if (!value) throw new Error(`E5B_IMPORT_STAGING_${key}_REQUIRED`);
  return value;
}

function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function failSource(code, value = "") { throw new Error(`${code}${value ? `: ${value}` : ""}`); }
function output(command, assertions) {
  console.log(JSON.stringify({
    command,
    child: { project: E5B_PROJECT, branch: E5B_CHILD_BRANCH, endpoint: E5B_CHILD_ENDPOINT, database: E5B_DATABASE },
    assertions,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "E5B_IMPORT_STAGING_UNKNOWN");
    process.exitCode = 1;
  });
}
