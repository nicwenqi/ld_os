import type { AppDataMode, AppEnvironmentName } from "../lib/environment.ts";
import type { AuthSession, EffectiveRole } from "../repositories/contracts/auth-repository.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

type SyntheticAccount = {
  loginId: string;
  password: string;
  displayName: string;
  role: EffectiveRole;
  status: "active" | "disabled";
  propertyId: string | null;
};

const syntheticAccounts: readonly SyntheticAccount[] = [
  { loginId: "platform-admin", password: "HotelDemo2026", displayName: "平台管理员（合成）", role: "platform_admin", status: "active", propertyId: "synthetic-property-a1" },
  { loginId: "property-manager", password: "HotelDemo2026", displayName: "学习与发展经理（合成）", role: "property_ld_manager", status: "active", propertyId: "synthetic-property-a1" },
  { loginId: "department-admin", password: "HotelDemo2026", displayName: "部门培训管理员（合成）", role: "department_training_admin", status: "active", propertyId: "synthetic-property-a1" },
  { loginId: "employee", password: "HotelDemo2026", displayName: "员工学员（合成）", role: "employee", status: "active", propertyId: "synthetic-property-a1" },
  { loginId: "unauthorized-user", password: "HotelDemo2026", displayName: "待授权账号（合成）", role: "unauthorized", status: "active", propertyId: null },
  { loginId: "disabled-user", password: "HotelDemo2026", displayName: "已停用账号（合成）", role: "employee", status: "disabled", propertyId: "synthetic-property-a1" },
];

export async function authenticateSyntheticAccount(input: { loginId: string; password: string; hostname: string; appEnv: AppEnvironmentName; dataMode: AppDataMode }): Promise<AuthSession> {
  if (input.appEnv !== "local" || input.dataMode !== "mock") throw new Error("本地合成登录不可用");
  const loginId = input.loginId.trim().toLowerCase();
  const account = syntheticAccounts.find(candidate => candidate.loginId === loginId);
  if (!account || account.password !== input.password || account.status !== "active") throw new Error("账号或密码错误");
  if (input.hostname !== "training-demo.example.test" && input.hostname !== "localhost" && input.hostname !== "127.0.0.1") throw new Error("当前账号无权访问此酒店");
  return {
    authenticated: true,
    userId: `synthetic-${account.loginId}`,
    displayName: account.displayName,
    propertyId: account.propertyId,
    propertyNameZh: "示范酒店",
    propertyNameEn: "Synthetic Hotel",
    propertyLogoUrl: null,
    role: account.role,
    mustChangePassword: false,
  };
}

export type ResolvedAccount = { session: AuthSession; internalEmail: string; accessToken?: string };

export async function resolveAccountForLogin(input: { loginId: string; password: string; hostname: string }): Promise<ResolvedAccount> {
  const [{ createServerAdminClient, createServerPasswordClient }, { parseAppEnvironment }] = await Promise.all([
    import("../lib/supabase/server-admin.ts"), import("../lib/environment.ts"),
  ]);
  const environment = parseAppEnvironment();
  if (environment.appEnv === "local" && environment.dataMode === "mock") {
    return { session: await authenticateSyntheticAccount({ ...input, appEnv: environment.appEnv, dataMode: environment.dataMode }), internalEmail: "local-only@example.test" };
  }
  const admin = createServerAdminClient();
  const hostname = input.hostname.trim().toLowerCase().split(":")[0];
  const { data: domain } = await admin.from("property_domains").select("tenant_id,property_id,properties(name_zh,name_en),is_active,verification_status").eq("hostname", hostname).eq("is_primary", true).maybeSingle();
  if (!domain || !domain.is_active || domain.verification_status !== "verified") throw genericLoginError();
  const { data: account } = await admin.from("user_accounts").select("user_id,auth_user_id,tenant_id,property_id,account_status,must_change_password,locked_until,profiles(email,display_name,is_active)").eq("property_id", domain.property_id).eq("normalized_login_id", input.loginId.trim().toLowerCase()).maybeSingle();
  const profile = relationOne(account?.profiles);
  if (!account || !profile || account.account_status !== "active" || profile.is_active !== true || (account.locked_until && Date.parse(account.locked_until) > Date.now())) throw genericLoginError();
  const passwordClient = createServerPasswordClient();
  const { data: auth, error } = await passwordClient.auth.signInWithPassword({ email: profile.email, password: input.password });
  if (error || !auth.user || auth.user.id !== account.auth_user_id || !auth.session) throw genericLoginError();
  const session = await resolveSessionForAuthUser(account.auth_user_id, hostname);
  await admin.from("user_accounts").update({ last_login_at: new Date().toISOString(), failed_login_count: 0 }).eq("auth_user_id", account.auth_user_id).eq("property_id", account.property_id);
  return { session, internalEmail: profile.email, accessToken: auth.session.access_token };
}

export async function resolveSessionForAuthUser(authUserId: string, hostname: string): Promise<AuthSession> {
  const { createServerAdminClient } = await import("../lib/supabase/server-admin.ts");
  const admin = createServerAdminClient();
  const normalizedHostname = hostname.trim().toLowerCase().split(":")[0];
  const { data: domain } = await admin.from("property_domains").select("tenant_id,property_id,properties(name_zh,name_en),is_active,verification_status").eq("hostname", normalizedHostname).eq("is_primary", true).maybeSingle();
  if (!domain || !domain.is_active || domain.verification_status !== "verified") return unauthorizedSession();
  const { data: account } = await admin.from("user_accounts").select("user_id,property_id,account_status,must_change_password,locked_until,profiles(display_name,is_active)").eq("auth_user_id", authUserId).eq("property_id", domain.property_id).maybeSingle();
  const profile = relationOne(account?.profiles);
  if (!account || !profile || account.account_status !== "active" || profile.is_active !== true || (account.locked_until && Date.parse(account.locked_until) > Date.now())) return unauthorizedSession();
  const { data: tenantMembership } = await admin.from("tenant_memberships").select("status").eq("tenant_id", domain.tenant_id).eq("user_id", account.user_id).maybeSingle();
  const { data: propertyMembership } = await admin.from("property_memberships").select("status").eq("property_id", domain.property_id).eq("user_id", account.user_id).maybeSingle();
  if (tenantMembership?.status !== "active" || propertyMembership?.status !== "active") return unauthorizedSession(true, profile.display_name);
  const role = await effectiveRole(admin, account.user_id, domain.tenant_id, domain.property_id);
  const property = relationOne(domain.properties);
  return { authenticated:true,userId:account.user_id,displayName:profile.display_name,propertyId:account.property_id,propertyNameZh:property?.name_zh??null,propertyNameEn:property?.name_en??null,propertyLogoUrl:null,role,mustChangePassword:account.must_change_password };
}

type RoleAssignmentRow={property_id:string|null;status:string;roles:{code:string;is_active:boolean}|Array<{code:string;is_active:boolean}>|null};
async function effectiveRole(admin: SupabaseClient, userId: string, tenantId: string, propertyId: string): Promise<EffectiveRole> {
  const { data: platform } = await admin.from("platform_memberships").select("role_code").eq("user_id", userId).eq("is_active", true).is("revoked_at", null).maybeSingle();
  if (platform?.role_code === "platform_admin") return "platform_admin";
  const { data: assignments } = await admin.from("role_assignments").select("property_id,status,roles(code,is_active)").eq("user_id", userId).eq("tenant_id", tenantId).eq("status", "active");
  const codes = ((assignments ?? []) as RoleAssignmentRow[]).filter(assignment=>assignment.property_id === null || assignment.property_id === propertyId).map(assignment=>relationOne(assignment.roles)).filter((role):role is {code:string;is_active:boolean}=>Boolean(role?.is_active)).map(role=>role.code);
  if (codes.includes("tenant_admin")) return "tenant_admin";
  if (codes.includes("property_ld_manager")) return "property_ld_manager";
  if (codes.includes("department_training_admin")) return "department_training_admin";
  if (codes.includes("employee_participant") || codes.includes("property_member")) return "employee";
  return "unauthorized";
}

function relationOne<T>(value:T|T[]|null|undefined):T|null{return Array.isArray(value)?value[0]??null:value??null}
function genericLoginError(){return new Error("账号或密码错误")}
function unauthorizedSession(authenticated=false,displayName:string|null=null):AuthSession{return{authenticated,userId:null,displayName,propertyId:null,propertyNameZh:null,propertyNameEn:null,propertyLogoUrl:null,role:"unauthorized",mustChangePassword:false}}
