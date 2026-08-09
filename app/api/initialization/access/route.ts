import { createServerAdminClient } from "../../../lib/supabase/server-admin.ts";
import { AuthorizationError, requirePropertyManager } from "../../../services/production-authorization.ts";
import { parseAppEnvironment } from "../../../lib/environment.ts";
import { resolveRequestId } from "../../../lib/neon/request-id.ts";
import { propertyErrorResponse, runAuthorizedNeonInitialization } from "../../../services/neon-property-authorization.ts";

type RoleRelation = { code?: string } | Array<{ code?: string }> | null;

export async function GET(request:Request){
  if (parseAppEnvironment().dataMode === "neon") {
    const requestId = resolveRequestId(request);
    try {
      const result = await runAuthorizedNeonInitialization(request, requestId, repository => repository.getAccessSummary("server"));
      return Response.json(result.data, { headers: result.headers });
    } catch (error) {
      return propertyErrorResponse(error, requestId);
    }
  }
  try{
    const actor=await requirePropertyManager(request);
    const requested=new URL(request.url).searchParams.get("propertyId");
    if(requested&&requested!==actor.propertyId)return failure(403,"不能读取其他酒店的管理员状态");
    const admin=createServerAdminClient();
    const [{data:assignments,error:assignmentError},{data:memberships,error:membershipError},{data:accounts,error:accountError}]=await Promise.all([
      admin.from("role_assignments").select("user_id,status,roles!inner(code,is_active)").eq("property_id",actor.propertyId).eq("status","active").eq("roles.is_active",true).in("roles.code",["property_ld_manager","department_training_admin"]),
      admin.from("property_memberships").select("user_id,status").eq("property_id",actor.propertyId).eq("status","active"),
      admin.from("user_accounts").select("user_id,auth_user_id,login_id,account_status,profiles(display_name,is_active)").eq("property_id",actor.propertyId),
    ]);
    if(assignmentError||membershipError||accountError)throw new Error("管理员状态读取失败");
    const activeMembers=new Set((memberships??[]).map(item=>item.user_id));
    const activeAccounts=new Map((accounts??[]).filter(item=>item.account_status==="active"&&relationOne(item.profiles)?.is_active===true).map(item=>[item.user_id,item]));
    const roleCode=(assignment:{roles:RoleRelation})=>relationOne(assignment.roles)?.code;
    const activeAssignments=(assignments??[]).filter(item=>activeMembers.has(item.user_id)&&activeAccounts.has(item.user_id));
    const current=(accounts??[]).find(item=>item.auth_user_id===actor.authUserId)??null;
    const profile=relationOne(current?.profiles);
    const headers=new Headers({"Cache-Control":"no-store, private"});
    for(const value of actor.refreshedCookies)headers.append("Set-Cookie",value);
    const activePropertyManagers=new Set(activeAssignments.filter(item=>roleCode(item)==="property_ld_manager").map(item=>item.user_id)).size;
    return Response.json({
      currentManager:current&&profile?{displayName:profile.display_name,loginId:current.login_id,accountStatus:current.account_status}:null,
      activePropertyManagers,
      activeDepartmentAdministrators:new Set(activeAssignments.filter(item=>roleCode(item)==="department_training_admin").map(item=>item.user_id)).size,
      canConfirm:activePropertyManagers>0,
    },{headers});
  }catch(error){if(error instanceof AuthorizationError)return failure(error.status,error.message);return failure(422,error instanceof Error?error.message:"无法读取管理员状态");}
}

function relationOne<T>(value:T|T[]|null|undefined):T|null{return Array.isArray(value)?value[0]??null:value??null}
function failure(status:number,message:string){return Response.json({message},{status,headers:{"Cache-Control":"no-store, private"}})}
