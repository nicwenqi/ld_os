import "server-only";

import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { Pool } from "pg";

let authPool: Pool | null = null;
let configuredAuth: ReturnType<typeof betterAuth> | null = null;

export function getBetterAuth() {
  if (!configuredAuth) {
    configuredAuth = betterAuth({
      appName: "Hotel L&D OS",
      database: createAuthPool(),
      secret: requiredEnvironment("BETTER_AUTH_SECRET"),
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: false,
      },
      advanced: {
        database: { generateId: () => randomUUID() },
      },
      user: {
        modelName: "auth_user",
        fields: {
          emailVerified: "email_verified",
          createdAt: "created_at",
          updatedAt: "updated_at",
        },
      },
      session: {
        modelName: "auth_session",
        fields: {
          expiresAt: "expires_at",
          createdAt: "created_at",
          updatedAt: "updated_at",
          ipAddress: "ip_address",
          userAgent: "user_agent",
          userId: "user_id",
        },
      },
      account: {
        modelName: "auth_account",
        fields: {
          accountId: "account_id",
          providerId: "provider_id",
          userId: "user_id",
          accessToken: "access_token",
          refreshToken: "refresh_token",
          idToken: "id_token",
          accessTokenExpiresAt: "access_token_expires_at",
          refreshTokenExpiresAt: "refresh_token_expires_at",
          createdAt: "created_at",
          updatedAt: "updated_at",
        },
      },
      verification: {
        modelName: "auth_verification",
        fields: {
          expiresAt: "expires_at",
          createdAt: "created_at",
          updatedAt: "updated_at",
        },
      },
    });
  }
  return configuredAuth;
}

export function createAuthPool() {
  if (!authPool) {
    const connectionString = requiredEnvironment("AUTH_DATABASE_URL");
    assertAuthConnection(connectionString);
    authPool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: true },
      enableChannelBinding: true,
      max: 5,
      connectionTimeoutMillis: 5_000,
    });
  }
  return authPool;
}

export function assertAuthConnection(connectionString: string) {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("AUTH_DATABASE_URL 格式无效");
  }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol) || !parsed.hostname.endsWith(".neon.tech")) {
    throw new Error("AUTH_DATABASE_URL 必须使用 Neon PostgreSQL TLS endpoint");
  }
  if (decodeURIComponent(parsed.username) !== "hotel_ld_auth_service" || !decodeURIComponent(parsed.password)) {
    throw new Error("AUTH_DATABASE_URL 必须使用 hotel_ld_auth_service");
  }
  if (decodeURIComponent(parsed.pathname.replace(/^\//, "")) !== "neondb") {
    throw new Error("AUTH_DATABASE_URL database 必须为 neondb");
  }
  if (["disable", "prefer", "no-verify"].includes(parsed.searchParams.get("sslmode") ?? "")) {
    throw new Error("AUTH_DATABASE_URL 必须启用 TLS 证书校验");
  }
}

function requiredEnvironment(name: "AUTH_DATABASE_URL" | "BETTER_AUTH_SECRET") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 未配置`);
  return value;
}
