import assert from "node:assert/strict";
import test from "node:test";

import {
  E5B_CATALOG_SQL,
  runE5bRuntimeValidation,
  runE5bRuntimeMatrix,
  runE5bStorageRuntimeValidation,
  validateE5bRuntimeMatrixSource,
} from "./validate-e5b-import-staging.mjs";

function runtimeClient({ actor = null } = {}) {
  let currentActor = actor;
  let inTransaction = false;
  const transcript = [];
  return {
    transcript,
    async query(query, values = []) {
      const text = typeof query === "string" ? query : query.text;
      transcript.push(text);
      if (/^begin(?:\s+read\s+only)?$/i.test(text.trim())) { inTransaction = true; return { rows: [] }; }
      if (/^rollback$/i.test(text.trim())) { inTransaction = false; currentActor = null; return { rows: [] }; }
      if (/set_config\('app\.actor_auth_user_id'/i.test(text)) { currentActor = values[0] ?? null; return { rows: [] }; }
      if (/current_setting\('app\.actor_auth_user_id'/i.test(text)) return { rows: [{ actor: currentActor, clean: currentActor === null }] };
      if (/current_setting\('app\.actor_request_id'/i.test(text)) return { rows: [{ clean: currentActor === null }] };
      if (/^savepoint\s+/i.test(text) || /^rollback to savepoint/i.test(text)) return { rows: [] };
      if (/^(select|insert|update|delete)\b[\s\S]*\bpublic\.import_batches\b/i.test(text)) {
        const error = new Error("permission denied for relation import_batches");
        error.code = "42501";
        throw error;
      }
      if (!inTransaction) throw new Error("RUNTIME_FIXTURE_TRANSACTION_REQUIRED");
      return { rows: [] };
    },
  };
}

test("runtime source gate requires denial probes, transaction cleanup and no fallback", () => {
  assert.doesNotThrow(() => validateE5bRuntimeMatrixSource());
  assert.match(E5B_CATALOG_SQL, /raw_application_catalog_privileges_zero/);
});

test("runtime matrix proves raw denial and actor cleanup without SET ROLE", async () => {
  const client = runtimeClient();
  const poolClients = [runtimeClient(), runtimeClient()];
  const runtimePool = {
    async connect() {
      const client = poolClients.shift();
      return { ...client, release() {} };
    },
  };
  const result = await runE5bRuntimeMatrix({ runtimeClient: client, runtimePool });
  assert.equal(result.rawTableReadDenied, "PASS");
  assert.equal(result.rawTableWriteDenied, "PASS");
  assert.equal(result.actorContextIsolation, "PASS");
  assert.equal(result.connectionReuse, "PASS");
  assert.equal(result.fallback, "OFF");
  assert.equal(client.transcript.some(query => /\bset\s+role\b/i.test(query)), false);
});

test("runtime validation wires an injected pooled application pool to the default matrix", async () => {
  const identityClient = role => {
    const base = runtimeClient();
    return {
      ...base,
      async query(query, values = []) {
        const text = typeof query === "string" ? query : query.text;
        if (text.includes("e5b:identity")) return { rows: [{ server_version_num: 180000, database: "neondb", database_owner: "neondb_owner", current_user: role, session_user: role }] };
        return base.query(query, values);
      },
    };
  };
  const poolClients = [runtimeClient(), runtimeClient()];
  let ended = false;
  const runtimePool = {
    async connect() { const client = poolClients.shift(); return { ...client, release() {} }; },
    async end() { ended = true; },
  };
  const result = await runE5bRuntimeValidation({
    bootstrapConnectionString: "postgresql://neondb_owner:fixture@ep-frosty-math-audxlq88.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
    runtimeConnectionString: "postgresql://hotel_ld_application:fixture@ep-frosty-math-audxlq88-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
    sourceCheck: async () => ({ ok: true }),
    createBootstrapClient: async () => identityClient("neondb_owner"),
    createRuntimeClient: async () => identityClient("hotel_ld_application"),
    runtimePool,
    catalog: async () => ({ catalogValidated: true, rowsEmpty: true }),
  });
  assert.equal(result.matrix.fallback, "OFF");
  assert.equal(result.matrix.concurrentActorIsolation, "PASS");
  assert.equal(ended, false, "caller-owned injected pool must not be closed by the validator");
});

test("Storage runtime remains synthetic-adapter-only and returns redacted matrix", async () => {
  const result = await runE5bStorageRuntimeValidation({
    storageMatrix: async () => ({
      readBackChecksum: "PASS",
      readBackSize: "PASS",
      contentMime: "PASS",
      cleanupRetry: "PASS",
      exactPath: "PASS",
    }),
  });
  assert.equal(result.mode, "synthetic");
  assert.equal(result.cleanupRetry, "PASS");
  assert.equal(JSON.stringify(result).includes("postgresql://"), false);
});
