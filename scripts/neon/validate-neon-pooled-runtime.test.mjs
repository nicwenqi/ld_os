import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVED_NEON_POOLED_RUNTIME_TARGET,
  validatePooledRuntimeConnection,
  runPooledRuntimeReadiness,
} from "./validate-neon-pooled-runtime.mjs";

const validUrl = `postgresql://hotel_ld_application:secret@${APPROVED_NEON_POOLED_RUNTIME_TARGET.pooledHostLabel}.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require`;

test("pooled-runtime guard accepts only the approved application pooler connection", () => {
  assert.deepEqual(validatePooledRuntimeConnection(validUrl, {
    NEON_ENDPOINT_ID: APPROVED_NEON_POOLED_RUNTIME_TARGET.endpointId,
  }), { valid: true });
});

test("pooled-runtime guard rejects direct, wrong-role, and wrong-target runtime connections", () => {
  for (const connectionString of [
    validUrl.replace("-pooler", ""),
    validUrl.replace("hotel_ld_application", "neondb_owner"),
    validUrl.replace("/neondb", "/otherdb"),
  ]) {
    assert.throws(() => validatePooledRuntimeConnection(connectionString, {
      NEON_ENDPOINT_ID: APPROVED_NEON_POOLED_RUNTIME_TARGET.endpointId,
    }), /NEON_POOLED_RUNTIME_TARGET_MISMATCH/);
  }
});

test("pooled runtime reports an endpoint failure as platform-blocked without direct fallback", async () => {
  const result = await runPooledRuntimeReadiness({
    connectionString: validUrl,
    environment: { NEON_ENDPOINT_ID: APPROVED_NEON_POOLED_RUNTIME_TARGET.endpointId },
    poolFactory: () => ({
      connect: async () => {
        const error = new Error("connection reset");
        error.code = "ECONNRESET";
        throw error;
      },
      end: async () => {},
    }),
  });
  assert.deepEqual(result, {
    status: "BLOCKED",
    code: "NEON_POOLED_RUNTIME_PLATFORM_BLOCKED",
    reason: "ECONNRESET",
  });
});

test("pooled runtime fails closed for a credential or query failure instead of mislabeling it platform-blocked", async () => {
  await assert.rejects(runPooledRuntimeReadiness({
    connectionString: validUrl,
    environment: { NEON_ENDPOINT_ID: APPROVED_NEON_POOLED_RUNTIME_TARGET.endpointId },
    poolFactory: () => ({
      connect: async () => {
        const error = new Error("authentication failed");
        error.code = "28P01";
        throw error;
      },
      end: async () => {},
    }),
  }), { code: "NEON_POOLED_RUNTIME_CONNECTION_FAILED_28P01" });
});
