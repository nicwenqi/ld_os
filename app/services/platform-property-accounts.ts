export type PlatformManagerDraft = {
  displayName: string;
  loginId: string;
  temporaryPassword: string;
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

export function normalizePlatformManagerDraft(input: Partial<PlatformManagerDraft> & { roleCode?: string }): PlatformManagerDraft {
  const displayName = String(input.displayName ?? "").trim();
  const loginId = String(input.loginId ?? "").trim();
  const temporaryPassword = String(input.temporaryPassword ?? "");
  if (!displayName) throw new Error("请输入经理姓名");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,79}$/.test(loginId)) {
    throw new Error("用户 ID 需为 3 至 80 位字母、数字、点、短横线或下划线");
  }
  if (input.roleCode && input.roleCode !== "property_ld_manager") {
    throw new Error("平台仅管理酒店学习与发展经理账号");
  }
  if (temporaryPassword.length < 12 || !/[A-Za-z]/.test(temporaryPassword) || !/\d/.test(temporaryPassword)) {
    throw new Error("临时密码至少 12 位，并同时包含字母和数字");
  }
  return { displayName, loginId, temporaryPassword };
}

export function validatePlatformLoginId(loginId: string) {
  return normalizePlatformManagerDraft({ displayName: "占位", loginId, temporaryPassword: "ValidManager2026" }).loginId;
}
