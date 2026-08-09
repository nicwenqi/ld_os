import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  EXPECTED_NEON_TARGET,
  assertExpectedSmokeRejection,
  runtimeSmokeValues,
  validateCanonicalNeon,
} from "./validate-canonical-neon-baseline.mjs";

const fixtureRoot = fileURLToPath(new URL("../../neon/canonical/", import.meta.url));
const validatorPath = fileURLToPath(new URL("./validate-canonical-neon-baseline.mjs", import.meta.url));

function fixtureConnectionString(role, pooled = false) {
  const endpoint = `${EXPECTED_NEON_TARGET.endpointId}${pooled ? "-pooler" : ""}.fixture.neon.tech`;
  const url = new URL(["postgresql:", "", endpoint, EXPECTED_NEON_TARGET.database].join("/"));
  url.username = role;
  url.password = "fixture-credential";
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

const bootstrapUrl = fixtureConnectionString(EXPECTED_NEON_TARGET.bootstrapRole);
const runtimeUrl = fixtureConnectionString("hotel_ld_application", true);

const emptyRow = {
  application_object_count: 0,
  canonical_role_count: 0,
  forbidden_schema_count: 0,
  application_row_count: 0,
  provider_routine_count: 0,
};

const catalogRow = {
  schema_count: 2,
  type_count: 6,
  table_count: 31,
  routine_count: 83,
  entrypoint_count: 27,
  policy_count: 31,
  trigger_count: 15,
  rls_table_count: 31,
  application_row_count: 0,
  audit_row_count: 0,
  roles_exact: true,
  runtime_role_restricted: true,
  migration_role_restricted: true,
  runtime_memberships_empty: true,
  runtime_owns_nothing: true,
  migration_owner_owns_all: true,
  schemas_exact: true,
  types_exact: true,
  tables_exact: true,
  routines_exact: true,
  entrypoints_exact: true,
  policies_exact: true,
  triggers_exact: true,
  rls_exact: true,
  runtime_raw_privileges_empty: true,
  runtime_private_schema_denied: true,
  runtime_entrypoints_exact: true,
  definers_hardened: true,
  audit_append_only: true,
  exclusions_absent: true,
  rows_empty: true,
};

function queryText(query) {
  return typeof query === "string" ? query : query.text;
}

function fakePool(handler) {
  const transcript = [];
  let released = 0;
  let ended = 0;
  const client = {
    async query(query, values) {
      const text = queryText(query);
      const parameters = values ?? query?.values;
      transcript.push({ text, values: parameters });
      return handler(text, parameters, transcript);
    },
    release() {
      released += 1;
    },
  };
  return {
    transcript,
    get released() { return released; },
    get ended() { return ended; },
    async connect() { return client; },
    async end() { ended += 1; },
  };
}

function identityRow(role = "neondb_owner") {
  return {
    server_version_num: 180004,
    database_name: "neondb",
    database_owner: "neondb_owner",
    current_role: role,
    session_role: role,
  };
}

function bootstrapHandler(text, values) {
  if (text.includes("canonical_target_identity")) return { rows: [identityRow()] };
  if (text.includes("canonical_empty_state")) return { rows: [emptyRow] };
  if (text.includes("canonical_catalog_matrix")) {
    const exactInventory = Array.isArray(values)
      && [2, 6, 31, 83, 27, 31, 15, 10].every((length, index) => values[index]?.length === length)
      && text.includes("namespace.nspname::text")
      && text.includes("pg_catalog.oidvectortypes(routine.proargtypes)");
    return { rows: [{ ...catalogRow, tables_exact: exactInventory }] };
  }
  return { rows: [] };
}

function dependenciesFor(pool, overrides = {}) {
  return {
    createBootstrapPool: () => pool,
    createRuntimePool: () => { throw new Error("runtime pool must not be created"); },
    randomPassword: () => "parameter-only-password",
    ...overrides,
  };
}

test("rejects any non-canonical project metadata before constructing a pool", async () => {
  let constructed = 0;
  await assert.rejects(
    validateCanonicalNeon({
      mode: "dry-run",
      root: fixtureRoot,
      target: { ...EXPECTED_NEON_TARGET, projectId: "flat-brook-43278549" },
      bootstrapConnectionString: bootstrapUrl,
      dependencies: {
        createBootstrapPool() {
          constructed += 1;
          throw new Error("must remain unreachable");
        },
      },
    }),
    (error) => error?.code === "CANONICAL_NEON_TARGET_MISMATCH",
  );
  assert.equal(constructed, 0);
});

test("dry-run strips only module transaction frames, catalogs inside one transaction, and proves rollback emptiness", async () => {
  const pool = fakePool(bootstrapHandler);
  const result = await validateCanonicalNeon({
    mode: "dry-run",
    root: fixtureRoot,
    target: EXPECTED_NEON_TARGET,
    bootstrapConnectionString: bootstrapUrl,
    dependencies: dependenciesFor(pool),
  });

  assert.equal(result.mode, "dry-run");
  assert.equal(result.rolledBack, true);
  const statements = pool.transcript.map(({ text }) => text.trim());
  assert.equal(statements.filter((text) => text === "BEGIN").length, 1);
  assert.equal(statements.filter((text) => text === "ROLLBACK").length, 1);
  assert.equal(statements.some((text) => /^begin;/i.test(text) || /commit;$/i.test(text)), false);
  assert.ok(statements.indexOf("RESET ROLE") >= 0);
  assert.ok(statements.indexOf("RESET ROLE") < statements.findIndex((text) => text.includes("canonical_catalog_matrix")));
  assert.ok(statements.findIndex((text) => text.includes("canonical_catalog_matrix")) < statements.indexOf("ROLLBACK"));
  assert.ok(statements.findLastIndex((text) => text.includes("canonical_empty_state")) > statements.indexOf("ROLLBACK"));
  assert.equal(pool.released, 1);
  assert.equal(pool.ended, 1);
});

test("dry-run rejects an otherwise empty target that contains an undeclared public routine", async () => {
  const pool = fakePool((text, values, transcript) => {
    if (text.includes("canonical_target_identity")) return { rows: [identityRow()] };
    if (text.includes("canonical_empty_state")) {
      return { rows: [{ ...emptyRow, provider_routine_count: 1 }] };
    }
    return bootstrapHandler(text, values, transcript);
  });

  await assert.rejects(
    validateCanonicalNeon({
      mode: "dry-run",
      root: fixtureRoot,
      target: EXPECTED_NEON_TARGET,
      bootstrapConnectionString: bootstrapUrl,
      dependencies: dependenciesFor(pool),
    }),
    (error) => error?.code === "CANONICAL_NEON_EMPTY_BASELINE_REQUIRED",
  );
  assert.equal(pool.transcript.some(({ text }) => /^\s*create\s/i.test(text)), false);
});

test("catalog fails closed when one exact security verdict drifts", async () => {
  const pool = fakePool((text) => {
    if (text.includes("canonical_target_identity")) return { rows: [identityRow()] };
    if (text.includes("canonical_catalog_matrix")) {
      return { rows: [{ ...catalogRow, definers_hardened: false }] };
    }
    return { rows: [] };
  });

  await assert.rejects(
    validateCanonicalNeon({
      mode: "catalog",
      root: fixtureRoot,
      target: EXPECTED_NEON_TARGET,
      bootstrapConnectionString: bootstrapUrl,
      dependencies: dependenciesFor(pool),
    }),
    (error) => error?.code === "CANONICAL_NEON_CATALOG_DRIFT",
  );
});

test("catalog binds every policy and trigger security descriptor, not names alone", async () => {
  let catalogQuery;
  const pool = fakePool((text, values) => {
    if (text.includes("canonical_target_identity")) return { rows: [identityRow()] };
    if (text.includes("canonical_catalog_matrix")) {
      catalogQuery = { text, values };
      return { rows: [catalogRow] };
    }
    if (text.includes("canonical_row_counts")) return { rows: [] };
    return { rows: [] };
  });

  await validateCanonicalNeon({
    mode: "catalog",
    root: fixtureRoot,
    target: EXPECTED_NEON_TARGET,
    bootstrapConnectionString: bootstrapUrl,
    dependencies: dependenciesFor(pool),
  });

  assert.equal(catalogQuery.values[5].length, 31);
  assert.equal(catalogQuery.values[6].length, 15);
  for (const field of ["polcmd", "polroles", "polpermissive", "pg_get_expr(policy.polqual", "pg_get_expr(policy.polwithcheck"]) {
    assert.equal(catalogQuery.text.includes(field), true, field);
  }
  for (const field of ["tgenabled", "tgtype", "tgattr", "tgfoid", "routine_namespace.nspname"]) {
    assert.equal(catalogQuery.text.includes(field), true, field);
  }
  assert.equal(catalogQuery.values[5].every((descriptor) => descriptor.split("|").length === 6), true);
  assert.equal(catalogQuery.values[6].every((descriptor) => descriptor.split("|").length === 7), true);
});

test("entrypoint smoke rejects structural, catalog, internal, and permission errors unconditionally", () => {
  const manifest = {
    entrypointSignatures: ["public.fixture(text)"],
    security: {
      runtimeSmokeExpectedRejections: {
        "public.fixture(text)": [{ code: "P0002", message: "fixture business rejection" }],
      },
    },
  };

  assert.doesNotThrow(() => assertExpectedSmokeRejection(
    manifest,
    "public.fixture(text)",
    Object.assign(new Error("fixture business rejection"), { code: "P0002" }),
  ));
  for (const [code, message] of [
    ["42883", "undefined function"],
    ["3F000", "invalid schema"],
    ["XX001", "internal error"],
    ["42501", "permission denied for function fixture"],
    ["P0002", "not the exact allowed business rejection"],
  ]) {
    assert.throws(
      () => assertExpectedSmokeRejection(manifest, "public.fixture(text)", Object.assign(new Error(message), { code })),
      (error) => error?.code === code,
    );
  }
  assert.throws(
    () => assertExpectedSmokeRejection(manifest, "public.not_declared(text)", Object.assign(new Error("fixture business rejection"), { code: "P0002" })),
    (error) => error?.code === "P0002",
  );
});

test("entrypoint smoke supplies scoped fixtures for every exact signature", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../neon/canonical/manifest.json", import.meta.url), "utf8"));
  const seed = Object.fromEntries([
    "tenantA", "propertyA", "rootDepartment", "childDepartment", "operationalUnit",
    "departmentAlias", "positionAlias", "position", "positionFamily", "childEmployee",
  ].map((key, index) => [key, `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`]));
  seed.hostnameA = "fixture.validation.invalid";

  for (const signature of manifest.entrypointSignatures) {
    const values = runtimeSmokeValues(signature, seed);
    assert.equal(values.length, signature.slice(signature.indexOf("(") + 1, -1).split(",").length, signature);
  }
  assert.deepEqual(
    runtimeSmokeValues("public.create_neon_organization_department(text,uuid,uuid,uuid,text,text,text,text,integer)", seed).slice(1, 3),
    [seed.tenantA, seed.propertyA],
  );
});

test("catalog fails closed when the migration owner gains login, inheritance, bypass, or admin attributes", async () => {
  const pool = fakePool((text) => {
    if (text.includes("canonical_target_identity")) return { rows: [identityRow()] };
    if (text.includes("canonical_catalog_matrix")) {
      return { rows: [{ ...catalogRow, migration_role_restricted: false }] };
    }
    return { rows: [] };
  });

  await assert.rejects(
    validateCanonicalNeon({
      mode: "catalog",
      root: fixtureRoot,
      target: EXPECTED_NEON_TARGET,
      bootstrapConnectionString: bootstrapUrl,
      dependencies: dependenciesFor(pool),
    }),
    (error) => error?.code === "CANONICAL_NEON_CATALOG_DRIFT"
      && error.message.includes("migration_role_restricted"),
  );
});

test("apply provisions the runtime password only as a query parameter and never returns it", async () => {
  const pool = fakePool(bootstrapHandler);
  const result = await validateCanonicalNeon({
    mode: "apply",
    root: fixtureRoot,
    target: EXPECTED_NEON_TARGET,
    bootstrapConnectionString: bootstrapUrl,
    dependencies: dependenciesFor(pool),
  });

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("parameter-only-password"), false);
  assert.equal(serialized.includes("postgresql://"), false);
  assert.equal(pool.transcript.some(({ text }) => text.includes("parameter-only-password")), false);
  assert.equal(pool.transcript.some(({ values }) => values?.includes("parameter-only-password")), true);
  assert.equal(result.runtimeCredentialProvisioned, true);
});

test("runtime requires the pooled application credential and never falls back to bootstrap or SET ROLE", async () => {
  let runtimeConstructed = 0;
  const bootstrapPool = fakePool(bootstrapHandler);
  const runtimePool = fakePool((text) => {
    if (text.includes("canonical_target_identity")) return { rows: [identityRow("hotel_ld_application")] };
    return { rows: [] };
  });

  await assert.rejects(
    validateCanonicalNeon({
      mode: "runtime",
      root: fixtureRoot,
      target: EXPECTED_NEON_TARGET,
      bootstrapConnectionString: bootstrapUrl,
      runtimeConnectionString: bootstrapUrl,
      dependencies: dependenciesFor(bootstrapPool, {
        createRuntimePool() {
          runtimeConstructed += 1;
          return runtimePool;
        },
      }),
    }),
    (error) => error?.code === "CANONICAL_NEON_RUNTIME_CONNECTION_MISMATCH",
  );
  assert.equal(runtimeConstructed, 0);
  assert.equal([...bootstrapPool.transcript, ...runtimePool.transcript].some(({ text }) => /\bset\s+role\b/i.test(text)), false);
});

test("repeatability performs two identical rollback installs before apply and final catalog", async () => {
  const pool = fakePool(bootstrapHandler);
  const result = await validateCanonicalNeon({
    mode: "repeatability",
    root: fixtureRoot,
    target: EXPECTED_NEON_TARGET,
    bootstrapConnectionString: bootstrapUrl,
    runtimePassword: "parameter-only-password",
    dependencies: dependenciesFor(pool),
  });

  const statements = pool.transcript.map(({ text }) => text.trim());
  assert.equal(statements.filter((text) => text === "ROLLBACK").length, 2);
  assert.equal(result.dryRuns, 2);
  assert.equal(result.identical, true);
  assert.equal(result.applied, true);
  assert.equal(result.runtimeCredentialProvisioned, true);
  assert.equal(JSON.stringify(result).includes("parameter-only-password"), false);
});

test("runtime opens distinct direct bootstrap and pooled application pools and returns only matrix verdicts", async () => {
  const bootstrapPool = fakePool(bootstrapHandler);
  const runtimePool = fakePool((text) => {
    if (text.includes("canonical_target_identity")) return { rows: [identityRow("hotel_ld_application")] };
    return { rows: [] };
  });
  const matrix = {
    actorContext: "PASS",
    resolvedActorContext: "PASS",
    managerReads: "PASS",
    departmentAdminScope: "PASS",
    crossScopeDenials: "PASS",
    rollbackWrites: "PASS",
    conflictAtomicity: "PASS",
    rawAccessDenied: "PASS",
    concurrentIsolation: "PASS",
    cleanup: "PASS",
  };
  const result = await validateCanonicalNeon({
    mode: "runtime",
    root: fixtureRoot,
    target: EXPECTED_NEON_TARGET,
    bootstrapConnectionString: bootstrapUrl,
    runtimeConnectionString: runtimeUrl,
    dependencies: dependenciesFor(bootstrapPool, {
      createRuntimePool: () => runtimePool,
      runRuntimeMatrix: async ({ bootstrapPool: actualBootstrap, runtimePool: actualRuntime }) => {
        assert.equal(actualBootstrap, bootstrapPool);
        assert.equal(actualRuntime, runtimePool);
        return matrix;
      },
    }),
  });

  assert.deepEqual(result, { mode: "runtime", matrix, finalRowsZero: true });
  assert.equal(JSON.stringify(result).includes("postgresql://"), false);
  assert.equal([...bootstrapPool.transcript, ...runtimePool.transcript].some(({ text }) => /\bset\s+role\b/i.test(text)), false);
  assert.equal(bootstrapPool.ended, 1);
  assert.equal(runtimePool.ended, 1);
});

test("real runtime matrix proves pooled-client cleanup and denies every raw table operation class", async () => {
  const source = await readFile(validatorPath, "utf8");

  assert.match(source, /after_commit_clear/);
  assert.match(source, /after_rollback_clear/);
  for (const statement of [
    "select * from public.properties",
    "insert into public.tenants",
    "update public.tenants",
    "delete from public.tenants",
  ]) assert.equal(source.includes(statement), true, statement);
});

test("runtime stage failures expose only a stable stage, code, and safe canonical message", async () => {
  const module = await import("./validate-canonical-neon-baseline.mjs");
  assert.equal(typeof module.runCanonicalRuntimeStage, "function");

  await assert.rejects(
    module.runCanonicalRuntimeStage("seed-create", async () => {
      const error = new Error("ACTOR_CONTEXT_REQUIRED");
      error.code = "42501";
      throw error;
    }),
    (error) => error?.code === "CANONICAL_NEON_RUNTIME_STAGE_FAILED"
      && error.message === "seed-create:42501:ACTOR_CONTEXT_REQUIRED",
  );
  await assert.rejects(
    module.runCanonicalRuntimeStage("manager-reads", async () => {
      throw new Error("unsafe detail with credential material");
    }),
    (error) => error?.message === "manager-reads:ERROR:REDACTED_RUNTIME_ERROR",
  );
});

test("bootstrap seed and cleanup bind synthetic actor settings locally before forced-RLS DML", async () => {
  const source = await readFile(validatorPath, "utf8");
  const helper = source.slice(
    source.indexOf("async function withBootstrapSeedPolicies"),
    source.indexOf("async function createRuntimeSeed"),
  );
  const localSettings = helper.indexOf("pg_catalog.set_config('app.actor_auth_user_id'");
  const firstPolicy = helper.indexOf("create policy canonical_validation_owner_seed");

  assert.ok(localSettings >= 0 && localSettings < firstPolicy);
  for (const setting of [
    "app.actor_auth_user_id",
    "app.actor_property_id",
    "app.actor_request_id",
  ]) assert.equal(helper.includes(setting), true, setting);
  assert.match(helper, /set_config\([^;]*\$1[^;]*\$2[^;]*\$3/s);
});

test("manager runtime reads are generated from exact manifest signatures with every nullable argument typed", async () => {
  const module = await import("./validate-canonical-neon-baseline.mjs");
  const manifest = JSON.parse(await readFile(new URL("../../neon/canonical/manifest.json", import.meta.url), "utf8"));
  assert.equal(typeof module.runtimeEntrypointQuery, "function");

  const fixtures = [
    {
      signature: "public.read_neon_people_manager_directory(text,text,uuid,uuid,uuid,text,boolean,integer,integer)",
      values: ["fixture.invalid", null, null, null, null, null, null, 100, 0],
    },
    { signature: "public.read_neon_organization_department_tree(text)", values: ["fixture.invalid"] },
    { signature: "public.read_neon_positions(text)", values: ["fixture.invalid"] },
  ];
  for (const fixture of fixtures) {
    const query = module.runtimeEntrypointQuery(manifest, fixture.signature, fixture.values);
    const types = fixture.signature.slice(fixture.signature.indexOf("(") + 1, -1).split(",");
    assert.deepEqual(query.values, fixture.values);
    assert.equal(
      query.text,
      `select ${fixture.signature.slice(0, fixture.signature.indexOf("("))}(${types.map((type, index) => `$${index + 1}::${type}`).join(",")}) as payload`,
    );
  }
  assert.throws(
    () => module.runtimeEntrypointQuery(manifest, "public.read_neon_positions(text)", []),
    (error) => error?.code === "CANONICAL_NEON_ENTRYPOINT_ARGUMENT_DRIFT",
  );
});

test("every hand-written runtime entrypoint probe routes through exact manifest query generation", async () => {
  const source = await readFile(validatorPath, "utf8");
  const matrix = source.slice(
    source.indexOf("async function runCanonicalRuntimeMatrix"),
    source.indexOf("function resolvedDependencies"),
  );

  assert.equal(matrix.includes("select public."), false);
  assert.ok(matrix.match(/runtimeEntrypointQuery\(/g).length >= 10);
});
