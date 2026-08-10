import assert from "node:assert/strict";
import test from "node:test";
import { createHttpImportRepository } from "../../app/repositories/http/import-repository.ts";

test("E5E HTTP Import repository uses same-origin history without client scope inputs", async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/mapping")) {
      return new Response(JSON.stringify({ batchId: "11111111-1111-4111-8111-111111111111", batchVersion: 1, decisionVersion: 1, previewHash: "", state: "blocked", mappings: { items: [], pendingCount: 0, confirmedCount: 0, excludedCount: 0 }, sourceLabels: { items: [], pendingCount: 0, resolvedCount: 0 }, issues: { items: [], openCount: 0, blockingCount: 0 }, impact: { state: "unavailable", reason: "employee_commit_not_migrated" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ items: [{ batchId: "11111111-1111-4111-8111-111111111111", tenantId: "22222222-2222-4222-8222-222222222222", propertyId: "33333333-3333-4333-8333-333333333333", fileName: "seed.csv", workbookLifecycle: "mapping_required", storageLifecycle: "linked", verificationStatus: "passed", version: 1, createdAt: "2026-08-10T00:00:00Z", updatedAt: "2026-08-10T00:00:00Z", counts: { total: 0, valid: 0, warning: 0, error: 0 } }], limit: 25, offset: 0, hasMore: false }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const rows = await createHttpImportRepository().listImportHistory("forged-property");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "11111111-1111-4111-8111-111111111111");
    assert.equal(calls[0].url, "/api/import/batches?limit=100&offset=0");
    assert.equal(calls[0].init.credentials, "same-origin");
    assert.doesNotMatch(JSON.stringify(calls[0].init), /forged-property|tenantId|propertyId/);
  } finally {
    globalThis.fetch = original;
  }
});
