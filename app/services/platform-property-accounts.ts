export type PlatformManagerDraft = {
  displayName: string;
  loginId: string;
};

export type PlatformManagerAccount = {
  accountId: string;
  displayName: string;
  loginId: string;
  roleCode: "property_ld_manager";
  status: "active" | "suspended" | "disabled";
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  version: number;
  updatedAt: string;
};

export type PlatformManagerCollection = {
  source: "real" | "demo";
  accounts: PlatformManagerAccount[];
};

export type PlatformAccountFailure = {
  status: number;
  code: string;
  message: string;
};

export class PlatformAccountApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(failure: PlatformAccountFailure) {
    super(failure.message);
    this.name = "PlatformAccountApiError";
    this.status = failure.status;
    this.code = failure.code;
  }
}

type DatabaseFailure = { code?: string | null; message?: string | null };

/**
 * Converts database and RPC signals into the limited business vocabulary the
 * Platform console is allowed to expose. Raw database, Auth, and relation
 * names must never cross the server route boundary.
 */
export function mapPlatformAccountError(input: DatabaseFailure): PlatformAccountFailure {
  const code = String(input.code ?? "").toUpperCase();
  const message = String(input.message ?? "").toUpperCase();
  const signal = `${code}|${message}`;
  if (signal.includes("P0003") || signal.includes("PLATFORM_MANAGER_ACCOUNT_STALE")) {
    return { status: 409, code: "ACCOUNT_STALE", message: "账号资料已由其他平台管理员更新，请重新读取后再试。" };
  }
  if (signal.includes("P5006") || signal.includes("FINAL ACTIVE HOTEL L&D MANAGER")) {
    return { status: 409, code: "FINAL_MANAGER_PROTECTED", message: "当前 Property 至少需要一位已启用的学习与发展经理。" };
  }
  if (signal.includes("23505") || signal.includes("LOGIN_ID_ALREADY_EXISTS") || signal.includes("IDENTITY_OR_LOGIN_ALREADY_EXISTS")) {
    return { status: 409, code: "LOGIN_ID_CONFLICT", message: "该用户 ID 已被其他 Property 使用，请选择全平台唯一的用户 ID。" };
  }
  if (signal.includes("P0002") || signal.includes("PLATFORM_PROPERTY_NOT_FOUND") || signal.includes("PLATFORM_MANAGER_ACCOUNT_NOT_FOUND")) {
    return { status: 404, code: "PROPERTY_ACCOUNT_NOT_FOUND", message: "所选 Property 或经理账号不存在，或当前不可管理。" };
  }
  if (signal.includes("42501") || signal.includes("PROVISIONER") || signal.includes("PERMISSION")) {
    return { status: 403, code: "PLATFORM_ACCESS_DENIED", message: "当前平台账号没有执行此操作的权限。" };
  }
  if (signal.includes("22023") || signal.includes("INPUT_INVALID") || signal.includes("STATUS_INVALID")) {
    return { status: 422, code: "ACCOUNT_INPUT_INVALID", message: "账号资料无效，请检查后重新提交。" };
  }
  return { status: 500, code: "PLATFORM_ACCOUNT_OPERATION_FAILED", message: "平台账号操作暂时无法完成，请稍后重试。" };
}

export function normalizePlatformManagerDraft(input: Partial<PlatformManagerDraft> & { roleCode?: string }): PlatformManagerDraft {
  const displayName = String(input.displayName ?? "").trim();
  const loginId = String(input.loginId ?? "").trim();
  if (!displayName) throw new Error("请输入经理姓名");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/.test(loginId)) {
    throw new Error("用户 ID 需为 3 至 80 位字母、数字、点、短横线或下划线");
  }
  if (input.roleCode && input.roleCode !== "property_ld_manager") {
    throw new Error("平台仅管理酒店学习与发展经理账号");
  }
  return { displayName, loginId };
}

export function validatePlatformLoginId(loginId: string) {
  return normalizePlatformManagerDraft({ displayName: "占位", loginId }).loginId;
}
