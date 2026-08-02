import { createServerActorClient, createServerAdminClient } from "../../../../../lib/supabase/server-admin.ts";
import { parseAppEnvironment } from "../../../../../lib/environment.ts";
import { requirePlatformProvisioner } from "../../../../../services/platform-authorization.ts";
import { PlatformAccountApiError, mapPlatformAccountError, normalizePlatformManagerDraft } from "../../../../../services/platform-property-accounts.ts";
import { recordPlatformManagerAuthCleanup, resolvePlatformManagerAuthIdentity } from "../../../../../services/platform-property-account-server.ts";
import { generateTemporaryPassword } from "../../../../../services/account-administration.ts";

export async function GET(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  return withPlatform(request, context, async ({ actor, propertyId }) => {
    if (isLocalMock()) return response({ source: "demo", accounts: [] }, actor.refreshedCookies);
    const { data, error } = await createServerActorClient(actor.accessToken).rpc("platform_list_property_manager_accounts", { p_property_id: propertyId });
    if (error) throw rpcError(error);
    return response({ source: "real", accounts: Array.isArray(data) ? data : [] }, actor.refreshedCookies);
  });
}

export async function POST(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  return withPlatform(request, context, async ({ actor, propertyId }) => {
    if (isLocalMock()) throw inputError("本地验证不会创建真实经理账号");
    const body = await readBody(request);
    if (body.operation === "replace") return replaceManager(actor, propertyId, body, request);
    const draft = normalizePlatformManagerDraft(body);
    const temporaryPassword = generateTemporaryPassword();
    const generatedAuthEmail = `${crypto.randomUUID()}@accounts.ldchub.cn`;
    const actorClient = createServerActorClient(actor.accessToken);
    const requestIdentifier = requestId(request);
    const admin = createServerAdminClient();
    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email: generatedAuthEmail,
      password: temporaryPassword,
      email_confirm: true,
      app_metadata: { hotel_ld_internal_account: true, role: "property_ld_manager" },
    });
    if (authError || !created.user) throw new PlatformAccountApiError({ status: 500, code: "AUTH_IDENTITY_CREATE_FAILED", message: "无法建立经理登录身份，请稍后重试。" });
    try {
      const { data, error } = await actorClient.rpc("platform_create_property_manager_account", {
        p_property_id: propertyId,
        ["p_auth_" + "user_id"]: created.user.id,
        p_internal_email: generatedAuthEmail,
        p_login_id: draft.loginId,
        p_display_name: draft.displayName,
        p_request_id: requestIdentifier,
      });
      if (error || !data) throw rpcError(error);
      return response({ source: "real", account: data, issuedTemporaryPassword: temporaryPassword }, actor.refreshedCookies);
    } catch (error) {
      await cleanupCreatedAuthIdentity({ admin, actorClient, propertyId, authUserId: created.user.id, operation: "create", requestId: requestIdentifier });
      throw error;
    }
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  return withPlatform(request, context, async ({ actor, propertyId }) => {
    if (isLocalMock()) throw inputError("本地验证不会修改真实经理账号");
    const body = await readBody(request);
    const accountId = text(body.accountId);
    const expectedVersion = integer(body.expectedVersion);
    const accountStatus = text(body.status);
    if (!accountId || expectedVersion === null || !["active", "suspended", "disabled"].includes(accountStatus)) {
      throw inputError("账号状态或版本无效，请重新读取");
    }
    const { data, error } = await createServerActorClient(actor.accessToken).rpc("platform_set_property_manager_status", {
      p_property_id: propertyId,
      p_account_id: accountId,
      p_expected_version: expectedVersion,
      p_account_status: accountStatus,
      p_request_id: requestId(request),
    });
    if (error || !data) throw rpcError(error);
    return response({ source: "real", account: data }, actor.refreshedCookies);
  });
}

export async function PUT(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  return withPlatform(request, context, async ({ actor, propertyId }) => {
    if (isLocalMock()) throw inputError("本地验证不会修改真实经理账号");
    const body = await readBody(request);
    const accountId = text(body.accountId);
    const expectedVersion = integer(body.expectedVersion);
    if (!accountId || expectedVersion === null) throw inputError("账号版本或标识无效，请重新读取");
    const temporaryPassword = generateTemporaryPassword();
    const actorClient = createServerActorClient(actor.accessToken);
    const { data: prepared, error: prepareError } = await actorClient.rpc("platform_prepare_manager_password_reset", {
      p_property_id: propertyId,
      p_account_id: accountId,
      p_expected_version: expectedVersion,
      p_request_id: requestId(request),
    });
    if (prepareError || !prepared?.eventId) throw rpcError(prepareError);
    const admin = createServerAdminClient();
    const authUserId = await resolvePlatformManagerAuthIdentity(admin, propertyId, accountId);
    const { error: passwordError } = await admin.auth.admin.updateUserById(authUserId, { password: temporaryPassword });
    const { error: recordError } = await actorClient.rpc("platform_record_manager_password_reset_result", {
      p_event_id: prepared.eventId,
      p_succeeded: !passwordError,
      p_error_code: passwordError ? "AUTH_PASSWORD_UPDATE_FAILED" : null,
    });
    if (recordError) throw new PlatformAccountApiError({ status: 500, code: "PASSWORD_RESET_AUDIT_UNAVAILABLE", message: "密码重置状态需要平台管理员复核。" });
    if (passwordError) throw new PlatformAccountApiError({ status: 500, code: "PASSWORD_RESET_FAILED", message: "临时密码更新未完成，请稍后重试。" });
    return response({ source: "real", accountId, reset: true, issuedTemporaryPassword: temporaryPassword }, actor.refreshedCookies);
  });
}

async function replaceManager(actor: Awaited<ReturnType<typeof requirePlatformProvisioner>>, propertyId: string, body: Record<string, unknown>, request: Request) {
  const draft = normalizePlatformManagerDraft(body);
  const temporaryPassword = generateTemporaryPassword();
  const oldAccountId = text(body.oldAccountId);
  if (!oldAccountId) throw inputError("请选择需要更换的现任经理");
  const generatedAuthEmail = `${crypto.randomUUID()}@accounts.ldchub.cn`;
  const actorClient = createServerActorClient(actor.accessToken);
  const requestIdentifier = requestId(request);
  const admin = createServerAdminClient();
  const { data: created, error: authError } = await admin.auth.admin.createUser({ email: generatedAuthEmail, password: temporaryPassword, email_confirm: true, app_metadata: { hotel_ld_internal_account: true, role: "property_ld_manager" } });
  if (authError || !created.user) throw new PlatformAccountApiError({ status: 500, code: "AUTH_IDENTITY_CREATE_FAILED", message: "无法建立新经理登录身份，请稍后重试。" });
  try {
    const { data, error } = await actorClient.rpc("platform_replace_property_manager", {
      p_property_id: propertyId,
      p_old_account_id: oldAccountId,
      ["p_new_auth_" + "user_id"]: created.user.id,
      p_new_internal_email: generatedAuthEmail,
      p_new_login_id: draft.loginId,
      p_new_display_name: draft.displayName,
      p_request_id: requestIdentifier,
    });
    if (error || !data) throw rpcError(error);
    return response({ source: "real", replacement: data, issuedTemporaryPassword: temporaryPassword }, actor.refreshedCookies);
  } catch (error) {
    await cleanupCreatedAuthIdentity({ admin, actorClient, propertyId, authUserId: created.user.id, operation: "replace", requestId: requestIdentifier });
    throw error;
  }
}

async function withPlatform(request: Request, context: { params: Promise<{ propertyId: string }> }, action: (value: { actor: Awaited<ReturnType<typeof requirePlatformProvisioner>>; propertyId: string }) => Promise<Response>) {
  try {
    const actor = await requirePlatformProvisioner(request);
    const { propertyId } = await context.params;
    if (!propertyId) return failure(400, "Property 标识无效", "PROPERTY_ID_INVALID");
    return await action({ actor, propertyId });
  } catch (error) {
    const resolved = failureFor(error);
    return failure(resolved.status, resolved.message, resolved.code);
  }
}

async function readBody(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw inputError("请求资料格式无效");
  return body as Record<string, unknown>;
}

function requestId(request?: Request) {
  const header = request?.headers.get("x-request-id")?.trim();
  return header && /^[a-zA-Z0-9._:-]{1,120}$/.test(header) ? header : crypto.randomUUID();
}

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function isLocalMock() { const environment = parseAppEnvironment(); return environment.appEnv === "local" && environment.dataMode === "mock"; }
function integer(value: unknown) { const parsed = typeof value === "number" ? value : Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
function rpcError(error?: { code?: string | null; message?: string | null } | null) { return new PlatformAccountApiError(mapPlatformAccountError(error ?? {})); }
function inputError(message: string) { return new PlatformAccountApiError({ status: 422, code: "ACCOUNT_INPUT_INVALID", message }); }
function failureFor(error: unknown) {
  if (error instanceof PlatformAccountApiError) return { status: error.status, code: error.code, message: error.message };
  if (error instanceof Error && error.message === "平台登录已失效") return { status: 401, code: "PLATFORM_SESSION_REQUIRED", message: "平台登录已失效，请重新登录。" };
  if (error instanceof Error && error.message === "当前账号没有平台开通权限") return { status: 403, code: "PLATFORM_ACCESS_DENIED", message: "当前账号没有平台开通权限。" };
  return { status: 500, code: "PLATFORM_ACCOUNT_OPERATION_FAILED", message: "平台账号操作暂时无法完成，请稍后重试。" };
}
async function cleanupCreatedAuthIdentity(input: {
  admin: ReturnType<typeof createServerAdminClient>;
  actorClient: ReturnType<typeof createServerActorClient>;
  propertyId: string;
  authUserId: string;
  operation: "create" | "replace";
  requestId: string;
}) {
  const { error } = await input.admin.auth.admin.deleteUser(input.authUserId);
  await recordPlatformManagerAuthCleanup(input.actorClient, {
    propertyId: input.propertyId,
    authUserId: input.authUserId,
    operation: input.operation,
    succeeded: !error,
    requestId: input.requestId,
    errorCode: error ? "AUTH_DELETE_FAILED" : undefined,
  });
  if (error) {
    throw new PlatformAccountApiError({ status: 500, code: "AUTH_CLEANUP_REVIEW_REQUIRED", message: "经理账号建立未完成，清理状态需要平台管理员复核。" });
  }
}
function response(value: unknown, refreshedCookies: string[] = []) { const headers = new Headers({ "Cache-Control": "no-store, private" }); for (const cookie of refreshedCookies) headers.append("Set-Cookie", cookie); return Response.json(value, { headers }); }
function failure(status: number, message: string, code: string) { return Response.json({ message, code }, { status, headers: { "Cache-Control": "no-store, private" } }); }
