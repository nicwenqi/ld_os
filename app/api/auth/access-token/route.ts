import { authCookies } from "../cookies.ts";
import { resolveAuthenticatedRequest } from "../../../services/request-authentication.ts";

export async function GET(request: Request) {
  const resolved = await resolveAuthenticatedRequest(request);
  if (!resolved) return Response.json({ message: "登录状态已失效" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (resolved.refreshed) {
    for (const value of authCookies(resolved.accessToken, resolved.refreshToken, true)) headers.append("Set-Cookie", value);
  }
  return Response.json({ accessToken: resolved.accessToken }, { headers });
}
