import { parseAppEnvironment } from "../../../lib/environment.ts";
import { anonymousSession } from "../../../repositories/contracts/auth-repository.ts";
import { expiredAuthCookies, readCookie } from "../cookies.ts";
import { removeMockSession } from "../mock-session-store.ts";

export async function POST(request:Request){const environment=parseAppEnvironment();if(environment.appEnv==="local"&&environment.dataMode==="mock")removeMockSession(readCookie(request));const headers=new Headers({"Cache-Control":"no-store"});for(const value of expiredAuthCookies(environment.appEnv!=="local"))headers.append("Set-Cookie",value);return Response.json(anonymousSession,{headers})}
