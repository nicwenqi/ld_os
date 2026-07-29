import { parseAppEnvironment } from "../lib/environment.ts";
import { createServerActorClient, createServerPasswordClient } from "../lib/supabase/server-admin.ts";
import { platformAuthCookies, readPlatformCookie } from "../api/platform/auth/cookies.ts";

export type PlatformActor = { authUserId: string; displayName: string; accessToken: string; refreshToken: string | null; refreshedCookies: string[] };
type PlatformLogin = PlatformActor & { cookies: string[] };
const localLoginId = "platform-provisioner";
const localPassword = "PlatformDemo2026";

export async function authenticatePlatformProvisioner(input: { identifier: string; password: string }): Promise<PlatformLogin> {
  const environment = parseAppEnvironment();
  if (environment.appEnv === "local" && environment.dataMode === "mock") {
    if (input.identifier.trim().toLowerCase() !== localLoginId || input.password !== localPassword) throw new Error("账号或密码错误");
    const token = localPlatformToken(); const actor = localPlatformActor(token);
    return { ...actor, cookies: platformAuthCookies(token, null, false) };
  }
  const passwordClient = createServerPasswordClient();
  const { data, error } = await passwordClient.auth.signInWithPassword({ email: input.identifier.trim().toLowerCase(), password: input.password });
  if (error || !data.user || !data.session) throw new Error("账号或密码错误");
  const actor = await platformActorFromTokens(data.session.access_token, data.session.refresh_token);
  return { ...actor, cookies: platformAuthCookies(actor.accessToken, actor.refreshToken, environment.appEnv !== "local") };
}

export async function requirePlatformProvisioner(request: Request): Promise<PlatformActor> {
  const environment = parseAppEnvironment(); const accessToken = readPlatformCookie(request);
  if (environment.appEnv === "local" && environment.dataMode === "mock") {
    if (accessToken !== localPlatformToken()) throw new Error("平台登录已失效");
    return localPlatformActor(accessToken);
  }
  if (!accessToken) throw new Error("平台登录已失效");
  return platformActorFromTokens(accessToken, readPlatformCookie(request, "hotel_ld_platform_refresh"));
}

async function platformActorFromTokens(initialToken: string, initialRefresh: string | null): Promise<PlatformActor> {
  const environment = parseAppEnvironment(); const passwordClient = createServerPasswordClient();
  let accessToken = initialToken; let refreshToken = initialRefresh;
  let user = (await passwordClient.auth.getUser(accessToken)).data.user; let refreshed = false;
  if (!user && refreshToken) {
    const { data, error } = await passwordClient.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.user || !data.session) throw new Error("平台登录已失效");
    user = data.user; accessToken = data.session.access_token; refreshToken = data.session.refresh_token; refreshed = true;
  }
  if (!user) throw new Error("平台登录已失效");
  const actorClient = createServerActorClient(accessToken);
  const [{ data: membership }, { data: profile }] = await Promise.all([
    actorClient.from("platform_memberships").select("role_code,is_active,revoked_at").eq("user_id", user.id).eq("role_code", "platform_admin").maybeSingle(),
    actorClient.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
  ]);
  if (!membership || !membership.is_active || membership.revoked_at) throw new Error("当前账号没有平台开通权限");
  return { authUserId: user.id, displayName: profile?.display_name ?? "平台开通管理员", accessToken, refreshToken, refreshedCookies: refreshed ? platformAuthCookies(accessToken, refreshToken, environment.appEnv !== "local") : [] };
}
function localPlatformActor(accessToken: string): PlatformActor { return { authUserId: "synthetic-platform-provisioner", displayName: "平台开通管理员（本地验证）", accessToken, refreshToken: null, refreshedCookies: [] }; }
function localPlatformToken() { return "local-platform-provisioner-v1"; }
