import type {
  CreateDepartmentInput,
  UpdateDepartmentInput,
} from "../../../repositories/contracts/department-repository.ts";
import type { DepartmentNodeType } from "../../../repositories/contracts/organization-models.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NODE_TYPES = new Set<DepartmentNodeType>([
  "division",
  "department",
  "section",
  "team",
  "other",
]);
const CREATE_KEYS = new Set([
  "tenantId",
  "propertyId",
  "parentId",
  "nodeType",
  "code",
  "nameZh",
  "nameEn",
  "sortOrder",
]);
const UPDATE_KEYS = new Set([
  "expectedVersion",
  "nameZh",
  "nameEn",
  "sortOrder",
  "isActive",
]);
const MOVE_PREVIEW_KEYS = new Set(["newParentId"]);
const MOVE_KEYS = new Set(["newParentId", "expectedVersion"]);

export class DepartmentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepartmentInputError";
  }
}

export function parseCreateDepartmentInput(
  value: unknown,
): CreateDepartmentInput {
  const body = record(value, "部门创建请求格式无效");
  assertKeys(body, CREATE_KEYS, "部门创建请求包含不支持的字段");
  const nodeType = text(body.nodeType, "部门类型无效");
  if (!NODE_TYPES.has(nodeType as DepartmentNodeType)) {
    invalid("部门类型无效");
  }
  const code = text(body.code, "部门代码无效").trim();
  if (code.length > 80 || (code !== "" && !CODE_PATTERN.test(code))) {
    invalid("部门代码无效");
  }

  return {
    tenantId: uuid(body.tenantId, "租户标识无效"),
    propertyId: uuid(body.propertyId, "酒店标识无效"),
    parentId: nullableUuid(body.parentId, "上级部门标识无效"),
    nodeType: nodeType as DepartmentNodeType,
    code,
    nameZh: requiredName(body.nameZh, "部门中文名称"),
    nameEn: optionalName(body.nameEn, "部门英文名称"),
    sortOrder: integer(body.sortOrder, -1_000_000, 1_000_000, "部门排序值"),
  };
}

export function parseUpdateDepartmentInput(
  id: string,
  value: unknown,
): UpdateDepartmentInput {
  const body = record(value, "部门更新请求格式无效");
  assertKeys(body, UPDATE_KEYS, "部门更新请求包含不支持的字段");
  if (typeof body.isActive !== "boolean") {
    invalid("部门启用状态无效");
  }
  return {
    id: uuid(id, "部门记录标识无效"),
    expectedVersion: integer(
      body.expectedVersion,
      1,
      Number.MAX_SAFE_INTEGER,
      "部门版本",
    ),
    nameZh: requiredName(body.nameZh, "部门中文名称"),
    nameEn: optionalName(body.nameEn, "部门英文名称"),
    sortOrder: integer(body.sortOrder, -1_000_000, 1_000_000, "部门排序值"),
    isActive: body.isActive,
  };
}

export function parseMovePreviewDepartmentInput(
  id: string,
  value: unknown,
): { id: string; newParentId: string | null } {
  const body = record(value, "部门移动预览请求格式无效");
  assertKeys(body, MOVE_PREVIEW_KEYS, "部门移动预览请求包含不支持的字段");
  return {
    id: uuid(id, "部门记录标识无效"),
    newParentId: nullableUuid(body.newParentId, "目标上级部门标识无效"),
  };
}

export function parseMoveDepartmentInput(
  id: string,
  value: unknown,
): { id: string; newParentId: string | null; expectedVersion: number } {
  const body = record(value, "部门移动请求格式无效");
  assertKeys(body, MOVE_KEYS, "部门移动请求包含不支持的字段");
  return {
    id: uuid(id, "部门记录标识无效"),
    newParentId: nullableUuid(body.newParentId, "目标上级部门标识无效"),
    expectedVersion: integer(
      body.expectedVersion,
      1,
      Number.MAX_SAFE_INTEGER,
      "部门版本",
    ),
  };
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(message);
  }
  return value as Record<string, unknown>;
}

function assertKeys(
  body: Record<string, unknown>,
  allowed: Set<string>,
  message: string,
) {
  if (Object.keys(body).some(key => !allowed.has(key))) invalid(message);
}

function uuid(value: unknown, message: string) {
  const candidate = text(value, message).trim();
  if (!UUID_PATTERN.test(candidate)) invalid(message);
  return candidate.toLowerCase();
}

function nullableUuid(value: unknown, message: string) {
  return value === null ? null : uuid(value, message);
}

function requiredName(value: unknown, label: string) {
  const candidate = text(value, `${label}无效`).trim();
  if (candidate.length === 0 || candidate.length > 160) {
    invalid(`${label}无效`);
  }
  return candidate;
}

function optionalName(value: unknown, label: string) {
  const candidate = text(value, `${label}无效`).trim();
  if (candidate.length > 160) invalid(`${label}无效`);
  return candidate;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalid(`${label}无效`);
  }
  return value;
}

function text(value: unknown, message: string) {
  if (typeof value !== "string") invalid(message);
  return value;
}

function invalid(message: string): never {
  throw new DepartmentInputError(message);
}
