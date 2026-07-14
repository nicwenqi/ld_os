import { parseAppEnvironment } from "../../../lib/environment.ts";
import { anonymousSession } from "../../../repositories/contracts/auth-repository.ts";
import { expiredSessionCookie, readCookie } from "../cookies.ts";
import { removeMockSession } from "../mock-session-store.ts";

export async function POST(request:Request){const environment=parseAppEnvironment();if(environment.appEnv==="local"&&environment.dataMode==="mock")removeMockSession(readCookie(request));return Response.json(anonymousSession,{headers:{"Cache-Control":"no-store","Set-Cookie":expiredSessionCookie(environment.appEnv!=="local")}})}
