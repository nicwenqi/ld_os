import { Pool } from "pg";
import { fileURLToPath } from "node:url";

export const APPROVED_NEON_POOLED_RUNTIME_TARGET = Object.freeze({
  projectId: "withered-bar-40598816",
  branchId: "br-wispy-flower-avd4hssa",
  endpointId: "ep-lingering-pine-avbdti90",
  database: "neondb",
  pooledHostLabel: "ep-lingering-pine-avbdti90-pooler",
  applicationRole: "hotel_ld_application",
});

function targetError() {
  const error = new Error("NEON_POOLED_RUNTIME_TARGET_MISMATCH");
  error.code = "NEON_POOLED_RUNTIME_TARGET_MISMATCH";
  return error;
}

function normalizedProtocol(protocol) {
  return protocol.replace(":", "").toLowerCase();
}

export function validatePooledRuntimeConnection(connectionString, environment = process.env) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw targetError();
  }
  const sslmode = url.searchParams.get("sslmode")?.toLowerCase();
  if (![
    "postgres", "postgresql",
  ].includes(normalizedProtocol(url.protocol))
    || url.hostname.split(".")[0] !== APPROVED_NEON_POOLED_RUNTIME_TARGET.pooledHostLabel
    || !url.hostname.endsWith(".neon.tech")
    || decodeURIComponent(url.username) !== APPROVED_NEON_POOLED_RUNTIME_TARGET.applicationRole
    || url.pathname !== `/${APPROVED_NEON_POOLED_RUNTIME_TARGET.database}`
    || environment.NEON_ENDPOINT_ID !== APPROVED_NEON_POOLED_RUNTIME_TARGET.endpointId
    || !["require", "verify-ca", "verify-full"].includes(sslmode ?? "")) {
    throw targetError();
  }
  return { valid: true };
}

function blockReason(error) {
  const code = typeof error?.code === "string" ? error.code : "UNKNOWN";
  return ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENETUNREACH"].includes(code)
    ? code
    : "UNAVAILABLE";
}

function connectionFailure(error) {
  const reason = typeof error?.code === "string" && /^[A-Z0-9_]{2,64}$/u.test(error.code)
    ? error.code
    : "UNKNOWN";
  const failure = new Error("NEON_POOLED_RUNTIME_CONNECTION_FAILED");
  failure.code = `NEON_POOLED_RUNTIME_CONNECTION_FAILED_${reason}`;
  return failure;
}

export async function runPooledRuntimeReadiness({
  connectionString = process.env.DATABASE_URL,
  environment = process.env,
  poolFactory = config => new Pool(config),
} = {}) {
  validatePooledRuntimeConnection(connectionString, environment);
  const pool = poolFactory({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        "select current_user = 'hotel_ld_application' and session_user = 'hotel_ld_application' as application_role",
      );
      if (result.rows?.[0]?.application_role !== true) throw targetError();
      return { status: "PASS", code: "NEON_POOLED_RUNTIME_READY" };
    } finally {
      client.release();
    }
  } catch (error) {
    if (error?.code === "NEON_POOLED_RUNTIME_TARGET_MISMATCH") throw error;
    if (![
      "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENETUNREACH",
    ].includes(error?.code)) throw connectionFailure(error);
    return {
      status: "BLOCKED",
      code: "NEON_POOLED_RUNTIME_PLATFORM_BLOCKED",
      reason: blockReason(error),
    };
  } finally {
    await pool.end();
  }
}

async function main() {
  if (process.argv[2] !== "live") {
    console.error("NEON_POOLED_RUNTIME_USAGE:live");
    process.exitCode = 1;
    return;
  }
  try {
    const result = await runPooledRuntimeReadiness();
    console.log(`NEON_POOLED_RUNTIME_STATUS=${result.status}`);
    console.log(`NEON_POOLED_RUNTIME_CODE=${result.code}`);
    if (result.status !== "PASS") process.exitCode = 2;
  } catch (error) {
    console.error(error?.code ?? "NEON_POOLED_RUNTIME_FAILED");
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
