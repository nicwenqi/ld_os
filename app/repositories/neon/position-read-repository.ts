import "server-only";

import type { NeonQueryable } from "../../lib/neon/actor-context.ts";
import type { PositionRepository } from "../contracts/position-repository.ts";
import type {
  OfficialPosition,
  PositionFamily,
} from "../contracts/organization-models.ts";

type PayloadRow = { payload: unknown };

export type NeonPositionReadRepository = Pick<
  PositionRepository,
  "listPositionFamilies" | "listPositions"
>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * E4A intentionally exposes only the existing read contract. Callers never
 * receive a database handle and this repository never selects raw tables.
 */
export function createNeonPositionReadRepository(
  database: NeonQueryable,
  trustedHostname: string,
): NeonPositionReadRepository {
  return {
    async listPositionFamilies(_propertyId) {
      const result = await database.query<PayloadRow>(
        "select public.read_neon_position_families($1::text) as payload",
        [trustedHostname],
      );
      return rows(result.rows[0]?.payload).map(mapFamily);
    },
    async listPositions(_propertyId) {
      const result = await database.query<PayloadRow>(
        "select public.read_neon_positions($1::text) as payload",
        [trustedHostname],
      );
      return rows(result.rows[0]?.payload).map(mapPosition);
    },
  };
}

function rows(value: unknown): unknown[] {
  const payload = object(value, "payload");
  if (!Array.isArray(payload.rows)) invalid("rows");
  return payload.rows;
}

export function mapNeonPositionFamily(value: unknown): PositionFamily {
  return mapFamily(value);
}

export function mapNeonOfficialPosition(value: unknown): OfficialPosition {
  return mapPosition(value);
}

function mapFamily(value: unknown): PositionFamily {
  const row = object(value, "position family");
  return {
    id: uuid(row.id, "id"),
    tenantId: uuid(row.tenant_id, "tenant_id"),
    propertyId: uuid(row.property_id, "property_id"),
    code: text(row.code, "code"),
    nameZh: text(row.name_zh, "name_zh"),
    nameEn: nullableText(row.name_en, "name_en"),
    description: nullableText(row.description, "description"),
    sortOrder: integer(row.sort_order, "sort_order"),
    isActive: boolean(row.is_active, "is_active"),
    version: positiveInteger(row.version, "version"),
  };
}

function mapPosition(value: unknown): OfficialPosition {
  const row = object(value, "position");
  const rawDepartmentIds = row.department_ids;
  if (!Array.isArray(rawDepartmentIds)) invalid("department_ids");
  const departmentIds = rawDepartmentIds.map((id, index) =>
    uuid(id, `department_ids[${index}]`),
  );
  if (new Set(departmentIds).size !== departmentIds.length) {
    invalid("duplicate department_ids");
  }
  return {
    id: uuid(row.id, "id"),
    tenantId: uuid(row.tenant_id, "tenant_id"),
    propertyId: uuid(row.property_id, "property_id"),
    positionFamilyId: nullableUuid(row.position_family_id, "position_family_id"),
    code: text(row.code, "code"),
    nameZh: text(row.name_zh, "name_zh"),
    nameEn: nullableText(row.name_en, "name_en"),
    gradeOrBand: nullableText(row.grade_or_band, "grade_or_band"),
    isActive: boolean(row.is_active, "is_active"),
    version: positiveInteger(row.version, "version"),
    departmentIds,
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(label);
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label);
}

function uuid(value: unknown, label: string): string {
  const candidate = text(value, label);
  if (!UUID_PATTERN.test(candidate)) invalid(label);
  return candidate;
}

function nullableUuid(value: unknown, label: string): string | null {
  return value === null ? null : uuid(value, label);
}

function integer(value: unknown, label: string): number {
  const candidate = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(candidate)) invalid(label);
  return candidate;
}

function positiveInteger(value: unknown, label: string): number {
  const candidate = integer(value, label);
  if (candidate < 1) invalid(label);
  return candidate;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(label);
  return value;
}

function invalid(detail: string): never {
  throw new Error(`NEON_POSITION_PAYLOAD_INVALID:${detail}`);
}
