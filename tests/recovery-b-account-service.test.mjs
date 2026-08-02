import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  accountRoleLabel,
  validateBackendPassword,
  validateAccountDraft,
} from "../app/services/account-administration.ts";
import { createMockSession } from "../app/api/auth/mock-session-store.ts";
import { requireLocalReviewManager } from "../app/services/local-review-authorization.ts";

test("account draft accepts only the two approved hotel roles", () => {
  assert.equal(accountRoleLabel("property_ld_manager"), "酒店学习与发展经理");
  assert.equal(accountRoleLabel("department_training_admin"), "部门培训负责人");
  assert.throws(
    () => validateAccountDraft({
      displayName: "普通员工",
      loginId: "employee-001",
      temporaryPassword: "HotelDemo2026",
      roleCode: "employee_participant",
      scopes: [],
    }),
    /仅支持酒店学习与发展经理和部门培训负责人/,
  );
});

test("department responsible accounts require explicit unique department scopes", () => {
  assert.throws(
    () => validateAccountDraft({
      displayName: "部门负责人",
      loginId: "dept-owner",
      temporaryPassword: "HotelDemo2026",
      roleCode: "department_training_admin",
      scopes: [],
    }),
    /至少选择一个正式部门范围/,
  );
  assert.throws(
    () => validateAccountDraft({
      displayName: "部门负责人",
      loginId: "dept-owner",
      temporaryPassword: "HotelDemo2026",
      roleCode: "department_training_admin",
      scopes: [
        { departmentId: "front-office", includeDescendants: true },
        { departmentId: "front-office", includeDescendants: false },
      ],
    }),
    /部门范围不能重复/,
  );
});

test("manager accounts cannot carry department scopes and temporary credentials are server-generated", () => {
  assert.throws(
    () => validateAccountDraft({
      displayName: "经理",
      loginId: "manager",
      roleCode: "property_ld_manager",
      scopes: [{ departmentId: "front-office", includeDescendants: true }],
    }),
    /酒店学习与发展经理不使用部门范围/,
  );
});

test("local-review administration APIs require the approved manager role", () => {
  const managerToken = createMockSession({
    authenticated: true,
    userId: "synthetic-property-manager",
    displayName: "学习与发展经理",
    propertyId: "synthetic-property-a1",
    propertyNameZh: "示范酒店",
    propertyNameEn: "Synthetic Hotel",
    propertyLogoUrl: null,
    role: "property_ld_manager",
    departmentScopes: [],
    mustChangePassword: false,
  });
  assert.equal(
    requireLocalReviewManager(new Request("http://localhost/api", {
      headers: { cookie: `hotel_ld_session=${managerToken}` },
    })).role,
    "property_ld_manager",
  );

  const departmentToken = createMockSession({
    authenticated: true,
    userId: "synthetic-department-responsible",
    displayName: "部门培训负责人",
    propertyId: "synthetic-property-a1",
    propertyNameZh: "示范酒店",
    propertyNameEn: "Synthetic Hotel",
    propertyLogoUrl: null,
    role: "department_training_responsible",
    departmentScopes: [],
    mustChangePassword: false,
  });
  assert.throws(
    () => requireLocalReviewManager(new Request("http://localhost/api", {
      headers: { cookie: `hotel_ld_session=${departmentToken}` },
    })),
    /仅酒店学习与发展经理/,
  );
  assert.throws(
    () => requireLocalReviewManager(new Request("http://localhost/api")),
    /请先登录当前酒店/,
  );
});

test("new backend passwords have a complete forced-change and manager-reset flow", async () => {
  assert.throws(() => validateBackendPassword("short"), /至少 12 位/);
  assert.throws(() => validateBackendPassword("letters-only-password"), /字母和数字/);
  assert.doesNotThrow(() => validateBackendPassword("HotelAccount2026"));

  const [sessionGate, loginRoute, changeRoute, changePage, accountRoute, accountPage] =
    await Promise.all([
      readFile(new URL("../app/components/auth/SessionGate.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/auth/change-password/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/change-password/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/api/admin/accounts/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/accounts/page.tsx", import.meta.url), "utf8"),
    ]);
  assert.match(sessionGate, /mustChangePassword/);
  assert.match(loginRoute, /change-password/);
  assert.match(changeRoute, /resolvePasswordChangeRequest/);
  assert.match(changeRoute, /auth\.updateUser/);
  assert.match(changeRoute, /auth\.setSession/);
  assert.match(changeRoute, /prepare_hotel_password_change/);
  assert.match(changeRoute, /complete_hotel_password_change/);
  assert.match(changeRoute, /reauthenticationRequired/);
  assert.match(changeRoute, /validateUserSelectedPassword/);
  assert.match(changePage, /minLength=\{8\}/);
  assert.doesNotMatch(changeRoute, /must_change_password:\s*false/);
  assert.match(changePage, /保存新密码并继续/);
  assert.match(accountRoute, /prepare_property_backend_account_password_reset/);
  assert.match(accountRoute, /updateUserById/);
  assert.match(accountPage, /重置登录密码/);
  assert.match(accountPage, /本地验证资料不会创建或修改真实认证密码/);
});
