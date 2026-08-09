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
    modules: ["001_roles.sql", "002_people.sql", "003_actor_context.sql"],
    objects: { policies: 1, routines: 3, tables: 1, triggers: 1, types: 1 },
  });
});

test("rejects SQL that would weaken the canonical security boundary", async (t) => {
  const cases = [
    ["auth compatibility", "select auth.uid();", "CANONICAL_NEON_FORBIDDEN_TOKEN"],
    ["persistent session state", "set app.actor_property_id = 'x';", "CANONICAL_NEON_PERSISTENT_SET"],
    ["PUBLIC execution", "grant execute on function public.read_people(text) to public;", "CANONICAL_NEON_PUBLIC_EXECUTE"],
    ["application raw reads", "grant select on table public.properties to hotel_ld_application;", "CANONICAL_NEON_APPLICATION_RAW_TABLE_PRIVILEGE"],
    ["application raw ALL privileges", "grant all on table public.properties to hotel_ld_application;", "CANONICAL_NEON_APPLICATION_RAW_TABLE_PRIVILEGE"],
    ["application raw schema privileges", "grant select on all tables in schema public to hotel_ld_application;", "CANONICAL_NEON_APPLICATION_RAW_TABLE_PRIVILEGE"],
    ["application raw schema multi-privileges", "grant select, insert on all tables in schema public to hotel_ld_application;", "CANONICAL_NEON_APPLICATION_RAW_TABLE_PRIVILEGE"],
    ["business seed DML", "insert into public.properties (id) values ('00000000-0000-0000-0000-000000000000');", "CANONICAL_NEON_BUSINESS_SEED_DML"],
    ["unqualified business seed DML", "insert into properties (id) values ('00000000-0000-0000-0000-000000000000');", "CANONICAL_NEON_BUSINESS_SEED_DML"],
    ["legacy import view", "create view public.import_staging as select 1 as id;", "CANONICAL_NEON_FORBIDDEN_OBJECT"],
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

test("requires an explicit PUBLIC execution revocation for every declared routine", async (t) => {
  const root = await copiedFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const sql = await source(root, "002_people.sql");
  await replace(root, "002_people.sql", sql.replace("revoke all on function public.read_people(text) from public;\n", ""));

  await assert.rejects(
    validateCanonicalNeonSource({ root }),
    (error) => error?.code === "CANONICAL_NEON_PUBLIC_EXECUTE_DEFAULT",
  );
});

test("rejects default PUBLIC revocations scoped to the wrong role", async (t) => {
  const root = await copiedFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const people = await source(root, "002_people.sql");
  const actor = await source(root, "003_actor_context.sql");
  await replace(root, "002_people.sql", people.replace(/revoke all on function[^\n]+\n/g, ""));
  await replace(root, "003_actor_context.sql", `${actor.replace(/revoke all on function[^\n]+\n/g, "")}\nalter default privileges for role wrong_owner revoke execute on functions from public;\n`);

  await assert.rejects(
    validateCanonicalNeonSource({ root }),
    (error) => error?.code === "CANONICAL_NEON_PUBLIC_EXECUTE_DEFAULT",
  );
});

test("rejects default PUBLIC revocations scoped away from public entrypoints", async (t) => {
  const root = await copiedFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const roles = await source(root, "001_roles.sql");
  const people = await source(root, "002_people.sql");
  const actor = await source(root, "003_actor_context.sql");
  await replace(root, "001_roles.sql", `${roles}\nalter default privileges for role hotel_ld_migration_owner in schema app_private revoke execute on functions from public;\n`);
  await replace(root, "002_people.sql", people.replace(/revoke all on function[^\n]+\n/g, ""));
  await replace(root, "003_actor_context.sql", actor.replace(/revoke all on function[^\n]+\n/g, ""));

  await assert.rejects(
    validateCanonicalNeonSource({ root }),
    (error) => error?.code === "CANONICAL_NEON_PUBLIC_EXECUTE_DEFAULT",
  );
});

test("enforces the runtime role's NOINHERIT, NOBYPASSRLS, and no-ownership boundary", async (t) => {
  const cases = [
    ["BYPASSRLS", "alter role hotel_ld_application bypassrls;", "CANONICAL_NEON_RUNTIME_ROLE_BYPASSRLS"],
    ["INHERIT", "alter role hotel_ld_application inherit;", "CANONICAL_NEON_RUNTIME_ROLE_INHERIT"],
    ["SUPERUSER", "alter role hotel_ld_application superuser;", "CANONICAL_NEON_RUNTIME_ROLE_ADMIN"],
    ["ownership", "alter table public.properties owner to hotel_ld_application;", "CANONICAL_NEON_APPLICATION_OWNERSHIP"],
    ["schema authorization", "create schema app_private authorization hotel_ld_application;", "CANONICAL_NEON_APPLICATION_OWNERSHIP"],
    ["reassign owned", "reassign owned by hotel_ld_migration_owner to hotel_ld_application;", "CANONICAL_NEON_APPLICATION_OWNERSHIP"],
  ];
  for (const [name, mutation, code] of cases) {
    await t.test(name, async (t) => {
      const root = await copiedFixture();
      t.after(() => rm(root, { recursive: true, force: true }));
      const sql = await source(root, "002_people.sql");
      await replace(root, "002_people.sql", `${sql}\n${mutation}\n`);
      await assert.rejects(validateCanonicalNeonSource({ root }), (error) => error?.code === code);
    });
  }
});

test("rejects quoted application roles in raw table grants", async (t) => {
  const root = await copiedFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const sql = await source(root, "002_people.sql");
  await replace(root, "002_people.sql", `${sql}\ngrant select on table public.properties to "hotel_ld_application";\n`);
  await assert.rejects(validateCanonicalNeonSource({ root }), (error) => error?.code === "CANONICAL_NEON_APPLICATION_RAW_TABLE_PRIVILEGE");
});

test("rejects the runtime role anywhere in raw object grant grantee lists", async (t) => {
  const cases = [
    ["table grantee list", "grant select on table public.properties to hotel_ld_migration_owner, hotel_ld_application;"],
    ["table GROUP grantee", "grant select on table public.properties to group hotel_ld_application;"],
    ["schema quoted grantee list", "grant usage on schema app_private to hotel_ld_migration_owner, \"hotel_ld_application\";"],
    ["sequence quoted GROUP grantee", "grant usage, select on sequence public.properties_id_seq to group \"hotel_ld_application\";"],
  ];

  for (const [name, mutation] of cases) {
    await t.test(name, async (t) => {
      const root = await copiedFixture();
      t.after(() => rm(root, { recursive: true, force: true }));
      const sql = await source(root, "002_people.sql");
      await replace(root, "002_people.sql", `${sql}\n${mutation}\n`);
      await assert.rejects(validateCanonicalNeonSource({ root }), (error) => error?.code === "CANONICAL_NEON_APPLICATION_RAW_TABLE_PRIVILEGE");
    });
  }
});

test("requires transaction-local actor GUC writes", async (t) => {
  const root = await copiedFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const sql = await source(root, "003_actor_context.sql");
  await replace(root, "003_actor_context.sql", sql.replace("p_user::text, true", "p_user::text, false"));

  await assert.rejects(
    validateCanonicalNeonSource({ root }),
    (error) => error?.code === "CANONICAL_NEON_ACTOR_CONTEXT_NOT_LOCAL",
  );
});

test("rejects actor GUC transaction-local expressions that are not exactly TRUE", async (t) => {
  const root = await copiedFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const sql = await source(root, "003_actor_context.sql");
  await replace(root, "003_actor_context.sql", sql.replace("p_user::text, true", "p_user::text, false::boolean"));

  await assert.rejects(
    validateCanonicalNeonSource({ root }),
    (error) => error?.code === "CANONICAL_NEON_ACTOR_CONTEXT_NOT_LOCAL",
  );
});

test("rejects an extra non-local actor GUC write beside a valid one", async (t) => {
  const root = await copiedFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const sql = await source(root, "003_actor_context.sql");
  await replace(root, "003_actor_context.sql", `${sql}\nselect set_config('app.actor_auth_user_id', p_user::text, false::boolean);\n`);
  await assert.rejects(validateCanonicalNeonSource({ root }), (error) => error?.code === "CANONICAL_NEON_ACTOR_CONTEXT_NOT_LOCAL");
});

test("recognizes PostgreSQL string literal forms in the actor GUC inventory", async (t) => {
  const root = await copiedFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const sql = await source(root, "003_actor_context.sql");
  await replace(root, "003_actor_context.sql", sql
    .replace("'app.actor_auth_user_id'", "E'app.actor_auth_user_id'")
    .replace("'app.actor_property_id'", "U&'app.actor_property_id'")
    .replace("'app.actor_request_id'", "$actor$app.actor_request_id$actor$"));

  await validateCanonicalNeonSource({ root });
});

test("rejects non-local or unknown actor GUC writes for every PostgreSQL string form", async (t) => {
  const cases = [
    ["escape string", "select set_config(E'app.actor_auth_user_id', p_user::text, false);"],
    ["Unicode string", "select set_config(U&'app.actor_property_id', p_property::text, false);"],
    ["dollar string", "select set_config($actor$app.actor_request_id$actor$, p_request::text, false);"],
    ["unknown target expression", "select set_config(lower('app.actor_auth_user_id'), p_user::text, true);"],
  ];

  for (const [name, mutation] of cases) {
    await t.test(name, async (t) => {
      const root = await copiedFixture();
      t.after(() => rm(root, { recursive: true, force: true }));
      const sql = await source(root, "003_actor_context.sql");
      await replace(root, "003_actor_context.sql", `${sql}\n${mutation}\n`);
      await assert.rejects(validateCanonicalNeonSource({ root }), (error) => error?.code === "CANONICAL_NEON_ACTOR_CONTEXT_NOT_LOCAL");
    });
  }
});

test("rejects Unicode escape actor GUC targets", async (t) => {
  const root = await copiedFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const sql = await source(root, "003_actor_context.sql");
  await replace(root, "003_actor_context.sql", `${sql}\nselect set_config(U&'app.actor!005fauth!005fuser!005fid' UESCAPE '!', p_user::text, true);\n`);

  await assert.rejects(
    validateCanonicalNeonSource({ root }),
    (error) => error?.code === "CANONICAL_NEON_ACTOR_CONTEXT_NOT_LOCAL",
  );
});

test("rejects every non-static set_config target expression", async (t) => {
  const root = await copiedFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const sql = await source(root, "003_actor_context.sql");
  await replace(root, "003_actor_context.sql", `${sql}\nselect set_config(format('%s.%s_%s', 'app', 'actor', 'request_id'), p_request::text, true);\n`);

  await assert.rejects(
    validateCanonicalNeonSource({ root }),
    (error) => error?.code === "CANONICAL_NEON_ACTOR_CONTEXT_NOT_LOCAL",
  );
});

test("does not count actor setters inside nested function-body comments", async (t) => {
  const root = await copiedFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const sql = await source(root, "003_actor_context.sql");
  await replace(root, "003_actor_context.sql", sql
    .replace("  select set_config('app.actor_auth_user_id', p_user::text, true);", "  -- select set_config('app.actor_auth_user_id', p_user::text, true);")
    .replace("  select set_config('app.actor_property_id', p_property::text, true);", "  /* select set_config('app.actor_property_id', p_property::text, true); */")
    .replace("  select set_config('app.actor_request_id', p_request::text, true);", "  /* outer /* inner */ select set_config('app.actor_request_id', p_request::text, true); */"));

  await assert.rejects(
    validateCanonicalNeonSource({ root }),
    (error) => error?.code === "CANONICAL_NEON_ACTOR_CONTEXT_NOT_LOCAL",
  );
});

test("rejects Unicode quoted grantees in raw object grants", async (t) => {
  const root = await copiedFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const sql = await source(root, "002_people.sql");
  await replace(root, "002_people.sql", `${sql}\ngrant select on table public.properties to U&"hotel!005fld!005fapplication" UESCAPE '!';\n`);

  await assert.rejects(
    validateCanonicalNeonSource({ root }),
    (error) => error?.code === "CANONICAL_NEON_APPLICATION_RAW_TABLE_PRIVILEGE",
  );
});

test("does not treat commented security directives as executable", async (t) => {
  const cases = [
    ["FORCE RLS", "alter table public.properties force row level security;", "CANONICAL_NEON_FORCE_RLS_REQUIRED"],
    ["definer path", "set search_path = ''", "CANONICAL_NEON_DEFINER_SEARCH_PATH"],
  ];
  for (const [name, directive, code] of cases) {
    await t.test(name, async (t) => {
      const root = await copiedFixture();
      t.after(() => rm(root, { recursive: true, force: true }));
      const sql = await source(root, "002_people.sql");
      await replace(root, "002_people.sql", sql.replace(directive, `-- ${directive}`));
      await assert.rejects(validateCanonicalNeonSource({ root }), (error) => error?.code === code);
    });
  }
});

test("does not let nested block comments satisfy FORCE RLS", async (t) => {
  const root = await copiedFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const sql = await source(root, "002_people.sql");
  await replace(root, "002_people.sql", sql.replace(
    "alter table public.properties force row level security;",
    "/* outer /* inner */ alter table public.properties force row level security; */",
  ));
  await assert.rejects(validateCanonicalNeonSource({ root }), (error) => error?.code === "CANONICAL_NEON_FORCE_RLS_REQUIRED");
});

test("validates declared schemas and entrypoint relationships", async (t) => {
  await t.test("missing non-default schema", async (t) => {
    const root = await copiedFixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    const sql = await source(root, "001_roles.sql");
    await replace(root, "001_roles.sql", sql.replace("create schema app_private;\n", ""));
    await assert.rejects(validateCanonicalNeonSource({ root }), (error) => error?.code === "CANONICAL_NEON_MANIFEST_DRIFT");
  });
  await t.test("undeclared schema", async (t) => {
    const root = await copiedFixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    const sql = await source(root, "001_roles.sql");
    await replace(root, "001_roles.sql", `${sql}\ncreate schema unlisted;\n`);
    await assert.rejects(validateCanonicalNeonSource({ root }), (error) => error?.code === "CANONICAL_NEON_MANIFEST_DRIFT");
  });
  await t.test("entrypoint must be a declared routine", async (t) => {
    const root = await copiedFixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.entrypoints = ["public.not_a_declared_routine"];
    await writeFile(path, JSON.stringify(manifest));
    await assert.rejects(validateCanonicalNeonSource({ root }), (error) => error?.code === "CANONICAL_NEON_MANIFEST_ENTRYPOINT_DRIFT");
  });
  await t.test("entrypoint grant must keep its declared signature", async (t) => {
    const root = await copiedFixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    const sql = await source(root, "002_people.sql");
    await replace(root, "002_people.sql", sql.replace(
      "grant execute on function public.read_people(text) to hotel_ld_application;",
      "grant execute on function public.read_people(integer) to hotel_ld_application;",
    ));
    await assert.rejects(validateCanonicalNeonSource({ root }), (error) => error?.code === "CANONICAL_NEON_ENTRYPOINT_SIGNATURE_DRIFT");
  });
  await t.test("created entrypoint must keep its declared signature", async (t) => {
    const root = await copiedFixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    const sql = await source(root, "002_people.sql");
    await replace(root, "002_people.sql", sql.replace("public.read_people(p_host text)", "public.read_people(p_host integer)"));
    await assert.rejects(validateCanonicalNeonSource({ root }), (error) => error?.code === "CANONICAL_NEON_ENTRYPOINT_SIGNATURE_DRIFT");
  });
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
