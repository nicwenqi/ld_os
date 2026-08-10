import "server-only";

import type { NeonQueryable } from "../../lib/neon/actor-context.ts";
import type {
  ImportIssueWorkflowItem,
  ImportMappingRepository,
  ImportMappingWorkflow,
  ImportMappingWorkflowItem,
  ImportSourceLabelWorkflowItem,
  SaveFieldMappingDecisionsInput,
  SaveIssueResolutionsInput,
  SaveSourceLabelDecisionsInput,
} from "../contracts/import-mapping-repository.ts";

type PayloadRow = { payload: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const TARGET_FIELDS = new Set([
  "employee_number", "name_zh", "name_en", "department_source_label",
  "position_source_label", "grade_or_band", "hire_date",
  "probation_or_confirmation_date", "employment_status",
]);
const ISSUE_FIELDS = new Set([...TARGET_FIELDS]);

export function createNeonImportMappingRepository(
  database: NeonQueryable,
  trustedHostname: string,
): ImportMappingRepository {
  const hostname = boundedText(trustedHostname, "trustedHostname", 255);
  return {
    async getWorkflow(batchId) {
      const id = uuid(batchId, "getWorkflow.batchId");
      const result = await database.query<PayloadRow>(
        "select public.read_neon_import_mapping_workflow($1::text,$2::uuid) as payload",
        [hostname, id],
      );
      return result.rows[0]?.payload === null ? null : mapWorkflow(result.rows[0]?.payload, "getWorkflow.payload");
    },

    async saveFieldMappingDecisions(input) {
      const value = validateFieldMappingInput(input);
      const result = await database.query<PayloadRow>(
        "select public.save_neon_import_field_mapping_decisions($1::text,$2::uuid,$3::bigint,$4::jsonb) as payload",
        [hostname, value.batchId, value.expectedDecisionVersion, JSON.stringify(value.decisions)],
      );
      return mapWorkflow(result.rows[0]?.payload, "saveFieldMappingDecisions.payload");
    },

    async saveSourceLabelDecisions(input) {
      const value = validateSourceLabelInput(input);
      const result = await database.query<PayloadRow>(
        "select public.save_neon_import_source_label_decisions($1::text,$2::uuid,$3::bigint,$4::jsonb) as payload",
        [hostname, value.batchId, value.expectedDecisionVersion, JSON.stringify(value.decisions)],
      );
      return mapWorkflow(result.rows[0]?.payload, "saveSourceLabelDecisions.payload");
    },

    async saveIssueResolutions(input) {
      const value = validateIssueInput(input);
      const result = await database.query<PayloadRow>(
        "select public.save_neon_import_issue_resolutions($1::text,$2::uuid,$3::bigint,$4::jsonb) as payload",
        [hostname, value.batchId, value.expectedDecisionVersion, JSON.stringify(value.decisions)],
      );
      return mapWorkflow(result.rows[0]?.payload, "saveIssueResolutions.payload");
    },

    async preview(batchId, expectedDecisionVersion) {
      const id = uuid(batchId, "preview.batchId");
      const version = positiveInteger(expectedDecisionVersion, "preview.expectedDecisionVersion");
      const result = await database.query<PayloadRow>(
        "select public.preview_neon_import_batch($1::text,$2::uuid,$3::bigint) as payload",
        [hostname, id, version],
      );
      return mapWorkflow(result.rows[0]?.payload, "preview.payload");
    },
  };
}

function validateFieldMappingInput(input: SaveFieldMappingDecisionsInput) {
  const value = exactRecord(input, ["batchId", "expectedDecisionVersion", "decisions"], "saveFieldMappingDecisions");
  const decisions = array(value.decisions, "saveFieldMappingDecisions.decisions");
  if (decisions.length === 0 || decisions.length > 250) invalid("saveFieldMappingDecisions.decisions");
  return {
    batchId: uuid(value.batchId, "saveFieldMappingDecisions.batchId"),
    expectedDecisionVersion: positiveInteger(value.expectedDecisionVersion, "saveFieldMappingDecisions.expectedDecisionVersion"),
    decisions: decisions.map((item, index) => {
      const row = exactRecord(item, ["mappingId", "mappingStatus", "targetField", "transformationRule"], `saveFieldMappingDecisions.decisions.${index}`);
      const status = enumValue(row.mappingStatus, new Set(["confirmed", "excluded"]), `mappingStatus.${index}`);
      const target = row.targetField === null ? null : boundedText(row.targetField, `targetField.${index}`, 100);
      if (status === "confirmed" && (!target || !TARGET_FIELDS.has(target))) invalid(`targetField.${index}`);
      if (status === "excluded" && target !== null) invalid(`targetField.${index}`);
      const transformation = exactRecord(row.transformationRule, ["trim", "preserveText"], `transformationRule.${index}`);
      if (transformation.trim !== true || typeof transformation.preserveText !== "boolean") invalid(`transformationRule.${index}`);
      return { mappingId: uuid(row.mappingId, `mappingId.${index}`), mappingStatus: status, targetField: target, transformationRule: { trim: true, preserveText: transformation.preserveText } };
    }),
  };
}

function validateSourceLabelInput(input: SaveSourceLabelDecisionsInput) {
  const value = exactRecord(input, ["batchId", "expectedDecisionVersion", "decisions"], "saveSourceLabelDecisions");
  const decisions = array(value.decisions, "saveSourceLabelDecisions.decisions");
  if (decisions.length === 0 || decisions.length > 250) invalid("saveSourceLabelDecisions.decisions");
  return {
    batchId: uuid(value.batchId, "saveSourceLabelDecisions.batchId"),
    expectedDecisionVersion: positiveInteger(value.expectedDecisionVersion, "saveSourceLabelDecisions.expectedDecisionVersion"),
    decisions: decisions.map((item, index) => {
      const row = exactRecord(item, ["sourceLabelId", "action", "targetDepartmentId", "targetOperationalUnitId", "targetPositionId", "targetPositionFamilyId", "externalRoleCode", "externalRoleName"], `saveSourceLabelDecisions.decisions.${index}`);
      const action = enumValue(row.action, new Set(["department", "operational_unit", "position", "family", "external", "ignore", "defer"]), `action.${index}`);
      return {
        sourceLabelId: uuid(row.sourceLabelId, `sourceLabelId.${index}`),
        action,
        targetDepartmentId: nullableUuid(row.targetDepartmentId, `targetDepartmentId.${index}`),
        targetOperationalUnitId: nullableUuid(row.targetOperationalUnitId, `targetOperationalUnitId.${index}`),
        targetPositionId: nullableUuid(row.targetPositionId, `targetPositionId.${index}`),
        targetPositionFamilyId: nullableUuid(row.targetPositionFamilyId, `targetPositionFamilyId.${index}`),
        externalRoleCode: nullableText(row.externalRoleCode, `externalRoleCode.${index}`, 100),
        externalRoleName: nullableText(row.externalRoleName, `externalRoleName.${index}`, 255),
      };
    }),
  };
}

function validateIssueInput(input: SaveIssueResolutionsInput) {
  const value = exactRecord(input, ["batchId", "expectedDecisionVersion", "decisions"], "saveIssueResolutions");
  const decisions = array(value.decisions, "saveIssueResolutions.decisions");
  if (decisions.length === 0 || decisions.length > 250) invalid("saveIssueResolutions.decisions");
  return {
    batchId: uuid(value.batchId, "saveIssueResolutions.batchId"),
    expectedDecisionVersion: positiveInteger(value.expectedDecisionVersion, "saveIssueResolutions.expectedDecisionVersion"),
    decisions: decisions.map((item, index) => {
      const row = exactRecord(item, ["issueId", "status", "correction", "resolutionNote"], `saveIssueResolutions.decisions.${index}`);
      const status = enumValue(row.status, new Set(["accepted", "corrected", "excluded", "ignored", "deferred"]), `status.${index}`);
      const correction = exactRecord(row.correction, [], `correction.${index}`);
      for (const key of Object.keys(correction)) if (!ISSUE_FIELDS.has(key)) invalid(`correction.${index}`);
      const note = row.resolutionNote === null ? null : boundedText(row.resolutionNote, `resolutionNote.${index}`, 500);
      return { issueId: uuid(row.issueId, `issueId.${index}`), status, correction, resolutionNote: note };
    }),
  };
}

function mapWorkflow(value: unknown, field: string): ImportMappingWorkflow {
  const row = exactRecord(value, ["batchId", "batchVersion", "decisionVersion", "evidenceHash", "previewHash", "state", "mappings", "sourceLabels", "issues", "impact"], field);
  const mappings = exactRecord(row.mappings, ["items", "pendingCount", "confirmedCount", "excludedCount"], `${field}.mappings`);
  const sourceLabels = exactRecord(row.sourceLabels, ["items", "pendingCount", "resolvedCount"], `${field}.sourceLabels`);
  const issues = exactRecord(row.issues, ["items", "openCount", "blockingCount"], `${field}.issues`);
  const impact = exactRecord(row.impact, ["state", "reason"], `${field}.impact`);
  if (impact.state !== "unavailable" || impact.reason !== "employee_commit_not_migrated") invalid(`${field}.impact`);
  return {
    batchId: uuid(row.batchId, `${field}.batchId`),
    batchVersion: positiveInteger(row.batchVersion, `${field}.batchVersion`),
    decisionVersion: positiveInteger(row.decisionVersion, `${field}.decisionVersion`),
    evidenceHash: hash(row.evidenceHash, `${field}.evidenceHash`),
    previewHash: hash(row.previewHash, `${field}.previewHash`),
    state: enumValue(row.state, new Set(["blocked", "ready"]), `${field}.state`),
    mappings: {
      items: array(mappings.items, `${field}.mappings.items`).map((item, index) => mapMapping(item, `${field}.mappings.items.${index}`)),
      pendingCount: nonnegativeInteger(mappings.pendingCount, `${field}.mappings.pendingCount`),
      confirmedCount: nonnegativeInteger(mappings.confirmedCount, `${field}.mappings.confirmedCount`),
      excludedCount: nonnegativeInteger(mappings.excludedCount, `${field}.mappings.excludedCount`),
    },
    sourceLabels: {
      items: array(sourceLabels.items, `${field}.sourceLabels.items`).map((item, index) => mapSourceLabel(item, `${field}.sourceLabels.items.${index}`)),
      pendingCount: nonnegativeInteger(sourceLabels.pendingCount, `${field}.sourceLabels.pendingCount`),
      resolvedCount: nonnegativeInteger(sourceLabels.resolvedCount, `${field}.sourceLabels.resolvedCount`),
    },
    issues: {
      items: array(issues.items, `${field}.issues.items`).map((item, index) => mapIssue(item, `${field}.issues.items.${index}`)),
      openCount: nonnegativeInteger(issues.openCount, `${field}.issues.openCount`),
      blockingCount: nonnegativeInteger(issues.blockingCount, `${field}.issues.blockingCount`),
    },
    impact: { state: "unavailable", reason: "employee_commit_not_migrated" },
  };
}

function mapMapping(value: unknown, field: string): ImportMappingWorkflowItem {
  const row = exactRecord(value, ["mappingId", "sourceColumnName", "sourceColumnIndex", "targetField", "mappingStatus", "transformationRule", "isRequired"], field);
  const target = row.targetField === null ? null : boundedText(row.targetField, `${field}.targetField`, 100);
  if (target !== null && !TARGET_FIELDS.has(target)) invalid(`${field}.targetField`);
  return {
    mappingId: uuid(row.mappingId, `${field}.mappingId`),
    sourceColumnName: boundedText(row.sourceColumnName, `${field}.sourceColumnName`, 255),
    sourceColumnIndex: nonnegativeInteger(row.sourceColumnIndex, `${field}.sourceColumnIndex`),
    targetField: target,
    mappingStatus: enumValue(row.mappingStatus, new Set(["confirmed", "excluded", "pending"]), `${field}.mappingStatus`),
    transformationRule: exactRecord(row.transformationRule, [], `${field}.transformationRule`),
    isRequired: booleanValue(row.isRequired, `${field}.isRequired`),
  };
}

function mapSourceLabel(value: unknown, field: string): ImportSourceLabelWorkflowItem {
  const row = exactRecord(value, ["sourceLabelId", "resolutionType", "sourceLabel", "normalizedSourceLabel", "affectedRowCount", "action", "targetDepartmentId", "targetOperationalUnitId", "targetPositionId", "targetPositionFamilyId", "externalRoleCode", "externalRoleName"], field);
  return {
    sourceLabelId: uuid(row.sourceLabelId, `${field}.sourceLabelId`),
    resolutionType: enumValue(row.resolutionType, new Set(["department", "position"]), `${field}.resolutionType`),
    sourceLabel: boundedText(row.sourceLabel, `${field}.sourceLabel`, 255),
    normalizedSourceLabel: boundedText(row.normalizedSourceLabel, `${field}.normalizedSourceLabel`, 255),
    affectedRowCount: nonnegativeInteger(row.affectedRowCount, `${field}.affectedRowCount`),
    action: enumValue(row.action, new Set(["department", "operational_unit", "position", "family", "external", "ignore", "defer", "pending"]), `${field}.action`),
    targetDepartmentId: nullableUuid(row.targetDepartmentId, `${field}.targetDepartmentId`),
    targetOperationalUnitId: nullableUuid(row.targetOperationalUnitId, `${field}.targetOperationalUnitId`),
    targetPositionId: nullableUuid(row.targetPositionId, `${field}.targetPositionId`),
    targetPositionFamilyId: nullableUuid(row.targetPositionFamilyId, `${field}.targetPositionFamilyId`),
    externalRoleCode: nullableText(row.externalRoleCode, `${field}.externalRoleCode`, 100),
    externalRoleName: nullableText(row.externalRoleName, `${field}.externalRoleName`, 255),
  };
}

function mapIssue(value: unknown, field: string): ImportIssueWorkflowItem {
  const row = exactRecord(value, ["issueId", "issueType", "severity", "sourceField", "sourceValueProjection", "message", "status", "correction", "resolutionNote"], field);
  return {
    issueId: uuid(row.issueId, `${field}.issueId`),
    issueType: boundedText(row.issueType, `${field}.issueType`, 255),
    severity: enumValue(row.severity, new Set(["warning", "error"]), `${field}.severity`),
    sourceField: nullableText(row.sourceField, `${field}.sourceField`, 100),
    sourceValueProjection: nullableText(row.sourceValueProjection, `${field}.sourceValueProjection`, 256),
    message: boundedText(row.message, `${field}.message`, 1000),
    status: enumValue(row.status, new Set(["accepted", "corrected", "excluded", "ignored", "deferred", "open"]), `${field}.status`),
    correction: exactRecord(row.correction, [], `${field}.correction`),
    resolutionNote: nullableText(row.resolutionNote, `${field}.resolutionNote`, 500),
  };
}

function exactRecord(value: unknown, keys: readonly string[], field: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  const row = value as Record<string, any>;
  if (keys.length && Object.keys(row).some(key => !keys.includes(key))) invalid(field);
  return row;
}
function array(value: unknown, field: string): unknown[] { if (!Array.isArray(value)) invalid(field); return value; }
function uuid(value: unknown, field: string): string { const result = boundedText(value, field, 100); if (!UUID.test(result)) invalid(field); return result; }
function nullableUuid(value: unknown, field: string): string | null { return value === null ? null : uuid(value, field); }
function hash(value: unknown, field: string): string { const result = boundedText(value, field, 100); if (!HASH.test(result)) invalid(field); return result; }
function boundedText(value: unknown, field: string, max: number): string { if (typeof value !== "string" || value.length === 0 || value.length > max) invalid(field); return value; }
function nullableText(value: unknown, field: string, max: number): string | null { return value === null ? null : boundedText(value, field, max); }
function positiveInteger(value: unknown, field: string): number { const result = nonnegativeInteger(value, field); if (result < 1) invalid(field); return result; }
function nonnegativeInteger(value: unknown, field: string): number { if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(field); return Number(value); }
function booleanValue(value: unknown, field: string): boolean { if (typeof value !== "boolean") invalid(field); return value; }
function enumValue<T extends string>(value: unknown, allowed: Set<T>, field: string): T { if (typeof value !== "string" || !allowed.has(value as T)) invalid(field); return value as T; }
function invalid(field: string): never { throw new Error(`NEON_IMPORT_MAPPING_PAYLOAD_INVALID:${field}`); }
