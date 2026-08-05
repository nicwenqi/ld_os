import "server-only";

import { Pool, type PoolConfig } from "pg";

let pool: Pool | null = null;

const APPROVED_DEVELOPMENT_ENDPOINT_ID = "ep-sparkling-shape-az9gxtuh";
const PRODUCTION_ENDPOINT_DENY_LIST = new Set([
  "ep-wild-wave-azjmgdif",
]);

export function createNeonPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    const expectedEndpointId = process.env.NEON_ENDPOINT_ID?.trim();

    if (!connectionString) {
      throw new Error("DATABASE_URL 未配置");
    }
    if (!expectedEndpointId) {
      throw new Error("NEON_ENDPOINT_ID 未配置");
    }

    assertRuntimeConnection(connectionString, expectedEndpointId);

    const poolConfig: PoolConfig & { enableChannelBinding: boolean } = {
      connectionString,
      ssl: {
        rejectUnauthorized: true,
      },
      enableChannelBinding: true,
      max: 10,
      connectionTimeoutMillis: 5_000,
    };
    pool = new Pool(poolConfig);
  }

  return pool;
}

function assertRuntimeConnection(connectionString: string, expectedEndpointId: string) {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL 格式无效");
  }

  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error("DATABASE_URL 必须使用 PostgreSQL 协议");
  }
  if (!/^ep-[a-z0-9-]+$/.test(expectedEndpointId)) {
    throw new Error("NEON_ENDPOINT_ID 格式无效");
  }
  if (PRODUCTION_ENDPOINT_DENY_LIST.has(expectedEndpointId)) {
    throw new Error("禁止连接 Production Neon endpoint");
  }
  if (expectedEndpointId !== APPROVED_DEVELOPMENT_ENDPOINT_ID) {
    throw new Error("Neon endpoint 未列入当前 development allow-list");
  }
  const sslMode = parsed.searchParams.get("sslmode");
  if (["disable", "prefer", "no-verify"].includes(sslMode ?? "")) {
    throw new Error("Neon runtime 禁止关闭 TLS 证书校验");
  }
  if (
    parsed.searchParams.get("uselibpqcompat") === "true" &&
    sslMode !== "verify-full"
  ) {
    throw new Error("Neon runtime 的 libpq TLS 模式必须为 verify-full");
  }

  if (!parsed.hostname.endsWith(".neon.tech")) {
    throw new Error("DATABASE_URL 必须使用 Neon 官方 endpoint hostname");
  }

  const endpointHost = parsed.hostname.split(".")[0]?.replace(/-pooler$/, "");
  if (endpointHost !== expectedEndpointId) {
    throw new Error("DATABASE_URL 与 NEON_ENDPOINT_ID 不匹配");
  }
  if (decodeURIComponent(parsed.username) !== "hotel_ld_application") {
    throw new Error("Neon runtime 必须使用 hotel_ld_application role");
  }
  if (!decodeURIComponent(parsed.password)) {
    throw new Error("Neon runtime application credential 未配置");
  }
  if (decodeURIComponent(parsed.pathname.replace(/^\//, "")) !== "neondb") {
    throw new Error("Neon runtime database 必须为 neondb");
  }
}
