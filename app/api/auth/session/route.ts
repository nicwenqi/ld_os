import { parseAppEnvironment } from "../../../lib/environment.ts";
import { anonymousSession } from "../../../repositories/contracts/auth-repository.ts";
import { resolveSessionForAuthUser } from "../../../services/authentication-service.ts";
import { readCookie } from "../cookies.ts";
import { readMockSession } from "../mock-session-store.ts";
import { resolveRequestAuthIdentity } from "../../../services/request-authentication.ts";

export async function GET(request:Request){
  const environment=parseAppEnvironment();const token=readCookie(request);
  if(environment.appEnv==="local"&&environment.dataMode==="mock")return noStore(readMockSession(token)??anonymousSession);
  if(!token&&!request.headers.get("cookie"))return noStore(anonymousSession);
  try{const identity=await resolveRequestAuthIdentity(request);if(!identity)return noStore(anonymousSession);const headers=new Headers({"Cache-Control":"no-store"});for(const value of identity.refreshedCookies)headers.append("Set-Cookie",value);return Response.json(await resolveSessionForAuthUser(identity.userId,identity.hostname,request.headers.get("x-request-id")??crypto.randomUUID()),{headers})}catch{return noStore(anonymousSession)}
}
function noStore(value:unknown){return Response.json(value,{headers:{"Cache-Control":"no-store"}})}
