import type {
  DepartmentEmployeeDirectoryOptions,
  EmployeeDirectoryOptions,
  EmployeeRecord,
  EmployeeRepository,
} from "../contracts/employee-repository.ts";
import type { AuthorizedDepartmentScope } from "../contracts/auth-repository.ts";

type MockEmployeeRepositoryOptions = {
  departmentScopes?: readonly AuthorizedDepartmentScope[];
};

const departmentPathIds: Record<string, readonly string[]> = {
  concierge: ["rooms", "front-office", "concierge"],
  engineering: ["engineering"],
};

const rows: EmployeeRecord[] = [
  {
    id: "synthetic-employee-0007",
    tenantId: "synthetic-tenant-a",
    propertyId: "synthetic-property-a1",
    employeeNumber: "0007",
    nameZh: "示例员工甲",
    nameEn: "Synthetic Associate A",
    departmentId: "concierge",
    departmentName: "房务部 › 前厅部 › 礼宾部",
    operationalUnitId: null,
    operationalUnitName: null,
    positionId: "guest-service-associate",
    positionName: "宾客服务专员",
    positionFamilyId: "associate",
    positionFamilyName: "一线员工",
    gradeOrBand: "A2",
    hireDate: "2026-06-01",
    probationOrConfirmationDate: "2026-09-01",
    employmentStatus: "active",
    isNewEmployee: true,
    isActive: true,
    externalIdentifierTypes: ["LMS"],
    version: 1,
  },
  {
    id: "synthetic-employee-0012",
    tenantId: "synthetic-tenant-a",
    propertyId: "synthetic-property-a1",
    employeeNumber: "0012",
    nameZh: "示例员工乙",
    nameEn: "Synthetic Engineer B",
    departmentId: "engineering",
    departmentName: "工程部",
    operationalUnitId: null,
    operationalUnitName: null,
    positionId: "engineer",
    positionName: "工程技工",
    positionFamilyId: "engineering",
    positionFamilyName: "工程岗位",
    gradeOrBand: "T2",
    hireDate: "2024-03-12",
    probationOrConfirmationDate: "2024-06-12",
    employmentStatus: "active",
    isNewEmployee: false,
    isActive: true,
    externalIdentifierTypes: [],
    version: 1,
  },
];

function filtered(
  options: EmployeeDirectoryOptions | DepartmentEmployeeDirectoryOptions = {},
  propertyId?: string,
  include: (employee: EmployeeRecord) => boolean = () => true,
) {
  const query = options.query?.trim().toLocaleLowerCase("zh-CN");
  return rows.filter(employee => {
    if (!include(employee)) return false;
    if (propertyId && employee.propertyId !== propertyId) return false;
    if ("active" in options && options.active !== undefined && employee.isActive !== options.active) return false;
    if ("departmentId" in options && options.departmentId && employee.departmentId !== options.departmentId) return false;
    if ("positionId" in options && options.positionId && employee.positionId !== options.positionId) return false;
    if ("positionFamilyId" in options && options.positionFamilyId && employee.positionFamilyId !== options.positionFamilyId) return false;
    if ("employmentStatus" in options && options.employmentStatus && employee.employmentStatus !== options.employmentStatus) return false;
    return !query || `${employee.employeeNumber}${employee.nameZh}${employee.nameEn}`.toLocaleLowerCase("zh-CN").includes(query);
  });
}

function page(
  options: EmployeeDirectoryOptions | DepartmentEmployeeDirectoryOptions = {},
  propertyId?: string,
  include?: (employee: EmployeeRecord) => boolean,
) {
  const matches = filtered(options, propertyId, include);
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));
  return {
    rows: matches.slice(offset, offset + limit),
    total: matches.length,
    refreshedAt: new Date().toISOString(),
  };
}

export function createMockEmployeeRepository(options: MockEmployeeRepositoryOptions = {}): EmployeeRepository {
  const repositoryOptions = options;
  const repository: EmployeeRepository = {
    async listEmployees(_propertyId, options) {
      return page({ ...options, limit: options?.limit ?? 100 }, _propertyId).rows;
    },
    async listEmployeesPage(_propertyId, options) {
      return page(options, _propertyId);
    },
    async listDepartmentEmployees(options) {
      const scoped = page(
        options,
        "synthetic-property-a1",
        employee => isAuthorizedDepartmentEmployee(
          employee,
          repositoryOptions.departmentScopes ?? [],
        ),
      );
      return {
        ...scoped,
        rows: scoped.rows.map(employee => ({
          ...employee,
          tenantId: "",
          propertyId: "",
          gradeOrBand: null,
          externalIdentifierTypes: [],
          version: 0,
        })),
      };
    },
    async getEmployee(id) {
      return rows.find(employee => employee.id === id) ?? null;
    },
    async findByEmployeeNumber(_propertyId, employeeNumber) {
      return rows.find(employee => employee.employeeNumber === employeeNumber) ?? null;
    },
    async previewEmployeeChanges(_propertyId, input) {
      const before = rows.find(employee => employee.employeeNumber === input.employeeNumber) ?? null;
      return { action: before ? "update" : "insert", before, after: input, reasons: [] };
    },
    async createEmployee(input) {
      const row: EmployeeRecord = {
        ...input,
        id: `synthetic-${Date.now()}`,
        departmentName: "待加载",
        operationalUnitName: null,
        positionName: null,
        positionFamilyName: null,
        externalIdentifierTypes: [],
        version: 1,
      };
      rows.push(row);
      return row;
    },
    async updateEmployee(id, version, changes) {
      const index = rows.findIndex(employee => employee.id === id && employee.version === version);
      if (index < 0) throw new Error("员工资料已更新，请刷新后重试");
      rows[index] = { ...rows[index], ...changes, version: version + 1 };
      return rows[index];
    },
    async activateEmployee(id, version) {
      return this.updateEmployee(id, version, { isActive: true, employmentStatus: "active" });
    },
    async deactivateEmployee(id, version) {
      return this.updateEmployee(id, version, { isActive: false, employmentStatus: "inactive" });
    },
    async listExternalIdentifiers(id) {
      return rows.find(employee => employee.id === id)?.externalIdentifierTypes.map(type => ({
        type,
        value: "已连接",
        sourceSystem: "synthetic",
        isPrimary: false,
      })) ?? [];
    },
  };
  if (typeof window === "undefined") return repository;
  return {
    ...repository,
    listDepartmentEmployees: input => mockEmployeeRequest(input),
  };
}

function isAuthorizedDepartmentEmployee(
  employee: EmployeeRecord,
  scopes: readonly AuthorizedDepartmentScope[],
) {
  const path = departmentPathIds[employee.departmentId] ?? [employee.departmentId];
  return scopes.some(scope => (
    scope.departmentId === employee.departmentId
    || (scope.includeDescendants && path.includes(scope.departmentId))
  ));
}

async function mockEmployeeRequest(
  input: DepartmentEmployeeDirectoryOptions = {},
) {
  const response = await fetch("/api/mock-employees", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "listDepartmentEmployees",
      input: {
        query: input.query,
        limit: input.limit,
        offset: input.offset,
      },
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message ?? "本地授权员工目录不可用");
  }
  return payload;
}
