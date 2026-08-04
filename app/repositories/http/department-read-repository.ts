import type { DepartmentRepository } from "../contracts/department-repository.ts";
import type { DepartmentNode } from "../contracts/organization-models.ts";

type DepartmentReadRepository = Pick<
  DepartmentRepository,
  "listTree" | "getNode" | "getAncestors" | "getDescendants"
>;

export function createHttpDepartmentReadRepository(): DepartmentReadRepository {
  return {
    listTree(_propertyId) {
      return request<DepartmentNode[]>("/api/organization/departments");
    },
    getNode(id) {
      return request<DepartmentNode>(departmentUrl(id));
    },
    getAncestors(id) {
      return request<DepartmentNode[]>(`${departmentUrl(id)}/ancestors`);
    },
    getDescendants(id) {
      return request<DepartmentNode[]>(`${departmentUrl(id)}/descendants`);
    },
  };
}

function departmentUrl(id: string) {
  return `/api/organization/departments/${encodeURIComponent(id)}`;
}

async function request<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? "组织架构服务暂时不可用");
  }
  return payload;
}
