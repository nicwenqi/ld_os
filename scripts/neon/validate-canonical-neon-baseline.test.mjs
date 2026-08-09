import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateCanonicalNeonSource } from "./validate-canonical-neon-baseline.mjs";

const fixtureRoot = new URL("./fixtures/canonical-neon-source/", import.meta.url);

async function copiedFixture() {
  const root = await mkdtemp(join(tmpdir(), "canonical-neon-source-"));
  await cp(fixtureRoot, root, { recursive: true });
  return root;
}

async function source(root, relativePath) {
  return readFile(join(root, relativePath), "utf8");
}

async function replace(root, relativePath, replacement) {
  await writeFile(join(root, relativePath), replacement);
}

test("accepts an ordered, fully declared source fixture without a database connection", async (t) => {
  const root = await copiedFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await validateCanonicalNeonSource({ root });

  assert.deepEqual(result, {
    mode: "source",
    modules: ["001_roles.sql", "002_people.sql"],
    objects: { policies: 1, routines: 2, tables: 1, triggers: 1, types: 1 },
  });
});

test("rejects SQL that would weaken the canonical security boundary", async (t) => {
  const cases = [
    ["auth compatibility", "select auth.uid();", "CANONICAL_NEON_FORBIDDEN_TOKEN"],
    ["persistent session state", "set app.actor_property_id = 'x';", "CANONICAL_NEON_PERSISTENT_SET"],
    ["PUBLIC execution", "grant execute on function public.read_people(text) to public;", "CANONICAL_NEON_PUBLIC_EXECUTE"],
    ["application raw reads", "grant select on table public.properties to hotel_ld_application;", "CANONICAL_NEON_APPLICATION_RAW_TABLE_PRIVILEGE"],
    ["application raw ALL privileges", "grant all on table public.properties to hotel_ld_application;", "CANONICAL_NEON_APPLICATION_RAW_TABLE_PRIVILEGE"],
    ["business seed DML", "insert into public.properties (id) values ('00000000-0000-0000-0000-000000000000');", "CANONICAL_NEON_BUSINESS_SEED_DML"],
  ];

  for (const [name, unsafeSql, code] of cases) {
    await t.test(name, async (t) => {
      const root = await copiedFixture();
      t.after(() => rm(root, { recursive: true, force: true }));
      const sql = await source(root, "002_people.sql");
      await replace(root, "002_people.sql", `${sql}\n${unsafeSql}\n`);

      await assert.rejects(
        validateCanonicalNeonSource({ root }),
        (error) => error?.code === code,
      );
    });
  }
});

test("rejects SQL modules outside the ordered manifest inventory", async (t) => {
  const root = await copiedFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "999_unlisted.sql"), "select 1;\n");

  await assert.rejects(
    validateCanonicalNeonSource({ root }),
    (error) => error?.code === "CANONICAL_NEON_MODULE_INVENTORY_DRIFT",
  );
});

test("rejects manifest drift, unordered inventory, missing FORCE RLS, and unpinned definers", async (t) => {
  const cases = [
    ["undeclared object", (sql) => `${sql}\ncreate table public.unlisted (id uuid primary key);`, "CANONICAL_NEON_MANIFEST_DRIFT"],
    ["missing FORCE RLS", (sql) => sql.replace(/alter table public\.properties force row level security;\n/, ""), "CANONICAL_NEON_FORCE_RLS_REQUIRED"],
    ["unfixed definer path", (sql) => sql.replace("set search_path = ''\n", ""), "CANONICAL_NEON_DEFINER_SEARCH_PATH"],
  ];

  for (const [name, mutate, code] of cases) {
    await t.test(name, async (t) => {
      const root = await copiedFixture();
      t.after(() => rm(root, { recursive: true, force: true }));
      const sql = await source(root, "002_people.sql");
      await replace(root, "002_people.sql", mutate(sql));

      await assert.rejects(
        validateCanonicalNeonSource({ root }),
        (error) => error?.code === code,
      );
    });
  }
});
