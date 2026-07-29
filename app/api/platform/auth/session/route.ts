import { requirePlatformProvisioner } from "../../../../services/platform-authorization.ts";
export async function GET(request: Request) {
  try { const actor = await requirePlatformProvisioner(request); const headers = new Headers({ "Cache-Control": "no-store, private" }); for (const cookie of actor.refreshedCookies) headers.append("Set-Cookie", cookie); return Response.json({ authenticated: true, displayName: actor.displayName }, { headers }); }
  catch { return Response.json({ authenticated: false }, { headers: { "Cache-Control": "no-store, private" } }); }
}
