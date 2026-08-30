import "server-only";

type AuthHandler = (request: Request) => Promise<Response>;

export type BetterAuthIdentity = Readonly<{
  userId: string;
  refreshedCookies: string[];
}>;

export async function signInWithBetterAuth(input: {
  request: Request;
  loginId: string;
  password: string;
  hostname: string;
  handler?: AuthHandler;
  deriveAuthEmail?: (loginId: string, hostname: string) => string;
}): Promise<BetterAuthIdentity | null> {
  const email = input.deriveAuthEmail
    ? input.deriveAuthEmail(input.loginId.trim().toLowerCase(), input.hostname.trim().toLowerCase())
    : (await import("../lib/auth/deterministic-login-identity.ts"))
      .deriveDeterministicAuthEmail(input.loginId.trim().toLowerCase(), input.hostname.trim().toLowerCase());
  const handler = input.handler ?? (await import("../lib/auth/better-auth.ts")).getBetterAuth().handler;
  const response = await handler(sameOriginRequest(input.request, "/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: input.password, rememberMe: true }),
  }));
  if (!response.ok) return null;
  const payload = await safeJson(response);
  const userId = userIdFromPayload(payload);
  return userId ? { userId, refreshedCookies: responseCookies(response.headers) } : null;
}

export async function resolveBetterAuthIdentity(request: Request): Promise<BetterAuthIdentity | null> {
  return resolveBetterAuthIdentityWith({ request, handler: (await import("../lib/auth/better-auth.ts")).getBetterAuth().handler });
}

export async function resolveBetterAuthIdentityWith(input: {
  request: Request;
  handler: AuthHandler;
}): Promise<BetterAuthIdentity | null> {
  const response = await input.handler(sameOriginRequest(input.request, "/api/auth/get-session", { method: "GET" }));
  if (!response.ok) return null;
  const payload = await safeJson(response);
  const userId = userIdFromPayload(payload);
  return userId ? { userId, refreshedCookies: responseCookies(response.headers) } : null;
}

export async function signOutWithBetterAuth(request: Request): Promise<string[]> {
  const response = await (await import("../lib/auth/better-auth.ts")).getBetterAuth().handler(sameOriginRequest(request, "/api/auth/sign-out", { method: "POST" }));
  return response.ok ? responseCookies(response.headers) : [];
}

function sameOriginRequest(source: Request, path: string, init: RequestInit) {
  const headers = new Headers(source.headers);
  for (const [name, value] of Object.entries(init.headers ?? {})) headers.set(name, value);
  headers.set("origin", new URL(source.url).origin);
  return new Request(new URL(path, source.url), { ...init, headers });
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function userIdFromPayload(value: unknown) {
  if (!isRecord(value) || !isRecord(value.user)) return null;
  return uuidSubject(value.user.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uuidSubject(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function responseCookies(headers: Headers) {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") return getSetCookie.call(headers);
  const cookie = headers.get("set-cookie");
  return cookie ? [cookie] : [];
}
