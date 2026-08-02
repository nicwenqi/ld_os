import { createServerActorClient, createServerAdminClient } from "../../../../../lib/supabase/server-admin.ts";
import { parseAppEnvironment } from "../../../../../lib/environment.ts";
import { requirePlatformProvisioner } from "../../../../../services/platform-authorization.ts";
import { normalizePlatformManagerDraft } from "../../../../../services/platform-property-accounts.ts";

export async function GET(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  return withPlatform(request, context, async ({ actor, propertyId }) => {
    if (isLocalMock()) return response({ source: "demo", accounts: [] }, actor.refreshedCookies);
    const { data, error } = await createServerActorClient(actor.accessToken).rpc("platform_list_property_manager_accounts", { p_property_id: propertyId });
    if (error) throw rpcFailure(error.message, "无法读取该 Property 的经理账号");
    return response({ source: "real", accounts: Array.isArray(data) ? data : [] }, actor.refreshedCookies);
  });
}

export async function POST(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  return withPlatform(request, context, async ({ actor, propertyId }) => {
    if (isLocalMock()) throw new Error("本地验证不会创建真实经理账号");
    const body = await readBody(request);
    if (body.operation === "replace") return replaceManager(actor, propertyId, body);
    const draft = normalizePlatformManagerDraft(body);
    const generatedAuthEmail = `${crypto.randomUUID()}@accounts.ldchub.cn`;
    const admin = createServerAdminClient();
    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email: generatedAuthEmail,
      password: draft.temporaryPassword,
      email_confirm: true,
      app_metadata: { hotel_ld_internal_account: true, role: "property_ld_manager" },
    });
    if (authError || !created.user) throw new Error("无法建立经理登录身份，请重试");
    try {
      const { data, error } = await createServerActorClient(actor.accessToken).rpc("platform_create_property_manager_account", {
        p_property_id: propertyId,
        ["p_auth_" + "user_id"]: created.user.id,
        p_internal_email: generatedAuthEmail,
        p_login_id: draft.loginId,
        p_display_name: draft.displayName,
        p_request_id: requestId(request),
      });
      if (error || !data) throw rpcFailure(error?.message, "经理账号保存失败");
      return response({ source: "real", account: data }, actor.refreshedCookies);
    } catch (error) {
      await admin.auth.admin.deleteUser(created.user.id);
      throw error;
    }
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  return withPlatform(request, context, async ({ actor, propertyId }) => {
    if (isLocalMock()) throw new Error("本地验证不会修改真实经理账号");
    const body = await readBody(request);
    const accountId = text(body.accountId);
    const expectedVersion = integer(body.expectedVersion);
    const accountStatus = text(body.status);
    if (!accountId || expectedVersion === null || !["active", "suspended", "disabled"].includes(accountStatus)) {
      throw new Error("账号状态或版本无效，请重新读取");
    }
    const { data, error } = await createServerActorClient(actor.accessToken).rpc("platform_set_property_manager_status", {
      p_property_id: propertyId,
      p_account_id: accountId,
      p_expected_version: expectedVersion,
      p_account_status: accountStatus,
      p_request_id: requestId(request),
    });
    if (error || !data) throw rpcFailure(error?.message, "账号状态更新失败");
    return response({ source: "real", account: data }, actor.refreshedCookies);
  });
}

export async function PUT(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  return withPlatform(request, context, async ({ actor, propertyId }) => {
    if (isLocalMock()) throw new Error("本地验证不会修改真实经理账号");
    const body = await readBody(request);
    const accountId = text(body.accountId);
    const expectedVersion = integer(body.expectedVersion);
    const temporaryPassword = text(body.temporaryPassword);
    if (!accountId || expectedVersion === null) throw new Error("账号版本或标识无效，请重新读取");
    normalizePlatformManagerDraft({ displayName: "占位", loginId: "manager-reset", temporaryPassword });
    const actorClient = createServerActorClient(actor.accessToken);
    const { data: prepared, error: prepareError } = await actorClient.rpc("platform_prepare_manager_password_reset", {
      p_property_id: propertyId,
      p_account_id: accountId,
      p_expected_version: expectedVersion,
      p_request_id: requestId(request),
    });
    if (prepareError || !prepared?.eventId || !prepared?.authUserId) throw rpcFailure(prepareError?.message, "无法准备密码重置");
    const admin = createServerAdminClient();
    const { error: passwordError } = await admin.auth.admin.updateUserById(prepared.authUserId, { password: temporaryPassword });
    const { error: recordError } = await actorClient.rpc("platform_record_manager_password_reset_result", {
      p_event_id: prepared.eventId,
      p_succeeded: !passwordError,
      p_error_code: passwordError?.message ?? null,
    });
    if (recordError) throw rpcFailure(recordError.message, "密码重置审计记录失败");
    if (passwordError) throw new Error("账号已标记需要修改密码，但临时密码更新失败，请重试");
    return response({ source: "real", accountId, reset: true }, actor.refreshedCookies);
  });
}

async function replaceManager(actor: Awaited<ReturnType<typeof requirePlatformProvisioner>>, propertyId: string, body: Record<string, unknown>) {
  const draft = normalizePlatformManagerDraft(body);
  const oldAccountId = text(body.oldAccountId);
  if (!oldAccountId) throw new Error("请选择需要更换的现任经理");
  const generatedAuthEmail = `${crypto.randomUUID()}@accounts.ldchub.cn`;
  const admin = createServerAdminClient();
  const { data: created, error: authError } = await admin.auth.admin.createUser({ email: generatedAuthEmail, password: draft.temporaryPassword, email_confirm: true, app_metadata: { hotel_ld_internal_account: true, role: "property_ld_manager" } });
  if (authError || !created.user) throw new Error("无法建立新经理登录身份，请重试");
  try {
    const { data, error } = await createServerActorClient(actor.accessToken).rpc("platform_replace_property_manager", {
      p_property_id: propertyId,
      p_old_account_id: oldAccountId,
      ["p_new_auth_" + "user_id"]: created.user.id,
      p_new_internal_email: generatedAuthEmail,
      p_new_login_id: draft.loginId,
      p_new_display_name: draft.displayName,
      p_request_id: requestId(),
    });
    if (error || !data) throw rpcFailure(error?.message, "经理更换未完成");
    return response({ source: "real", replacement: data }, actor.refreshedCookies);
  } catch (error) {
    await admin.auth.admin.deleteUser(created.user.id);
    throw error;
  }
}

async function withPlatform(request: Request, context: { params: Promise<{ propertyId: string }> }, action: (value: { actor: Awaited<ReturnType<typeof requirePlatformProvisioner>>; propertyId: string }) => Promise<Response>) {
  try {
    const actor = await requirePlatformProvisioner(request);
    const { propertyId } = await context.params;
    if (!propertyId) return failure(400, "Property 标识无效");
    return await action({ actor, propertyId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "平台账号操作未完成";
    return failure(error instanceof Error && /无效|请输入|密码|请选择/.test(message) ? 422 : 403, message);
  }
}

async function readBody(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("请求资料格式无效");
  return body as Record<string, unknown>;
}

function requestId(request?: Request) {
  const header = request?.headers.get("x-request-id")?.trim();
  return header && /^[a-zA-Z0-9._:-]{1,120}$/.test(header) ? header : crypto.randomUUID();
}

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function isLocalMock() { const environment = parseAppEnvironment(); return environment.appEnv === "local" && environment.dataMode === "mock"; }
function integer(value: unknown) { const parsed = typeof value === "number" ? value : Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
function rpcFailure(message: string | undefined, fallback: string) { return new Error(message?.replace(/^.*?:\s*/, "") || fallback); }
function response(value: unknown, refreshedCookies: string[] = []) { const headers = new Headers({ "Cache-Control": "no-store, private" }); for (const cookie of refreshedCookies) headers.append("Set-Cookie", cookie); return Response.json(value, { headers }); }
function failure(status: number, message: string) { return Response.json({ message }, { status, headers: { "Cache-Control": "no-store, private" } }); }
