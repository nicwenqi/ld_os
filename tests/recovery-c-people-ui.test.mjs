import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canRoleAccessPath } from "../app/services/auth-routing.ts";
import { loadScopedDepartmentEmployees } from "../app/services/department-foundation.ts";

const read = async path => {
  try {
    return await readFile(new URL(path, import.meta.url), "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
};

const departmentSession = {
  authenticated: true,
  userId: "department-user",
  displayName: "部门培训负责人",
  propertyId: "property-a",
  propertyNameZh: "示例酒店",
  propertyNameEn: "Example Hotel",
  propertyLogoUrl: null,
  role: "department_training_responsible",
  departmentScopes: [
    {
      departmentId: "front-office",
      departmentNameZh: "前厅部",
      departmentNameEn: "Front Office",
      breadcrumb: ["房务部", "前厅部"],
      breadcrumbEn: ["Rooms", "Front Office"],
      includeDescendants: true,
    },
  ],
  mustChangePassword: false,
};

const scopedEmployee = {
  id: "department:0007",
  tenantId: "",
  propertyId: "",
  employeeNumber: "0007",
  nameZh: "示例员工",
  nameEn: "Synthetic Associate",
  departmentId: "front-office",
  departmentName: "前厅部",
  operationalUnitId: null,
  operationalUnitName: null,
  positionId: "guest-service",
  positionName: "宾客服务专员",
  positionFamilyId: "associate",
  positionFamilyName: "一线员工",
  gradeOrBand: null,
  hireDate: "2026-06-01",
  probationOrConfirmationDate: "2026-09-01",
  employmentStatus: "active",
  isNewEmployee: true,
  isActive: true,
  externalIdentifierTypes: [],
  version: 0,
};

test("manager People Center uses current-property paginated authority and truthful filters", async () => {
  const [page, directory, drawer] = await Promise.all([
    read("../app/people/page.tsx"),
    read("../app/components/people/EmployeeDirectory.tsx"),
    read("../app/components/people/EmployeeProfileDrawer.tsx"),
  ]);

  for (const token of [
    "createEmployeeService",
    "listManagerDirectory",
    "session.propertyId",
    "departmentId",
    "positionId",
    "positionFamilyId",
    "employmentStatus",
    "PAGE_SIZE",
    "EmployeeDirectory",
    "EmployeeProfileDrawer",
    "refreshEmployee",
    "员工资料权威来源",
    "员工登录账号",
    "培训历史尚未接入",
  ]) {
    assert.match(page, new RegExp(token));
  }
  assert.match(drawer, /href=\{updateHistoryHref\}/);
  assert.match(page, /updateHistoryHref="\/import#update-history"/);
  assert.match(directory, /aria-label="员工列表分页"/);
  assert.match(directory, /onPageChange\(offset - pageSize\)/);
  assert.match(directory, /onPageChange\(offset \+ pageSize\)/);
  assert.doesNotMatch(page, /\.listEmployees\(/);
  assert.doesNotMatch(`${page}\n${drawer}`, /完成率|培训时数|课程|签到|反馈|风险标签/);
  assert.doesNotMatch(`${page}\n${drawer}`, /externalIdentifierTypes|外部资料标识/);
});

test("department foundation calls only the server-scoped directory and strips forged scope", async () => {
  const calls = [];
  const snapshot = await loadScopedDepartmentEmployees(
    {
      environment: { dataMode: "supabase" },
      property: {
        async resolveContext() {
          throw new Error("property repository must not be used");
        },
      },
      department: {
        async listTree() {
          throw new Error("organization repository must not be used");
        },
      },
      employee: {
        async listEmployees() {
          throw new Error("full employee repository must not be used");
        },
        async listEmployeesPage() {
          throw new Error("manager employee repository must not be used");
        },
        async listDepartmentEmployees(options) {
          calls.push(options);
          return {
            rows: [scopedEmployee],
            total: 1,
            refreshedAt: "2026-07-16T09:00:00.000Z",
          };
        },
        async getEmployee() {
          throw new Error("base employee detail must not be used");
        },
      },
    },
    departmentSession,
    {
      query: "0007",
      limit: 25,
      offset: 0,
      propertyId: "forged-property",
      departmentId: "forged-department",
    },
  );

  assert.deepEqual(calls, [{ query: "0007", limit: 25, offset: 0 }]);
  assert.equal(snapshot.presentationState, "real");
  assert.equal(snapshot.total, 1);
  assert.equal(snapshot.employees[0].employeeNumber, "0007");
  assert.deepEqual(snapshot.scopes, departmentSession.departmentScopes);
});

test("department People Center makes scope and descendant behavior explicit with approved fields only", async () => {
  const [page, directory, drawer] = await Promise.all([
    read("../app/department/employees/page.tsx"),
    read("../app/components/people/EmployeeDirectory.tsx"),
    read("../app/components/people/EmployeeProfileDrawer.tsx"),
  ]);

  for (const token of [
    "snapshot.scopes",
    "scope.breadcrumb",
    "scope.includeDescendants",
    "EmployeeDirectory",
    "EmployeeProfileDrawer",
    'audience="department"',
    "授权范围内可见记录",
    "培训历史尚未接入",
  ]) {
    assert.match(page, new RegExp(token));
  }
  for (const field of [
    "employeeNumber",
    "nameZh",
    "nameEn",
    "departmentName",
    "operationalUnitName",
    "positionName",
    "positionFamilyName",
    "hireDate",
    "probationOrConfirmationDate",
    "employmentStatus",
    "isNewEmployee",
  ]) {
    assert.match(`${directory}\n${drawer}`, new RegExp(field));
  }
  assert.doesNotMatch(page, /\/import|全酒店|工作簿|外部资料标识|externalIdentifier|tenantId|propertyId|version/);
  assert.doesNotMatch(`${directory}\n${drawer}`, /externalIdentifierTypes|外部资料标识/);
});

test("shared employee profile drawer manages initial focus, trapping, restoration, and dismissal", async () => {
  const drawer = await read("../app/components/people/EmployeeProfileDrawer.tsx");

  for (const pattern of [
    /closeButtonRef\.current\?\.focus\(\)/,
    /event\.key (?:===|!==) "Tab"/,
    /event\.key === "Escape"/,
    /document\.body\.style\.overflow = "hidden"/,
    /returnFocus\?\.focus\(\)/,
    /event\.target === event\.currentTarget/,
    /aria-modal="true"/,
    /role="dialog"/,
  ]) {
    assert.match(drawer, pattern);
  }
});

test("department direct URLs remain denied for manager People and employee update", () => {
  assert.equal(
    canRoleAccessPath("department_training_responsible", "/people"),
    false,
  );
  assert.equal(
    canRoleAccessPath("department_training_responsible", "/import"),
    false,
  );
  assert.equal(
    canRoleAccessPath("department_training_responsible", "/department/employees"),
    true,
  );
});
