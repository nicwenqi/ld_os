import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const TARGET_PAGES = [
  "app/organization/page.tsx",
  "app/people/page.tsx",
  "app/positions/page.tsx",
];
const LOADER = "app/repositories/runtime/load-domain-registry.ts";
const NEON_REGISTRY = "app/repositories/runtime/neon-domain-registry.ts";
const POSITION_HTTP = "app/repositories/http/position-repository.ts";

async function main() {
  const command = process.argv[2] ?? "source";
  if (command !== "source") {
    throw new Error("RUNTIME_REHEARSAL_SOURCE_VALIDATION_ONLY");
  }
  const pages = await Promise.all(TARGET_PAGES.map(read));
  const loader = await read(LOADER);
  const neonRegistry = await read(NEON_REGISTRY);
  const position = await read(POSITION_HTTP);

  const forbiddenPageImport = /createRepositoryRegistry|createBrowserSupabaseClient|repositories\/supabase|@supabase\/supabase-js|DATABASE_URL|from\s+["']pg["']/;
  if (pages.some(source => forbiddenPageImport.test(source))) {
    throw new Error("RUNTIME_REHEARSAL_TARGET_PAGE_BOUNDARY_DRIFT");
  }
  if (
    !loader.includes('fetch("/api/runtime/rehearsal-mode"') ||
    !loader.includes('import("./neon-domain-registry.ts")') ||
    loader.includes("supabase-domain-registry")
  ) throw new Error("RUNTIME_REHEARSAL_LAZY_LOADER_DRIFT");
  if (/supabase\/browser|repositories\/supabase|@supabase\/supabase-js|DATABASE_URL|from\s+["']pg["']/.test(neonRegistry)) {
    throw new Error("RUNTIME_REHEARSAL_NEON_REGISTRY_BOUNDARY_DRIFT");
  }
  if (!position.includes('credentials: "same-origin"') || /\.from\(|@supabase/.test(position)) {
    throw new Error("RUNTIME_REHEARSAL_POSITION_HTTP_BOUNDARY_DRIFT");
  }

  console.log(JSON.stringify({
    command,
    targetPages: TARGET_PAGES,
    sameOriginHttpOnly: true,
    noLegacyFallbackLoader: true,
    noBrowserNeonCredential: true,
  }));
}

async function read(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "RUNTIME_REHEARSAL_VALIDATION_UNKNOWN");
    process.exitCode = 1;
  });
}
