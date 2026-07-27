import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadScopedDepartmentEmployees } from "../app/services/department-foundation.ts";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("department home is driven by server-authorized scope facts", async () => {
  const page = await read("../app/department/page.tsx");
  for (const token of [
    "session.departmentScopes",
    "授权部门范围",
    "部门运营暂时无法判断",
    "本部门员工",
    "尚未接入真实数据",
    "includeDescendants",
  ]) {
    assert.match(page, new RegExp(token));
  }
  assert.doesNotMatch(page, /合成演示范围|前厅部及其下级部门（合成/);
  assert.doesNotMatch(page, /酒店设置|员工资料更新|账号管理|全酒店 KPI/);
});

test("an empty department source-error collection does not render numeric zero", async () => {
  const page = await read("../app/department/page.tsx");
  assert.match(
    page,
    /Boolean\(loadError \|\| snapshot\?\.errors\.length\)/,
  );
});

test("department employee view applies authorized branch and descendant boundaries", async () => {
  const page = await read("../app/department/employees/page.tsx");
  for (const token of [
    "loadScopedDepartmentEmployees",
    "session.departmentScopes",
    "本部门员工",
    "培训历史尚未接入",
    "返回部门工作台",
  ]) {
    assert.match(page, new RegExp(token));
  }
  assert.doesNotMatch(page, /synthetic-property-a1|useDepartmentScope/);
});

test("real-mode department scope uses only the narrow employee directory boundary", async () => {
  let departmentReads = 0;
  let managerEmployeeReads = 0;
  let scopedEmployeeReads = 0;
  const snapshot = await loadScopedDepartmentEmployees(
    {
      environment: { dataMode: "supabase" },
      department: {
        async listTree() {
          departmentReads += 1;
          return [];
        },
      },
      employee: {
        async listEmployees() {
          managerEmployeeReads += 1;
          return [];
        },
        async listEmployeesPage() {
          managerEmployeeReads += 1;
          return { rows: [], total: 0, refreshedAt: "2026-07-16T09:00:00.000Z" };
        },
        async listDepartmentEmployees() {
          scopedEmployeeReads += 1;
          return {
            rows: [],
            total: 0,
            refreshedAt: "2026-07-16T09:00:00.000Z",
          };
        },
        async getEmployee() {
          managerEmployeeReads += 1;
          return null;
        },
      },
    },
    {
      authenticated: true,
      userId: "authorized-department-user",
      displayName: "部门培训负责人",
      propertyId: "property-a",
      propertyNameZh: "酒店",
      propertyNameEn: "Hotel",
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
    },
  );

  assert.equal(snapshot.presentationState, "real");
  assert.equal(snapshot.employees.length, 0);
  assert.equal(snapshot.total, 0);
  assert.equal(departmentReads, 0);
  assert.equal(managerEmployeeReads, 0);
  assert.equal(scopedEmployeeReads, 1);
});

test("local-review department scope also stays on the scoped employee source", async () => {
  let departmentReads = 0;
  let managerEmployeeReads = 0;
  let scopedEmployeeReads = 0;
  const snapshot = await loadScopedDepartmentEmployees(
    {
      environment: { dataMode: "mock" },
      property: {
        async resolveContext() {
          return { propertyId: "synthetic-property-a1" };
        },
      },
      department: {
        async listTree() {
          departmentReads += 1;
          return [];
        },
      },
      employee: {
        async listEmployees() {
          managerEmployeeReads += 1;
          return [];
        },
        async listEmployeesPage() {
          managerEmployeeReads += 1;
          return { rows: [], total: 0, refreshedAt: "2026-07-16T09:00:00.000Z" };
        },
        async listDepartmentEmployees() {
          scopedEmployeeReads += 1;
          return {
            rows: [],
            total: 0,
            refreshedAt: "2026-07-16T09:00:00.000Z",
          };
        },
        async getEmployee() {
          managerEmployeeReads += 1;
          return null;
        },
      },
    },
    {
      authenticated: true,
      userId: "synthetic-department-responsible",
      displayName: "部门培训负责人（本地验证）",
      propertyId: "synthetic-property-a1",
      propertyNameZh: "示范酒店",
      propertyNameEn: "Synthetic Hotel",
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
    },
  );

  assert.equal(snapshot.presentationState, "demo");
  assert.equal(snapshot.employees.length, 0);
  assert.equal(snapshot.total, 0);
  assert.equal(departmentReads, 0);
  assert.equal(managerEmployeeReads, 0);
  assert.equal(scopedEmployeeReads, 1);
});

test("department operational routes explain unavailable facts and return home", async () => {
  for (const route of [
    "calendar",
    "attendance-feedback",
    "remediation",
    "data",
  ]) {
    const page = await read(`../app/department/${route}/page.tsx`);
    assert.match(page, /UnavailableOperationalPage/);
    assert.match(page, /returnHref="\/department"/);
  }
  const sessions = await read("../app/department/sessions/page.tsx");
  assert.match(sessions, /DepartmentSessionWorkspace/);
  assert.doesNotMatch(sessions, /UnavailableOperationalPage/);
  const unavailable = await read(
    "../app/components/operations/UnavailableOperationalPage.tsx",
  );
  assert.match(unavailable, /尚未接入真实数据/);
  assert.match(unavailable, /DataStateBadge/);
  assert.doesNotMatch(unavailable, /showToast/);
});

test("department experience has responsive premium layout", async () => {
  const css = await read("../app/recovery-a.css");
  for (const token of [
    "department-command-center",
    "department-scope-hero",
    "department-foundation-grid",
    "scoped-employee-list",
  ]) {
    assert.match(css, new RegExp(token));
  }
});
