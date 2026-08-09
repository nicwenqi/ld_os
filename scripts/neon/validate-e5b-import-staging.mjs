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

export const E5B_SAGA_ENTRYPOINT_SIGNATURES = Object.freeze(E5B_ENTRYPOINT_SIGNATURES.slice(0, 9));
export const E5B_WORKBOOK_ENTRYPOINT_SIGNATURES = Object.freeze(E5B_ENTRYPOINT_SIGNATURES.slice(9));

const E5B_SAGA_PRIVATE_ROUTINES = Object.freeze([
  "app_private.append_neon_import_activity",
  "app_private.assert_neon_import_manager",
  "app_private.neon_import_saga_state",
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
  const hasCapabilityRoot = await exists(capabilityRoot);
  const migrationRoot = hasCapabilityRoot ? capabilityRoot : canonical;
  const migrationPaths = E5B_MIGRATIONS.map(file => join(migrationRoot, file));
  const serverPaths = REQUIRED_SERVER_FILES.map(file => join(root, file));

  if (!(await exists(migrationPaths[0]))) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_MISSING");
  }

  const schema = await readFile(migrationPaths[0], "utf8");
  let manifest = null;
  // Task 1 fixtures intentionally model only the later aggregate source gate.
  // A real Task 2 module declares its batch relation and is then subject to the
  // complete schema audit before later module checks can run.
  if (/\bcreate\s+table\s+public\.import_batches\b/i.test(stripSqlComments(schema))) {
    const manifestPath = join(migrationRoot, E5B_SCHEMA_MANIFEST);
    if (!(await exists(manifestPath))) failSource("E5B_IMPORT_STAGING_SCHEMA_MANIFEST_MISSING");
    try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
    catch { failSource("E5B_IMPORT_STAGING_SCHEMA_MANIFEST_INVALID"); }
    validateE5bImportStagingSchema(schema, manifest);
  }

  if (!(await exists(migrationPaths[1]))) {
    failSource("E5B_IMPORT_STAGING_SAGA_ENTRYPOINT_MISSING");
  }
  // Task 1 fixtures intentionally model a pre-canonical aggregate source
  // contract. Only a real post-baseline capability root is subject to the
  // Task 3 saga audit; this preserves their independent raw-ACL assertions.
  if (hasCapabilityRoot) {
    validateE5bImportSagaEntrypoints(
      await readFile(migrationPaths[1], "utf8"),
      manifest,
    );
  }
  if (!(await exists(migrationPaths[2]))) {
    failSource("E5B_IMPORT_STAGING_WORKBOOK_ENTRYPOINT_MISSING");
  }
  if (hasCapabilityRoot) {
    validateE5bImportStagingEntrypoints(await readFile(migrationPaths[2], "utf8"), manifest);
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
 * Task 3 independently validates the storage-saga mutation boundary before
 * later workbook code can hide a lease, projection, or ACL regression.
 */
export function validateE5bImportSagaEntrypoints(source, manifest = null) {
  const sql = stripSqlComments(source);
  if (!/begin;[\s\S]*commit;\s*$/i.test(sql)
    || !/set\s+local\s+role\s+hotel_ld_migration_owner\s*;/i.test(sql)) {
    failSource("E5B_IMPORT_STAGING_SAGA_TRANSACTION_BOUNDARY");
  }

  for (const signature of E5B_SAGA_ENTRYPOINT_SIGNATURES) {
    const routine = routineSource(sql, signature);
    if (!routine) failSource("E5B_IMPORT_STAGING_SAGA_ENTRYPOINT_MISSING", signature);
    if (!/security\s+definer/i.test(routine)
      || !/set\s+search_path\s*=\s*''/i.test(routine)
      || !new RegExp(`alter\\s+function\\s+${escape(signature)}\\s+owner\\s+to\\s+hotel_ld_migration_owner`, "i").test(sql)
      || !new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${escape(signature)}\\s+from\\s+public`, "i").test(sql)
      || !new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${escape(signature)}\\s+to\\s+hotel_ld_application`, "i").test(sql)) {
      failSource("E5B_IMPORT_STAGING_SAGA_ENTRYPOINT_SECURITY", signature);
    }
  }

  const manager = functionSource(sql, "app_private.assert_neon_import_manager");
  if (!manager
    || !/app_private\.assert_actor_context\s*\(\s*\)/i.test(manager)
    || !/app_private\.assert_neon_property_hostname\s*\(\s*p_hostname\s*\)/i.test(manager)
    || !/app_private\.assert_neon_property_manager\s*\(\s*\)/i.test(manager)
    || !/app_private\.current_actor_property_id\s*\(\s*\)/i.test(manager)
    || !/app_private\.current_actor_request_id\s*\(\s*\)/i.test(manager)) {
    failSource("E5B_IMPORT_STAGING_SAGA_ACTOR_CONTEXT_MISSING");
  }

  const createIntent = routineSource(sql, E5B_SAGA_ENTRYPOINT_SIGNATURES[0]);
  if (!/v_object_path\s*:=\s*v_tenant_id::text\s*\|\|\s*'\/'\s*\|\|\s*v_property_id::text[\s\S]*?\/imports\/[\s\S]*?p_batch_id::text/i.test(createIntent)
    || !/insert\s+into\s+app_private\.import_storage_operations/i.test(createIntent)
    || !/app_private\.append_neon_import_activity/i.test(createIntent)) {
    failSource("E5B_IMPORT_STAGING_SAGA_UPLOAD_INTENT_INVARIANT_MISSING");
  }

  const uploaded = routineSource(sql, E5B_SAGA_ENTRYPOINT_SIGNATURES[1]);
  if (!/for\s+update/i.test(uploaded)
    || !/v_batch\.version\s*<>\s*p_expected_version/i.test(uploaded)
    || !/storage_lifecycle\s*<>\s*'intent_created'/i.test(uploaded)
    || !/storage_lifecycle\s*=\s*'uploaded_unverified'/i.test(uploaded)) {
    failSource("E5B_IMPORT_STAGING_SAGA_UPLOAD_OBSERVATION_INVARIANT_MISSING");
  }

  const verification = routineSource(sql, E5B_SAGA_ENTRYPOINT_SIGNATURES[2]);
  if (!/for\s+update/i.test(verification)
    || !/p_verified_checksum_sha256\s*=\s*v_batch\.declared_checksum_sha256/i.test(verification)
    || !/p_verified_size_bytes\s*=\s*v_batch\.declared_size_bytes/i.test(verification)
    || !/pg_catalog\.btrim\(p_verified_mime_type\)\s*=\s*v_batch\.declared_mime_type/i.test(verification)
    || !/storage_lifecycle\s*=\s*'verification_failed'/i.test(verification)
    || !/update\s+app_private\.import_storage_operations\s+operation/i.test(verification)) {
    failSource("E5B_IMPORT_STAGING_SAGA_VERIFICATION_INVARIANT_MISSING");
  }
  if (!/storage_lifecycle\s*=\s*'verification_failed'[\s\S]*?workbook_lifecycle\s*=\s*'failed'/i.test(verification)) {
    failSource("E5B_IMPORT_STAGING_SAGA_FAILURE_WORKBOOK_TERMINALIZATION_MISSING");
  }

  const cleanupPending = routineSource(sql, E5B_SAGA_ENTRYPOINT_SIGNATURES[3]);
  if (!/storage_lifecycle\s*=\s*'linked'/i.test(cleanupPending)
    || !/storage_lifecycle\s*=\s*'cleanup_pending'/i.test(cleanupPending)
    || !/workbook_lifecycle\s*=\s*'failed'/i.test(cleanupPending)
    || !/update\s+app_private\.import_storage_operations\s+operation/i.test(cleanupPending)) {
    failSource("E5B_IMPORT_STAGING_SAGA_CLEANUP_PENDING_INVARIANT_MISSING");
  }

  const completion = routineSource(sql, E5B_SAGA_ENTRYPOINT_SIGNATURES[5]);
  const failure = routineSource(sql, E5B_SAGA_ENTRYPOINT_SIGNATURES[6]);
  const operationThenBatchLock = (routine) => {
    const operationLock = routine.search(/select\s+operation\.\*\s+into\s+v_operation\s+from\s+app_private\.import_storage_operations\s+operation[\s\S]*?for\s+update\s*;/i);
    const batchLock = routine.search(/select\s+batch\.\*\s+into\s+v_batch\s+from\s+public\.import_batches\s+batch[\s\S]*?for\s+update\s*;/i);
    return operationLock >= 0 && batchLock >= 0 && operationLock < batchLock;
  };
  if (![verification, cleanupPending, completion, failure].every(operationThenBatchLock)) {
    failSource("E5B_IMPORT_STAGING_SAGA_LEDGER_FIRST_LOCK_ORDER_MISSING");
  }

  const claim = routineSource(sql, E5B_SAGA_ENTRYPOINT_SIGNATURES[4]);
  const lockIndex = claim.search(/for\s+update(?:\s+of\s+operation\s*,\s*batch)?\s+skip\s+locked/i);
  if (lockIndex < 0) failSource("E5B_IMPORT_STAGING_SAGA_SKIP_LOCKED_MISSING");
  if (!/\bloop\b[\s\S]*?v_now\s*:=\s*pg_catalog\.clock_timestamp\s*\(\s*\)/i.test(claim)
    || !/lease_expires_at\s*<=\s*v_now/i.test(claim)
    || !/v_lease_expires_at\s*:=\s*v_now\s*\+\s*interval\s*'5 minutes'/i.test(claim)) {
    failSource("E5B_IMPORT_STAGING_SAGA_CURRENT_TIME_LEASE_GUARD_MISSING");
  }
  if (/from\s+public\.import_batches\s+batch[\s\S]*?for\s+update\s*;[\s\S]*?(?:for\s+update(?:\s+of\s+operation\s*,\s*batch)?\s+skip\s+locked|with\s+claimable_operations\s+as\s+materialized)/i.test(claim)
    || !/limit\s+p_limit/i.test(claim)
    || !/p_batch_id\s+is\s+null\s+or\s+operation\.batch_id\s*=\s*p_batch_id/i.test(claim)) {
    failSource("E5B_IMPORT_STAGING_SAGA_CLAIM_LIMIT_OR_NONBLOCKING_MISSING");
  }
  if (!/with\s+claimable_operations\s+as\s+materialized\s*\([\s\S]*?from\s+app_private\.import_storage_operations\s+operation[\s\S]*?for\s+update\s+skip\s+locked[\s\S]*?\)[\s\S]*?join\s+public\.import_batches\s+batch[\s\S]*?for\s+update\s+of\s+batch\s+skip\s+locked/i.test(claim)) {
    failSource("E5B_IMPORT_STAGING_SAGA_LEDGER_FIRST_LOCK_ORDER_MISSING");
  }
  if (!/operation\.batch_id\s*=\s*p_batch_id/i.test(claim)
    || !/operation\.property_id\s*=\s*app_private\.current_actor_property_id\s*\(\s*\)/i.test(claim)
    || !/attempt_count\s*=\s*operation\.attempt_count\s*\+\s*1/i.test(claim)
    || !/last_request_id\s*=\s*app_private\.current_actor_request_id\s*\(\s*\)/i.test(claim)
    || !/'object_path'\s*,\s*v_candidate\.object_path/i.test(claim)) {
    failSource("E5B_IMPORT_STAGING_SAGA_CLAIM_SCOPE_MISSING");
  }

  for (const routine of [verification, cleanupPending, claim, completion, failure]) {
    if (!/updated_at\s*=\s*pg_catalog\.transaction_timestamp\s*\(\s*\)/i.test(routine)) {
      failSource("E5B_IMPORT_STAGING_SAGA_LEDGER_UPDATED_AT_MISSING");
    }
  }

  for (const [signature, routine] of [
    [E5B_SAGA_ENTRYPOINT_SIGNATURES[5], completion],
    [E5B_SAGA_ENTRYPOINT_SIGNATURES[6], failure],
  ]) {
    if (!/operation\.claim_id\s*=\s*p_claim_id/i.test(routine)
      || !/operation\.lease_expires_at\s*>\s*v_now/i.test(routine)
      || !/batch\.storage_lifecycle\s*=\s*'cleanup_in_progress'/i.test(routine)) {
      failSource("E5B_IMPORT_STAGING_SAGA_CLAIM_MATCH_MISSING", signature);
    }
  }
  const failedCleanup = failure;
  if (!/pg_catalog\.left[\s\S]*?500/i.test(failedCleanup)
    || !/p_next_attempt_at\s*>\s*v_now/i.test(failedCleanup)
    || !/p_next_attempt_at\s*>\s*v_now\s*\+\s*interval\s*'24 hours'/i.test(failedCleanup)) {
    failSource("E5B_IMPORT_STAGING_SAGA_RETRY_BOUND_MISSING");
  }
  if (!/v_previous_storage_lifecycle\s*:=\s*v_candidate\.storage_lifecycle[\s\S]*?set\s+storage_lifecycle\s*=\s*'cleanup_pending'[\s\S]*?append_neon_import_activity\s*\(\s*v_candidate\.batch_id\s*,\s*'cleanup_requeued'\s*,\s*v_previous_storage_lifecycle[\s\S]*?set\s+storage_lifecycle\s*=\s*'cleanup_in_progress'[\s\S]*?append_neon_import_activity\s*\(\s*v_candidate\.batch_id\s*,\s*'cleanup_claimed'/i.test(claim)) {
    failSource("E5B_IMPORT_STAGING_SAGA_CLAIM_RECONCILIATION_AUDIT_MISSING");
  }

  for (const signature of E5B_SAGA_ENTRYPOINT_SIGNATURES.slice(7)) {
    const projection = routineSource(sql, signature);
    if (/\b(?:object_path|declared_checksum_sha256|verified_checksum_sha256|last_error_message)\b/i.test(projection)
      || !/sanitized_filename/i.test(projection)
      || !/cleanup_attention_required/i.test(projection)) {
      failSource("E5B_IMPORT_STAGING_SAGA_BROWSER_PROJECTION_LEAK", signature);
    }
  }

  if (hasUnsafeRawApplicationPrivilege(sql)
    || hasUnsafeDefaultApplicationPrivilege(sql)
    || /\bcreate\s+schema(?:\s+if\s+not\s+exists)?\s+"?(?:auth|storage)"?\b/i.test(sql)
    || /(?:^|[^\w"])"?(?:auth|storage)"?\s*\./i.test(sql)
    || /(?:commit_neon_import|revert_neon_import|legacy_import)/i.test(sql)) {
    failSource("E5B_IMPORT_STAGING_SAGA_BOUNDARY_VIOLATION");
  }

  if (manifest && (!sameStrings(sourceInventory(sql, "function"), manifest.sagaRoutines)
    || JSON.stringify(E5B_SAGA_ENTRYPOINT_SIGNATURES) !== JSON.stringify(manifest.sagaEntrypoints))) {
    failSource("E5B_IMPORT_STAGING_SAGA_MANIFEST_DRIFT");
  }
  return { entrypoints: E5B_SAGA_ENTRYPOINT_SIGNATURES.length, privateRoutines: E5B_SAGA_PRIVATE_ROUTINES.length };
}

/**
 * Task 4 is deliberately source-verifiable before any repository exists.  The
 * transaction-local guard is critical: a chunk routine must never be usable as
 * an independently committed mutation after `begin` has released its lock.
 */
export function validateE5bImportStagingEntrypoints(source, manifest = null) {
  const sql = stripSqlComments(source);
  if (!/begin;[\s\S]*commit;\s*$/i.test(sql)
    || !/set\s+local\s+role\s+hotel_ld_migration_owner\s*;/i.test(sql)) {
    failSource("E5B_IMPORT_STAGING_TRANSACTION_BOUNDARY");
  }
  for (const signature of E5B_WORKBOOK_ENTRYPOINT_SIGNATURES) {
    const routine = routineSource(sql, signature);
    if (!routine
      || !/security\s+definer/i.test(routine)
      || !/set\s+search_path\s*=\s*''/i.test(routine)
      || !new RegExp(`alter\\s+function\\s+${escape(signature)}\\s+owner\\s+to\\s+hotel_ld_migration_owner`, "i").test(sql)
      || !new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${escape(signature)}\\s+from\\s+public`, "i").test(sql)
      || !new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${escape(signature)}\\s+to\\s+hotel_ld_application`, "i").test(sql)) {
      failSource("E5B_IMPORT_STAGING_ENTRYPOINT_SECURITY", signature);
    }
  }
  const begin = routineSource(sql, E5B_WORKBOOK_ENTRYPOINT_SIGNATURES[0]);
  if (!/storage_lifecycle\s*<>\s*'verified'/i.test(begin)
    || !/verification_status\s*<>\s*'passed'/i.test(begin)
    || !/workbook_lifecycle\s*<>\s*'intent_created'/i.test(begin)
    || !/v_batch\.version\s*<>\s*p_expected_version/i.test(begin)
    || !/pg_catalog\.pg_advisory_xact_lock/i.test(begin)
    || !/pg_catalog\.set_config\(\s*'app\.e5b_import_staging_batch_id'/i.test(begin)) {
    failSource("E5B_IMPORT_STAGING_BEGIN_GUARD_MISSING");
  }
  const guard = functionSource(sql, "app_private.assert_neon_import_staging_guard");
  if (!/pg_catalog\.current_setting\(\s*'app\.e5b_import_staging_batch_id'\s*,\s*true\s*\)/i.test(guard)
    || !/pg_catalog\.pg_try_advisory_xact_lock/i.test(guard)
    || !/NEON_IMPORT_STAGING_TRANSACTION_REQUIRED/i.test(guard)) {
    failSource("E5B_IMPORT_STAGING_XACT_LOCK_GUARD_MISSING");
  }
  if (!/batch\.xmin\s*=\s*pg_catalog\.pg_current_xact_id\(\)::xid/i.test(guard)
    || !/batch\.xmin::text\s*=\s*v_provenance/i.test(guard)
    || !/pg_catalog\.current_setting\(\s*'app\.e5b_import_staging_xmin'\s*,\s*true\s*\)/i.test(guard)
    || !/pg_catalog\.set_config\(\s*'app\.e5b_import_staging_batch_id'/i.test(begin)
    || !/pg_catalog\.set_config\(\s*'app\.e5b_import_staging_xmin'/i.test(begin)) {
    failSource("E5B_IMPORT_STAGING_TRANSACTION_PROVENANCE_MISSING");
  }
  for (const signature of E5B_WORKBOOK_ENTRYPOINT_SIGNATURES.slice(1, 6)) {
    const append = routineSource(sql, signature);
    if (!/app_private\.assert_neon_import_staging_guard/i.test(append)
      || !/NEON_IMPORT_STAGING_CHUNK_INVALID/i.test(append)
      || !/250/i.test(append)) {
      failSource("E5B_IMPORT_STAGING_APPEND_BOUNDARY_MISSING", signature);
    }
  }
  const mappings = routineSource(sql, E5B_WORKBOOK_ENTRYPOINT_SIGNATURES[2]);
  const rawRows = routineSource(sql, E5B_WORKBOOK_ENTRYPOINT_SIGNATURES[3]);
  if (!/public\.import_source_rows/i.test(mappings)
    || !/public\.import_field_mappings/i.test(rawRows)
    || !/row_fingerprint/i.test(rawRows)
    || !/app_private\.neon_import_source_row_fingerprint/i.test(rawRows)) {
    failSource("E5B_IMPORT_STAGING_MAPPING_ROW_CONSISTENCY_MISSING");
  }
  const labels = routineSource(sql, E5B_WORKBOOK_ENTRYPOINT_SIGNATURES[5]);
  if (!/sheet\.id\s*=\s*batch\.selected_sheet_id/i.test(labels)
    || !/same_name\.sheet_name/i.test(labels)) {
    failSource("E5B_IMPORT_STAGING_SELECTED_SHEET_LABEL_BINDING_MISSING");
  }
  if (!/(?:resolution_type|resolutiontype).*?not\s+in\s*\(\s*'department'\s*,\s*'position'\s*\)/i.test(labels)
    || !/resolution_status/i.test(labels)
    || !/'pending'/i.test(labels)
    || !/sheet\.id\s*=\s*batch\.selected_sheet_id/i.test(labels)
    || !/sheet\.purpose\s*=\s*'employee_master'/i.test(labels)
    || !/count\(\*\).*same_name/i.test(labels)) {
    failSource("E5B_IMPORT_STAGING_SOURCE_LABEL_SCOPE_MISSING");
  }
  const finalize = routineSource(sql, E5B_WORKBOOK_ENTRYPOINT_SIGNATURES[6]);
  if (!/app_private\.neon_import_staging_manifest_sha256/i.test(finalize)
    || !/p_evidence_manifest\s*<>\s*v_manifest/i.test(finalize)
    || !/p_evidence_sha256\s*<>\s*v_evidence_sha256/i.test(finalize)
    || !/storage_lifecycle\s*=\s*'linked'/i.test(finalize)
    || !/workbook_lifecycle\s*=\s*'mapping_required'/i.test(finalize)
    || !/version\s*=\s*v_batch\.version\s*\+\s*1/i.test(finalize)
    || !/app_private\.append_neon_import_activity/i.test(finalize)) {
    failSource("E5B_IMPORT_STAGING_CANONICAL_MANIFEST_MISSING");
  }
  const rawCanonicalizer = functionSource(sql, "app_private.neon_import_canonical_raw_values");
  if (!/'sourceColumnIndex'/i.test(rawRows)
    || !/sourceColumnIndex.*sourceColumnName.*targetField/i.test(rawRows)
    || !/app_private\.neon_import_canonical_raw_values/i.test(rawRows)
    || !/value->>'sourceColumnIndex'\)::integer/i.test(rawCanonicalizer)
    || !/sourceColumnName.*targetField/i.test(rawCanonicalizer)) {
    failSource("E5B_IMPORT_STAGING_DUPLICATE_HEADER_IDENTITY_MISSING");
  }
  if (!/pg_catalog\.jsonb_array_elements\(row\.raw_values\).*?mapping\.source_column_name/i.test(finalize)
    || !/mapping\.source_column_index\s*=\s*\(cell->>'sourceColumnIndex'\)::integer/i.test(finalize)
    || !/\(cell->>'sourceColumnIndex'\)::integer\s*=\s*mapping\.source_column_index/i.test(finalize)
    || !/mapping\.mapping_status\s*=\s*'suggested'/i.test(finalize)
    || !/pg_catalog\.jsonb_object_keys\(row\.normalized_values\)/i.test(finalize)
    || !/not\s+\(row\.normalized_values\s*\?\s*mapping\.target_field\)/i.test(finalize)) {
    failSource("E5B_IMPORT_STAGING_BIDIRECTIONAL_MAPPING_MISSING");
  }
  const hash = functionSource(sql, "app_private.neon_import_sha256");
  const normalization = functionSource(sql, "app_private.neon_import_normalize_source_label");
  if (!/e5b-utf8-frame-v1/i.test(hash)
    || !/pg_catalog\.octet_length\(pg_catalog\.convert_to/i.test(hash)
    || !/public\.digest/i.test(hash)
    || !/pg_catalog\.normalize\(pg_catalog\.btrim\(p_value\),\s*'NFKC'\)/i.test(normalization)
    || !/collate\s+"C"/i.test(normalization)) {
    failSource("E5B_IMPORT_STAGING_CANONICAL_JSON_ENCODING_MISSING");
  }
  const pgcryptoInstall = sql.search(/create\s+extension\s+if\s+not\s+exists\s+pgcrypto\s+with\s+schema\s+public/i);
  const migrationRole = sql.search(/set\s+local\s+role\s+hotel_ld_migration_owner\s*;/i);
  if (pgcryptoInstall < 0
    || (manifest && !manifest.extensions?.includes("pgcrypto"))) {
    failSource("E5B_IMPORT_STAGING_PGCRYPTO_MANIFEST_MISSING");
  }
  if (migrationRole < 0 || pgcryptoInstall > migrationRole) {
    failSource("E5B_IMPORT_STAGING_PGCRYPTO_BOOTSTRAP_ORDER_INVALID");
  }
  if (/\b(?:commit_neon_import|revert_neon_import|employee_external_identifiers|insert\s+into\s+public\.employees)\b/i.test(sql)
    || hasUnsafeRawApplicationPrivilege(sql)
    || hasUnsafeDefaultApplicationPrivilege(sql)) {
    failSource("E5B_IMPORT_STAGING_BOUNDARY_VIOLATION");
  }
  return { entrypoints: E5B_WORKBOOK_ENTRYPOINT_SIGNATURES.length, atomic: true };
}

/**
 * The live catalog command consumes this compact shape after querying
 * pg_extension. Keeping it pure allows the extension requirement to be
 * verified without opening a database connection in source fixtures.
 */
export function validateE5bImportStagingCatalog(catalog, manifest) {
  if (!manifest || !Array.isArray(manifest.extensions)) {
    failSource("E5B_IMPORT_STAGING_CATALOG_MANIFEST_INVALID");
  }
  const extensions = Array.isArray(catalog?.extensions)
    ? new Set(catalog.extensions.map(value => String(value).toLowerCase()))
    : new Set();
  for (const extension of manifest.extensions) {
    if (!extensions.has(String(extension).toLowerCase())) {
      failSource("E5B_IMPORT_STAGING_CATALOG_EXTENSION_MISSING", extension);
    }
  }
  return { extensions: [...extensions].sort() };
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
  for (const policy of [
    "canonical_import_batches_scope",
    "canonical_import_sheets_scope",
    "canonical_import_source_rows_scope",
    "canonical_import_field_mappings_scope",
    "canonical_import_issues_scope",
    "canonical_import_source_label_resolutions_scope",
    "canonical_import_storage_operations_scope",
  ]) {
    const statement = policyStatement(sql, policy);
    if (!/\bfor\s+all\s+to\s+hotel_ld_migration_owner\b/i.test(statement)
      || !hasActorPropertyScope(policyClause(statement, "using"))
      || !hasActorPropertyScope(policyClause(statement, "with check"))) {
      failSource("E5B_IMPORT_STAGING_SCHEMA_POLICY_SEMANTICS_MISSING", policy);
    }
  }
  const auditPolicy = policyStatement(sql, "canonical_import_activity_events_insert");
  if (!/\bon\s+app_private\.import_activity_events\s+for\s+insert\s+to\s+hotel_ld_migration_owner\b/i.test(auditPolicy)
    || /\busing\s*\(/i.test(auditPolicy)
    || !hasActorPropertyScope(policyClause(auditPolicy, "with check"))) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_POLICY_SEMANTICS_MISSING", "canonical_import_activity_events_insert");
  }
  if (!/create\s+function\s+app_private\.neon_import_storage_transition_allowed\s*\(/i.test(sql)
    || !/create\s+function\s+app_private\.neon_import_workbook_transition_allowed\s*\(/i.test(sql)
    || !/create\s+trigger\s+canonical_import_batch_lifecycle_transition\b/i.test(sql)) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING", "lifecycle_transitions");
  }
  const storageTransitions = normalizedSource(
    functionSource(sql, "app_private.neon_import_storage_transition_allowed"),
  );
  // Task 1/2 focused fixtures intentionally model the minimum schema inventory.
  // The complete canonical manifest adds the saga failure/reconciliation state
  // machine and therefore must carry this ambiguous-upload transition.
  const requiresSagaCleanupTransition = manifest?.schemaTypes?.includes(
    "public.import_sheet_purpose",
  );
  if (requiresSagaCleanupTransition
    && !storageTransitions.includes("'uploaded_unverified'::public.import_storage_lifecycle,'cleanup_pending'::public.import_storage_lifecycle")) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING", "storage_cleanup_pending_transition");
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
  const linkedEvidence = normalizedSource(constraintSource(sql, "import_batches_linked_evidence_check"));
  if (!includesAll(linkedEvidence, [
    "storage_lifecycle<>'linked'", "verification_status='passed'",
    "workbook_lifecycle='mapping_required'", "sealed_evidence_sha256isnotnull", "linked_atisnotnull",
  ])) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING", "linked_verification_guard");
  }
  if (!/unique\s*\(\s*id\s*,\s*tenant_id\s*,\s*property_id\s*,\s*object_path\s*\)/i.test(sql)
    || !/foreign\s+key\s*\(\s*batch_id\s*,\s*tenant_id\s*,\s*property_id\s*,\s*object_path\s*\)\s*references\s+public\.import_batches\s*\(\s*id\s*,\s*tenant_id\s*,\s*property_id\s*,\s*object_path\s*\)/i.test(sql)) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING", "storage_operation_object_path_binding");
  }
  const verifiedStorage = normalizedSource(constraintSource(sql, "import_batches_storage_verification_state_check"));
  if (!includesAll(verifiedStorage, [
    "storage_lifecyclenotin('verified','linked')",
    "verification_status='passed'",
    "verified_checksum_sha256isnotnull",
    "verified_size_bytesisnotnull",
    "verified_mime_typeisnotnull",
    "verified_checksum_sha256=declared_checksum_sha256",
    "verified_size_bytes=declared_size_bytes",
    "verified_mime_type=declared_mime_type",
  ])) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING", "storage_verification_state");
  }
  const verificationFailure = normalizedSource(constraintSource(sql, "import_batches_verification_failure_coherence_check"));
  if (!includesAll(verificationFailure, [
    "storage_lifecycle<>'verification_failed'", "verification_status='failed'",
    "verification_status<>'failed'", "storage_lifecyclein('verification_failed','cleanup_pending','cleanup_in_progress','cleanup_failed','cleanup_completed')",
  ])) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING", "verification_failure_state");
  }
  const cleanupLease = constraintSource(sql, "import_storage_operations_cleanup_lease_check");
  if (/\b(?:transaction_timestamp|clock_timestamp|statement_timestamp|now)\s*\(/i.test(cleanupLease)) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_TIME_DEPENDENT_LEASE_CHECK");
  }
  if (!/cleanup_state\s*<>\s*'cleanup_in_progress'\s+or\s*\(\s*claim_id\s+is\s+not\s+null\s+and\s+lease_expires_at\s+is\s+not\s+null\s+and\s+last_attempt_at\s+is\s+not\s+null\s+and\s+lease_expires_at\s*>\s*last_attempt_at/i.test(cleanupLease)) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING", "cleanup_lease_guard");
  }
  if (!/create\s+function\s+app_private\.reject_import_activity_mutation\s*\(/i.test(sql)
    || !/create\s+trigger\s+import_activity_events_append_only\s+before\s+update\s+or\s+delete\s+on\s+app_private\.import_activity_events/i.test(sql)) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_AUDIT_TRIGGER_MISSING");
  }
  if (!/new\.source_system\s+is\s+distinct\s+from\s+old\.source_system/i.test(functionSource(sql, "app_private.enforce_neon_import_batch_lifecycle_transition"))) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING", "batch_immutable_source_system");
  }
  const selectedSheetFunction = functionSource(sql, "app_private.enforce_neon_import_selected_sheet");
  if (!/\bcreate\s+constraint\s+trigger\s+canonical_import_selected_sheet_integrity_batches\b[\s\S]*?\bdeferrable\s+initially\s+deferred\b/i.test(sql)
    || !/\bcreate\s+constraint\s+trigger\s+canonical_import_selected_sheet_integrity_sheets\b[\s\S]*?\bdeferrable\s+initially\s+deferred\b/i.test(sql)
    || !/count\s*\(\s*\*\s*\)/i.test(selectedSheetFunction)
    || !/v_selected_count\s*<>\s*1/i.test(selectedSheetFunction)
    || !/v_matching_selected_count\s*<>\s*1/i.test(selectedSheetFunction)) {
    failSource("E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING", "selected_sheet_integrity");
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

function policyStatement(source, name) {
  return source.match(new RegExp(`\\bcreate\\s+policy\\s+${escape(name)}\\b[\\s\\S]*?;`, "i"))?.[0] ?? "";
}

function policyClause(statement, clause) {
  const match = statement.match(new RegExp(`\\b${clause.replace(" ", "\\s+")}\\s*\\(([^;]+)`, "i"));
  return match?.[1] ?? "";
}

function hasActorPropertyScope(value) {
  const normalized = value.replace(/\s+/g, "").toLowerCase();
  return normalized.includes("session_user='hotel_ld_application'")
    && normalized.includes("property_id=app_private.current_actor_property_id()");
}

function constraintSource(source, name) {
  const start = source.search(new RegExp(`\\bconstraint\\s+${escape(name)}\\s+check\\s*\\(`, "i"));
  if (start < 0) return "";
  const following = source.slice(start);
  const end = following.search(/\n\s*\),\n\s*constraint\s+/i);
  return end < 0 ? following : following.slice(0, end + 2);
}

function functionSource(source, name) {
  return source.match(new RegExp(`\\bcreate\\s+function\\s+${escape(name)}\\s*\\([\\s\\S]*?\\$function\\$;`, "i"))?.[0]
    ?? source.match(new RegExp(`\\bcreate\\s+function\\s+${escape(name)}\\s*\\([\\s\\S]*?\\$\\$;`, "i"))?.[0]
    ?? "";
}

function normalizedSource(value) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function includesAll(value, required) {
  return required.every(fragment => value.includes(fragment));
}

function sourceInventory(source, kind) {
  const patterns = {
    type: /\bcreate\s+type\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s+as\s+enum\b/gi,
    table: /\bcreate\s+table\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\b/gi,
    function: /\bcreate\s+function\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(/gi,
    policy: /\bcreate\s+policy\s+([a-z_][a-z0-9_]*)\b/gi,
    trigger: /\bcreate(?:\s+constraint)?\s+trigger\s+([a-z_][a-z0-9_]*)\b/gi,
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
