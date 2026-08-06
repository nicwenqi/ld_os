import type {
  SavePositionFamilyInput,
  SavePositionWithDepartmentsInput,
} from "../../../../repositories/contracts/position-repository.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class PositionInputError extends Error {}

type Scope = { tenantId: string; propertyId: string };

export function parseSavePositionFamilyInput(
  value: unknown,
  scope: Scope,
  id?: string,
): SavePositionFamilyInput {
  const body = record(value, "职位族保存请求格式无效");
  const update = id !== undefined;
  exactKeys(
    body,
    update
      ? ["expectedVersion", "code", "nameZh", "nameEn", "description", "sortOrder", "isActive"]
      : ["code", "nameZh", "nameEn", "description", "sortOrder", "isActive"],
    "职位族保存请求包含不支持的字段",
  );
  return {
    ...scope,
    ...(update ? { id: uuid(id, "职位族标识无效"), version: version(body.expectedVersion) } : {}),
    code: code(body.code),
    nameZh: requiredText(body.nameZh, "职位族中文名称无效", 160),
    nameEn: optionalText(body.nameEn, "职位族英文名称无效", 160),
    description: optionalText(body.description, "职位族说明无效", 1_000),
    sortOrder: integer(body.sortOrder, -1_000_000, 1_000_000, "职位族排序值无效"),
    isActive: bool(body.isActive, "职位族启用状态无效"),
  };
}

export function parseSavePositionWithDepartmentsInput(
  value: unknown,
  scope: Scope,
  id?: string,
): SavePositionWithDepartmentsInput {
  const body = record(value, "职位保存请求格式无效");
  const update = id !== undefined;
  exactKeys(
    body,
    update
      ? ["expectedVersion", "positionFamilyId", "code", "nameZh", "nameEn", "gradeOrBand", "isActive", "departmentIds"]
      : ["positionFamilyId", "code", "nameZh", "nameEn", "gradeOrBand", "isActive", "departmentIds"],
    "职位保存请求包含不支持的字段",
  );
  return {
    ...scope,
    ...(update ? { id: uuid(id, "职位标识无效"), version: version(body.expectedVersion) } : {}),
    positionFamilyId: nullableUuid(body.positionFamilyId, "职位族标识无效"),
    code: code(body.code),
    nameZh: requiredText(body.nameZh, "职位中文名称无效", 160),
    nameEn: optionalText(body.nameEn, "职位英文名称无效", 160),
    gradeOrBand: optionalText(body.gradeOrBand, "职位等级无效", 120),
    isActive: bool(body.isActive, "职位启用状态无效"),
    departmentIds: departmentIds(body.departmentIds),
  };
}

function record(value: unknown, message: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(message);
  return value as Record<string, unknown>;
}

function exactKeys(body: Record<string, unknown>, keys: string[], message: string) {
  if (Object.keys(body).some(key => !keys.includes(key)) || keys.some(key => !(key in body))) invalid(message);
}

function uuid(value: unknown, message: string) {
  if (typeof value !== "string" || !UUID.test(value)) invalid(message);
  return value.toLowerCase();
}

function nullableUuid(value: unknown, message: string) {
  return value === null ? null : uuid(value, message);
}

function code(value: unknown) {
  if (typeof value !== "string") invalid("职位代码无效");
  const result = value.trim().toLowerCase();
  if (!CODE.test(result) || result.length > 80) invalid("职位代码无效");
  return result;
}

function requiredText(value: unknown, message: string, maximum: number) {
  if (typeof value !== "string") invalid(message);
  const result = value.trim();
  if (!result || result.length > maximum) invalid(message);
  return result;
}

function optionalText(value: unknown, message: string, maximum: number) {
  if (typeof value !== "string") invalid(message);
  const result = value.trim();
  if (result.length > maximum) invalid(message);
  return result;
}

function integer(value: unknown, minimum: number, maximum: number, message: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(message);
  return value;
}

function version(value: unknown) {
  return integer(value, 1, Number.MAX_SAFE_INTEGER, "职位版本无效");
}

function bool(value: unknown, message: string) {
  if (typeof value !== "boolean") invalid(message);
  return value;
}

function departmentIds(value: unknown) {
  if (!Array.isArray(value)) invalid("职位部门列表无效");
  const result = value.map(id => uuid(id, "职位部门标识无效"));
  if (new Set(result).size !== result.length) invalid("职位部门列表不能重复");
  return result;
}

function invalid(message: string): never { throw new PositionInputError(message); }
