import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("active Import route is Neon-authorized and has no legacy provider storage or RPC path", async () => {
  const [route, boundary, authorization] = await Promise.all([
    readFile(new URL("../app/api/import/inspect/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/services/import/neon-import-inspection-boundary.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/services/neon-import-staging-authorization.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /inspectAndStageWorkbookInNeon/);
  assert.match(boundary, /runAuthorizedNeonImportStaging/);
  assert.match(authorization, /property-import-files/);
  assert.doesNotMatch(`${route}\n${boundary}\n${authorization}`, /supabase|stage_employee_import|createServerActorClient/i);
});
