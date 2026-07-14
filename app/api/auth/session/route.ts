import { parseAppEnvironment } from "../../../lib/environment.ts";
import { anonymousSession } from "../../../repositories/contracts/auth-repository.ts";
import { resolveSessionForAuthUser } from "../../../services/authentication-service.ts";
import { createServerPasswordClient } from "../../../lib/supabase/server-admin.ts";
import { readCookie } from "../cookies.ts";
import { readMockSession } from "../mock-session-store.ts";

export async function GET(request:Request){
  const environment=parseAppEnvironment();const token=readCookie(request);
  if(environment.appEnv==="local"&&environment.dataMode==="mock")return noStore(readMockSession(token)??anonymousSession);
  if(!token)return noStore(anonymousSession);
  try{const client=createServerPasswordClient();const{data,error}=await client.auth.getUser(token);if(error||!data.user)return noStore(anonymousSession);const hostname=(request.headers.get("x-forwarded-host")?.split(",")[0]||request.headers.get("host")||new URL(request.url).hostname).trim().split(":")[0].toLowerCase();return noStore(await resolveSessionForAuthUser(data.user.id,hostname))}catch{return noStore(anonymousSession)}
}
function noStore(value:unknown){return Response.json(value,{headers:{"Cache-Control":"no-store"}})}
