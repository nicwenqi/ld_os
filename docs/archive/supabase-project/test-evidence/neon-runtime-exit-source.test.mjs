import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("active runtime has no Supabase provider, business registry, or browser client", async () => {
  const active = await Promise.all([
    source("app/lib/environment.ts"),
    source("app/lib/runtime-rehearsal-mode.ts"),
    source("app/repositories/registry.ts"),
    source("app/repositories/runtime/load-domain-registry.ts"),
    source("app/api/admin/accounts/route.ts"),
    source("app/api/auth/change-password/route.ts"),
  ]);
  assert.doesNotMatch(active.join("\n"), /supabase|createServer(?:Actor|Admin|Password)Client|createBrowserSupabaseClient/i);
});

test("runtime data mode is explicitly mock or Neon", async () => {
  const environment = await source("app/lib/environment.ts");
  assert.match(environment, /"mock", "neon"/);
  assert.doesNotMatch(environment, /hybrid|supabase/i);
});

test("active source, canonical Import metadata, package, and environment template contain no Supabase dependency", async () => {
  const appFiles = await readdir(new URL("app/", root), { recursive: true });
  const appSources = await Promise.all(appFiles
    .filter(path => typeof path === "string" && /\.(?:ts|tsx)$/.test(path))
    .map(path => readFile(new URL(`app/${path}`, root), "utf8")));
  const [schema, pkg, env] = await Promise.all([
    source("neon/canonical/e5b/090_import_staging_schema.sql"),
    source("package.json"),
    source(".env.example"),
  ]);
  assert.doesNotMatch([...appSources, schema, pkg, env].join("\n"), /@supabase|supabase_storage|NEXT_PUBLIC_SUPABASE|SUPABASE_/i);
});
