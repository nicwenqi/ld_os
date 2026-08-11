import { parseAppEnvironment } from "../../../lib/environment.ts";
import { anonymousSession } from "../../../repositories/contracts/auth-repository.ts";
import { readCookie } from "../cookies.ts";
import { removeMockSession } from "../mock-session-store.ts";
import { signOutWithBetterAuth } from "../../../services/better-auth-session.ts";

export async function POST(request:Request){const environment=parseAppEnvironment();const headers=new Headers({"Cache-Control":"no-store"});if(environment.appEnv==="local"&&environment.dataMode==="mock")removeMockSession(readCookie(request));else for(const value of await signOutWithBetterAuth(request))headers.append("Set-Cookie",value);return Response.json(anonymousSession,{headers})}
