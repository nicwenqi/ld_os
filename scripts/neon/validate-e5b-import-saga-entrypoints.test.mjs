import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  validateE5bImportSagaEntrypoints,
  validateE5bImportStagingSchema,
  validateE5bImportStagingSource,
} from "./validate-e5b-import-staging.mjs";

const repositoryRoot = join(import.meta.dirname, "../..");

test("E5B source rejects a saga claim without a current-time lease guard before workbook staging checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "e5b-saga-validator-"));
  try {
    await mkdir(join(root, "neon/canonical/e5b"), { recursive: true });
    await cp(
      join(repositoryRoot, "neon/canonical/e5b/090_import_staging_schema.sql"),
      join(root, "neon/canonical/e5b/090_import_staging_schema.sql"),
    );
    await cp(
      join(repositoryRoot, "neon/canonical/e5b/e5b-import-staging-manifest.json"),
      join(root, "neon/canonical/e5b/e5b-import-staging-manifest.json"),
    );
    const sagaSource = await readFile(
      join(repositoryRoot, "neon/canonical/e5b/091_import_saga_entrypoints.sql"),
      "utf8",
    );
    await writeFile(
      join(root, "neon/canonical/e5b/091_import_saga_entrypoints.sql"),
      sagaSource.replace(
        "v_now := pg_catalog.clock_timestamp();",
        "v_now := pg_catalog.transaction_timestamp();",
      ),
    );

    await assert.rejects(
      validateE5bImportStagingSource({ root }),
      /E5B_IMPORT_STAGING_SAGA_CURRENT_TIME_LEASE_GUARD_MISSING/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("E5B schema rejects cleanup-pending transition missing from uploaded storage", async () => {
  const [schema, manifestSource] = await Promise.all([
    readFile(join(repositoryRoot, "neon/canonical/e5b/090_import_staging_schema.sql"), "utf8"),
    readFile(join(repositoryRoot, "neon/canonical/e5b/e5b-import-staging-manifest.json"), "utf8"),
  ]);

  assert.throws(
    () => validateE5bImportStagingSchema(
      schema.replace(
        "('uploaded_unverified'::public.import_storage_lifecycle, 'cleanup_pending'::public.import_storage_lifecycle),\n",
        "",
      ),
      JSON.parse(manifestSource),
    ),
    /E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING: storage_cleanup_pending_transition/,
  );
});

test("E5B saga rejects a verification failure that leaves workbook lifecycle inspectable", async () => {
  const [saga, manifestSource] = await Promise.all([
    readFile(join(repositoryRoot, "neon/canonical/e5b/091_import_saga_entrypoints.sql"), "utf8"),
    readFile(join(repositoryRoot, "neon/canonical/e5b/e5b-import-staging-manifest.json"), "utf8"),
  ]);

  assert.throws(
    () => validateE5bImportSagaEntrypoints(
      saga.replace(
        "storage_lifecycle = 'verification_failed',\n        workbook_lifecycle = 'failed',\n        failure_reason = v_failure_reason,",
        "storage_lifecycle = 'verification_failed',\n        failure_reason = v_failure_reason,",
      ),
      JSON.parse(manifestSource),
    ),
    /E5B_IMPORT_STAGING_SAGA_FAILURE_WORKBOOK_TERMINALIZATION_MISSING/,
  );
});

test("E5B saga rejects a cleanup-pending transition that leaves its failed workbook non-terminal", async () => {
  const [saga, manifestSource] = await Promise.all([
    readFile(join(repositoryRoot, "neon/canonical/e5b/091_import_saga_entrypoints.sql"), "utf8"),
    readFile(join(repositoryRoot, "neon/canonical/e5b/e5b-import-staging-manifest.json"), "utf8"),
  ]);

  assert.throws(
    () => validateE5bImportSagaEntrypoints(
      saga.replace(
        "set storage_lifecycle = 'cleanup_pending',\n      workbook_lifecycle = 'failed',\n      version = version + 1",
        "set storage_lifecycle = 'cleanup_pending',\n      version = version + 1",
      ),
      JSON.parse(manifestSource),
    ),
    /E5B_IMPORT_STAGING_SAGA_CLEANUP_PENDING_INVARIANT_MISSING/,
  );
});

test("E5B saga rejects a cleanup claim that does not refresh its ledger timestamp", async () => {
  const [saga, manifestSource] = await Promise.all([
    readFile(join(repositoryRoot, "neon/canonical/e5b/091_import_saga_entrypoints.sql"), "utf8"),
    readFile(join(repositoryRoot, "neon/canonical/e5b/e5b-import-staging-manifest.json"), "utf8"),
  ]);

  assert.throws(
    () => validateE5bImportSagaEntrypoints(
      saga.replace(
        "completed_at = null,\n        updated_at = pg_catalog.transaction_timestamp(),\n        version = operation.version + 1",
        "completed_at = null,\n        version = operation.version + 1",
      ),
      JSON.parse(manifestSource),
    ),
    /E5B_IMPORT_STAGING_SAGA_LEDGER_UPDATED_AT_MISSING/,
  );
});

test("E5B saga rejects a claim that ignores its requested limit", async () => {
  const [saga, manifestSource] = await Promise.all([
    readFile(join(repositoryRoot, "neon/canonical/e5b/091_import_saga_entrypoints.sql"), "utf8"),
    readFile(join(repositoryRoot, "neon/canonical/e5b/e5b-import-staging-manifest.json"), "utf8"),
  ]);

  assert.throws(
    () => validateE5bImportSagaEntrypoints(
      saga.replace("limit p_limit\n      for update skip locked", "limit 1\n      for update skip locked"),
      JSON.parse(manifestSource),
    ),
    /E5B_IMPORT_STAGING_SAGA_CLAIM_LIMIT_OR_NONBLOCKING_MISSING/,
  );
});

test("E5B saga rejects a cleanup claim that blocks on a batch before using SKIP LOCKED", async () => {
  const [saga, manifestSource] = await Promise.all([
    readFile(join(repositoryRoot, "neon/canonical/e5b/091_import_saga_entrypoints.sql"), "utf8"),
    readFile(join(repositoryRoot, "neon/canonical/e5b/e5b-import-staging-manifest.json"), "utf8"),
  ]);

  assert.throws(
    () => validateE5bImportSagaEntrypoints(
      saga.replace(
        "for v_candidate in\n    with claimable_operations as materialized (",
        "select batch.id from public.import_batches batch where batch.id = p_batch_id for update;\n\n  for v_candidate in\n    with claimable_operations as materialized (",
      ),
      JSON.parse(manifestSource),
    ),
    /E5B_IMPORT_STAGING_SAGA_CLAIM_LIMIT_OR_NONBLOCKING_MISSING/,
  );
});

test("E5B saga rejects completion that locks the batch before its cleanup ledger", async () => {
  const [saga, manifestSource] = await Promise.all([
    readFile(join(repositoryRoot, "neon/canonical/e5b/091_import_saga_entrypoints.sql"), "utf8"),
    readFile(join(repositoryRoot, "neon/canonical/e5b/e5b-import-staging-manifest.json"), "utf8"),
  ]);

  assert.throws(
    () => validateE5bImportSagaEntrypoints(
      saga.replace(
        "v_now := pg_catalog.clock_timestamp();\n  select operation.* into v_operation\n  from app_private.import_storage_operations operation",
        "v_now := pg_catalog.clock_timestamp();\n  select batch.* into v_batch\n  from public.import_batches batch",
      ),
      JSON.parse(manifestSource),
    ),
    /E5B_IMPORT_STAGING_SAGA_LEDGER_FIRST_LOCK_ORDER_MISSING/,
  );
});

test("E5B saga rejects a claim that skips its failed-to-pending reconciliation audit", async () => {
  const [saga, manifestSource] = await Promise.all([
    readFile(join(repositoryRoot, "neon/canonical/e5b/091_import_saga_entrypoints.sql"), "utf8"),
    readFile(join(repositoryRoot, "neon/canonical/e5b/e5b-import-staging-manifest.json"), "utf8"),
  ]);

  assert.throws(
    () => validateE5bImportSagaEntrypoints(
      saga.replace("'cleanup_requeued'", "'cleanup_reconciliation_omitted'"),
      JSON.parse(manifestSource),
    ),
    /E5B_IMPORT_STAGING_SAGA_CLAIM_RECONCILIATION_AUDIT_MISSING/,
  );
});
