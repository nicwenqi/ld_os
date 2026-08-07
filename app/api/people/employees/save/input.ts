import type {
  EmployeeEmploymentStatus,
  EmployeeExternalIdentifierInput,
  EmployeeIdentifierType,
  SaveEmployeeWithIdentifiersInput,
} from "../../../../repositories/contracts/employee-write-repository.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMPLOYMENT_STATUSES = new Set<EmployeeEmploymentStatus>([
  "active",
  "inactive",
  "leave",
  "terminated",
  "unknown",
]);
const IDENTIFIER_TYPES = new Set<EmployeeIdentifierType>([
  "local_employee_number",
  "lms_employee_id",
  "merlin_id",
  "hris_id",
  "other",
]);
const REQUIRED_KEYS = [
  "expectedVersion",
  "employeeNumber",
  "nameZh",
  "nameEn",
  "departmentId",
  "operationalUnitId",
  "positionId",
  "positionFamilyId",
  "gradeOrBand",
  "hireDate",
  "probationOrConfirmationDate",
  "employmentStatus",
  "isActive",
  "identifiers",
] as const;
const ALLOWED_KEYS = new Set<string>(["id", ...REQUIRED_KEYS]);
const IDENTIFIER_KEYS = new Set([
  "sourceSystem",
  "identifierType",
  "identifierValue",
  "isPrimary",
  "isActive",
]);

export class EmployeeWriteInputError extends Error {}

export function parseSaveEmployeeWithIdentifiersInput(
  value: unknown,
): SaveEmployeeWithIdentifiersInput {
  const body = record(value, "员工保存请求格式无效");
  if (
    Object.keys(body).some(key => !ALLOWED_KEYS.has(key))
    || REQUIRED_KEYS.some(key => !(key in body))
  ) invalid("员工保存请求包含不接受或缺失的字段");

  const id = body.id === undefined || body.id === null
    ? null
    : uuid(body.id, "员工标识无效");
  const expectedVersion = integer(
    body.expectedVersion,
    id ? 1 : 0,
    Number.MAX_SAFE_INTEGER,
    "员工版本无效",
  );
  if (!id && expectedVersion !== 0) invalid("新员工版本必须为 0");

  const nameZh = nullableText(body.nameZh, 160, "员工中文姓名无效");
  const nameEn = nullableText(body.nameEn, 160, "员工英文姓名无效");
  if (!nameZh && !nameEn) invalid("员工姓名不能为空");

  const identifiers = identifierList(body.identifiers);
  const identifierKeys = identifiers.map(identifier => [
    identifier.sourceSystem.toLowerCase(),
    identifier.identifierValue,
  ].join("\u0000"));
  if (new Set(identifierKeys).size !== identifierKeys.length) {
    invalid("员工外部标识不能重复");
  }

  return {
    id,
    expectedVersion,
    employeeNumber: requiredText(body.employeeNumber, 120, "员工编号无效"),
    nameZh,
    nameEn,
    departmentId: nullableUuid(body.departmentId, "部门标识无效"),
    operationalUnitId: nullableUuid(
      body.operationalUnitId,
      "运营单元标识无效",
    ),
    positionId: nullableUuid(body.positionId, "职位标识无效"),
    positionFamilyId: nullableUuid(body.positionFamilyId, "职位族标识无效"),
    gradeOrBand: nullableText(body.gradeOrBand, 120, "员工职级无效"),
    hireDate: nullableDate(body.hireDate, "入职日期无效"),
    probationOrConfirmationDate: nullableDate(
      body.probationOrConfirmationDate,
      "转正日期无效",
    ),
    employmentStatus: employmentStatus(body.employmentStatus),
    isActive: bool(body.isActive, "员工启用状态无效"),
    identifiers,
  };
}

function identifierList(value: unknown): EmployeeExternalIdentifierInput[] {
  if (!Array.isArray(value) || value.length > 100) {
    invalid("员工外部标识列表无效");
  }
  return value.map(item => {
    const identifier = record(item, "员工外部标识格式无效");
    if (
      Object.keys(identifier).some(key => !IDENTIFIER_KEYS.has(key))
      || [...IDENTIFIER_KEYS].some(key => !(key in identifier))
    ) invalid("员工外部标识包含不接受或缺失的字段");
    return {
      sourceSystem: requiredText(
        identifier.sourceSystem,
        120,
        "员工外部标识来源无效",
      ).toLowerCase(),
      identifierType: identifierType(identifier.identifierType),
      identifierValue: requiredText(
        identifier.identifierValue,
        240,
        "员工外部标识值无效",
      ),
      isPrimary: bool(identifier.isPrimary, "员工外部主标识状态无效"),
      isActive: bool(identifier.isActive, "员工外部标识状态无效"),
    };
  });
}

function identifierType(value: unknown): EmployeeIdentifierType {
  if (
    typeof value !== "string"
    || !IDENTIFIER_TYPES.has(value as EmployeeIdentifierType)
  ) invalid("员工外部标识类型无效");
  return value as EmployeeIdentifierType;
}

function employmentStatus(value: unknown): EmployeeEmploymentStatus {
  if (
    typeof value !== "string"
    || !EMPLOYMENT_STATUSES.has(value as EmployeeEmploymentStatus)
  ) invalid("员工在职状态无效");
  return value as EmployeeEmploymentStatus;
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(message);
  return value as Record<string, unknown>;
}

function uuid(value: unknown, message: string): string {
  if (typeof value !== "string" || !UUID.test(value)) invalid(message);
  return value.toLowerCase();
}

function nullableUuid(value: unknown, message: string): string | null {
  return value === null ? null : uuid(value, message);
}

function requiredText(value: unknown, maximum: number, message: string): string {
  if (typeof value !== "string") invalid(message);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) invalid(message);
  return normalized;
}

function nullableText(value: unknown, maximum: number, message: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") invalid(message);
  const normalized = value.trim();
  if (normalized.length > maximum) invalid(message);
  return normalized || null;
}

function nullableDate(value: unknown, message: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !DATE.test(value)) invalid(message);
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    invalid(message);
  }
  return value;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  message: string,
): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) invalid(message);
  return value;
}

function bool(value: unknown, message: string): boolean {
  if (typeof value !== "boolean") invalid(message);
  return value;
}

function invalid(message: string): never {
  throw new EmployeeWriteInputError(message);
}
