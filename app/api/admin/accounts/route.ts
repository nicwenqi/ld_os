import { parseAppEnvironment } from "../../../lib/environment.ts";
import {
  createServerActorClient,
  createServerAdminClient,
} from "../../../lib/supabase/server-admin.ts";
import type {
  BackendAccountCollection,
  BackendAccountDraft,
  BackendAccountScope,
  BackendAccountStatus,
  BackendAccountSummary,
  BackendAccountMutation,
  HotelBackendRoleCode,
} from "../../../services/account-administration.ts";
import {
  validateAccountDraft,
  generateTemporaryPassword,
} from "../../../services/account-administration.ts";
import { requireLocalReviewManager } from "../../../services/local-review-authorization.ts";
import {
  AuthorizationError,
  requirePropertyManager,
  type PropertyManagerActor,
} from "../../../services/production-authorization.ts";
import {
  createMockAccount,
  listMockAccounts,
  updateMockAccount,
} from "./mock-store.ts";

export async function GET(request: Request) {
  return handle(request, async actor => listRealAccounts(actor));
}

export async function POST(request: Request) {
  return handle(request, async actor => {
    const draft = await accountDraft(request);
    const temporaryPassword = generateTemporaryPassword();
    const admin = createServerAdminClient();
    const actorClient = createServerActorClient(actor.accessToken);
    const internalEmail = `${crypto.randomUUID()}@accounts.ldchub.cn`;
    const { data: auth, error: authError } = await admin.auth.admin.createUser({
      email: internalEmail,
      password: temporaryPassword,
      email_confirm: true,
      app_metadata: { hotel_ld_internal_account: true },
    });
    if (authError || !auth.user) throw new Error("无法创建登录身份，请重试");
    const { error } = await actorClient.rpc("create_property_backend_account_foundation", {
      p_property_id: actor.propertyId,
      p_auth_user_id: auth.user.id,
      p_internal_email: internalEmail,
      p_login_id: draft.loginId.trim(),
      p_display_name: draft.displayName.trim(),
      p_role_code: draft.roleCode,
      p_scopes: draft.scopes,
    });
    if (error) {
      await admin.auth.admin.deleteUser(auth.user.id);
      throw rpcError(error.message, "账号基础资料保存失败");
    }
    return issueTemporaryPassword(await listRealAccounts(actor), temporaryPassword);
  }, async () => createMockAccount(await accountDraft(request)));
}

export async function PATCH(request: Request) {
  return handle(request, async actor => {
    const body = await safeJson(request);
    const accountId = text(body.accountId);
    const expectedVersion = Number(body.expectedVersion);
    if (!accountId || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error("账号版本或标识无效，请重新读取");
    }
    const draft = normalizedDraft(body);
    validateAccountDraft(draft, { requireTemporaryPassword: false });
    const actorClient = createServerActorClient(actor.accessToken);
    const { error } = await actorClient.rpc("update_property_backend_account", {
      p_property_id: actor.propertyId,
      p_account_id: accountId,
      p_expected_version: expectedVersion,
      p_login_id: draft.loginId.trim(),
      p_display_name: draft.displayName.trim(),
      p_account_status: draft.status ?? "active",
      p_role_code: draft.roleCode,
      p_scopes: draft.scopes,
    });
    if (error) throw rpcError(error.message, "账号资料保存失败");
    return listRealAccounts(actor);
  }, async () => {
    const body = await safeJson(request);
    const accountId = text(body.accountId);
    const expectedVersion = Number(body.expectedVersion);
    if (!accountId || !Number.isInteger(expectedVersion)) {
      throw new Error("账号版本或标识无效，请重新读取");
    }
    return updateMockAccount(accountId, expectedVersion, normalizedDraft(body));
  });
}

export async function PUT(request: Request) {
  return handle(request, async actor => {
    const body = await safeJson(request);
    const accountId = text(body.accountId);
    const expectedVersion = Number(body.expectedVersion);
    if (!accountId || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error("账号版本或标识无效，请重新读取");
    }
    const temporaryPassword = generateTemporaryPassword();
    const actorClient = createServerActorClient(actor.accessToken);
    const { error: prepareError } = await actorClient.rpc(
      "prepare_property_backend_account_password_reset",
      {
        p_property_id: actor.propertyId,
        p_account_id: accountId,
        p_expected_version: expectedVersion,
      },
    );
    if (prepareError) throw rpcError(prepareError.message, "无法准备密码重置");

    const admin = createServerAdminClient();
    const { data: account, error: accountError } = await admin
      .from("user_accounts")
      .select("auth_user_id")
      .eq("id", accountId)
      .eq("property_id", actor.propertyId)
      .maybeSingle();
    if (accountError || !account) throw new Error("账号不存在或已被移除");
    const { error: passwordError } = await admin.auth.admin.updateUserById(
      account.auth_user_id,
      { password: temporaryPassword },
    );
    if (passwordError) {
      throw new Error("账号已标记为需要修改密码，但初始密码更新失败，请重试");
    }
    return issueTemporaryPassword(await listRealAccounts(actor), temporaryPassword);
  }, async () => {
    throw new Error("本地验证账号不支持密码重置");
  });
}

async function handle(
  request: Request,
  realAction: (actor: PropertyManagerActor) => Promise<BackendAccountMutation>,
  mockAction?: () => Promise<BackendAccountMutation> | BackendAccountMutation,
) {
  try {
    const environment = parseAppEnvironment();
    if (environment.dataMode === "mock") {
      if (environment.appEnv === "production") {
        throw new AuthorizationError(404, "本地验证账号来源不可用");
      }
      requireLocalReviewManager(request);
      const result = mockAction ? await mockAction() : listMockAccounts();
      return response(result);
    }
    const actor = await requirePropertyManager(request);
    const result = await realAction(actor);
    return response(result, actor.refreshedCookies);
  } catch (error) {
    if (error instanceof AuthorizationError) return failure(error.status, error.message);
    if (error instanceof SyntaxError) return failure(400, "请求资料格式无效");
    const status = error instanceof Error && error.name === "ConflictError" ? 409 : 422;
    return failure(status, error instanceof Error ? error.message : "账号操作未完成");
  }
}

async function listRealAccounts(
  actor: PropertyManagerActor,
): Promise<BackendAccountCollection> {
  const admin = createServerAdminClient();
  const { data: accounts, error: accountError } = await admin
    .from("user_accounts")
    .select("id,user_id,login_id,account_status,must_change_password,last_login_at,updated_at,version")
    .eq("property_id", actor.propertyId)
    .order("created_at");
  if (accountError) throw new Error("无法读取当前酒店后台账号");
  const userIds = (accounts ?? []).map(account => account.user_id);
  if (!userIds.length) return { source: "real", accounts: [] };
  const [{ data: profiles, error: profileError }, { data: assignments, error: assignmentError }] =
    await Promise.all([
      admin.from("profiles").select("id,display_name").in("id", userIds),
      admin
        .from("role_assignments")
        .select("id,user_id,role_id,status,roles(code)")
        .eq("property_id", actor.propertyId)
        .eq("status", "active")
        .in("user_id", userIds),
    ]);
  if (profileError || assignmentError) throw new Error("无法读取账号角色资料");
  const approvedAssignments = (assignments ?? []).flatMap(assignment => {
    const role = relationOne(assignment.roles);
    return role && approvedRole(role.code)
      ? [{ ...assignment, roleCode: role.code }]
      : [];
  });
  const assignmentIds = approvedAssignments.map(assignment => assignment.id);
  const { data: scopes, error: scopeError } = assignmentIds.length
    ? await admin
        .from("trainer_scopes")
        .select("role_assignment_id,department_id,include_descendants,is_active,departments(name_zh,name_en,path_ids)")
        .eq("property_id", actor.propertyId)
        .eq("is_active", true)
        .in("role_assignment_id", assignmentIds)
    : { data: [], error: null };
  if (scopeError) throw new Error("无法读取部门授权范围");
  const pathIds = [
    ...new Set((scopes ?? []).flatMap(scope => relationOne(scope.departments)?.path_ids ?? [])),
  ];
  const { data: pathDepartments, error: pathError } = pathIds.length
    ? await admin.from("departments").select("id,name_zh").in("id", pathIds)
    : { data: [], error: null };
  if (pathError) throw new Error("无法读取部门授权路径");
  const profileNames = new Map((profiles ?? []).map(profile => [profile.id, profile.display_name]));
  const pathNames = new Map((pathDepartments ?? []).map(department => [department.id, department.name_zh]));

  const visibleAccounts: BackendAccountSummary[] = (accounts ?? []).flatMap(account => {
    const assignment = approvedAssignments.find(item => item.user_id === account.user_id);
    if (!assignment) return [];
    const roleCode = assignment.roleCode as HotelBackendRoleCode;
    const accountScopes: BackendAccountScope[] = (scopes ?? [])
      .filter(scope => scope.role_assignment_id === assignment.id)
      .map(scope => {
        const department = relationOne(scope.departments);
        return {
          departmentId: scope.department_id,
          departmentNameZh: department?.name_zh ?? "正式部门",
          departmentNameEn: department?.name_en ?? null,
          breadcrumb: (department?.path_ids ?? []).map((id: string) => pathNames.get(id)).filter(Boolean) as string[],
          includeDescendants: scope.include_descendants,
        };
      });
    return [{
      accountId: account.id,
      displayName: profileNames.get(account.user_id) ?? "后台账号",
      loginId: account.login_id,
      roleCode,
      status: account.account_status as BackendAccountStatus,
      mustChangePassword: account.must_change_password,
      scopes: accountScopes,
      version: Number(account.version),
      lastLoginAt: account.last_login_at,
      updatedAt: account.updated_at,
      isCurrentAccount: account.user_id === actor.authUserId,
    }];
  });
  return { source: "real", accounts: visibleAccounts };
}

async function accountDraft(request: Request) {
  const draft = normalizedDraft(await safeJson(request));
  validateAccountDraft(draft);
  return draft as BackendAccountDraft & { roleCode: HotelBackendRoleCode };
}

function normalizedDraft(body: Record<string, unknown>): BackendAccountDraft {
  const rawScopes = Array.isArray(body.scopes) ? body.scopes : [];
  return {
    displayName: text(body.displayName),
    loginId: text(body.loginId),
    roleCode: text(body.roleCode),
    status: accountStatus(body.status),
    scopes: rawScopes.map(scope => {
      const value = scope && typeof scope === "object"
        ? scope as Record<string, unknown>
        : {};
      return {
        departmentId: text(value.departmentId),
        includeDescendants: value.includeDescendants === true,
      };
    }),
  };
}

function issueTemporaryPassword(
  collection: BackendAccountCollection,
  issuedTemporaryPassword: string,
): BackendAccountMutation {
  return { ...collection, issuedTemporaryPassword };
}

function approvedRole(value: string): value is HotelBackendRoleCode {
  return value === "property_ld_manager" || value === "department_training_admin";
}

function accountStatus(value: unknown): BackendAccountStatus {
  return value === "suspended" || value === "disabled" ? value : "active";
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function safeJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SyntaxError();
  return body as Record<string, unknown>;
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function rpcError(message: string, fallback: string) {
  const normalized = message.includes(":")
    ? message.split(":").slice(1).join(":").trim()
    : message;
  const error = new Error(normalized || fallback);
  if (/stale|updated|conflict|版本|更新/.test(message)) error.name = "ConflictError";
  return error;
}

function response(value: BackendAccountCollection, cookies: string[] = []) {
  const headers = new Headers({ "Cache-Control": "no-store, private" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return Response.json(value, { headers });
}

function failure(status: number, message: string) {
  return Response.json(
    { message },
    { status, headers: { "Cache-Control": "no-store, private" } },
  );
}
