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
const E5B_SCHEMA_MANIFEST = "e5b-import-staging-manifest.json";
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

export const E5B_STAGING_TABLES = Object.freeze([
  "public.import_batches",
  "public.import_sheets",
  "public.import_source_rows",
  "public.import_field_mappings",
  "public.import_issues",
  "public.import_source_label_resolutions",
  "app_private.import_storage_operations",
  "app_private.import_activity_events",
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
  // E5B is a post-baseline capability. Its canonical modules are isolated from
  // the immutable 010–080 final-environment bootstrap inventory. The fallback
  // keeps the Task 1 minimal fixtures connection-free and backward compatible.
  const capabilityRoot = join(canonical, "e5b");
  const migrationRoot = (await exists(capabilityRoot)) ? capabilityRoot : canonical;
  const migrationPaths = E5B_MIGRATIONS.map(file => join(migrationRoot, file));
  const serverPaths = REQUIRED_SERVER_FILES.map(file => join(root, file));

  if (!(await exists(migrationPaths[0]))) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_MISSING");
  }

  const schema = await readFile(migrationPaths[0], "utf8");
  // Task 1 fixtures intentionally model only the later aggregate source gate.
  // A real Task 2 module declares its batch relation and is then subject to the
  // complete schema audit before later module checks can run.
  if (/\bcreate\s+table\s+public\.import_batches\b/i.test(stripSqlComments(schema))) {
    const manifestPath = join(migrationRoot, E5B_SCHEMA_MANIFEST);
    if (!(await exists(manifestPath))) failSource("E5B_IMPORT_STAGING_SCHEMA_MANIFEST_MISSING");
    let manifest;
    try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
    catch { failSource("E5B_IMPORT_STAGING_SCHEMA_MANIFEST_INVALID"); }
    validateE5bImportStagingSchema(schema, manifest);
  }

  if (!(await exists(migrationPaths[1]))) {
    failSource("E5B_IMPORT_STAGING_SAGA_ENTRYPOINT_MISSING");
  }
  if (!(await exists(migrationPaths[2]))) {
    failSource("E5B_IMPORT_STAGING_WORKBOOK_ENTRYPOINT_MISSING");
  }
  if (!(await everyExists(serverPaths))) {
    failSource("E5B_IMPORT_STAGING_SERVER_BOUNDARY_MISSING");
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
  for (const table of E5B_STAGING_TABLES) {
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
    || /(?:^|[^\w"])"?(?:auth|storage)"?\s*\./i.test(sql)
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

/**
 * Task 2 validates the permanent schema separately from later entrypoints.
 * This staged gate makes a schema regression visible before a missing future
 * module masks it, while still refusing any environment or database access.
 */
export function validateE5bImportStagingSchema(source, manifest = null) {
  const sql = stripSqlComments(source);
  if (!/begin;[\s\S]*commit;\s*$/i.test(sql)
    || !/set\s+local\s+role\s+hotel_ld_migration_owner\s*;/i.test(sql)) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_TRANSACTION_BOUNDARY");
  }
  for (const type of [
    "public.import_storage_lifecycle",
    "public.import_workbook_lifecycle",
    "public.import_verification_status",
    "public.import_cleanup_state",
  ]) {
    if (!new RegExp(`create\\s+type\\s+${escape(type)}\\s+as\\s+enum`, "i").test(sql)) {
      failSource("E5B_IMPORT_STAGING_SCHEMA_TYPE_MISSING", type);
    }
  }
  for (const table of E5B_STAGING_TABLES) {
    if (!new RegExp(`create\\s+table\\s+${escape(table)}\\b`, "i").test(sql)) {
      failSource("E5B_IMPORT_STAGING_SCHEMA_TABLE_MISSING", table);
    }
    if (!new RegExp(`alter\\s+table\\s+${escape(table)}\\s+owner\\s+to\\s+hotel_ld_migration_owner`, "i").test(sql)) {
      failSource("E5B_IMPORT_STAGING_SCHEMA_OWNER_MISSING", table);
    }
    if (!new RegExp(`alter\\s+table\\s+${escape(table)}\\s+enable\\s+row\\s+level\\s+security`, "i").test(sql)) {
      failSource("E5B_IMPORT_STAGING_RLS_MISSING", table);
    }
    if (!new RegExp(`alter\\s+table\\s+${escape(table)}\\s+force\\s+row\\s+level\\s+security`, "i").test(sql)) {
      failSource("E5B_IMPORT_STAGING_FORCE_RLS_MISSING", table);
    }
    if (!new RegExp(`revoke\\s+all\\s+on\\s+table\\s+${escape(table)}\\s+from\\s+public\\s*,\\s*hotel_ld_application`, "i").test(sql)) {
      failSource("E5B_IMPORT_STAGING_SCHEMA_ACL_REVOKE_MISSING", table);
    }
  }
  for (const policy of [
    "canonical_import_batches_scope",
    "canonical_import_sheets_scope",
    "canonical_import_source_rows_scope",
    "canonical_import_field_mappings_scope",
    "canonical_import_issues_scope",
    "canonical_import_source_label_resolutions_scope",
    "canonical_import_storage_operations_scope",
    "canonical_import_activity_events_insert",
  ]) {
    if (!new RegExp(`create\\s+policy\\s+${escape(policy)}\\b`, "i").test(sql)) {
      failSource("E5B_IMPORT_STAGING_SCHEMA_POLICY_MISSING", policy);
    }
  }
  if (!/create\s+function\s+app_private\.neon_import_storage_transition_allowed\s*\(/i.test(sql)
    || !/create\s+function\s+app_private\.neon_import_workbook_transition_allowed\s*\(/i.test(sql)
    || !/create\s+trigger\s+canonical_import_batch_lifecycle_transition\b/i.test(sql)) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING", "lifecycle_transitions");
  }
  if (!/object_path\s*=\s*tenant_id::text\s*\|\|\s*'\/'\s*\|\|\s*property_id::text\s*\|\|\s*'\/imports\/'\s*\|\|\s*id::text\s*\|\|\s*'\/'\s*\|\|\s*sanitized_filename/i.test(sql)) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING", "server_generated_object_path");
  }
  if (!/declared_checksum_sha256\s*~\s*'\^\[0-9a-f\]\{64\}\$'/i.test(sql)
    || !/declared_size_bytes\s+between\s+1\s+and\s+52428800/i.test(sql)
    || !/declared_mime_type\s+in\s*\(\s*'application\/vnd\.ms-excel'/i.test(sql)) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING", "declared_object_evidence");
  }
  if (!/verified_checksum_sha256\s*=\s*declared_checksum_sha256\s+and\s+verified_size_bytes\s*=\s*declared_size_bytes\s+and\s+verified_mime_type\s*=\s*declared_mime_type/i.test(sql)) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING", "verification_equality");
  }
  if (!/storage_lifecycle\s*<>\s*'linked'\s+or\s*\(\s*verification_status\s*=\s*'passed'\s+and\s*workbook_lifecycle\s*=\s*'mapping_required'/i.test(sql)) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING", "linked_verification_guard");
  }
  if (!/cleanup_state\s*<>\s*'cleanup_in_progress'\s+or\s*\(\s*claim_id\s+is\s+not\s+null\s+and\s+lease_expires_at\s*>\s*pg_catalog\.transaction_timestamp\(\)/i.test(sql)) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING", "cleanup_lease_guard");
  }
  if (!/create\s+function\s+app_private\.reject_import_activity_mutation\s*\(/i.test(sql)
    || !/create\s+trigger\s+import_activity_events_append_only\s+before\s+update\s+or\s+delete\s+on\s+app_private\.import_activity_events/i.test(sql)) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_AUDIT_TRIGGER_MISSING");
  }
  if (/\bon\s+delete\s+cascade\b/i.test(sql)) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_AUDIT_CASCADE_FORBIDDEN");
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
  validateE5bSchemaManifest(sql, manifest);
  return { tables: E5B_STAGING_TABLES.length, module: E5B_MIGRATIONS[0] };
}

function validateE5bSchemaManifest(source, manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || manifest.capability !== "e5b-import-staging"
    || JSON.stringify(manifest.modules) !== JSON.stringify(E5B_MIGRATIONS)) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_MANIFEST_INVALID");
  }
  const inventory = {
    schemaTypes: sourceInventory(source, "type"),
    schemaTables: sourceInventory(source, "table"),
    schemaRoutines: sourceInventory(source, "function"),
    schemaPolicies: sourceInventory(source, "policy"),
    schemaTriggers: sourceInventory(source, "trigger"),
  };
  for (const [key, actual] of Object.entries(inventory)) {
    if (!sameStrings(actual, manifest[key])) {
      failSource("E5B_IMPORT_STAGING_SCHEMA_MANIFEST_DRIFT", key);
    }
  }
  if (!Array.isArray(manifest.excluded)
    || !manifest.excluded.includes("auth schema")
    || !manifest.excluded.includes("storage schema")
    || !manifest.excluded.includes("legacy import commit")
    || !manifest.excluded.includes("legacy import revert")
    || !manifest.excluded.includes("legacy provenance")
    || !manifest.excluded.includes("compatibility objects")) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_MANIFEST_INVALID");
  }
}

function sourceInventory(source, kind) {
  const patterns = {
    type: /\bcreate\s+type\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s+as\s+enum\b/gi,
    table: /\bcreate\s+table\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\b/gi,
    function: /\bcreate\s+function\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(/gi,
    policy: /\bcreate\s+policy\s+([a-z_][a-z0-9_]*)\b/gi,
    trigger: /\bcreate\s+trigger\s+([a-z_][a-z0-9_]*)\b/gi,
  };
  return [...new Set([...source.matchAll(patterns[kind])].map(match => match[1].toLowerCase()))].sort();
}

function sameStrings(left, right) {
  if (!Array.isArray(right) || right.some(value => typeof value !== "string")) return false;
  return JSON.stringify(left) === JSON.stringify([...new Set(right.map(value => value.toLowerCase()))].sort());
}

async function exists(path) {
  try { await access(path); return true; }
  catch { return false; }
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
    const allSchemaObjects = objects.match(/^\s*all\s+(?:tables|sequences)\s+in\s+schema\s+([\s\S]*?)\s*$/i);
    if (allSchemaObjects && includesApplicationSchema(allSchemaObjects[1])) return true;
    if (kind.toLowerCase() === "schema") {
      if (includesApplicationSchema(objects)) return true;
      continue;
    }
    if (objects.split(",").some(object => /^\s*"?(?:public|app_private)"?\s*\./i.test(object))) return true;
  }
  return false;
}

export function hasUnsafeDefaultApplicationPrivilege(source) {
  const sql = stripSqlComments(source);
  for (const statement of sql.match(/\balter\s+default\s+privileges\b[\s\S]*?;/gi) ?? []) {
    const schemaList = statement.match(/\bin\s+schema\s+([\s\S]*?)\s+\bgrant\b/i)?.[1] ?? "";
    if (!includesApplicationSchema(schemaList)) continue;
    const grant = statement.match(/\bgrant\s+[\s\S]*?\bon\s+(tables|sequences)\s+to\s+([\s\S]*?);\s*$/i);
    if (grant && mentionsApplicationRole(grant[2])) return true;
  }
  return false;
}

function includesApplicationSchema(value) {
  return value.split(",").some(identifier => /^\s*"?(?:public|app_private)"?\s*$/i.test(identifier));
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
