import "server-only";

import type { NeonQueryable } from "../../lib/neon/actor-context.ts";
import type {
  ApprovePositionMappingInput,
  PositionRepository,
} from "../contracts/position-repository.ts";
import type {
  PositionSourceImpact,
  PositionSourceLabel,
} from "../contracts/organization-models.ts";

type PayloadRow = { payload: unknown };

export type NeonPositionMappingRepository = Pick<
  PositionRepository,
  "listSourceLabels" | "previewSourceImpact" | "approvePositionMapping"
>;

export function createNeonPositionMappingRepository(
  database: NeonQueryable,
  trustedHostname: string,
): NeonPositionMappingRepository {
  return {
    async listSourceLabels(_propertyId) {
      const result = await database.query<PayloadRow>(
        "select public.read_neon_position_source_labels($1::text) as payload",
        [trustedHostname],
      );
      return rows(result.rows[0]?.payload).map(label);
    },
    async previewSourceImpact(sourceLabelId) {
      const result = await database.query<PayloadRow>(
        "select public.preview_neon_position_source_impact($1::text,$2::uuid) as payload",
        [trustedHostname, sourceLabelId],
      );
      return impact(result.rows[0]?.payload);
    },
    async approvePositionMapping(input) {
      const targetId = target(input);
      const result = await database.query<PayloadRow>(
        "select public.resolve_neon_position_alias($1::text,$2::uuid,$3::text,$4::uuid,$5::text,$6::text) as payload",
        [
          trustedHostname,
          input.sourceLabelId,
          input.action,
          targetId,
          input.action === "external" ? input.externalRoleCode ?? null : null,
          input.action === "external" ? input.externalRoleName ?? null : null,
        ],
      );
      return label(result.rows[0]?.payload);
    },
  };
}

function target(input: ApprovePositionMappingInput): string | null {
  if (input.action === "position") return requiredUuid(input.targetPositionId);
  if (input.action === "family") return requiredUuid(input.targetPositionFamilyId);
  if (input.action === "external" || input.action === "ignore" || input.action === "defer") {
    if (input.targetPositionId !== undefined || input.targetPositionFamilyId !== undefined) invalid("target shape");
    return null;
  }
  invalid("action");
}

function rows(value: unknown): unknown[] {
  const payload = object(value, "label payload");
  if (!Array.isArray(payload.rows)) invalid("label rows");
  return payload.rows;
}

function label(value: unknown): PositionSourceLabel {
  const row = object(value, "label");
  const sourceRowCount = integer(row.source_row_count, "source_row_count");
  return {
    id: uuid(row.id, "id"),
    propertyId: uuid(row.property_id, "property_id"),
    sourceSystem: text(row.source_system, "source_system"),
    sourceSheet: text(row.source_sheet, "source_sheet"),
    sourceValue: text(row.source_value, "source_value"),
    normalizedSourceValue: text(row.normalized_source_value, "normalized_source_value"),
    sourceRowCount,
    syntheticEmployeeCount: sourceRowCount,
    suggestedPositionId: nullableUuid(row.suggested_position_id, "suggested_position_id"),
    suggestedFamilyId: nullableUuid(row.suggested_family_id, "suggested_family_id"),
    confidence: integer(row.confidence, "confidence"),
    suggestionReason: text(row.suggestion_reason, "suggestion_reason"),
    targetPositionId: nullableUuid(row.target_position_id, "target_position_id"),
    targetPositionFamilyId: nullableUuid(row.target_position_family_id, "target_position_family_id"),
    externalRoleCode: nullableText(row.external_role_code, "external_role_code"),
    externalRoleName: nullableText(row.external_role_name, "external_role_name"),
    resolutionStatus: status(row.resolution_status),
  };
}

function impact(value: unknown): PositionSourceImpact {
  const payload = object(value, "impact payload");
  const sourceEvidence = object(payload.source_evidence, "source_evidence");
  const sourceRowCount = integer(sourceEvidence.source_row_count, "source_row_count");
  return {
    sourceLabelId: uuid(payload.source_label_id, "source_label_id"),
    sourceEvidence: {
      sourceSystem: text(sourceEvidence.source_system, "source_system"),
      sourceSheet: text(sourceEvidence.source_sheet, "source_sheet"),
      sourceRowCount,
    },
    syntheticEmployeeCount: sourceRowCount,
    employeeImpact: unavailable(payload.employee_impact, "employee_impact"),
    departmentImpact: unavailable(payload.department_impact, "department_impact"),
  };
}

function unavailable(value: unknown, name: string) {
  const current = object(value, name);
  if (current.state !== "unavailable" || current.reason !== "import_source_rows_not_migrated") invalid(name);
  return { state: "unavailable" as const, reason: "import_source_rows_not_migrated" as const };
}

function status(value: unknown): PositionSourceLabel["resolutionStatus"] {
  if (["mapped", "family_only", "external_only", "ignored", "deferred"].includes(String(value))) return value as PositionSourceLabel["resolutionStatus"];
  invalid("resolution_status");
}

function requiredUuid(value: string | undefined): string {
  if (!value) invalid("target");
  return uuid(value, "target");
}
function object(value: unknown, name: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(name); return value as Record<string, unknown>; }
function text(value: unknown, name: string): string { if (typeof value !== "string") invalid(name); return value; }
function nullableText(value: unknown, name: string): string | null { return value === null ? null : text(value, name); }
function uuid(value: unknown, name: string): string { const candidate = text(value, name); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)) invalid(name); return candidate; }
function nullableUuid(value: unknown, name: string): string | null { return value === null ? null : uuid(value, name); }
function integer(value: unknown, name: string): number { const candidate = typeof value === "number" ? value : Number(value); if (!Number.isSafeInteger(candidate) || candidate < 0) invalid(name); return candidate; }
function invalid(detail: string): never { throw new Error(`NEON_POSITION_MAPPING_PAYLOAD_INVALID:${detail}`); }
