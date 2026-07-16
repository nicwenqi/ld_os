import type {
  DepartmentEmployeeDirectoryOptions,
  EmployeeDirectoryOptions,
  EmployeeRepository,
} from "../repositories/contracts/employee-repository.ts";

type EmployeeDirectoryRepository = Pick<
  EmployeeRepository,
  "listEmployeesPage" | "listDepartmentEmployees" | "getEmployee"
>;

function normalizePage<T extends { limit?: number; offset?: number }>(options: T): T & { limit: number; offset: number } {
  const limit = Math.min(100, Math.max(1, Number(options.limit ?? 25)));
  const offset = Math.max(0, Number(options.offset ?? 0));
  return { ...options, limit, offset };
}

export function createEmployeeService(repository: EmployeeDirectoryRepository) {
  return {
    listManagerDirectory(propertyId: string, options: EmployeeDirectoryOptions = {}) {
      if (!propertyId) throw new Error("当前账号尚未取得酒店范围");
      return repository.listEmployeesPage(propertyId, normalizePage(options));
    },
    listDepartmentDirectory(options: DepartmentEmployeeDirectoryOptions & Record<string, unknown> = {}) {
      const allowed: DepartmentEmployeeDirectoryOptions = {};
      if (typeof options.query === "string") allowed.query = options.query;
      if (options.employmentStatus) allowed.employmentStatus = options.employmentStatus;
      if (options.limit !== undefined) allowed.limit = options.limit;
      if (options.offset !== undefined) allowed.offset = options.offset;
      return repository.listDepartmentEmployees(normalizePage(allowed));
    },
    refreshEmployee(employeeId: string) {
      if (!employeeId) throw new Error("员工记录标识无效");
      return repository.getEmployee(employeeId);
    },
  };
}
