import type { AuthRepository, AuthSession, LoginInput } from "../contracts/auth-repository.ts";

export function createHttpAuthRepository(): AuthRepository {
  return {
    async login(input: LoginInput) {
      return request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    },
    async getSession() { return request("/api/auth/session"); },
    async logout() { await request("/api/auth/logout", { method: "POST" }); },
  };
}

async function request(url: string, init?: RequestInit): Promise<AuthSession> {
  const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store" });
  const payload = await response.json() as AuthSession & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "登录服务暂时不可用，请稍后重试");
  return payload;
}
