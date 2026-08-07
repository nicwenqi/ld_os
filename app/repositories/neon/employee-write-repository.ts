import "server-only";

import type { NeonQueryable } from "../../lib/neon/actor-context.ts";
import type {
  EmployeeEmploymentStatus,
  EmployeeExternalIdentifierInput,
  EmployeeIdentifierType,
  EmployeeWriteRepository,
  SaveEmployeeWithIdentifiersInput,
  SavedEmployee,
} from "../contracts/employee-write-repository.ts";

type PayloadRow = { payload: unknown };
type TrustedEmployeeScope = { tenantId: string; propertyId: string };

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

export function createNeonEmployeeWriteRepository(
  database: NeonQueryable,
  trustedHostname: string,
  scope: TrustedEmployeeScope,
): EmployeeWriteRepository {
  return {
    async saveEmployeeWithIdentifiers(
      input: SaveEmployeeWithIdentifiersInput,
    ): Promise<SavedEmployee> {
      const identifiers = input.identifiers.map(identifier => ({
        source_system: identifier.sourceSystem,
        identifier_type: identifier.identifierType,
        identifier_value: identifier.identifierValue,
        is_primary: identifier.isPrimary,
        is_active: identifier.isActive,
      }));
      const result = await database.query<PayloadRow>(
        `
          select public.save_neon_employee_with_identifiers(
            $1::text,$2::uuid,$3::uuid,$4::uuid,$5::bigint,
            $6::text,$7::text,$8::text,$9::uuid,$10::uuid,$11::uuid,
            $12::uuid,$13::text,$14::date,$15::date,$16::text,
            $17::boolean,$18::jsonb
          ) as payload
        `,
        [
          trustedHostname,
          scope.tenantId,
          scope.propertyId,
          input.id,
          input.expectedVersion,
          input.employeeNumber,
          input.nameZh,
          input.nameEn,
          input.departmentId,
          input.operationalUnitId,
          input.positionId,
          input.positionFamilyId,
          input.gradeOrBand,
          input.hireDate,
          input.probationOrConfirmationDate,
          input.employmentStatus,
          input.isActive,
          JSON.stringify(identifiers),
        ],
      );
      return mapSavedEmployee(result.rows[0]?.payload);
    },
  };
}

function mapSavedEmployee(value: unknown): SavedEmployee {
  const row = record(value, "employee");
  return {
    id: string(row.id, "employee id"),
    employeeNumber: string(row.employee_number, "employee number"),
    nameZh: nullableString(row.name_zh, "employee Chinese name"),
    nameEn: nullableString(row.name_en, "employee English name"),
    departmentId: nullableString(row.department_id, "department id"),
    operationalUnitId: nullableString(
      row.operational_unit_id,
      "operational unit id",
    ),
    positionId: nullableString(row.position_id, "position id"),
    positionFamilyId: nullableString(
      row.position_family_id,
      "position family id",
    ),
    gradeOrBand: nullableString(row.grade_or_band, "grade or band"),
    hireDate: nullableString(row.hire_date, "hire date"),
    probationOrConfirmationDate: nullableString(
      row.probation_or_confirmation_date,
      "probation or confirmation date",
    ),
    employmentStatus: employmentStatus(row.employment_status),
    isActive: boolean(row.is_active, "employee active state"),
    identifiers: array(row.identifiers, "identifiers").map(mapIdentifier),
    version: positiveInteger(row.version, "employee version"),
  };
}

function mapIdentifier(value: unknown): EmployeeExternalIdentifierInput {
  const row = record(value, "identifier");
  return {
    sourceSystem: string(row.source_system, "identifier source system"),
    identifierType: identifierType(row.identifier_type),
    identifierValue: string(row.identifier_value, "identifier value"),
    isPrimary: boolean(row.is_primary, "identifier primary state"),
    isActive: boolean(row.is_active, "identifier active state"),
  };
}

function employmentStatus(value: unknown): EmployeeEmploymentStatus {
  if (
    typeof value !== "string"
    || !EMPLOYMENT_STATUSES.has(value as EmployeeEmploymentStatus)
  ) invalid("employment status");
  return value as EmployeeEmploymentStatus;
}

function identifierType(value: unknown): EmployeeIdentifierType {
  if (
    typeof value !== "string"
    || !IDENTIFIER_TYPES.has(value as EmployeeIdentifierType)
  ) invalid("identifier type");
  return value as EmployeeIdentifierType;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(label);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(label);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(label);
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 1) invalid(label);
  return number;
}

function invalid(label: string): never {
  throw new Error(`NEON_EMPLOYEE_WRITE_PAYLOAD_INVALID:${label}`);
}
