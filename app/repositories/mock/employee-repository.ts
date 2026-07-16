import type {
  DepartmentEmployeeDirectoryOptions,
  EmployeeDirectoryOptions,
  EmployeeRecord,
  EmployeeRepository,
} from "../contracts/employee-repository.ts";

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

function filtered(options: EmployeeDirectoryOptions | DepartmentEmployeeDirectoryOptions = {}) {
  const query = options.query?.trim().toLocaleLowerCase("zh-CN");
  return rows.filter(employee => {
    if ("active" in options && options.active !== undefined && employee.isActive !== options.active) return false;
    if ("departmentId" in options && options.departmentId && employee.departmentId !== options.departmentId) return false;
    if ("positionId" in options && options.positionId && employee.positionId !== options.positionId) return false;
    if ("positionFamilyId" in options && options.positionFamilyId && employee.positionFamilyId !== options.positionFamilyId) return false;
    if (options.employmentStatus && employee.employmentStatus !== options.employmentStatus) return false;
    return !query || `${employee.employeeNumber}${employee.nameZh}${employee.nameEn}`.toLocaleLowerCase("zh-CN").includes(query);
  });
}

function page(options: EmployeeDirectoryOptions | DepartmentEmployeeDirectoryOptions = {}) {
  const matches = filtered(options);
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));
  return {
    rows: matches.slice(offset, offset + limit),
    total: matches.length,
    refreshedAt: new Date().toISOString(),
  };
}

export function createMockEmployeeRepository(): EmployeeRepository {
  return {
    async listEmployees(_propertyId, options) {
      return page({ ...options, limit: options?.limit ?? 100 }).rows;
    },
    async listEmployeesPage(_propertyId, options) {
      return page(options);
    },
    async listDepartmentEmployees(options) {
      return page(options);
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
}
