import { parseAppEnvironment } from "../../../lib/environment.ts";
import { requireLocalReviewManager } from "../../../services/local-review-authorization.ts";
import { requirePropertyManager, AuthorizationError } from "../../../services/production-authorization.ts";
import {
  createMockAccount,
  listMockAccounts,
  updateMockAccount,
} from "./mock-store.ts";
import { validateAccountDraft, type BackendAccountDraft, type BackendAccountStatus } from "../../../services/account-administration.ts";

/**
 * Real account provisioning is deliberately an acceptance/operator workflow:
 * Better Auth owns credentials while the Neon initialization operator owns the
 * user-account/membership/role mapping.  This endpoint must never become a
 * second privileged identity-management path.
 */
export async function GET(request: Request) {
  return handle(request, () => listMockAccounts());
}

export async function POST(request: Request) {
  return handle(request, async () => createMockAccount(await draft(request, true)));
}

export async function PATCH(request: Request) {
  return handle(request, async () => {
    const body = await safeJson(request);
    const accountId = text(body.accountId);
    const expectedVersion = Number(body.expectedVersion);
    if (!accountId || !Number.isInteger(expectedVersion)) throw new Error("账号版本或标识无效，请重新读取");
    return updateMockAccount(accountId, expectedVersion, await draft(request, false, body));
  });
}

export async function PUT(request: Request) {
  return handle(request, () => Promise.reject(new Error("Neon-first 初始化不通过运行时账号接口重置凭据")));
}

async function handle(request: Request, mockAction: () => Promise<unknown> | unknown) {
  try {
    const environment = parseAppEnvironment();
    if (environment.dataMode === "mock") {
      if (environment.appEnv === "production") throw new AuthorizationError(404, "本地验证账号来源不可用");
      requireLocalReviewManager(request);
      return response(await mockAction());
    }
    await requirePropertyManager(request);
    return failure(410, "真实账号通过 Neon-first 初始化 operator 创建和映射");
  } catch (error) {
    if (error instanceof AuthorizationError) return failure(error.status, error.message);
    if (error instanceof SyntaxError) return failure(400, "请求资料格式无效");
    return failure(422, error instanceof Error ? error.message : "账号操作未完成");
  }
}

async function draft(request: Request, requireTemporaryPassword: boolean, existing?: Record<string, unknown>) {
  const body = existing ?? await safeJson(request);
  const value: BackendAccountDraft = {
    displayName: text(body.displayName),
    loginId: text(body.loginId),
    temporaryPassword: text(body.temporaryPassword),
    roleCode: text(body.roleCode),
    scopes: Array.isArray(body.scopes) ? body.scopes : [],
    status: accountStatus(body.status),
  };
  validateAccountDraft(value, { requireTemporaryPassword });
  return value;
}

async function safeJson(request: Request) {
  const value = await request.json();
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

function accountStatus(value: unknown): BackendAccountStatus | undefined {
  return value === "active" || value === "suspended" || value === "disabled" ? value : undefined;
}

function response(value: unknown) {
  return Response.json(value, { headers: { "Cache-Control": "no-store, private" } });
}

function failure(status: number, message: string) {
  return Response.json({ message }, { status, headers: { "Cache-Control": "no-store, private" } });
}
