import assert from "node:assert/strict";
import test from "node:test";

import {
  E5B_CATALOG_SQL,
  runE5bDatabaseCommand,
  runE5bRuntimeValidation,
} from "./validate-e5b-import-staging.mjs";

test("catalog raw-privilege probe includes public and private schema ACLs", () => {
  assert.match(E5B_CATALOG_SQL, /has_schema_privilege\('hotel_ld_application','app_private','USAGE'\)/);
  assert.match(E5B_CATALOG_SQL, /has_schema_privilege\('hotel_ld_application','app_private','CREATE'\)/);
  assert.match(E5B_CATALOG_SQL, /has_schema_privilege\('hotel_ld_application','public','CREATE'\)/);
  assert.match(E5B_CATALOG_SQL, /relation\.relkind in \('r','p','S','v','m','f'\)/);
  assert.match(E5B_CATALOG_SQL, /has_any_column_privilege\('hotel_ld_application', relation\.oid/);
});

const BOOTSTRAP_URL = "postgresql://neondb_owner:fixture-secret@ep-frosty-math-audxlq88.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const RUNTIME_URL = "postgresql://hotel_ld_application:fixture-secret@ep-frosty-math-audxlq88-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const MIGRATIONS = [
  "begin; set local role hotel_ld_migration_owner; select 'e5b-090'; commit;",
  "begin; set local role hotel_ld_migration_owner; select 'e5b-091'; commit;",
  "begin; set local role hotel_ld_migration_owner; select 'e5b-092'; commit;",
];

function fakeClient({ catalog = {}, identity = {} } = {}) {
  const transcript = [];
  return {
    transcript,
    async connect() {},
    async end() {},
    async query(query) {
      const text = typeof query === "string" ? query : query.text;
      transcript.push(text);
      if (text.includes("e5b:identity")) {
        return { rows: [{ server_version_num: 180000, database: "neondb", database_owner: "neondb_owner", current_user: "neondb_owner", session_user: "neondb_owner", ...identity }] };
      }
      if (text.includes("e5b:catalog-matrix")) return { rows: [{ ...catalog }] };
      if (text.includes("e5b:catalog-snapshot")) return { rows: [{ fingerprint: "empty-before" }] };
      return { rows: [] };
    },
  };
}

test("Task 9 dry-run uses the direct bootstrap role, outer transaction, rollback, and empty proof", async () => {
  const client = fakeClient({ catalog: { empty_after_rollback: true } });
  const result = await runE5bDatabaseCommand("dry-run", BOOTSTRAP_URL, {
    sourceCheck: async () => ({ ok: true }),
    readMigrationSources: async () => MIGRATIONS,
    createClient: () => client,
    catalog: async () => ({ catalogValidated: true, empty: true }),
    emptyProof: async () => ({ empty: true }),
  });

  assert.equal(result.rolledBack, true);
  assert.equal(result.emptyAfterRollback, true);
  assert.equal(client.transcript.filter((query) => /^begin\s*$/i.test(query.trim())).length, 1);
  assert.equal(client.transcript.filter((query) => /^rollback\s*$/i.test(query.trim())).length, 1);
  assert.equal(client.transcript.some((query) => /^commit\s*$/i.test(query.trim())), false);
  assert.equal(client.transcript.some((query) => query.includes("e5b-090")), true);
});

test("Task 9 apply is migration-only and commits only after catalog checks", async () => {
  const client = fakeClient();
  const result = await runE5bDatabaseCommand("apply", BOOTSTRAP_URL, {
    sourceCheck: async () => ({ ok: true }),
    readMigrationSources: async () => MIGRATIONS,
    createClient: () => client,
    catalog: async () => ({ catalogValidated: true, empty: true }),
  });

  assert.equal(result.applied, true);
  assert.equal(result.migrationsApplied, 3);
  assert.equal(client.transcript.filter((query) => /^commit\s*$/i.test(query.trim())).length, 1);
  assert.equal(client.transcript.filter((query) => /^rollback\s*$/i.test(query.trim())).length, 0);
});

test("Task 9 catalog is read-only and requires bootstrap identity", async () => {
  const client = fakeClient();
  const result = await runE5bDatabaseCommand("catalog", BOOTSTRAP_URL, {
    sourceCheck: async () => ({ ok: true }),
    createClient: () => client,
    catalog: async () => ({ catalogValidated: true, empty: true }),
  });

  assert.equal(result.readOnly, true);
  assert.equal(client.transcript.some((query) => /^begin read only$/i.test(query.trim())), true);
  assert.equal(client.transcript.filter((query) => /^commit\s*$/i.test(query.trim())).length, 0);
});

test("Task 10 runtime validation uses pooled application credentials and redacts credentials", async () => {
  const runtimeClient = fakeClient({ identity: { current_user: "hotel_ld_application", session_user: "hotel_ld_application" } });
  const result = await runE5bRuntimeValidation({
    bootstrapConnectionString: BOOTSTRAP_URL,
    runtimeConnectionString: RUNTIME_URL,
    createBootstrapClient: () => fakeClient(),
    createRuntimeClient: () => runtimeClient,
    runtimeMatrix: async () => ({ manager: "PASS", crossProperty: "PASS" }),
    catalog: async () => ({ catalogValidated: true, empty: true }),
  });

  assert.equal(result.runtimeRole, "hotel_ld_application");
  assert.deepEqual(result.matrix, { manager: "PASS", crossProperty: "PASS" });
  assert.equal(JSON.stringify(result).includes("fixture-secret"), false);
  assert.equal(JSON.stringify(result).includes("postgresql://"), false);
  assert.equal(runtimeClient.transcript.some((query) => query.includes("e5b:identity")), true);
});
