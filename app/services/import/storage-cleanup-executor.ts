import "server-only";

import { randomUUID } from "node:crypto";

import type { ImportStagingRepository } from "../../repositories/contracts/import-staging-repository.ts";
import type { ImportStorageGateway } from "../neon-import-staging-authorization.ts";

const RETRY_DELAYS_MS = Object.freeze([
  30_000,
  120_000,
  600_000,
  3_600_000,
  21_600_000,
]);

export type CleanupExecutorOptions = Readonly<{
  repository: ImportStagingRepository;
  storage: ImportStorageGateway;
  limit?: number;
  requestId?: string;
  claimIdFactory?: () => string;
  now?: () => Date;
}>;

/** Bounded exponential retry schedule: 30s, 2m, 10m, 1h, 6h (capped). */
export function cleanupRetryDelayMs(attemptCount: number) {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) return RETRY_DELAYS_MS[0];
  return RETRY_DELAYS_MS[Math.min(attemptCount, RETRY_DELAYS_MS.length) - 1];
}
/**
 * Claims same-property cleanup work, deletes only the exact returned object,
 * then records completion/failure through separate repository operations.
 * The repository is expected to be created inside an authenticated manager
 * Actor Context; this executor never impersonates a system principal.
 */
export async function executeDueStorageCleanup(options: CleanupExecutorOptions) {
  const limit = options.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("IMPORT_CLEANUP_LIMIT_INVALID");
  }
  const claimIdFactory = options.claimIdFactory ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const claimId = claimIdFactory();
  const claims = await options.repository.claimDueCleanup({ limit, claimId });
  const results: Array<{ batchId: string; status: "completed" | "failed"; attemptCount: number }> = [];

  for (const claim of claims) {
    try {
      // Exact bucket/path from the server-owned claim; no prefix or wildcard.
      await options.storage.remove("property-import-files", claim.objectPath);
      await options.repository.completeCleanup({
        batchId: claim.batchId,
        operationId: claim.operationId,
        claimId: claim.claimId,
      });
      results.push({ batchId: claim.batchId, status: "completed", attemptCount: claim.attemptCount });
    } catch {
      const retryAt = new Date(now().getTime() + cleanupRetryDelayMs(claim.attemptCount));
      await options.repository.failCleanup({
        batchId: claim.batchId,
        operationId: claim.operationId,
        claimId: claim.claimId,
        error: "IMPORT_STORAGE_CLEANUP_FAILED",
        nextAttemptAt: retryAt.toISOString(),
      });
      results.push({ batchId: claim.batchId, status: "failed", attemptCount: claim.attemptCount });
    }
  }
  return results;
}
