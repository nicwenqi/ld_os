import type {
  DepartmentEmployeeDirectoryOptions,
  EmployeeDirectoryOptions,
  EmployeeDirectoryPage,
  EmployeeRecord,
  EmployeeRepository,
} from "../contracts/employee-repository.ts";

export function createHttpEmployeeRepository(): EmployeeRepository {
  return {
    async listEmployees(_propertyId, options = {}) {
      const rows: EmployeeRecord[] = [];
      let offset = Math.max(0, options.offset ?? 0);
      let total = Number.POSITIVE_INFINITY;

      while (offset < total) {
        const page = await managerPage({ ...options, limit: 100, offset });
        rows.push(...page.rows);
        total = page.total;
        if (page.rows.length === 0) break;
        offset += page.rows.length;
      }
      return rows;
    },

    async listEmployeesPage(_propertyId, options = {}) {
      return managerPage(options);
    },

    async listDepartmentEmployees(options = {}) {
      return request<EmployeeDirectoryPage>("/api/people/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(departmentWireOptions(options)),
      });
    },

    async getEmployee(id) {
      const response = await fetch(
        `/api/people/employees/${encodeURIComponent(id)}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      if (response.status === 404) return null;
      const payload = await response.json() as EmployeeRecord & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? "员工目录服务暂时不可用");
      }
      return payload;
    },

    async findByEmployeeNumber(_propertyId, employeeNumber) {
      let offset = 0;
      let total = Number.POSITIVE_INFINITY;

      while (offset < total) {
        const page = await managerPage({
          query: employeeNumber,
          limit: 100,
          offset,
        });
        const match = page.rows.find(
          row => row.employeeNumber === employeeNumber,
        );
        if (match) return match;
        total = page.total;
        if (page.rows.length === 0) break;
        offset += page.rows.length;
      }

      return null;
    },

    async listExternalIdentifiers() {
      throw new Error("Neon People 只读切片不提供员工外部标识值");
    },
  };
}

function managerPage(options: EmployeeDirectoryOptions) {
  const search = new URLSearchParams();
  append(search, "query", options.query?.trim());
  append(search, "departmentId", options.departmentId);
  append(search, "positionId", options.positionId);
  append(search, "positionFamilyId", options.positionFamilyId);
  append(search, "employmentStatus", options.employmentStatus);
  if (options.active !== undefined) search.set("active", String(options.active));
  search.set("limit", String(options.limit ?? 25));
  search.set("offset", String(options.offset ?? 0));
  return request<EmployeeDirectoryPage>(`/api/people/employees?${search}`);
}

function departmentWireOptions(options: DepartmentEmployeeDirectoryOptions) {
  return {
    ...(options.query?.trim() ? { query: options.query.trim() } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.offset !== undefined ? { offset: options.offset } : {}),
  };
}

function append(search: URLSearchParams, name: string, value: string | undefined) {
  if (value) search.set(name, value);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
  });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? "员工目录服务暂时不可用");
  }
  return payload;
}
