import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateSupabaseFreeBaseline } from "./validate-supabase-free-baseline.mjs";

async function fixture(files = {}) {
  const root = await mkdtemp(join(tmpdir(), "supabase-free-baseline-"));
  await Promise.all(Object.entries({
    "package.json": JSON.stringify({ name: "fixture", dependencies: {} }),
    "package-lock.json": JSON.stringify({ name: "fixture", packages: {} }),
    ".env.example": "APP_DATA_MODE=neon\n",
    "app/runtime.ts": "export const mode = 'neon';\n",
    ...files,
  }).map(async ([path, contents]) => {
    const target = join(root, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, contents);
  }));
  return root;
}

async function withFixture(files, run) {
  const root = await fixture(files);
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Supabase-free gate permits a Neon/Better Auth/Blob runtime and archived historical evidence", async () => {
  await withFixture({
    "docs/archive/supabase-project/migration.sql": "-- historical Supabase evidence only\n",
    "app/bytes.ts": "export const bytes = Buffer.from('safe'); export const list = Array.from([]);\n",
    "app/unrelated-client.ts": "import { createClient } from 'unrelated-sdk'; createClient();\n",
  }, async root => {
    assert.deepEqual(await validateSupabaseFreeBaseline({ root }), {
      supabaseFreeBaseline: true,
      legacySupabaseRuntimeRemoved: true,
      packageEnvClean: true,
    });
  });
});

test("Supabase-free gate rejects package, environment, active client, RPC, fallback, and deleted-project drift", async t => {
  const cases = [
    ["package", { "package.json": JSON.stringify({ dependencies: { "@supabase/supabase-js": "2.0.0" } }) }, "SUPABASE_FREE_PACKAGE_DRIFT"],
    ["environment", { ".env.example": "SUPABASE_URL=https://example.test\n" }, "SUPABASE_FREE_ENV_DRIFT"],
    ["import", { "app/runtime.ts": "import { createClient } from '@supabase/supabase-js';\n" }, "SUPABASE_FREE_RUNTIME_IMPORT"],
    ["client", { "app/runtime.ts": "client.from('people');\n" }, "SUPABASE_FREE_RUNTIME_CLIENT_DRIFT"],
    ["rpc", { "app/runtime.ts": "client.rpc('legacy_operation');\n" }, "SUPABASE_FREE_RUNTIME_CLIENT_DRIFT"],
    ["optional client", { "app/runtime.ts": "client?.from('people');\n" }, "SUPABASE_FREE_RUNTIME_CLIENT_DRIFT"],
    ["optional rpc", { "app/runtime.ts": "client?.rpc('legacy_operation');\n" }, "SUPABASE_FREE_RUNTIME_CLIENT_DRIFT"],
    ["fallback", { "app/runtime.ts": "export const dataMode = 'supabase';\n" }, "SUPABASE_FREE_FALLBACK_DRIFT"],
    ["project", { "app/runtime.ts": "export const endpoint = 'gaikifwwyaetjlnepuwh.supabase.co';\n" }, "SUPABASE_FREE_DELETED_PROJECT_DRIFT"],
    ["legacy config", { "supabase/config.toml": "project_id = 'legacy'\n" }, "SUPABASE_FREE_LEGACY_CONFIG_DRIFT"],
  ];

  for (const [name, files, code] of cases) {
    await t.test(name, () => withFixture(files, async root => {
      await assert.rejects(validateSupabaseFreeBaseline({ root }), { code });
    }));
  }
});
