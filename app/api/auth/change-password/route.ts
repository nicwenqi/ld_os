import { parseAppEnvironment } from "../../../lib/environment.ts";
import { getBetterAuth } from "../../../lib/auth/better-auth.ts";
import { resolvePasswordChangeRequest } from "../../../services/request-authentication.ts";
import { validateBackendPassword } from "../../../services/account-administration.ts";

export async function POST(request: Request) {
  try {
    if (parseAppEnvironment().dataMode === "mock") return failure(404, "本地验证账号不需要修改密码");
    const resolved = await resolvePasswordChangeRequest(request);
    if (!resolved?.session.userId) return failure(401, "登录已失效，请重新登录");
    const body = await request.json() as Record<string, unknown>;
    const password = typeof body.password === "string" ? body.password : "";
    validateBackendPassword(password);
    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    headers.set("origin", new URL(request.url).origin);
    const result = await getBetterAuth().handler(new Request(new URL("/api/auth/change-password", request.url), {
      method: "POST",
      headers,
      body: JSON.stringify({ newPassword: password }),
    }));
    if (!result.ok) return failure(422, "密码修改失败，请重新登录后重试");
    const responseHeaders = new Headers({ "Cache-Control": "no-store, private" });
    for (const cookie of cookies(result.headers)) responseHeaders.append("Set-Cookie", cookie);
    return Response.json({ changed: true }, { headers: responseHeaders });
  } catch (error) {
    return failure(422, error instanceof Error ? error.message : "密码修改失败，请重试");
  }
}

function cookies(headers: Headers) {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") return getSetCookie.call(headers);
  const cookie = headers.get("set-cookie");
  return cookie ? [cookie] : [];
}

function failure(status: number, message: string) {
  return Response.json({ message }, { status, headers: { "Cache-Control": "no-store, private" } });
}
