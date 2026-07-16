import type {
  BackendAccountCollection,
  BackendAccountDraft,
  BackendAccountSummary,
  HotelBackendRoleCode,
} from "../../../services/account-administration.ts";
import { validateAccountDraft } from "../../../services/account-administration.ts";

const manager: BackendAccountSummary = {
  accountId: "review-account-manager",
  displayName: "学习与发展经理（本地验证）",
  loginId: "property-manager",
  roleCode: "property_ld_manager",
  status: "active",
  mustChangePassword: false,
  scopes: [],
  version: 1,
  lastLoginAt: null,
  updatedAt: "2026-07-16T08:00:00.000Z",
  isCurrentAccount: true,
};

const departmentResponsible: BackendAccountSummary = {
  accountId: "review-account-department",
  displayName: "部门培训负责人（本地验证）",
  loginId: "department-responsible",
  roleCode: "department_training_admin",
  status: "active",
  mustChangePassword: false,
  scopes: [{
    departmentId: "61000000-0000-0000-0000-000000000012",
    departmentNameZh: "前厅部",
    departmentNameEn: "Front Office",
    breadcrumb: ["房务部", "前厅部"],
    includeDescendants: true,
  }],
  version: 1,
  lastLoginAt: null,
  updatedAt: "2026-07-16T08:00:00.000Z",
  isCurrentAccount: false,
};

const accounts: BackendAccountSummary[] = [manager, departmentResponsible];

export function listMockAccounts(): BackendAccountCollection {
  return { source: "demo", accounts: structuredClone(accounts) };
}

export function createMockAccount(draft: BackendAccountDraft): BackendAccountCollection {
  validateAccountDraft(draft);
  const normalized = draft.loginId.trim().toLowerCase();
  if (accounts.some(account => account.loginId.toLowerCase() === normalized)) {
    throw conflict("用户 ID 已存在，请使用其他 ID");
  }
  const now = new Date().toISOString();
  accounts.push({
    accountId: crypto.randomUUID(),
    displayName: draft.displayName.trim(),
    loginId: draft.loginId.trim(),
    roleCode: draft.roleCode as HotelBackendRoleCode,
    status: "active",
    mustChangePassword: true,
    scopes: draft.scopes.map(scope => ({
      ...scope,
      departmentNameZh: "已授权正式部门",
      departmentNameEn: null,
      breadcrumb: ["当前酒店", "已授权正式部门"],
    })),
    version: 1,
    lastLoginAt: null,
    updatedAt: now,
    isCurrentAccount: false,
  });
  return listMockAccounts();
}

export function updateMockAccount(
  accountId: string,
  expectedVersion: number,
  draft: BackendAccountDraft,
): BackendAccountCollection {
  validateAccountDraft(draft, { requireTemporaryPassword: false });
  const account = accounts.find(item => item.accountId === accountId);
  if (!account) throw new Error("账号不存在或已被移除");
  if (account.version !== expectedVersion) throw conflict("账号资料已更新，请重新读取");
  if (account.isCurrentAccount && account.roleCode !== draft.roleCode) {
    throw new Error("不能修改当前登录账号的角色");
  }
  const removingManager =
    account.roleCode === "property_ld_manager" &&
    account.status === "active" &&
    (draft.roleCode !== "property_ld_manager" || draft.status !== "active");
  if (
    removingManager &&
    accounts.filter(item =>
      item.accountId !== account.accountId &&
      item.roleCode === "property_ld_manager" &&
      item.status === "active"
    ).length === 0
  ) {
    throw new Error("必须保留至少一位活动酒店学习与发展经理");
  }
  const duplicate = accounts.find(item =>
    item.accountId !== account.accountId &&
    item.loginId.toLowerCase() === draft.loginId.trim().toLowerCase()
  );
  if (duplicate) throw conflict("用户 ID 已存在，请使用其他 ID");
  Object.assign(account, {
    displayName: draft.displayName.trim(),
    loginId: draft.loginId.trim(),
    roleCode: draft.roleCode,
    status: draft.status ?? account.status,
    scopes: draft.scopes.map(scope => ({
      ...scope,
      departmentNameZh:
        account.scopes.find(item => item.departmentId === scope.departmentId)
          ?.departmentNameZh ?? "已授权正式部门",
      departmentNameEn:
        account.scopes.find(item => item.departmentId === scope.departmentId)
          ?.departmentNameEn ?? null,
      breadcrumb:
        account.scopes.find(item => item.departmentId === scope.departmentId)
          ?.breadcrumb ?? ["当前酒店", "已授权正式部门"],
    })),
    version: account.version + 1,
    updatedAt: new Date().toISOString(),
  });
  return listMockAccounts();
}

function conflict(message: string) {
  const error = new Error(message);
  error.name = "ConflictError";
  return error;
}
