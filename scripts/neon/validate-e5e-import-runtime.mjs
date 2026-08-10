#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PATHS = Object.freeze({
  runtimeRegistry: join(ROOT, "app/repositories/runtime/neon-domain-registry.ts"),
  runtimeLoader: join(ROOT, "app/repositories/runtime/load-domain-registry.ts"),
  httpImport: join(ROOT, "app/repositories/http/import-repository.ts"),
  mainRegistry: join(ROOT, "app/repositories/registry.ts"),
  inspectRoute: join(ROOT, "app/api/import/inspect/route.ts"),
  inspectBoundary: join(ROOT, "app/services/import/neon-import-inspection-boundary.ts"),
  seed: join(ROOT, "scripts/neon/e5e-development-seed.mjs"),
});

export async function validateE5eImportRuntimeSource() {
  const sources = Object.fromEntries(await Promise.all(Object.entries(PATHS).map(async ([key, path]) => [key, await readFile(path, "utf8")])))
  if (!sources.httpImport.includes('credentials: "same-origin"') || /DATABASE_URL|createBrowserSupabaseClient|@supabase\/supabase-js|from\s+["']pg["']/.test(sources.httpImport)) {
    throw new Error("E5E_IMPORT_HTTP_BOUNDARY_INVALID");
  }
  if (!sources.runtimeRegistry.includes("import:") || !sources.runtimeRegistry.includes("createHttpImportRepository")) throw new Error("E5E_IMPORT_RUNTIME_REGISTRY_MISSING");
  if (!sources.runtimeLoader.includes("import:") || !sources.runtimeLoader.includes("payload.domains.import")) throw new Error("E5E_IMPORT_RUNTIME_LOADER_MISSING");
  if (/createBrowserSupabaseClient\(environment\)/.test(sources.mainRegistry) && !/dataMode\s*!==\s*["']neon["']/.test(sources.mainRegistry)) throw new Error("E5E_MAIN_REGISTRY_SUPABASE_CLIENT_EAGER");
  if (!sources.inspectBoundary.includes("createStorageSagaCoordinator") || !sources.inspectBoundary.includes("runAuthorizedNeonImportStaging")) throw new Error("E5E_IMPORT_INSPECTION_NEON_SAGA_MISSING");
  // The legacy RPC is allowed only in the explicitly non-Neon branch.  A
  // Neon request must call the server Storage saga and never fall back after
  // an error.
  if (!/environment\.dataMode\s*===\s*["']neon["']/.test(sources.inspectRoute)
    || !/return\s+createImportInspectionHandler\(\)\(request\)/.test(sources.inspectRoute)) {
    throw new Error("E5E_IMPORT_INSPECTION_MODE_BOUNDARY_MISSING");
  }
  if (!sources.seed.includes("tenant") || !sources.seed.includes("property") || !sources.seed.includes("department") || !sources.seed.includes("position") || !sources.seed.includes("employee")) throw new Error("E5E_SEED_SCENARIOS_MISSING");
  return { runtimeImport: "neon", sameOriginHttpOnly: true, noBrowserNeonCredential: true, storageSaga: true, legacyInspectRpc: "fallback-only" };
}

export async function main() {
  const command = process.argv[2] ?? "source";
  if (command !== "source") throw new Error("E5E_IMPORT_RUNTIME_SOURCE_ONLY");
  process.stdout.write(`${JSON.stringify(await validateE5eImportRuntimeSource())}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(error instanceof Error ? error.message : "E5E_IMPORT_RUNTIME_VALIDATION_FAILED"); process.exitCode = 1; });
}
