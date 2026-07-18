import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canRoleAccessPath } from "../app/services/auth-routing.ts";
import { loadScopedDepartmentEmployees } from "../app/services/department-foundation.ts";
import { createMockSession } from "../app/api/auth/mock-session-store.ts";
import { createMockEmployeeRepository } from "../app/repositories/mock/employee-repository.ts";

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

const optionalImport = async path => {
  try {
    return await import(path);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ERR_MODULE_NOT_FOUND"
    ) {
      return null;
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

test("manager filter facets load independently from active current-property organization authority", async () => {
  const peopleFoundation = await optionalImport(
    "../app/services/people-foundation.ts",
  );
  assert.ok(
    peopleFoundation,
    "manager People facets need a dedicated organization-backed service",
  );

  const calls = [];
  const facets = await peopleFoundation.loadManagerPeopleFacets(
    {
      department: {
        async listTree(propertyId) {
          calls.push(["departments", propertyId]);
          return [
            {
              id: "rooms",
              propertyId,
              nameZh: "房务部",
              nameEn: "Rooms",
              sortOrder: 20,
              isActive: true,
            },
            {
              id: "front-office",
              propertyId,
              nameZh: "前厅部",
              nameEn: "Front Office",
              sortOrder: 10,
              isActive: true,
            },
            {
              id: "inactive-department",
              propertyId,
              nameZh: "停用部门",
              nameEn: null,
              sortOrder: 0,
              isActive: false,
            },
            {
              id: "foreign-department",
              propertyId: "property-b",
              nameZh: "其他酒店部门",
              nameEn: null,
              sortOrder: 0,
              isActive: true,
            },
          ];
        },
      },
      position: {
        async listPositions(propertyId) {
          calls.push(["positions", propertyId]);
          return [
            {
              id: "supervisor",
              propertyId,
              nameZh: "主管",
              nameEn: "Supervisor",
              isActive: true,
            },
            {
              id: "associate",
              propertyId,
              nameZh: "宾客服务专员",
              nameEn: "Guest Service Associate",
              isActive: true,
            },
            {
              id: "inactive-position",
              propertyId,
              nameZh: "停用职位",
              nameEn: null,
              isActive: false,
            },
          ];
        },
        async listPositionFamilies(propertyId) {
          calls.push(["position-families", propertyId]);
          return [
            {
              id: "leadership",
              propertyId,
              nameZh: "管理岗位",
              nameEn: "Leadership",
              sortOrder: 20,
              isActive: true,
            },
            {
              id: "frontline",
              propertyId,
              nameZh: "一线员工",
              nameEn: "Frontline",
              sortOrder: 10,
              isActive: true,
            },
            {
              id: "inactive-family",
              propertyId,
              nameZh: "停用职位族",
              nameEn: null,
              sortOrder: 0,
              isActive: false,
            },
          ];
        },
      },
      employee: {
        async listEmployees() {
          throw new Error("facet loading must not scan employee rows");
        },
      },
    },
    "property-a",
  );

  assert.deepEqual(calls, [
    ["departments", "property-a"],
    ["positions", "property-a"],
    ["position-families", "property-a"],
  ]);
  assert.deepEqual(facets, {
    departments: [
      { id: "front-office", label: "前厅部" },
      { id: "rooms", label: "房务部" },
    ],
    positions: [
      { id: "associate", label: "宾客服务专员" },
      { id: "supervisor", label: "主管" },
    ],
    positionFamilies: [
      { id: "frontline", label: "一线员工" },
      { id: "leadership", label: "管理岗位" },
    ],
  });

  const page = await read("../app/people/page.tsx");
  assert.match(page, /loadManagerPeopleFacets\(registry, propertyId\)/);
  assert.match(page, /facetOptions\.departments/);
  assert.match(page, /facetOptions\.positions/);
  assert.match(page, /facetOptions\.positionFamilies/);
  assert.doesNotMatch(page, /uniqueOptions\(\s*rows\.map/);
});

test("manager profile refresh ignores stale requests after selection, close, and unmount", async () => {
  const requestGateModule = await optionalImport(
    "../app/lib/latest-request-gate.ts",
  );
  assert.ok(
    requestGateModule,
    "profile refresh needs a reusable latest-request gate",
  );

  const gate = requestGateModule.createLatestRequestGate();
  const requestA = gate.begin();
  assert.equal(gate.isCurrent(requestA), true);
  const requestB = gate.begin();
  assert.equal(gate.isCurrent(requestA), false);
  assert.equal(gate.isCurrent(requestB), true);
  gate.invalidate();
  assert.equal(gate.isCurrent(requestB), false);

  const page = await read("../app/people/page.tsx");
  assert.match(page, /createLatestRequestGate\(\)/);
  assert.match(page, /const requestToken = profileRequestGate\.begin\(\)/);
  assert.ok(
    (page.match(/profileRequestGate\.isCurrent\(requestToken\)/g) ?? [])
      .length >= 2,
    "success and failure paths must both correlate the active request",
  );
  assert.ok(
    (page.match(/profileRequestGate\.invalidate\(\)/g) ?? []).length >= 2,
    "close and unmount must both invalidate pending profile requests",
  );
});

test("People directory responsive CSS preserves avatar sizing and explicit tablet placement", async () => {
  const css = await read("../app/recovery-a.css");

  assert.match(css, /\.employee-identity-cell\s*>\s*span:first-child\s*\{/);
  assert.doesNotMatch(css, /\.employee-identity-cell\s*>\s*span\s*\{/);
  assert.match(css, /\.employee-identity-cell\s*>\s*span:last-child\s*\{[^}]*min-width:0/);
  assert.match(css, /overflow-wrap:anywhere/);
  assert.match(
    css,
    /@media\s*\(min-width:651px\)\s*and\s*\(max-width:1000px\)/,
  );
  assert.match(
    css,
    /\.employee-directory-manager\s+\.people-list\s+article\s*>\s*span:first-child\s*\{[^}]*grid-column:1/,
  );
  assert.match(
    css,
    /\.employee-directory-manager\s+\.identity-cell\s*\{[^}]*grid-column:2/,
  );
  assert.match(
    css,
    /\.employee-directory-manager\s+\.dept-cell\s*\{[^}]*grid-column:3/,
  );
  assert.match(
    css,
    /\.employee-directory-manager\s+\.next-cell\s*\{[^}]*grid-column:2\s*\/\s*-1/,
  );
});

test("employee update history deep link resolves to the real history section", async () => {
  const history = await read("../app/components/import/EmployeeUpdateHistory.tsx");
  assert.match(history, /id="update-history"/);
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

test("local review department directory enforces the authorized branch and descendants", async () => {
  const repository = createMockEmployeeRepository({
    departmentScopes: departmentSession.departmentScopes,
  });

  const page = await repository.listDepartmentEmployees({ limit: 25, offset: 0 });

  assert.deepEqual(page.rows.map(employee => employee.employeeNumber), ["0007"]);
  assert.equal(page.total, 1);
  assert.equal(page.rows.some(employee => employee.departmentName === "工程部"), false);
});

test("local review browser employee source derives scope from the server session", async () => {
  const route = await optionalImport("../app/api/mock-employees/route.ts");
  assert.ok(route, "local review needs an actor-scoped employee endpoint");

  const token = createMockSession({
    ...departmentSession,
    userId: "synthetic-department-responsible",
    propertyId: "synthetic-property-a1",
  });
  const request = new Request("http://localhost:3000/api/mock-employees", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `hotel_ld_session=${encodeURIComponent(token)}`,
    },
    body: JSON.stringify({
      action: "listDepartmentEmployees",
      input: {
        query: "",
        limit: 25,
        offset: 0,
        departmentId: "engineering",
      },
    }),
  });

  const response = await route.POST(request);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(payload.rows.map(employee => employee.employeeNumber), ["0007"]);
  assert.equal(payload.total, 1);

  const repositorySource = await read("../app/repositories/mock/employee-repository.ts");
  assert.match(repositorySource, /\/api\/mock-employees/);
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
