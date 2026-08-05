import "server-only";

import type { NeonQueryable } from "../../lib/neon/actor-context.ts";
import type {
  ApproveDepartmentMappingInput,
  DepartmentRepository,
} from "../contracts/department-repository.ts";
import type { DepartmentAlias } from "../contracts/organization-models.ts";

type PayloadRow = { payload: unknown };

export type NeonDepartmentAliasRepository = Pick<
  DepartmentRepository,
  "listAliases" | "approveMapping"
>;

export function createNeonDepartmentAliasRepository(
  database: NeonQueryable,
  trustedHostname: string,
): NeonDepartmentAliasRepository {
  return {
    async listAliases(_propertyId) {
      const result = await database.query<PayloadRow>(
        "select public.read_neon_organization_department_aliases($1::text) as payload",
        [trustedHostname],
      );
      return aliases(result.rows[0]?.payload);
    },

    async approveMapping(input) {
      if (isCreatedDepartment(input)) {
        const draft = input.createDepartment;
        validateCreatedParent(input.resolutionType, draft.parentId);
        const result = await database.query<PayloadRow>(
          `
            select public.create_neon_organization_department_from_alias(
              $1::text, $2::uuid, $3::text, $4::uuid, $5::text,
              $6::text, $7::text, $8::text, $9::integer
            ) as payload
          `,
          [
            trustedHostname,
            input.aliasId,
            input.resolutionType,
            draft.parentId,
            draft.nodeType,
            draft.code,
            draft.nameZh,
            draft.nameEn,
            draft.sortOrder,
          ],
        );
        return alias(result.rows[0]?.payload);
      }

      if (input.action === "merge") {
        const targetDepartmentId = exactTarget(input.targetDepartmentId, input.operationalUnitId, input.createDepartment);
        if (input.resolutionType !== undefined && input.resolutionType !== "merged") {
          invalidTarget();
        }
        const result = await database.query<PayloadRow>(
          `select public.merge_neon_organization_department_alias(
            $1::text, $2::uuid, $3::uuid
          ) as payload`,
          [trustedHostname, input.aliasId, targetDepartmentId],
        );
        return alias(result.rows[0]?.payload);
      }

      if (input.action === "operational_unit") {
        const operationalUnitId = exactTarget(input.operationalUnitId, input.targetDepartmentId, input.createDepartment);
        if (input.resolutionType !== undefined) invalidTarget();
        const result = await database.query<PayloadRow>(
          `select public.resolve_neon_organization_department_alias_to_operational_unit(
            $1::text, $2::uuid, $3::uuid
          ) as payload`,
          [trustedHostname, input.aliasId, operationalUnitId],
        );
        return alias(result.rows[0]?.payload);
      }

      const action = phase4aAction(input);
      const targetDepartmentId = phase4aTarget(action, input);
      const result = await database.query<PayloadRow>(
        `
          select public.resolve_neon_organization_department_alias(
            $1::text, $2::uuid, $3::text, $4::uuid
          ) as payload
        `,
        [trustedHostname, input.aliasId, action, targetDepartmentId],
      );
      return alias(result.rows[0]?.payload);
    },
  };
}

function isCreatedDepartment(
  input: ApproveDepartmentMappingInput,
): input is ApproveDepartmentMappingInput & {
  action: "department";
  resolutionType: "created_top_level" | "created_child";
  createDepartment: NonNullable<ApproveDepartmentMappingInput["createDepartment"]>;
} {
  const created = input.resolutionType === "created_top_level" || input.resolutionType === "created_child";
  if (!created) return false;
  if (
    input.action !== "department" ||
    !input.createDepartment ||
    input.targetDepartmentId !== undefined ||
    input.operationalUnitId !== undefined
  ) {
    invalidTarget();
  }
  return true;
}

function validateCreatedParent(
  resolutionType: "created_top_level" | "created_child",
  parentId: string | null,
) {
  if (
    (resolutionType === "created_top_level" && parentId !== null) ||
    (resolutionType === "created_child" && parentId === null)
  ) {
    invalidTarget();
  }
}

function phase4aAction(input: ApproveDepartmentMappingInput) {
  if (input.action === "department" || input.action === "ignore" || input.action === "defer") {
    return input.action;
  }
  throw new Error("NEON_ORGANIZATION_ALIAS_ACTION_UNSUPPORTED");
}

function phase4aTarget(
  action: "department" | "ignore" | "defer",
  input: ApproveDepartmentMappingInput,
) {
  if (input.operationalUnitId !== undefined || input.createDepartment !== undefined) invalidTarget();
  if (action === "department" && input.targetDepartmentId &&
      (input.resolutionType === undefined || input.resolutionType === "mapped")) {
    return input.targetDepartmentId;
  }
  if (action !== "department" && input.targetDepartmentId === undefined && input.resolutionType === undefined) {
    return null;
  }
  return invalidTarget();
}

function exactTarget(
  target: string | undefined,
  otherTarget: string | undefined,
  draft: ApproveDepartmentMappingInput["createDepartment"],
) {
  if (target && otherTarget === undefined && draft === undefined) return target;
  return invalidTarget();
}

function invalidTarget(): never {
  throw new Error("NEON_ORGANIZATION_ALIAS_TARGET_INVALID");
}

function aliases(value: unknown): DepartmentAlias[] {
  const payload = object(value, "alias payload");
  if (!Array.isArray(payload.rows)) invalid("alias rows");
  return payload.rows.map(alias);
}

function alias(value: unknown): DepartmentAlias {
  const row = object(value, "alias");
  return {
    id: text(row.id, "id"), propertyId: text(row.property_id, "property_id"),
    sourceSystem: text(row.source_system, "source_system"),
    sourceSheet: nullableText(row.source_sheet) ?? "历史批准来源",
    sourceValue: text(row.source_value, "source_value"),
    normalizedSourceValue: text(row.normalized_source_value, "normalized_source_value"),
    sourceRowCount: integer(row.source_row_count, "source_row_count"),
    syntheticEmployeeCount: integer(row.source_row_count, "source_row_count"),
    suggestedTargetId: nullableText(row.suggested_target_id),
    suggestionLabel: text(row.suggestion_label, "suggestion_label"),
    confidence: integer(row.confidence, "confidence"),
    suggestionReason: text(row.suggestion_reason, "suggestion_reason"),
    targetDepartmentId: nullableText(row.target_department_id),
    operationalUnitId: nullableText(row.operational_unit_id),
    resolutionType: resolution(row.resolution_type), isActive: boolean(row.is_active, "is_active"),
  };
}

function resolution(value: unknown): DepartmentAlias["resolutionType"] {
  if (["mapped", "created_top_level", "created_child", "merged", "ignored", "deferred"].includes(String(value))) return value as DepartmentAlias["resolutionType"];
  invalid("resolution_type");
}
function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label); return value as Record<string, unknown>; }
function text(value: unknown, label: string): string { if (typeof value !== "string") invalid(label); return value; }
function nullableText(value: unknown): string | null { return value === null ? null : typeof value === "string" ? value : null; }
function integer(value: unknown, label: string): number { const number = typeof value === "number" ? value : Number(value); if (!Number.isSafeInteger(number) || number < 0) invalid(label); return number; }
function boolean(value: unknown, label: string): boolean { if (typeof value !== "boolean") invalid(label); return value; }
function invalid(detail: string): never { throw new Error(`NEON_ORGANIZATION_ALIAS_PAYLOAD_INVALID:${detail}`); }
