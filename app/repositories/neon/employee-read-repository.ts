import "server-only";

import type { AuthorizedDepartmentScope } from "../contracts/auth-repository.ts";
import type {
  DepartmentEmployeeDirectoryOptions,
  EmployeeDirectoryOptions,
  EmployeeDirectoryPage,
  EmployeeRecord,
} from "../contracts/employee-repository.ts";
import type { ManagerPeopleFacets } from "../contracts/people-facet-repository.ts";
import type { NeonQueryable } from "../../lib/neon/actor-context.ts";

type PayloadRow = { payload: unknown };

const EMPLOYMENT_STATUSES = new Set<EmployeeRecord["employmentStatus"]>([
  "active",
  "inactive",
  "leave",
  "terminated",
  "unknown",
]);

export function createNeonEmployeeReadRepository(
  database: NeonQueryable,
  trustedHostname: string,
) {
  return {
    async listManagerDirectory(
      options: EmployeeDirectoryOptions,
    ): Promise<EmployeeDirectoryPage> {
      const result = await database.query<PayloadRow>(
        `
          select public.read_neon_people_manager_directory(
            $1::text,
            $2::text,
            $3::uuid,
            $4::uuid,
            $5::uuid,
            $6::text,
            $7::boolean,
            $8::integer,
            $9::integer
          ) as payload
        `,
        [
          trustedHostname,
          options.query?.trim() || null,
          options.departmentId ?? null,
          options.positionId ?? null,
          options.positionFamilyId ?? null,
          options.employmentStatus ?? null,
          options.active ?? null,
          options.limit ?? 25,
          options.offset ?? 0,
        ],
      );
      return managerPage(result.rows[0]?.payload);
    },

    async getManagerEmployee(employeeId: string): Promise<EmployeeRecord | null> {
      const result = await database.query<PayloadRow>(
        `
          select public.read_neon_people_manager_employee(
            $1::text,
            $2::uuid
          ) as payload
        `,
        [trustedHostname, employeeId],
      );
      const payload = result.rows[0]?.payload;
      return payload === null || payload === undefined
        ? null
        : managerEmployee(payload);
    },

    async listManagerFacets(): Promise<ManagerPeopleFacets> {
      const result = await database.query<PayloadRow>(
        "select public.read_neon_people_manager_facets($1::text) as payload",
        [trustedHostname],
      );
      return managerFacets(result.rows[0]?.payload);
    },

    async listDepartmentDirectory(
      options: DepartmentEmployeeDirectoryOptions,
    ): Promise<EmployeeDirectoryPage> {
      const result = await database.query<PayloadRow>(
        `
          select public.read_neon_people_department_directory(
            $1::text,
            $2::text,
            $3::integer,
            $4::integer
          ) as payload
        `,
        [
          trustedHostname,
          options.query?.trim() || null,
          options.limit ?? 25,
          options.offset ?? 0,
        ],
      );
      return departmentPage(result.rows[0]?.payload);
    },
  };
}

function managerPage(value: unknown): EmployeeDirectoryPage {
  const payload = record(value, "manager directory");
  return {
    rows: array(payload.rows).map(managerEmployee),
    total: nonNegativeNumber(payload.total, "manager directory total"),
    refreshedAt: isoTimestamp(payload.refreshed_at),
  };
}

function departmentPage(value: unknown): EmployeeDirectoryPage {
  const payload = record(value, "department directory");
  return {
    rows: array(payload.rows).map(departmentEmployee),
    total: nonNegativeNumber(payload.total, "department directory total"),
    refreshedAt: isoTimestamp(payload.refreshed_at),
    authorizedDepartmentScopes: array(payload.scopes).map(departmentScope),
  };
}

function managerEmployee(value: unknown): EmployeeRecord {
  const row = record(value, "manager employee");
  return {
    id: string(row.id),
    tenantId: string(row.tenant_id),
    propertyId: string(row.property_id),
    employeeNumber: string(row.employee_number),
    nameZh: nullableString(row.name_zh),
    nameEn: nullableString(row.name_en),
    departmentId: nullableString(row.department_id) ?? "",
    departmentName: nullableString(row.department_name) ?? "",
    operationalUnitId: nullableString(row.operational_unit_id),
    operationalUnitName: nullableString(row.operational_unit_name),
    positionId: nullableString(row.position_id),
    positionName: nullableString(row.position_name),
    positionFamilyId: nullableString(row.position_family_id),
    positionFamilyName: nullableString(row.position_family_name),
    gradeOrBand: nullableString(row.grade_or_band),
    hireDate: nullableString(row.hire_date),
    probationOrConfirmationDate: nullableString(
      row.probation_or_confirmation_date,
    ),
    employmentStatus: employmentStatus(row.employment_status),
    isNewEmployee: boolean(row.is_new_employee),
    isActive: boolean(row.is_active),
    externalIdentifierTypes: array(row.external_identifier_types).map(string),
    version: nonNegativeNumber(row.version, "employee version"),
  };
}

function departmentEmployee(value: unknown): EmployeeRecord {
  const row = record(value, "department employee");
  const employeeNumber = string(row.employee_number);
  return {
    id: `department:${employeeNumber}`,
    tenantId: "",
    propertyId: "",
    employeeNumber,
    nameZh: nullableString(row.name_zh),
    nameEn: nullableString(row.name_en),
    departmentId: string(row.department_id),
    departmentName: nullableString(row.department_name) ?? "",
    operationalUnitId: nullableString(row.operational_unit_id),
    operationalUnitName: nullableString(row.operational_unit_name),
    positionId: nullableString(row.position_id),
    positionName: nullableString(row.position_name),
    positionFamilyId: nullableString(row.position_family_id),
    positionFamilyName: nullableString(row.position_family_name),
    gradeOrBand: null,
    hireDate: nullableString(row.hire_date),
    probationOrConfirmationDate: nullableString(
      row.probation_or_confirmation_date,
    ),
    employmentStatus: employmentStatus(row.employment_status),
    isNewEmployee: boolean(row.is_new_employee),
    isActive: boolean(row.is_active),
    externalIdentifierTypes: [],
    version: 0,
  };
}

function departmentScope(value: unknown): AuthorizedDepartmentScope {
  const row = record(value, "department scope");
  return {
    departmentId: string(row.department_id),
    departmentNameZh: string(row.department_name_zh),
    departmentNameEn: nullableString(row.department_name_en),
    breadcrumb: array(row.breadcrumb).map(string),
    breadcrumbEn: array(row.breadcrumb_en).map(string),
    includeDescendants: boolean(row.include_descendants),
  };
}

function managerFacets(value: unknown): ManagerPeopleFacets {
  const payload = record(value, "manager facets");
  const options = (candidate: unknown) =>
    array(candidate).map(item => {
      const row = record(item, "facet option");
      return { id: string(row.id), label: string(row.label) };
    });
  return {
    departments: options(payload.departments),
    positions: options(payload.positions),
    positionFamilies: options(payload.position_families),
  };
}

function employmentStatus(value: unknown): EmployeeRecord["employmentStatus"] {
  return typeof value === "string" &&
    EMPLOYMENT_STATUSES.has(value as EmployeeRecord["employmentStatus"])
    ? (value as EmployeeRecord["employmentStatus"])
    : "unknown";
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`NEON_PEOPLE_PAYLOAD_INVALID:${label}`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("NEON_PEOPLE_PAYLOAD_INVALID:array");
  return value;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("NEON_PEOPLE_PAYLOAD_INVALID:string");
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("NEON_PEOPLE_PAYLOAD_INVALID:boolean");
  return value;
}

function nonNegativeNumber(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`NEON_PEOPLE_PAYLOAD_INVALID:${label}`);
  }
  return number;
}

function isoTimestamp(value: unknown): string {
  const timestamp = string(value);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error("NEON_PEOPLE_PAYLOAD_INVALID:timestamp");
  }
  return timestamp;
}
