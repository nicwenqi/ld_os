import { parseAppEnvironment } from "../../../lib/environment.ts";
import { homeForRole } from "../../../services/auth-routing.ts";
import { authenticateSyntheticAccount, resolveAccountForLogin } from "../../../services/authentication-service.ts";
import type { AuthSession } from "../../../repositories/contracts/auth-repository.ts";
import { createMockSession } from "../mock-session-store.ts";
import { authCookies } from "../cookies.ts";
import { resolveRequestHostname } from "../../../lib/request-hostname.ts";

export async function POST(request:Request){
  const environment=parseAppEnvironment();
  const body=await safeJson(request);const loginId=typeof body.loginId==="string"?body.loginId.trim():"";const password=typeof body.password==="string"?body.password:"";
  if(!loginId||password.length<8)return failure();
  const hostname=resolveRequestHostname(request,{appEnv:environment.appEnv,appBaseDomain:environment.appBaseDomain,localOverride:environment.appEnv==="local"?environment.devPropertyHostname:environment.appEnv==="preview"?environment.previewPropertyHostname:null});
  if(!hostname)return failure();
  try{
    if(environment.appEnv==="local"&&environment.dataMode==="mock"){
      const session=await authenticateSyntheticAccount({loginId,password,hostname,appEnv:environment.appEnv,dataMode:environment.dataMode});
      const token=createMockSession(session);return success(session,authCookies(token,null,false));
    }
    const resolved=await resolveAccountForLogin({request,loginId,password,hostname,requestId:request.headers.get("x-request-id")??crypto.randomUUID()});
    return success(resolved.session,resolved.refreshedCookies??[]);
  }catch{return failure()}
}

function success(session:AuthSession,cookies:string[]){const headers=new Headers({"Cache-Control":"no-store"});for(const value of cookies)headers.append("Set-Cookie",value);return Response.json({...session,destination:session.mustChangePassword?"/change-password":homeForRole(session.role)},{headers})}
function failure(){return Response.json({message:"账号或密码错误"},{status:401,headers:{"Cache-Control":"no-store"}})}
async function safeJson(request:Request):Promise<Record<string,unknown>>{try{return await request.json()}catch{return{}}}
