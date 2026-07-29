import { parseAppEnvironment } from "../../../lib/environment.ts";
import { createServerActorClient, createServerAdminClient } from "../../../lib/supabase/server-admin.ts";
import { requirePlatformProvisioner } from "../../../services/platform-authorization.ts";
import { preparePropertyProvisioningPreview, verifyPropertyProvisioningPreview, type PropertyProvisioningDraft } from "../../../services/platform-property-provisioning.ts";

export async function POST(request: Request) {
  try {
    const actor = await requirePlatformProvisioner(request); const body = await request.json() as Record<string, unknown>; const draft = body.draft as PropertyProvisioningDraft; const secret = previewSecret();
    if (body.operation === "preview") return response({ source: "preview", preview: preparePropertyProvisioningPreview(draft, { actorUserId: actor.authUserId, secret }) }, actor.refreshedCookies);
    if (body.operation !== "commit" || typeof body.previewToken !== "string") return failure(400, "请先完成开通预览");
    const normalized = verifyPropertyProvisioningPreview(body.previewToken, draft, { actorUserId: actor.authUserId, secret }); const environment = parseAppEnvironment();
    if (environment.appEnv === "local" && environment.dataMode === "mock") return response({ source: "local_review", handoff: { propertyId: "local-review-property", hostname: normalized.hostname, managerDisplayName: normalized.managerDisplayName, passwordChangeRequired: true, handoffState: "manager_password_change_required", initializationState: "not_started" }, notice: "本地验证未创建 Property、Auth 用户或酒店业务事实。" }, actor.refreshedCookies);
    const admin = createServerAdminClient(); const internalEmail = `${crypto.randomUUID()}@accounts.ldchub.cn`;
    const { data: auth, error: authError } = await admin.auth.admin.createUser({ email: internalEmail, password: draft.temporaryPassword, email_confirm: true, app_metadata: { hotel_ld_internal_account: true } });
    if (authError || !auth.user) throw new Error("无法创建首位经理登录身份，请重试");
    try {
      const actorClient = createServerActorClient(actor.accessToken);
      const { data, error } = await actorClient.rpc("provision_initial_property_and_manager", { p_tenant_id: normalized.tenantId, p_property_container: { code: normalized.propertyCode, nameZh: normalized.preliminaryNameZh, nameEn: normalized.preliminaryNameEn, brand: normalized.brand, city: normalized.city, countryRegion: normalized.countryRegion, timezone: normalized.timezone, defaultLanguage: normalized.defaultLanguage, hostname: normalized.hostname }, p_initial_manager: { authUserId: auth.user.id, internalEmail, loginId: normalized.managerLoginId, displayName: normalized.managerDisplayName } });
      if (error || !data) throw new Error(error?.message ?? "Property 开通未完成");
      return response({ source: "real", handoff: data }, actor.refreshedCookies);
    } catch (error) { await admin.auth.admin.deleteUser(auth.user.id); throw error; }
  } catch (error) { return failure(error instanceof Error && /预览|格式|请输入|无效/.test(error.message) ? 422 : 403, error instanceof Error ? error.message : "Property 开通未完成"); }
}
function previewSecret() { const secret = process.env.SUPABASE_SECRET_KEY?.trim(); const environment = parseAppEnvironment(); if (secret) return secret; if (environment.appEnv === "local" && environment.dataMode === "mock") return "local-c1-preview-secret"; throw new Error("平台开通预览签名不可用"); }
function response(value: unknown, refreshedCookies: string[]) { const headers = new Headers({ "Cache-Control": "no-store, private" }); for (const cookie of refreshedCookies) headers.append("Set-Cookie", cookie); return Response.json(value, { headers }); }
function failure(status: number, message: string) { return Response.json({ message }, { status, headers: { "Cache-Control": "no-store, private" } }); }
