import { parseAppEnvironment } from "../../../lib/environment.ts";
import { homeForRole } from "../../../services/auth-routing.ts";
import { authenticateSyntheticAccount, resolveAccountForLogin } from "../../../services/authentication-service.ts";
import type { AuthSession } from "../../../repositories/contracts/auth-repository.ts";
import { createMockSession } from "../mock-session-store.ts";
import { sessionCookie } from "../cookies.ts";

export async function POST(request:Request){
  const environment=parseAppEnvironment();
  const body=await safeJson(request);const loginId=typeof body.loginId==="string"?body.loginId.trim():"";const password=typeof body.password==="string"?body.password:"";
  if(!loginId||password.length<8)return failure();
  const hostname=hostnameForRequest(request,environment.appEnv==="local"?environment.devPropertyHostname:null);
  try{
    if(environment.appEnv==="local"&&environment.dataMode==="mock"){
      const session=await authenticateSyntheticAccount({loginId,password,hostname,appEnv:environment.appEnv,dataMode:environment.dataMode});
      const token=createMockSession(session);return success(session,token,false);
    }
    const resolved=await resolveAccountForLogin({loginId,password,hostname});
    if(!resolved.accessToken)return failure();
    return success(resolved.session,resolved.accessToken,true);
  }catch{return failure()}
}

function success(session:AuthSession,token:string,secure:boolean){return Response.json({...session,destination:homeForRole(session.role)},{headers:{"Cache-Control":"no-store","Set-Cookie":sessionCookie(token,secure)}})}
function failure(){return Response.json({message:"账号或密码错误"},{status:401,headers:{"Cache-Control":"no-store"}})}
async function safeJson(request:Request):Promise<Record<string,unknown>>{try{return await request.json()}catch{return{}}}
function hostnameForRequest(request:Request,override:string|null){if(override)return override;const forwarded=request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();return(forwarded||request.headers.get("host")||new URL(request.url).hostname).split(":")[0].toLowerCase()}
