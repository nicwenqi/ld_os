import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  runVercelBlobStorageValidation,
  validateNonProductionBlobEnvironment,
} from "./validate-vercel-blob-storage-live.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { executeDueStorageCleanup } = await import("../../app/services/import/storage-cleanup-executor.ts");

test("live Blob validation requires an explicitly non-production token environment", () => {
  const token = "vercel_blob_rw_bdM5v7tXMyRQPrGq_validation";
  assert.throws(
    () => validateNonProductionBlobEnvironment({ BLOB_READ_WRITE_TOKEN: token, VERCEL_ENV: "production", BLOB_VALIDATION_NON_PRODUCTION: "1" }),
    /BLOB_STORAGE_VALIDATION_ENVIRONMENT_INVALID/,
  );
  assert.doesNotThrow(
    () => validateNonProductionBlobEnvironment({ BLOB_READ_WRITE_TOKEN: token, VERCEL_ENV: "preview", BLOB_VALIDATION_NON_PRODUCTION: "1" }),
  );
  assert.throws(
    () => validateNonProductionBlobEnvironment({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_production_validation", VERCEL_ENV: "preview", BLOB_VALIDATION_NON_PRODUCTION: "1" }),
    /BLOB_STORAGE_VALIDATION_ENVIRONMENT_INVALID/,
  );
});

test("live Blob matrix verifies exact upload/read-back and cleanup retry/idempotency", async () => {
  const objects = new Map();
  const calls = [];
  const storage = {
    async upload(bucket, path, bytes, contentType) {
      calls.push(["upload", bucket, path, contentType]);
      if (objects.has(path)) throw new Error("unexpected overwrite");
      objects.set(path, new Uint8Array(bytes));
    },
    async download(bucket, path) {
      calls.push(["download", bucket, path]);
      const bytes = objects.get(path);
      if (!bytes) throw new Error("not found");
      return new Uint8Array(bytes);
    },
    async remove(bucket, path) {
      calls.push(["remove", bucket, path]);
      objects.delete(path);
    },
  };
  let verifierDownloads = 0;
  const result = await runVercelBlobStorageValidation({
    storage,
    executeDueStorageCleanup,
    idFactory: () => "11111111-1111-4111-8111-111111111111",
    async verifyWorkbookStorageObject(input) {
      verifierDownloads += 1;
      const bytes = await input.reader.download(input.bucket, input.objectPath);
      return {
        checksumSha256: input.declaredChecksumSha256,
        sizeBytes: bytes.byteLength,
        contentDerivedMimeType: input.declaredMimeType,
      };
    },
  });

  assert.deepEqual(result, {
    provider: "vercel-blob",
    upload: "passed",
    readBack: "passed",
    checksum: "passed",
    size: "passed",
    contentMime: "passed",
    exactPathDelete: "passed",
    cleanupRetry: "passed",
    notFoundCleanup: "passed",
  });
  assert.equal(verifierDownloads, 1);
  assert.equal(objects.size, 0);
  assert.equal(calls.filter(([kind]) => kind === "upload").length, 3);
});
