export type HotelBackendRoleCode =
  | "property_ld_manager"
  | "department_training_admin";

export type BackendAccountStatus = "active" | "suspended" | "disabled";

export type DepartmentScopeDraft = {
  departmentId: string;
  includeDescendants: boolean;
};

export type BackendAccountDraft = {
  displayName: string;
  loginId: string;
  temporaryPassword?: string;
  roleCode: string;
  status?: BackendAccountStatus;
  scopes: DepartmentScopeDraft[];
};

export type BackendAccountScope = DepartmentScopeDraft & {
  departmentNameZh: string;
  departmentNameEn: string | null;
  breadcrumb: string[];
};

export type BackendAccountSummary = {
  accountId: string;
  displayName: string;
  loginId: string;
  roleCode: HotelBackendRoleCode;
  status: BackendAccountStatus;
  mustChangePassword: boolean;
  scopes: BackendAccountScope[];
  version: number;
  lastLoginAt: string | null;
  updatedAt: string;
  isCurrentAccount: boolean;
};

export type BackendAccountCollection = {
  source: "real" | "demo";
  accounts: BackendAccountSummary[];
};

export function accountRoleLabel(roleCode: HotelBackendRoleCode) {
  return roleCode === "property_ld_manager"
    ? "酒店学习与发展经理"
    : "部门培训负责人";
}

export function validateBackendPassword(password: string) {
  if (password.length < 12) throw new Error("密码至少 12 位");
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error("密码需同时包含字母和数字");
  }
}

export function validateAccountDraft(
  input: BackendAccountDraft,
  options: { requireTemporaryPassword?: boolean } = {},
): asserts input is BackendAccountDraft & { roleCode: HotelBackendRoleCode } {
  const displayName = input.displayName.trim();
  const loginId = input.loginId.trim();
  if (!displayName) throw new Error("请输入账号显示名称");
  if (!loginId) throw new Error("请输入用户 ID");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/.test(loginId)) {
    throw new Error("用户 ID 需为 3 至 80 位字母、数字、点、短横线或下划线");
  }
  if (
    input.roleCode !== "property_ld_manager" &&
    input.roleCode !== "department_training_admin"
  ) {
    throw new Error("仅支持酒店学习与发展经理和部门培训负责人");
  }
  if (options.requireTemporaryPassword !== false) {
    const password = input.temporaryPassword ?? "";
    try {
      validateBackendPassword(password);
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? error.message.replace(/^密码/, "临时密码")
          : "临时密码不符合要求",
      );
    }
  }
  const uniqueScopes = new Set(input.scopes.map(scope => scope.departmentId));
  if (uniqueScopes.size !== input.scopes.length) {
    throw new Error("部门范围不能重复");
  }
  if (input.roleCode === "department_training_admin" && input.scopes.length === 0) {
    throw new Error("部门培训负责人至少选择一个正式部门范围");
  }
  if (input.roleCode === "property_ld_manager" && input.scopes.length > 0) {
    throw new Error("酒店学习与发展经理不使用部门范围");
  }
}

export async function loadBackendAccounts(): Promise<BackendAccountCollection> {
  return accountRequest("/api/admin/accounts");
}

export async function createBackendAccount(
  draft: BackendAccountDraft,
): Promise<BackendAccountCollection> {
  validateAccountDraft(draft);
  return accountRequest("/api/admin/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
}

export async function updateBackendAccount(
  accountId: string,
  expectedVersion: number,
  draft: BackendAccountDraft,
): Promise<BackendAccountCollection> {
  validateAccountDraft(draft, { requireTemporaryPassword: false });
  return accountRequest("/api/admin/accounts", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, expectedVersion, ...draft }),
  });
}

export async function resetBackendAccountPassword(
  accountId: string,
  expectedVersion: number,
  temporaryPassword: string,
): Promise<BackendAccountCollection> {
  validateBackendPassword(temporaryPassword);
  return accountRequest("/api/admin/accounts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, expectedVersion, temporaryPassword }),
  });
}

async function accountRequest(
  url: string,
  init?: RequestInit,
): Promise<BackendAccountCollection> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = await response.json() as BackendAccountCollection & { message?: string };
  if (!response.ok) {
    const error = new Error(payload.message ?? "账号管理服务暂时不可用");
    if (response.status === 409) error.name = "ConflictError";
    throw error;
  }
  return payload;
}
