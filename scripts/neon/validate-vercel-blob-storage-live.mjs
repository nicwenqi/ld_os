import { createHash, randomUUID } from "node:crypto";

const BUCKET = "property-import-files";
const MIME = "text/csv";
const BYTES = new TextEncoder().encode("Employee No,Name\nE-001,Ada\n");
const PREVIEW_BLOB_STORE_TOKEN_ID = "bdM5v7tXMyRQPrGq";

export function validateNonProductionBlobEnvironment(environment = process.env) {
  const token = environment.BLOB_READ_WRITE_TOKEN?.trim() ?? "";
  if (environment.BLOB_VALIDATION_NON_PRODUCTION !== "1" ||
      environment.VERCEL_ENV !== "preview" ||
      token.split("_")[3] !== PREVIEW_BLOB_STORE_TOKEN_ID) {
    throw new Error("BLOB_STORAGE_VALIDATION_ENVIRONMENT_INVALID");
  }
}

/**
 * Exercises the same private gateway and cleanup executor used by the Import
 * saga. Paths are random and never reported, so this command cannot reveal a
 * Blob URL, object name, or credential in logs.
 */
export async function runVercelBlobStorageValidation({
  storage,
  verifyWorkbookStorageObject,
  executeDueStorageCleanup,
  idFactory = randomUUID,
}) {
  const namespace = `validation/${idFactory()}`;
  const primaryPath = `${namespace}/workbook.csv`;
  const sentinelPath = `${namespace}/sentinel.csv`;
  const cleanupPath = `${namespace}/cleanup.csv`;
  const checksumSha256 = createHash("sha256").update(BYTES).digest("hex");

  try {
    await storage.upload(BUCKET, sentinelPath, BYTES, MIME);
    await storage.upload(BUCKET, primaryPath, BYTES, MIME);
    const verified = await verifyWorkbookStorageObject({
      reader: storage,
      bucket: BUCKET,
      objectPath: primaryPath,
      sanitizedFilename: "workbook.csv",
      declaredChecksumSha256: checksumSha256,
      declaredSizeBytes: BYTES.byteLength,
      declaredMimeType: MIME,
    });
    if (verified.checksumSha256 !== checksumSha256 ||
        verified.sizeBytes !== BYTES.byteLength ||
        verified.contentDerivedMimeType !== MIME) {
      throw new Error("BLOB_STORAGE_VERIFICATION_MISMATCH");
    }

    await storage.remove(BUCKET, primaryPath);
    await assertUnavailable(storage, primaryPath);
    const sentinel = await storage.download(BUCKET, sentinelPath);
    if (!bytesEqual(sentinel, BYTES)) throw new Error("BLOB_STORAGE_EXACT_PATH_VIOLATION");

    await storage.upload(BUCKET, cleanupPath, BYTES, MIME);
    const cleanup = createCleanupRepository(cleanupPath);
    let transientFailure = true;
    const retryingStorage = {
      ...storage,
      async remove(bucket, objectPath) {
        if (transientFailure) {
          transientFailure = false;
          throw new Error("BLOB_STORAGE_TRANSIENT_VALIDATION_FAILURE");
        }
        return storage.remove(bucket, objectPath);
      },
    };
    const first = await executeDueStorageCleanup({
      repository: cleanup.repository,
      storage: retryingStorage,
      claimIdFactory: () => cleanup.claimId,
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    });
    const second = await executeDueStorageCleanup({
      repository: cleanup.repository,
      storage,
      claimIdFactory: () => cleanup.claimId,
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    });
    const third = await executeDueStorageCleanup({
      repository: cleanup.repository,
      storage,
      claimIdFactory: () => cleanup.claimId,
      now: () => new Date("2026-08-11T00:00:00.000Z"),
    });
    if (first[0]?.status !== "failed" || second[0]?.status !== "completed" || third[0]?.status !== "completed" ||
        cleanup.events.join(",") !== "failed,completed,completed") {
      throw new Error("BLOB_STORAGE_CLEANUP_RETRY_INVALID");
    }

    return {
      provider: "vercel-blob",
      upload: "passed",
      readBack: "passed",
      checksum: "passed",
      size: "passed",
      contentMime: "passed",
      exactPathDelete: "passed",
      cleanupRetry: "passed",
      notFoundCleanup: "passed",
    };
  } finally {
    await Promise.allSettled([
      storage.remove(BUCKET, primaryPath),
      storage.remove(BUCKET, sentinelPath),
      storage.remove(BUCKET, cleanupPath),
    ]);
  }
}

function createCleanupRepository(objectPath) {
  const claimId = "blob-validation-cleanup-claim";
  const events = [];
  const claim = {
    batchId: "blob-validation-batch",
    operationId: "blob-validation-operation",
    bucket: BUCKET,
    objectPath,
    claimId,
    attemptCount: 1,
    leaseExpiresAt: "2026-08-11T00:05:00.000Z",
  };
  return {
    claimId,
    events,
    repository: {
      async claimDueCleanup() { return [claim]; },
      async completeCleanup() { events.push("completed"); return {}; },
      async failCleanup() { events.push("failed"); return {}; },
    },
  };
}

async function assertUnavailable(storage, objectPath) {
  try {
    await storage.download(BUCKET, objectPath);
  } catch {
    return;
  }
  throw new Error("BLOB_STORAGE_EXACT_PATH_DELETE_FAILED");
}

function bytesEqual(left, right) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

async function main() {
  validateNonProductionBlobEnvironment();
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  const [gatewayModule, verifierModule, cleanupModule] = await Promise.all([
    import("../../app/services/import/vercel-blob-storage-gateway.ts"),
    import("../../app/services/import/storage-object-verification.ts"),
    import("../../app/services/import/storage-cleanup-executor.ts"),
  ]);
  const result = await runVercelBlobStorageValidation({
    storage: gatewayModule.createVercelBlobImportStorageGateway(),
    verifyWorkbookStorageObject: verifierModule.verifyWorkbookStorageObject,
    executeDueStorageCleanup: cleanupModule.executeDueStorageCleanup,
  });
  console.log(JSON.stringify(result));
}

const { pathToFileURL } = await import("node:url");
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error && /^BLOB_STORAGE_[A-Z_]+$/.test(error.message)
      ? error.message
      : "BLOB_STORAGE_VALIDATION_FAILED");
    process.exitCode = 1;
  });
}
