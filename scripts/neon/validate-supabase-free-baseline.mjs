import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIRECTORY, "../..");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const DELETED_PROJECT_IDENTIFIERS = [
  "gaikifwwyaetjlnepuwh",
  "supabase.co",
  "supabase.in",
];

function baselineError(code, file = "") {
  const error = new Error(code);
  error.code = code;
  error.file = file;
  return error;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function filesUnder(directory) {
  if (!await exists(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return [path];
  }));
  return files.flat();
}

function isSource(path) {
  return [...SOURCE_EXTENSIONS].some(extension => path.endsWith(extension));
}

function isProductionCapableScript(path) {
  const normalized = path.replaceAll("\\", "/");
  const name = normalized.split("/").at(-1) ?? "";
  return isSource(path)
    && !normalized.includes("/fixtures/")
    && !name.includes(".test.")
    && !name.startsWith("validate-");
}

function hasActiveSupabaseImport(source) {
  return /(?:from\s*["'][^"']*(?:supabase|Supabase)[^"']*["']|require\(\s*["'][^"']*(?:supabase|Supabase)[^"']*["']\s*\)|import\(\s*["'][^"']*(?:supabase|Supabase)[^"']*["']\s*\))/u.test(source);
}

function hasSupabaseClientCall(source) {
  const withoutLanguageOrBinaryFactories = source.replace(/\b(?:Array|Buffer)\s*\.\s*from\s*\(/gu, "");
  const dotClientCall = /\b[A-Za-z_$][\w$]*\s*(?:\.|\?\.)\s*(?:from|rpc)\s*\(/u;
  const bracketClientCall = /\b[A-Za-z_$][\w$]*\s*(?:\?\.)?\s*\[\s*["'](?:from|rpc)["']\s*\]\s*\(/u;
  return dotClientCall.test(withoutLanguageOrBinaryFactories) || bracketClientCall.test(withoutLanguageOrBinaryFactories);
}

function hasSupabaseFallback(source) {
  return /(?:APP_DATA_MODE\s*(?:={1,3}|!={1,2})\s*["']supabase["']|dataMode\s*(?:={1,3}|!={1,2})\s*["']supabase["']|supabase(?:Domain|Repository|Runtime)?Registry|supabase\s+fallback)/iu.test(source);
}

function hasDeletedProjectReference(source) {
  const normalized = source.toLowerCase();
  return DELETED_PROJECT_IDENTIFIERS.some(identifier => normalized.includes(identifier));
}

async function readIfPresent(path) {
  return await exists(path) ? readFile(path, "utf8") : "";
}

export async function validateSupabaseFreeBaseline({ root = DEFAULT_ROOT } = {}) {
  const packageJson = await readIfPresent(join(root, "package.json"));
  const lockfile = await readIfPresent(join(root, "package-lock.json"));
  if (/@supabase\/supabase-js|@supabase\//u.test(`${packageJson}\n${lockfile}`)) {
    throw baselineError("SUPABASE_FREE_PACKAGE_DRIFT");
  }

  const envContractFiles = [".env.example", ".env.local.example", "vercel.json", "vite.config.ts"];
  for (const name of envContractFiles) {
    const contents = await readIfPresent(join(root, name));
    if (/\b(?:NEXT_PUBLIC_)?SUPABASE_[A-Z0-9_]*\b/u.test(contents)) {
      throw baselineError("SUPABASE_FREE_ENV_DRIFT", name);
    }
    if (hasDeletedProjectReference(contents)) {
      throw baselineError("SUPABASE_FREE_DELETED_PROJECT_DRIFT", name);
    }
  }

  for (const legacyPath of ["supabase/config.toml", "supabase/seed.sql", ".supabase"]) {
    if (await exists(join(root, legacyPath))) {
      throw baselineError("SUPABASE_FREE_LEGACY_CONFIG_DRIFT", legacyPath);
    }
  }

  const runtimeFiles = (await filesUnder(join(root, "app"))).filter(isSource);
  for (const path of runtimeFiles) {
    const source = await readFile(path, "utf8");
    const file = relative(root, path);
    if (hasDeletedProjectReference(source)) {
      throw baselineError("SUPABASE_FREE_DELETED_PROJECT_DRIFT", file);
    }
    if (/\b(?:NEXT_PUBLIC_)?SUPABASE_[A-Z0-9_]*\b/u.test(source)) {
      throw baselineError("SUPABASE_FREE_ENV_DRIFT", file);
    }
    if (hasActiveSupabaseImport(source)) {
      throw baselineError("SUPABASE_FREE_RUNTIME_IMPORT", file);
    }
    if (hasSupabaseClientCall(source)) {
      throw baselineError("SUPABASE_FREE_RUNTIME_CLIENT_DRIFT", file);
    }
    if (hasSupabaseFallback(source)) {
      throw baselineError("SUPABASE_FREE_FALLBACK_DRIFT", file);
    }
  }

  const productionScripts = (await filesUnder(join(root, "scripts"))).filter(isProductionCapableScript);
  for (const path of productionScripts) {
    const source = await readFile(path, "utf8");
    const file = relative(root, path);
    if (hasDeletedProjectReference(source)) {
      throw baselineError("SUPABASE_FREE_DELETED_PROJECT_DRIFT", file);
    }
    if (/\b(?:NEXT_PUBLIC_)?SUPABASE_[A-Z0-9_]*\b/u.test(source)) {
      throw baselineError("SUPABASE_FREE_ENV_DRIFT", file);
    }
    if (hasActiveSupabaseImport(source)) {
      throw baselineError("SUPABASE_FREE_RUNTIME_IMPORT", file);
    }
    if (hasSupabaseClientCall(source)) {
      throw baselineError("SUPABASE_FREE_RUNTIME_CLIENT_DRIFT", file);
    }
    if (hasSupabaseFallback(source)) {
      throw baselineError("SUPABASE_FREE_FALLBACK_DRIFT", file);
    }
  }

  const browserBundle = join(root, "dist", "client");
  for (const path of await filesUnder(browserBundle)) {
    const source = await readFile(path, "utf8");
    if (hasDeletedProjectReference(source) || /@supabase\/supabase-js/u.test(source)) {
      throw baselineError("SUPABASE_FREE_BROWSER_BUNDLE_DRIFT", relative(root, path));
    }
  }

  return {
    supabaseFreeBaseline: true,
    legacySupabaseRuntimeRemoved: true,
    packageEnvClean: true,
  };
}

async function main() {
  try {
    const result = await validateSupabaseFreeBaseline();
    console.log(`SUPABASE_FREE_BASELINE=${result.supabaseFreeBaseline ? "PASS" : "FAIL"}`);
    console.log(`LEGACY_SUPABASE_RUNTIME_REMOVED=${result.legacySupabaseRuntimeRemoved ? "PASS" : "FAIL"}`);
    console.log(`PACKAGE_ENV_CLEAN=${result.packageEnvClean ? "PASS" : "FAIL"}`);
  } catch (error) {
    console.error(error?.code ?? "SUPABASE_FREE_BASELINE_FAILED");
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
