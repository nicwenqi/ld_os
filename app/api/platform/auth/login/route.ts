import { parseAppEnvironment } from "../../../../lib/environment.ts";
import { authenticatePlatformProvisioner } from "../../../../services/platform-authorization.ts";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const identifier = typeof body.identifier === "string" ? body.identifier : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!identifier.trim() || password.length < 8) return failure(401, "账号或密码错误");
    const result = await authenticatePlatformProvisioner({ identifier, password });
    const headers = new Headers({ "Cache-Control": "no-store, private" }); for (const cookie of result.cookies) headers.append("Set-Cookie", cookie);
    return Response.json({ authenticated: true, displayName: result.displayName, destination: "/platform/properties/new" }, { headers });
  } catch (error) { return failure(401, error instanceof Error ? error.message : "账号或密码错误"); }
}
function failure(status: number, message: string) { return Response.json({ message }, { status, headers: { "Cache-Control": "no-store, private" } }); }
