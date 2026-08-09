import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { createNeonImportStagingRepository } = await import("../../app/repositories/neon/import-staging-repository.ts");

test("repository permits null verification evidence only for failed read-back", async () => {
  const calls = [];
  const database = {
    async query(text, values) {
      calls.push({ text: String(text), values });
      return { rows: [{ payload: { batch_id: "33333333-3333-4333-8333-333333333333", storage_lifecycle: "verification_failed", workbook_lifecycle: "failed", verification_status: "failed", version: 3 } }] };
    },
  };
  const repository = createNeonImportStagingRepository(database, "hotel.example.test", {
    tenantId: "11111111-1111-4111-8111-111111111111",
    propertyId: "22222222-2222-4222-8222-222222222222",
  });
  const state = await repository.recordObjectVerification({
    batchId: "33333333-3333-4333-8333-333333333333",
    expectedVersion: 2,
    verifiedChecksumSha256: null,
    verifiedSizeBytes: null,
    verifiedMimeType: null,
    status: "failed",
    failureReason: "READBACK_UNAVAILABLE",
  });
  assert.equal(state.storageLifecycle, "verification_failed");
  assert.deepEqual(calls[0].values.slice(3, 6), [null, null, null]);
});
