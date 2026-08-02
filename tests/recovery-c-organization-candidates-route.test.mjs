import test from "node:test";
import assert from "node:assert/strict";
import { createOrganizationCandidateHandler } from "../app/api/import/organization-candidates/route.ts";

test("organization candidate route exposes preview and confirmation through manager-scoped RPC", async () => {
  const calls = [];
  const handler = createOrganizationCandidateHandler({
    authorize: async () => ({ tenantId: "t1", propertyId: "p1", accessToken: "token", refreshedCookies: [] }),
    actorClient: () => ({ rpc: async (name, args) => { calls.push([name, args]); return { data: { departments: 2 }, error: null }; } }),
  });
  const preview = await handler(new Request("http://localhost/api/import/organization-candidates", { method: "POST", body: JSON.stringify({ batchId: "b1", expectedVersion: 1 }), headers: { "content-type": "application/json" } }));
  assert.equal(preview.status, 200);
  const confirm = await handler(new Request("http://localhost/api/import/organization-candidates", { method: "POST", body: JSON.stringify({ batchId: "b1", expectedVersion: 1, decisions: [{ candidateId: "c1", decision: "create" }] }), headers: { "content-type": "application/json" } }));
  assert.equal(confirm.status, 200);
  assert.deepEqual(calls.map(call => call[0]), ["preview_employee_import_organization_candidates", "confirm_employee_import_organization_candidates"]);
});
