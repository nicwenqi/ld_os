import "server-only";

import type {
  CreateImportUploadIntentInput,
  ImportStagingRepository,
  ImportStagingResult,
  StageVerifiedWorkbookInput,
} from "../../repositories/contracts/import-staging-repository.ts";
import {
  verifyWorkbookStorageObject,
  type StorageObjectReader,
  type VerifiedWorkbookObject,
} from "./storage-object-verification.ts";
import type { ImportStorageGateway } from "../neon-import-staging-authorization.ts";

export type StorageSagaUploadInput = CreateImportUploadIntentInput & {
  bytes: Uint8Array;
  /** Parser callback receives bytes downloaded after verification, never the browser buffer. */
  prepareEvidence: (verifiedBytes: Uint8Array, evidence: VerifiedWorkbookObject) => Promise<StageVerifiedWorkbookInput["evidence"]>;
};

export type StorageSagaDependencies = Readonly<{
  repository: ImportStagingRepository;
  storage: ImportStorageGateway;
  requestId?: string;
  cleanup?: (repository: ImportStagingRepository, storage: ImportStorageGateway, requestId?: string) => Promise<unknown>;
}>;

/**
 * Coordinates the Storage/Neon saga. Storage calls are intentionally outside
 * the individual repository operations: no database rollback is described as
 * deleting an object. The caller must provide a repository bound to a fresh
 * Actor Context for each operation in production.
 */
export function createStorageSagaCoordinator(dependencies: StorageSagaDependencies) {
  const repository = dependencies.repository;
  const storage = dependencies.storage;

  return {
    async uploadAndStage(input: StorageSagaUploadInput): Promise<ImportStagingResult> {
      const intent = await repository.createUploadIntent(input);
      let state = intent;
      let uploaded = false;
      let verificationStateRecorded = false;
      try {
        // Storage upload is outside the Neon repository operation.
        await storage.upload("property-import-files", intent.objectPath, input.bytes, input.declaredMimeType);
        uploaded = true;

        state = await repository.recordObjectUploaded(input.batchId, state.version);
        const reader: StorageObjectReader = {
          download: (bucket, objectPath) => storage.download(bucket, objectPath),
        };
        // The verifier downloads the persisted object and derives all evidence.
        const verified = await verifyWorkbookStorageObject({
          reader,
          bucket: "property-import-files",
          objectPath: intent.objectPath,
          sanitizedFilename: input.sanitizedFilename,
          declaredChecksumSha256: input.declaredChecksumSha256,
          declaredSizeBytes: input.declaredSizeBytes,
          declaredMimeType: input.declaredMimeType,
        });
        state = await repository.recordObjectVerification({
          batchId: input.batchId,
          expectedVersion: state.version,
          verifiedChecksumSha256: verified.checksumSha256,
          verifiedSizeBytes: verified.sizeBytes,
          verifiedMimeType: verified.contentDerivedMimeType,
          status: "passed",
          failureReason: null,
        });
        verificationStateRecorded = true;

        // Parser input is a second server read, after verification, rather than
        // the untrusted upload buffer supplied by the browser.
        const verifiedBytes = await storage.download("property-import-files", intent.objectPath);
        const evidence = await input.prepareEvidence(verifiedBytes, verified);
        return await repository.stageVerifiedWorkbook({
          batchId: input.batchId,
          expectedVersion: state.version,
          evidence,
        });
      } catch (error) {
        if (uploaded) {
          if (!verificationStateRecorded && state.storageLifecycle === "uploaded_unverified") {
            try {
              state = await repository.recordObjectVerification({
                batchId: input.batchId,
                expectedVersion: state.version,
                verifiedChecksumSha256: null,
                verifiedSizeBytes: null,
                verifiedMimeType: null,
                status: "failed",
                failureReason: safeReason(error),
              });
              verificationStateRecorded = true;
            } catch {
              // Preserve the original failure; cleanup pending remains the
              // durable compensation obligation when this write is unavailable.
            }
          }
          await persistCleanupPending(repository, input.batchId, state.version, safeReason(error));
          if (dependencies.cleanup) {
            try {
              await dependencies.cleanup(repository, storage, dependencies.requestId);
            } catch {
              // The durable ledger remains the retry authority when immediate
              // compensation cannot reach Storage.
            }
          }
        }
        throw error;
      }
    },
  };
}

async function persistCleanupPending(
  repository: ImportStagingRepository,
  batchId: string,
  expectedVersion: number,
  reason: string,
) {
  // This happens in a fresh transaction in the caller's repository boundary,
  // and always precedes any deletion attempt.
  await repository.markCleanupPending({ batchId, expectedVersion, reason });
}

function safeReason(error: unknown) {
  if (error instanceof Error && error.message && /^[A-Z0-9_:-]{1,120}$/.test(error.message)) return error.message;
  return "IMPORT_STORAGE_SAGA_FAILED";
}
