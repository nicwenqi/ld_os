import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  validateE5bImportStagingAuthorizationSource,
  validateE5bImportStorageCleanupExecutorSource,
  validateE5bImportStorageSagaCoordinatorSource,
} from "./validate-e5b-import-staging.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { readFile } = await import("node:fs/promises");
const { cleanupRetryDelayMs, executeDueStorageCleanup } = await import("../../app/services/import/storage-cleanup-executor.ts");
const { createStorageSagaCoordinator } = await import("../../app/services/import/storage-saga-coordinator.ts");

const ids = Object.freeze({ batch: "33333333-3333-4333-8333-333333333333", operation: "44444444-4444-4444-8444-444444444444", claim: "55555555-5555-4555-8555-555555555555" });
const csv = new TextEncoder().encode("Employee No,Name\nE-001,Ada\n");
const checksum = createHash("sha256").update(csv).digest("hex");

test("source audit enforces auth, saga ordering, and exact cleanup deletion", async () => {
  const [authorization, coordinator, cleanup] = await Promise.all([
    readFile(new URL("../../app/services/neon-import-staging-authorization.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/services/import/storage-saga-coordinator.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/services/import/storage-cleanup-executor.ts", import.meta.url), "utf8"),
  ]);
  assert.deepEqual(validateE5bImportStagingAuthorizationSource(authorization), { auth: "supabase-auth-user", scope: "neon-live-property", storage: "server-private-blob" });
  assert.equal(validateE5bImportStorageSagaCoordinatorSource(coordinator).order, "intent-upload-observe-verify-parse-stage");
  assert.equal(validateE5bImportStorageCleanupExecutorSource(cleanup).deletion, "exact-bucket-path");
});

test("retry schedule is bounded at six hours", () => {
  assert.equal(cleanupRetryDelayMs(1), 30_000);
  assert.equal(cleanupRetryDelayMs(2), 120_000);
  assert.equal(cleanupRetryDelayMs(3), 600_000);
  assert.equal(cleanupRetryDelayMs(4), 3_600_000);
  assert.equal(cleanupRetryDelayMs(5), 21_600_000);
  assert.equal(cleanupRetryDelayMs(99), 21_600_000);
});

test("cleanup removes only the claimed exact object and records success", async () => {
  const calls = [];
  const repository = {
    async claimDueCleanup(input) { calls.push(["claim", input]); return [{ batchId: ids.batch, operationId: ids.operation, bucket: "property-import-files", objectPath: "tenant/property/imports/batch/file.csv", claimId: ids.claim, attemptCount: 1, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }]; },
    async completeCleanup(input) { calls.push(["complete", input]); return {}; },
    async failCleanup() { throw new Error("unexpected failure"); },
  };
  const storage = { async remove(bucket, path) { calls.push(["remove", bucket, path]); } };
  const result = await executeDueStorageCleanup({ repository, storage, claimIdFactory: () => ids.claim });
  assert.deepEqual(result, [{ batchId: ids.batch, status: "completed", attemptCount: 1 }]);
  assert.deepEqual(calls.map(call => call[0]), ["claim", "remove", "complete"]);
  assert.deepEqual(calls[1], ["remove", "property-import-files", "tenant/property/imports/batch/file.csv"]);
});

test("cleanup failure records bounded retry evidence", async () => {
  let failure;
  const repository = {
    async claimDueCleanup() { return [{ batchId: ids.batch, operationId: ids.operation, bucket: "property-import-files", objectPath: "exact.csv", claimId: ids.claim, attemptCount: 2, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }]; },
    async completeCleanup() { throw new Error("must not complete"); },
    async failCleanup(input) { failure = input; return {}; },
  };
  const result = await executeDueStorageCleanup({ repository, storage: { async remove() { throw new Error("provider-secret"); } }, now: () => new Date("2026-01-01T00:00:00.000Z") });
  assert.deepEqual(result, [{ batchId: ids.batch, status: "failed", attemptCount: 2 }]);
  assert.equal(failure.error, "IMPORT_STORAGE_CLEANUP_FAILED");
  assert.equal(failure.nextAttemptAt, "2026-01-01T00:02:00.000Z");
});

test("saga observes upload before verification and stages only after read-back", async () => {
  const calls = [];
  const repository = {
    async createUploadIntent() { calls.push("intent"); return { batchId: ids.batch, objectPath: "tenant/property/imports/batch/file.csv", storageLifecycle: "intent_created", workbookLifecycle: "intent_created", verificationStatus: "pending", version: 1 }; },
    async recordObjectUploaded() { calls.push("uploaded"); return { batchId: ids.batch, storageLifecycle: "uploaded_unverified", workbookLifecycle: "intent_created", verificationStatus: "pending", version: 2 }; },
    async recordObjectVerification() { calls.push("verified"); return { batchId: ids.batch, storageLifecycle: "verified", workbookLifecycle: "inspecting", verificationStatus: "passed", version: 3 }; },
    async stageVerifiedWorkbook() { calls.push("stage"); return { batchId: ids.batch, storageLifecycle: "linked", workbookLifecycle: "mapping_required", verificationStatus: "passed", version: 4 }; },
    async markCleanupPending() { calls.push("cleanup_pending"); return {}; },
  };
  const storage = {
    async upload() { calls.push("upload"); },
    async download() { calls.push("download"); return csv; },
    async remove() { calls.push("remove"); },
  };
  const result = await createStorageSagaCoordinator({ repository, storage }).uploadAndStage({
    batchId: ids.batch,
    originalFilename: "employees.csv",
    sanitizedFilename: "employees.csv",
    declaredChecksumSha256: checksum,
    declaredSizeBytes: csv.byteLength,
    declaredMimeType: "text/csv",
    sourceSystem: "manual-upload",
    bytes: csv,
    prepareEvidence: async (bytes) => { assert.deepEqual(bytes, csv); return { batch: { detectedSheetCount: 1, totalSourceRows: 1, validRows: 1, warningRows: 0, errorRows: 0, selectedSheetName: "Employees" }, sheets: [], fieldMappings: [], sourceRows: [], issues: [], sourceLabels: [] }; },
  });
  assert.equal(result.storageLifecycle, "linked");
  assert.deepEqual(calls, ["intent", "upload", "uploaded", "download", "verified", "stage"]);
});

test("saga Storage I/O never overlaps a repository transaction", async () => {
  let transactionOpen = false;
  const calls = [];
  const inTransaction = async (name, result) => {
    assert.equal(transactionOpen, false, `${name} began while another transaction was open`);
    transactionOpen = true;
    calls.push(name);
    try { return result; } finally { transactionOpen = false; }
  };
  const repository = {
    createUploadIntent: () => inTransaction("intent", { batchId: ids.batch, objectPath: "exact.csv", storageLifecycle: "intent_created", workbookLifecycle: "intent_created", verificationStatus: "pending", version: 1 }),
    recordObjectUploaded: () => inTransaction("uploaded", { batchId: ids.batch, storageLifecycle: "uploaded_unverified", workbookLifecycle: "intent_created", verificationStatus: "pending", version: 2 }),
    recordObjectVerification: () => inTransaction("verified", { batchId: ids.batch, storageLifecycle: "verified", workbookLifecycle: "inspecting", verificationStatus: "passed", version: 3 }),
    stageVerifiedWorkbook: () => inTransaction("stage", { batchId: ids.batch, storageLifecycle: "linked", workbookLifecycle: "mapping_required", verificationStatus: "passed", version: 4 }),
    markCleanupPending: () => inTransaction("cleanup_pending", {}),
  };
  const storage = {
    async upload() { assert.equal(transactionOpen, false); calls.push("upload"); },
    async download() { assert.equal(transactionOpen, false); calls.push("download"); return csv; },
    async remove() { assert.equal(transactionOpen, false); calls.push("remove"); },
  };
  await createStorageSagaCoordinator({ repository, storage }).uploadAndStage({
    batchId: ids.batch,
    originalFilename: "employees.csv",
    sanitizedFilename: "employees.csv",
    declaredChecksumSha256: checksum,
    declaredSizeBytes: csv.byteLength,
    declaredMimeType: "text/csv",
    sourceSystem: "manual-upload",
    bytes: csv,
    prepareEvidence: async () => ({ batch: { detectedSheetCount: 1, totalSourceRows: 1, validRows: 1, warningRows: 0, errorRows: 0, selectedSheetName: "Employees" }, sheets: [], fieldMappings: [], sourceRows: [], issues: [], sourceLabels: [] }),
  });
  assert.deepEqual(calls, ["intent", "upload", "uploaded", "download", "verified", "stage"]);
});

test("failed staging persists cleanup pending before compensation", async () => {
  const calls = [];
  const repository = {
    async createUploadIntent() { calls.push("intent"); return { batchId: ids.batch, objectPath: "exact.csv", storageLifecycle: "intent_created", workbookLifecycle: "intent_created", verificationStatus: "pending", version: 1 }; },
    async recordObjectUploaded() { calls.push("uploaded"); return { batchId: ids.batch, storageLifecycle: "uploaded_unverified", workbookLifecycle: "intent_created", verificationStatus: "pending", version: 2 }; },
    async recordObjectVerification() { calls.push("verified"); return { batchId: ids.batch, storageLifecycle: "verified", workbookLifecycle: "inspecting", verificationStatus: "passed", version: 3 }; },
    async markCleanupPending() { calls.push("cleanup_pending"); return {}; },
  };
  const storage = { async upload() { calls.push("upload"); }, async download() { calls.push("download"); return csv; }, async remove() { calls.push("remove"); } };
  await assert.rejects(
    createStorageSagaCoordinator({
      repository,
      storage,
      cleanup: async (_repository, cleanupStorage) => { calls.push("cleanup_claim"); await cleanupStorage.remove("property-import-files", "exact.csv"); },
    }).uploadAndStage({
      batchId: ids.batch,
      originalFilename: "employees.csv",
      sanitizedFilename: "employees.csv",
      declaredChecksumSha256: checksum,
      declaredSizeBytes: csv.byteLength,
      declaredMimeType: "text/csv",
      sourceSystem: "manual-upload",
      bytes: csv,
      prepareEvidence: async () => { throw new Error("PARSER_FAILED"); },
    }),
    /PARSER_FAILED/,
  );
  assert.deepEqual(calls, ["intent", "upload", "uploaded", "download", "verified", "cleanup_pending", "cleanup_claim", "remove"]);
});

test("corrupted read-back records verification_failed before cleanup pending", async () => {
  const calls = [];
  const repository = {
    async createUploadIntent() { return { batchId: ids.batch, objectPath: "exact.csv", storageLifecycle: "intent_created", workbookLifecycle: "intent_created", verificationStatus: "pending", version: 1 }; },
    async recordObjectUploaded() { calls.push("uploaded"); return { batchId: ids.batch, storageLifecycle: "uploaded_unverified", workbookLifecycle: "intent_created", verificationStatus: "pending", version: 2 }; },
    async recordObjectVerification(input) { calls.push(["verification", input.status, input.verifiedChecksumSha256]); return { batchId: ids.batch, storageLifecycle: "verification_failed", workbookLifecycle: "failed", verificationStatus: "failed", version: 3 }; },
    async markCleanupPending() { calls.push("cleanup_pending"); return {}; },
  };
  await assert.rejects(
    createStorageSagaCoordinator({ repository, storage: { async upload() {}, async download() { throw new Error("READBACK_UNAVAILABLE"); }, async remove() {} } }).uploadAndStage({
      batchId: ids.batch,
      originalFilename: "employees.csv",
      sanitizedFilename: "employees.csv",
      declaredChecksumSha256: checksum,
      declaredSizeBytes: csv.byteLength,
      declaredMimeType: "text/csv",
      sourceSystem: "manual-upload",
      bytes: csv,
      prepareEvidence: async () => { throw new Error("unreachable"); },
    }),
    /READBACK_UNAVAILABLE/,
  );
  assert.deepEqual(calls, ["uploaded", ["verification", "failed", null], "cleanup_pending"]);
});
