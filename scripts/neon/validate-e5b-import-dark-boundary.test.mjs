import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateE5bImportDarkBoundarySource } from "./validate-e5b-import-staging.mjs";

const root = new URL("../..", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("E5B dark inspection boundary is server-only and uses the verified saga", async () => {
  const value = await source("app/services/import/neon-import-inspection-boundary.ts");
  assert.match(value, /import ["']server-only["'];/);
  assert.match(value, /runAuthorizedNeonImportStaging/);
  assert.match(value, /createStorageSagaCoordinator/);
  assert.match(value, /prepareEmployeeMasterStaging/);
  assert.match(value, /inspectAndStageWorkbookInNeon/);
  assert.doesNotMatch(value, /DATABASE_URL|NEON_BOOTSTRAP_DATABASE_URL|from ["'](?:pg|@neondatabase)/);
  assert.doesNotMatch(value, /tenantId|propertyId|role|authUserId/);
});

test("E5B history routes are same-origin GET-only APIs with bounded input", async () => {
  const list = await source("app/api/import/batches/route.ts");
  const detail = await source("app/api/import/batches/[id]/route.ts");
  const input = await source("app/api/import/batches/input.ts");
  assert.match(list, /export async function GET/);
  assert.doesNotMatch(list, /export async function POST|tenantId|propertyId|role|authUserId/);
  assert.match(list, /runAuthorizedNeonImportStaging/);
  assert.match(detail, /export async function GET/);
  assert.doesNotMatch(detail, /export async function POST|tenantId|propertyId|role|authUserId/);
  assert.match(detail, /runAuthorizedNeonImportStaging/);
  assert.match(input, /limit/);
  assert.match(input, /100/);
  assert.doesNotMatch(input, /tenantId|propertyId|role|authUserId/);
});

test("E5B inspect route delegates to the Neon and Blob server boundary", async () => {
  const inspect = await source("app/api/import/inspect/route.ts");
  const all = await Promise.all([
    source("app/services/import/neon-import-inspection-boundary.ts"),
    source("app/api/import/batches/route.ts"),
    source("app/api/import/batches/[id]/route.ts"),
    source("app/api/import/batches/input.ts"),
  ]);
  assert.match(inspect, /inspectAndStageWorkbookInNeon\s*\(/);
  assert.doesNotMatch(inspect, /createServerActorClient|stage_employee_import|supabase/i);
  assert.doesNotMatch(all.join("\n"), /DATABASE_URL|NEON_BOOTSTRAP_DATABASE_URL|from ["'](?:pg|@neondatabase)/);
  assert.doesNotMatch(all.join("\n"), /createServerPasswordClient\(\)\.storage|createBrowserClient|supabase/i);
});

test("dark-boundary source audit rejects browser scope and credential inputs", () => {
  assert.throws(
    () => validateE5bImportDarkBoundarySource({
      boundary: 'import "server-only"; export function inspectAndStageWorkbookInNeon(input) { return input.tenantId; } runAuthorizedNeonImportStaging(); createStorageSagaCoordinator(); prepareEmployeeMasterStaging();',
      listRoute: 'export async function GET() { return Response.json(await runAuthorizedNeonImportStaging()); }',
      detailRoute: 'export async function GET() { return Response.json(await runAuthorizedNeonImportStaging()); } getWorkflow(); 404;',
      input: 'limit offset 100 parseBatchId',
    }),
    /E5B_IMPORT_STAGING_UNTRUSTED_SCOPE_INPUT/,
  );
});
