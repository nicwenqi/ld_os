import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const runtimeConsumers = [
  "app/page.tsx",
  "app/organization/page.tsx",
  "app/people/page.tsx",
  "app/positions/page.tsx",
  "app/import/page.tsx",
  "app/initialize/page.tsx",
  "app/settings/hotel/page.tsx",
  "app/accounts/page.tsx",
  "app/data-quality/page.tsx",
  "app/department/page.tsx",
  "app/department/employees/page.tsx",
  "app/components/initialization/InitializationStatusCard.tsx",
  "app/services/department-foundation.ts",
  "app/services/people-foundation.ts",
  "app/services/foundation-readiness.ts",
];

const domainNames = [
  "organization", "people", "position", "employee", "import", "property", "initialization",
];

const consumerForbidden = /createRepositoryRegistry\(|createBrowserSupabaseClient|repositories\/supabase|@supabase\/supabase-js|createSupabase\w+Repository|DATABASE_URL|from\s+["']pg["']/;
const browserCredential = /DATABASE_URL|postgres(?:ql)?:\/\/|NEON_[A-Z0-9_]*(?:URL|TOKEN|SECRET|PASSWORD|KEY)/;

export function validateRuntimeFinalCutoverSources(input) {
  if (input.pages.some(source => consumerForbidden.test(source))) {
    const joined = input.pages.join("\n");
    if (/createRepositoryRegistry\(/.test(joined)) throw new Error("DIRECT_REGISTRY_DRIFT");
    if (/createBrowserSupabaseClient|repositories\/supabase|@supabase\/supabase-js|createSupabase\w+Repository/.test(joined)) {
      throw new Error("SUPABASE_BUSINESS_CLIENT_DRIFT");
    }
    throw new Error("BROWSER_NEON_SECRET_DRIFT");
  }
  if (
    !input.loader.includes('fetch("/api/runtime/rehearsal-mode"') ||
    !input.loader.includes('import("./neon-domain-registry.ts")') ||
    input.loader.includes("supabase-domain-registry") ||
    !input.loader.includes('return loaders.createNeon()')
  ) throw new Error("RUNTIME_LOADER_DRIFT");
  if (!input.modeSource.includes("resolveRuntimeDomainSelection") || !input.route.includes("resolveRuntimeDomainSelection")) {
    throw new Error("RUNTIME_SELECTOR_DRIFT");
  }
  if (input.modePayload.source !== "neon" || domainNames.some(name => input.modePayload.domains[name] !== "neon")) {
    throw new Error("DOMAIN_SOURCE_MATRIX_DRIFT");
  }
  if (/supabase\/browser|repositories\/supabase|@supabase\/supabase-js|DATABASE_URL|from\s+["']pg["']/.test(input.neonRegistry)) {
    throw new Error("NEON_REGISTRY_BOUNDARY_DRIFT");
  }
  if (![
    "createHttpDepartmentRepository", "createHttpEmployeeRepository", "createHttpPositionRepository",
    "createHttpPropertyRepository", "createHttpInitializationRepository", "createHttpImportRepository",
  ].every(token => input.neonRegistry.includes(token))) {
    throw new Error("NEON_DOMAIN_REGISTRY_INCOMPLETE");
  }
  if (input.clientAssets.some(source => browserCredential.test(source))) {
    throw new Error("BROWSER_NEON_SECRET_DRIFT");
  }
  return {
    source: "neon",
    allDomainsSameSource: true,
    supabaseBusinessClient: false,
    browserNeonCredential: false,
  };
}

async function main() {
  if ((process.argv[2] ?? "source") !== "source") {
    throw new Error("RUNTIME_FINAL_CUTOVER_SOURCE_VALIDATION_ONLY");
  }
  const root = new URL("../../", import.meta.url);
  const [pages, loader, neonRegistry, modeSource, route, clientAssets] = await Promise.all([
    Promise.all(runtimeConsumers.map(path => read(root, path))),
    read(root, "app/repositories/runtime/load-domain-registry.ts"),
    read(root, "app/repositories/runtime/neon-domain-registry.ts"),
    read(root, "app/lib/runtime-rehearsal-mode.ts"),
    read(root, "app/api/runtime/rehearsal-mode/route.ts"),
    readClientAssets(root),
  ]);
  const domains = Object.fromEntries(domainNames.map(name => [name, "neon"]));
  console.log(JSON.stringify(validateRuntimeFinalCutoverSources({
    pages,
    loader,
    neonRegistry,
    modeSource,
    route,
    modePayload: { source: "neon", domains },
    clientAssets,
  })));
}

async function read(root, path) {
  return readFile(new URL(path, root), "utf8");
}

async function readClientAssets(root) {
  const directory = new URL("dist/client/", root);
  try {
    const names = await readdir(directory, { recursive: true });
    const files = names.filter(name => /\.(?:js|mjs|css)$/i.test(name));
    return Promise.all(files.map(name => readFile(new URL(name, directory), "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "RUNTIME_FINAL_CUTOVER_VALIDATION_UNKNOWN");
    process.exitCode = 1;
  });
}
