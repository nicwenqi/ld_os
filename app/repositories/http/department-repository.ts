import type {
  CreateOperationalUnitInput,
  DepartmentRepository,
  SaveOperationalUnitInput,
  UpdateDepartmentInput,
} from "../contracts/department-repository.ts";
import type {
  DepartmentAlias,
  DepartmentMovePreview,
  DepartmentNode,
  OperationalUnit,
} from "../contracts/organization-models.ts";
import { createHttpDepartmentReadRepository } from "./department-read-repository.ts";

export function createHttpDepartmentRepository(): DepartmentRepository {
  const read = createHttpDepartmentReadRepository();
  const updateNode = (input: UpdateDepartmentInput) => request<DepartmentNode>(
    departmentUrl(input.id),
    json("PATCH", without(input, "id")),
  );

  return {
    ...read,
    createNode(input) {
      return request<DepartmentNode>(
        "/api/organization/departments",
        json("POST", input),
      );
    },
    updateNode,
    async setActive(id, expectedVersion, active) {
      const current = await read.getNode(id);
      return updateNode({
        id,
        expectedVersion,
        nameZh: current.nameZh,
        nameEn: current.nameEn ?? "",
        sortOrder: current.sortOrder,
        isActive: active,
      });
    },
    previewMove(id, newParentId) {
      return request<DepartmentMovePreview>(
        `${departmentUrl(id)}/move-preview`,
        json("POST", { newParentId }),
      );
    },
    moveNode(id, newParentId, expectedVersion) {
      return request<DepartmentNode>(
        `${departmentUrl(id)}/move`,
        json("POST", { newParentId, expectedVersion }),
      );
    },
    listAliases(_propertyId) {
      return request<DepartmentAlias[]>(
        "/api/organization/departments/aliases",
      );
    },
    approveMapping(input) {
      const { aliasId, ...body } = input;
      return request<DepartmentAlias>(
        `/api/organization/departments/aliases/${encodeURIComponent(aliasId)}/resolution`,
        json("POST", body),
      );
    },
    createOperationalUnit(input) {
      return createOperationalUnit(input);
    },
    saveOperationalUnit(input) {
      if (!input.id || input.expectedVersion === undefined) {
        throw new Error("运营单元更新需要记录标识和版本");
      }
      const { id, ...body } = input;
      return request<OperationalUnit>(
        `/api/organization/operational-units/${encodeURIComponent(id)}`,
        json("PATCH", body),
      );
    },
    listOperationalUnits(_propertyId) {
      return request<OperationalUnit[]>("/api/organization/operational-units");
    },
  };
}

function createOperationalUnit(input: CreateOperationalUnitInput) {
  const { propertyId: _propertyId, ...body } = input;
  return request<OperationalUnit>(
    "/api/organization/operational-units",
    json("POST", body),
  );
}

function departmentUrl(id: string) {
  return `/api/organization/departments/${encodeURIComponent(id)}`;
}

function json(method: "POST" | "PATCH", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? "组织架构服务暂时不可用");
  }
  return payload;
}
