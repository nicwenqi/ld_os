import { createServerActorClient } from "../../../lib/supabase/server-admin.ts";
import { parseInitializationAccessSummary } from "../../../services/initialization-access-projection.ts";
import { AuthorizationError, requirePropertyManager } from "../../../services/production-authorization.ts";

export async function GET(request:Request){
  try{
    const actor=await requirePropertyManager(request);
    const requested=new URL(request.url).searchParams.get("propertyId");
    if(requested&&requested!==actor.propertyId)return failure(403,"不能读取其他酒店的管理员状态");
    const client=createServerActorClient(actor.accessToken);
    const {data,error}=await client.rpc("get_property_initialization_access_summary",{
      p_property_id:actor.propertyId,
    });
    const summary=parseInitializationAccessSummary(data);
    if(error||!summary)throw new Error("管理员状态读取失败");
    const headers=new Headers({"Cache-Control":"no-store, private"});
    for(const value of actor.refreshedCookies)headers.append("Set-Cookie",value);
    return Response.json(summary,{headers});
  }catch(error){if(error instanceof AuthorizationError)return failure(error.status,error.message);return failure(422,error instanceof Error?error.message:"无法读取管理员状态");}
}

function failure(status:number,message:string){return Response.json({message},{status,headers:{"Cache-Control":"no-store, private"}})}
