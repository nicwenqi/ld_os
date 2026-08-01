import { parseAppEnvironment } from "../../../lib/environment.ts";
import { anonymousSession } from "../../../repositories/contracts/auth-repository.ts";
import { resolveSessionForAccessToken } from "../../../services/authentication-service.ts";
import { authCookies, readCookie, readRefreshCookie } from "../cookies.ts";
import { readMockSession } from "../mock-session-store.ts";
import { resolveRequestAuthIdentity } from "../../../services/request-authentication.ts";

export async function GET(request:Request){
  const environment=parseAppEnvironment();const token=readCookie(request);
  if(environment.appEnv==="local"&&environment.dataMode==="mock")return noStore(readMockSession(token)??anonymousSession);
  if(!token&&!readRefreshCookie(request))return noStore(anonymousSession);
  try{const identity=await resolveRequestAuthIdentity(request);if(!identity)return noStore(anonymousSession);const headers=new Headers({"Cache-Control":"no-store"});if(identity.refreshed)for(const value of authCookies(identity.accessToken,identity.refreshToken,environment.appEnv!=="local"))headers.append("Set-Cookie",value);return Response.json(await resolveSessionForAccessToken(identity.accessToken,identity.hostname),{headers})}catch{return noStore(anonymousSession)}
}
function noStore(value:unknown){return Response.json(value,{headers:{"Cache-Control":"no-store"}})}
