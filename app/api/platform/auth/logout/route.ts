import { parseAppEnvironment } from "../../../../lib/environment.ts";
import { expiredPlatformAuthCookies } from "../cookies.ts";
export async function POST() { const environment = parseAppEnvironment(); const headers = new Headers({ "Cache-Control": "no-store, private" }); for (const cookie of expiredPlatformAuthCookies(environment.appEnv !== "local")) headers.append("Set-Cookie", cookie); return Response.json({ authenticated: false }, { headers }); }
