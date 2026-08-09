import "server-only";

import { createHash } from "node:crypto";

import type { NeonQueryable } from "../../lib/neon/actor-context.ts";
import type {
  ClaimDueCleanupInput,
  CompleteCleanupInput,
  CreateImportUploadIntentInput,
  FailCleanupInput,
  ImportCleanupClaim,
  ImportEvidenceValue,
  ImportFieldMappingStagingEvidence,
  ImportHistoryItem,
  ImportIssueStagingEvidence,
  ImportSagaState,
  ImportSheetStagingEvidence,
  ImportSourceLabelStagingEvidence,
  ImportSourceRowStagingEvidence,
  ImportStagingRepository,
  ImportStagingResult,
  ImportStorageLifecycle,
  ImportUploadIntent,
  ImportVerificationStatus,
  ImportWorkbookLifecycle,
  ImportWorkflowProjection,
  MarkCleanupPendingInput,
  RecordImportObjectVerificationInput,
  StageVerifiedWorkbookInput,
} from "../contracts/import-staging-repository.ts";

type PayloadRow = { payload: unknown };
type TrustedImportScope = { tenantId: string; propertyId: string };
type JsonRecord = Record<string, JsonValue>;
type JsonValue = string | number | boolean | null | JsonRecord | JsonValue[];
type PreparedCollection = { chunks: readonly string[]; records: readonly JsonRecord[] };

const OTHER_MAX_RECORDS = 250;
const SOURCE_ROW_MAX_RECORDS = 250;
const OTHER_MAX_BYTES = 512 * 1024;
const SOURCE_ROW_MAX_BYTES = 1024 * 1024;
const UTF8 = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const TARGET_FIELDS = new Set([
  "employee_number",
  "name_zh",
  "name_en",
  "department_source_label",
  "position_source_label",
  "grade_or_band",
  "hire_date",
  "probation_or_confirmation_date",
  "employment_status",
]);
const STORAGE_LIFECYCLES = new Set<ImportStorageLifecycle>([
  "intent_created", "uploaded_unverified", "verification_failed", "verified",
  "linked", "cleanup_pending", "cleanup_in_progress", "cleanup_failed", "cleanup_completed",
]);
const WORKBOOK_LIFECYCLES = new Set<ImportWorkbookLifecycle>([
  "intent_created", "inspecting", "mapping_required", "failed",
]);
const VERIFICATION_STATUSES = new Set<ImportVerificationStatus>([
  "pending", "passed", "failed",
]);

/** The only database surface available to this E5B repository. */
export const APPROVED_IMPORT_STAGING_ENTRYPOINTS = Object.freeze([
  "begin_neon_import_staging",
  "append_neon_import_sheets",
  "append_neon_import_field_mappings",
  "append_neon_import_source_rows",
  "append_neon_import_issues",
  "append_neon_import_source_labels",
  "finalize_neon_import_staging",
  "create_neon_import_upload_intent",
  "record_neon_import_object_uploaded",
  "record_neon_import_object_verification",
  "mark_neon_import_cleanup_pending",
  "claim_neon_import_cleanup",
  "complete_neon_import_cleanup",
  "fail_neon_import_cleanup",
  "get_neon_import_workflow",
  "list_neon_import_history",
] as const);

/**
 * This adapter is instantiated only inside the server authorization transaction.
 * The trusted scope is used to verify server-only payloads; method inputs never
 * choose a tenant, property, role, object path, or actor identity.
 */
export function createNeonImportStagingRepository(
  database: NeonQueryable,
  trustedHostname: string,
  trustedScope: TrustedImportScope,
): ImportStagingRepository {
  const hostname = nonemptyString(trustedHostname, "trustedHostname");
  const scope = exactRecord(trustedScope, ["tenantId", "propertyId"], "trustedScope");
  const tenantId = uuid(scope.tenantId, "trustedScope.tenantId");
  const propertyId = uuid(scope.propertyId, "trustedScope.propertyId");

  return {
    async createUploadIntent(input) {
      const value = exactRecord(input, [
        "batchId", "originalFilename", "sanitizedFilename", "declaredChecksumSha256",
        "declaredSizeBytes", "declaredMimeType", "sourceSystem",
      ], "createUploadIntent");
      const batchId = uuid(value.batchId, "createUploadIntent.batchId");
      const result = await database.query<PayloadRow>(
        "select public.create_neon_import_upload_intent($1::text,$2::uuid,$3::text,$4::text,$5::text,$6::bigint,$7::text,$8::text) as payload",
        [
          hostname, batchId,
          boundedString(value.originalFilename, "createUploadIntent.originalFilename", 255),
          sanitizedFilename(value.sanitizedFilename, "createUploadIntent.sanitizedFilename"),
          sha256(value.declaredChecksumSha256, "createUploadIntent.declaredChecksumSha256"),
          boundedInteger(value.declaredSizeBytes, "createUploadIntent.declaredSizeBytes", 1, 52_428_800),
          importMime(value.declaredMimeType, "createUploadIntent.declaredMimeType"),
          boundedString(value.sourceSystem, "createUploadIntent.sourceSystem", 100),
        ],
      );
      return mapUploadIntent(result.rows[0]?.payload, tenantId, propertyId, batchId);
    },

    async recordObjectUploaded(batchId, expectedVersion) {
      const id = uuid(batchId, "recordObjectUploaded.batchId");
      const result = await database.query<PayloadRow>(
        "select public.record_neon_import_object_uploaded($1::text,$2::uuid,$3::bigint) as payload",
        [hostname, id, positiveInteger(expectedVersion, "recordObjectUploaded.expectedVersion")],
      );
      return mapSagaState(result.rows[0]?.payload, id);
    },

    async recordObjectVerification(input) {
      const value = exactRecord(input, [
        "batchId", "expectedVersion", "verifiedChecksumSha256", "verifiedSizeBytes",
        "verifiedMimeType", "status", "failureReason",
      ], "recordObjectVerification");
      const status = enumValue(value.status, new Set(["passed", "failed"]), "recordObjectVerification.status");
      const verifiedChecksum = sha256(value.verifiedChecksumSha256, "recordObjectVerification.verifiedChecksumSha256");
      const verifiedSize = boundedInteger(value.verifiedSizeBytes, "recordObjectVerification.verifiedSizeBytes", 1, 52_428_800);
      const verifiedMime = importMime(value.verifiedMimeType, "recordObjectVerification.verifiedMimeType");
      const failureReason = nullableBoundedString(value.failureReason, "recordObjectVerification.failureReason", 500);
      if (status === "passed" && failureReason !== null) invalid("recordObjectVerification.failureReason");
      if (status === "failed" && failureReason === null) invalid("recordObjectVerification.failureReason");
      const id = uuid(value.batchId, "recordObjectVerification.batchId");
      const result = await database.query<PayloadRow>(
        "select public.record_neon_import_object_verification($1::text,$2::uuid,$3::bigint,$4::text,$5::bigint,$6::text,$7::text,$8::text) as payload",
        [hostname, id, positiveInteger(value.expectedVersion, "recordObjectVerification.expectedVersion"), verifiedChecksum, verifiedSize, verifiedMime, status, failureReason],
      );
      return mapSagaState(result.rows[0]?.payload, id);
    },

    async stageVerifiedWorkbook(input) {
      const prepared = prepareStagingInput(input);
      const sheets = prepareCollection(prepared.sheets, OTHER_MAX_RECORDS, OTHER_MAX_BYTES, "sheets");
      const mappings = prepareCollection(prepared.fieldMappings, OTHER_MAX_RECORDS, OTHER_MAX_BYTES, "fieldMappings");
      const rows = prepareCollection(prepared.sourceRows, SOURCE_ROW_MAX_RECORDS, SOURCE_ROW_MAX_BYTES, "sourceRows");
      const issues = prepareCollection(prepared.issues, OTHER_MAX_RECORDS, OTHER_MAX_BYTES, "issues");
      const labels = prepareCollection(prepared.sourceLabels, OTHER_MAX_RECORDS, OTHER_MAX_BYTES, "sourceLabels");
      const manifest = buildDatabaseManifest(prepared.batchId, prepared.batch, sheets.records, mappings.records, rows.records, issues.records, labels.records);
      const evidenceSha256 = e5bSha256(postgresJsonbText(manifest));

      const began = await database.query<PayloadRow>(
        "select public.begin_neon_import_staging($1::text,$2::uuid,$3::bigint,$4::jsonb) as payload",
        [hostname, prepared.batchId, prepared.expectedVersion, JSON.stringify(prepared.batch)],
      );
      const beginState = mapSagaState(began.rows[0]?.payload, prepared.batchId);
      if (beginState.storageLifecycle !== "verified" || beginState.workbookLifecycle !== "inspecting" || beginState.verificationStatus !== "passed" || beginState.version !== prepared.expectedVersion) {
        invalid("stageVerifiedWorkbook.beginResult");
      }

      await appendChunks(database, "append_neon_import_sheets", hostname, prepared.batchId, sheets.chunks);
      await appendChunks(database, "append_neon_import_field_mappings", hostname, prepared.batchId, mappings.chunks);
      await appendChunks(database, "append_neon_import_source_rows", hostname, prepared.batchId, rows.chunks);
      await appendChunks(database, "append_neon_import_issues", hostname, prepared.batchId, issues.chunks);
      await appendChunks(database, "append_neon_import_source_labels", hostname, prepared.batchId, labels.chunks);

      const finalized = await database.query<PayloadRow>(
        "select public.finalize_neon_import_staging($1::text,$2::uuid,$3::bigint,$4::jsonb,$5::text) as payload",
        [hostname, prepared.batchId, prepared.expectedVersion, JSON.stringify(manifest), evidenceSha256],
      );
      const result = mapSagaState(finalized.rows[0]?.payload, prepared.batchId);
      if (result.storageLifecycle !== "linked" || result.workbookLifecycle !== "mapping_required" || result.verificationStatus !== "passed" || result.version !== prepared.expectedVersion + 1) {
        invalid("stageVerifiedWorkbook.result");
      }
      return { ...result, storageLifecycle: "linked", workbookLifecycle: "mapping_required" };
    },

    async markCleanupPending(input) {
      const value = exactRecord(input, ["batchId", "expectedVersion", "reason"], "markCleanupPending");
      const id = uuid(value.batchId, "markCleanupPending.batchId");
      const result = await database.query<PayloadRow>(
        "select public.mark_neon_import_cleanup_pending($1::text,$2::uuid,$3::bigint,$4::text) as payload",
        [hostname, id, positiveInteger(value.expectedVersion, "markCleanupPending.expectedVersion"), boundedString(value.reason, "markCleanupPending.reason", 500)],
      );
      return mapSagaState(result.rows[0]?.payload, id);
    },

    async claimDueCleanup(input) {
      const value = exactRecord(input, ["limit", "claimId"], "claimDueCleanup");
      const limit = boundedInteger(value.limit, "claimDueCleanup.limit", 1, 50);
      const claimId = uuid(value.claimId, "claimDueCleanup.claimId");
      const result = await database.query<PayloadRow>(
        "select public.claim_neon_import_cleanup($1::text,$2::uuid,$3::integer,$4::uuid) as payload",
        [hostname, null, limit, claimId],
      );
      const payload = exactRecord(result.rows[0]?.payload, ["claims"], "claimDueCleanup.payload");
      const claims = array(payload.claims, "claimDueCleanup.payload.claims");
      if (claims.length > limit) invalid("claimDueCleanup.payload.claims");
      return claims.map((claim, index) => mapCleanupClaim(claim, tenantId, propertyId, claimId, `claimDueCleanup.payload.claims.${index}`));
    },

    async completeCleanup(input) {
      const value = exactRecord(input, ["batchId", "operationId", "claimId"], "completeCleanup");
      const id = uuid(value.batchId, "completeCleanup.batchId");
      const result = await database.query<PayloadRow>(
        "select public.complete_neon_import_cleanup($1::text,$2::uuid,$3::uuid,$4::uuid) as payload",
        [hostname, id, uuid(value.operationId, "completeCleanup.operationId"), uuid(value.claimId, "completeCleanup.claimId")],
      );
      return mapSagaState(result.rows[0]?.payload, id);
    },

    async failCleanup(input) {
      const value = exactRecord(input, ["batchId", "operationId", "claimId", "error", "nextAttemptAt"], "failCleanup");
      const id = uuid(value.batchId, "failCleanup.batchId");
      const result = await database.query<PayloadRow>(
        "select public.fail_neon_import_cleanup($1::text,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::timestamptz) as payload",
        [hostname, id, uuid(value.operationId, "failCleanup.operationId"), uuid(value.claimId, "failCleanup.claimId"), boundedString(value.error, "failCleanup.error", 500), boundedString(value.nextAttemptAt, "failCleanup.nextAttemptAt", 100)],
      );
      return mapSagaState(result.rows[0]?.payload, id);
    },

    async getWorkflow(batchId) {
      const id = uuid(batchId, "getWorkflow.batchId");
      const result = await database.query<PayloadRow>(
        "select public.get_neon_import_workflow($1::text,$2::uuid) as payload",
        [hostname, id],
      );
      return result.rows[0]?.payload === null ? null : mapWorkflow(result.rows[0]?.payload, id);
    },

    async listHistory() {
      const result = await database.query<PayloadRow>(
        "select public.list_neon_import_history($1::text) as payload",
        [hostname],
      );
      const payload = exactRecord(result.rows[0]?.payload, ["rows"], "listHistory.payload");
      const rows = array(payload.rows, "listHistory.payload.rows");
      if (rows.length > 100) invalid("listHistory.payload.rows");
      return rows.map((row, index) => mapWorkflow(row, undefined, `listHistory.payload.rows.${index}`));
    },
  };
}

function prepareStagingInput(input: StageVerifiedWorkbookInput) {
  const value = exactRecord(input, ["batchId", "expectedVersion", "evidence"], "stageVerifiedWorkbook");
  const evidence = exactRecord(value.evidence, ["batch", "sheets", "fieldMappings", "sourceRows", "issues", "sourceLabels"], "stageVerifiedWorkbook.evidence");
  const batchId = uuid(value.batchId, "stageVerifiedWorkbook.batchId");
  const sheets = array(evidence.sheets, "stageVerifiedWorkbook.evidence.sheets").map((item, index) => mapSheet(item, `sheets.${index}`));
  const selected = sheets.filter(sheet => sheet.selected && sheet.purpose === "employee_master");
  if (selected.length !== 1) invalid("sheets.selected");
  const batch = mapBatch(evidence.batch, selected[0], sheets.length);
  const mappings = array(evidence.fieldMappings, "stageVerifiedWorkbook.evidence.fieldMappings").map((item, index) => mapMapping(item, `fieldMappings.${index}`));
  const rows = array(evidence.sourceRows, "stageVerifiedWorkbook.evidence.sourceRows").map((item, index) => mapSourceRow(item, `sourceRows.${index}`));
  const issues = array(evidence.issues, "stageVerifiedWorkbook.evidence.issues").map((item, index) => mapIssue(item, `issues.${index}`));
  const labels = array(evidence.sourceLabels, "stageVerifiedWorkbook.evidence.sourceLabels").map((item, index) => mapSourceLabel(item, `sourceLabels.${index}`));
  validateEvidenceRelations(batch, sheets, mappings, rows, issues, labels);
  return { batchId, expectedVersion: positiveInteger(value.expectedVersion, "stageVerifiedWorkbook.expectedVersion"), batch, sheets, fieldMappings: mappings, sourceRows: rows, issues, sourceLabels: labels };
}

function mapBatch(value: unknown, selected: JsonRecord, sheetCount: number): JsonRecord {
  const row = exactRecord(value, ["detectedSheetCount", "totalSourceRows", "validRows", "warningRows", "errorRows", "selectedSheetName"], "batch");
  const detected = boundedInteger(row.detectedSheetCount, "batch.detectedSheetCount", 1, 2_147_483_647);
  const total = boundedInteger(row.totalSourceRows, "batch.totalSourceRows", 0, 2_147_483_647);
  const valid = boundedInteger(row.validRows, "batch.validRows", 0, 2_147_483_647);
  const warning = boundedInteger(row.warningRows, "batch.warningRows", 0, 2_147_483_647);
  const error = boundedInteger(row.errorRows, "batch.errorRows", 0, 2_147_483_647);
  if (detected !== sheetCount || valid + warning + error !== total) invalid("batch.counts");
  const selectedName = boundedString(row.selectedSheetName, "batch.selectedSheetName", 255);
  if (selected.name !== selectedName) invalid("batch.selectedSheetName");
  return { detectedSheetCount: detected, totalSourceRows: total, validRows: valid, warningRows: warning, errorRows: error, selectedSheetId: selected.id };
}

function mapSheet(value: unknown, field: string): JsonRecord {
  const row = exactRecord(value, ["id", "name", "index", "headerRow", "rowCount", "columnCount", "hidden", "selected", "purpose"], field);
  const purpose = enumValue(row.purpose, new Set(["employee_master", "excluded"]), `${field}.purpose`);
  const selected = booleanValue(row.selected, `${field}.selected`);
  if ((purpose === "employee_master") !== selected) invalid(`${field}.selected`);
  const header = row.headerRow === null ? null : positiveInteger(row.headerRow, `${field}.headerRow`);
  return { id: uuid(row.id, `${field}.id`), name: boundedString(row.name, `${field}.name`, 255), index: boundedInteger(row.index, `${field}.index`, 0, 2_147_483_647), headerRow: header, rowCount: boundedInteger(row.rowCount, `${field}.rowCount`, 0, 2_147_483_647), columnCount: boundedInteger(row.columnCount, `${field}.columnCount`, 0, 2_147_483_647), hidden: booleanValue(row.hidden, `${field}.hidden`), selected, purpose };
}

function mapMapping(value: unknown, field: string): JsonRecord {
  const row = exactRecord(value, ["sheetId", "sourceColumnName", "sourceColumnIndex", "targetField", "transformationRule", "isRequired"], field);
  const transformation = exactRecord(row.transformationRule, ["trim", "preserveText"], `${field}.transformationRule`);
  if (transformation.trim !== true) invalid(`${field}.transformationRule.trim`);
  const record: JsonRecord = { sheetId: uuid(row.sheetId, `${field}.sheetId`), sourceColumnName: boundedString(row.sourceColumnName, `${field}.sourceColumnName`, 255), sourceColumnIndex: boundedInteger(row.sourceColumnIndex, `${field}.sourceColumnIndex`, 0, 2_147_483_647), targetField: targetField(row.targetField, `${field}.targetField`), transformationRule: { trim: true, preserveText: booleanValue(transformation.preserveText, `${field}.transformationRule.preserveText`) }, isRequired: booleanValue(row.isRequired, `${field}.isRequired`), mappingStatus: "suggested" };
  return { id: deterministicUuid("mapping", record), ...record };
}

function mapSourceRow(value: unknown, field: string): JsonRecord {
  const row = exactRecord(value, ["id", "sheetId", "sourceRowNumber", "rawValues", "normalizedValues", "rowFingerprint", "processingStatus", "proposedAction", "validationSummary"], field);
  const raw = array(row.rawValues, `${field}.rawValues`).map((cell, index) => mapRawCell(cell, `${field}.rawValues.${index}`));
  if (raw.length === 0) invalid(`${field}.rawValues`);
  const sortedRaw = [...raw].sort((left, right) => Number(left.sourceColumnIndex) - Number(right.sourceColumnIndex));
  if (new Set(sortedRaw.map(cell => String(cell.sourceColumnIndex))).size !== sortedRaw.length) invalid(`${field}.rawValues`);
  if (sha256(row.rowFingerprint, `${field}.rowFingerprint`) !== sourceRowFingerprint(sortedRaw)) {
    invalid(`${field}.rowFingerprint`);
  }
  const normalizedInput = exactRecordValue(row.normalizedValues, `${field}.normalizedValues`);
  const normalized: JsonRecord = {};
  for (const [key, cell] of Object.entries(normalizedInput)) normalized[targetField(key, `${field}.normalizedValues.${key}`)] = evidenceValue(cell, `${field}.normalizedValues.${key}`);
  const summary = exactRecord(row.validationSummary, ["blockingIssues", "warningIssues"], `${field}.validationSummary`);
  const processing = enumValue(row.processingStatus, new Set(["staged", "warning", "error"]), `${field}.processingStatus`);
  if (row.proposedAction !== "unresolved") invalid(`${field}.proposedAction`);
  return { id: uuid(row.id, `${field}.id`), sheetId: uuid(row.sheetId, `${field}.sheetId`), sourceRowNumber: positiveInteger(row.sourceRowNumber, `${field}.sourceRowNumber`), rawValues: sortedRaw, normalizedValues: normalized, rowFingerprint: sha256(row.rowFingerprint, `${field}.rowFingerprint`), processingStatus: processing, proposedAction: "unresolved", validationSummary: { blockingIssues: stringArray(summary.blockingIssues, `${field}.validationSummary.blockingIssues`), warningIssues: stringArray(summary.warningIssues, `${field}.validationSummary.warningIssues`) } };
}

function mapRawCell(value: unknown, field: string): JsonRecord {
  const row = exactRecord(value, ["sourceColumnIndex", "sourceColumnName", "targetField", "value"], field);
  return { sourceColumnIndex: boundedInteger(row.sourceColumnIndex, `${field}.sourceColumnIndex`, 0, 2_147_483_647), sourceColumnName: boundedString(row.sourceColumnName, `${field}.sourceColumnName`, 255), targetField: targetField(row.targetField, `${field}.targetField`), value: evidenceValue(row.value, `${field}.value`) };
}

function mapIssue(value: unknown, field: string): JsonRecord {
  const row = exactRecord(value, ["sourceRowId", "issueType", "severity", "message"], field);
  const record: JsonRecord = { sourceRowId: uuid(row.sourceRowId, `${field}.sourceRowId`), issueType: boundedString(row.issueType, `${field}.issueType`, 255), severity: enumValue(row.severity, new Set(["warning", "error"]), `${field}.severity`), message: boundedString(row.message, `${field}.message`, 1000) };
  return { id: deterministicUuid("issue", record), ...record };
}

function mapSourceLabel(value: unknown, field: string): JsonRecord {
  const row = exactRecord(value, ["resolutionType", "sourceLabel", "normalizedSourceLabel", "sourceSheet", "affectedRowCount"], field);
  const sourceLabel = boundedAsciiBtrimString(row.sourceLabel, `${field}.sourceLabel`, 255);
  const normalized = normalizeImportSourceLabel(sourceLabel);
  if (normalized !== stringValue(row.normalizedSourceLabel, `${field}.normalizedSourceLabel`)) invalid(`${field}.normalizedSourceLabel`);
  return { resolutionType: enumValue(row.resolutionType, new Set(["department", "position"]), `${field}.resolutionType`), sourceLabel, normalizedSourceLabel: normalized, sourceSheet: boundedAsciiBtrimString(row.sourceSheet, `${field}.sourceSheet`, 255), affectedRowCount: boundedInteger(row.affectedRowCount, `${field}.affectedRowCount`, 0, 2_147_483_647) };
}

function validateEvidenceRelations(batch: JsonRecord, sheets: readonly JsonRecord[], mappings: readonly JsonRecord[], rows: readonly JsonRecord[], issues: readonly JsonRecord[], labels: readonly JsonRecord[]) {
  const sheetIds = new Set(sheets.map(sheet => String(sheet.id)));
  if (sheetIds.size !== sheets.length) invalid("sheets.id");
  const selectedSheet = sheets.find(sheet => sheet.id === batch.selectedSheetId);
  if (!selectedSheet) invalid("batch.selectedSheetId");
  const mappingKeys = new Set<string>();
  for (const mapping of mappings) {
    if (!sheetIds.has(String(mapping.sheetId))) invalid("fieldMappings.sheetId");
    const key = `${mapping.sheetId}:${mapping.sourceColumnIndex}`;
    if (mappingKeys.has(key)) invalid("fieldMappings.sourceColumnIndex");
    mappingKeys.add(key);
  }
  const rowIds = new Set<string>();
  const labelCounts = new Map<string, number>();
  let valid = 0; let warning = 0; let error = 0;
  for (const row of rows) {
    if (!sheetIds.has(String(row.sheetId)) || row.sheetId !== selectedSheet.id) invalid("sourceRows.sheetId");
    if (rowIds.has(String(row.id))) invalid("sourceRows.id");
    rowIds.add(String(row.id));
    const status = String(row.processingStatus);
    if (status === "staged") valid += 1; else if (status === "warning") warning += 1; else error += 1;
    for (const kind of ["department", "position"] as const) {
      const field = kind === "department" ? "department_source_label" : "position_source_label";
      const value = row.normalizedValues as JsonRecord;
      if (typeof value[field] === "string" && trimAsciiSpace(value[field] as string).length > 0) {
        const key = `${kind}:${selectedSheet.name}:${normalizeImportSourceLabel(value[field] as string)}`;
        labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
      }
    }
  }
  if (rows.length !== batch.totalSourceRows || valid !== batch.validRows || warning !== batch.warningRows || error !== batch.errorRows) invalid("batch.rowCounts");
  for (const issue of issues) if (!rowIds.has(String(issue.sourceRowId))) invalid("issues.sourceRowId");
  const labelKeys = new Set<string>();
  for (const label of labels) {
    if (label.sourceSheet !== selectedSheet.name) invalid("sourceLabels.sourceSheet");
    const key = `${label.resolutionType}:${label.sourceSheet}:${label.normalizedSourceLabel}`;
    if (labelKeys.has(key) || labelCounts.get(key) !== label.affectedRowCount) invalid("sourceLabels");
    labelKeys.add(key);
  }
  if (labelKeys.size !== labelCounts.size) invalid("sourceLabels");
}

function prepareCollection(records: readonly JsonRecord[], maxRecords: number, maxBytes: number, field: string): PreparedCollection {
  const ordered = [...records].sort((left, right) => compareUtf8(stableJson(left), stableJson(right)));
  const chunks: string[] = [];
  let chunk: JsonRecord[] = [];
  for (const record of ordered) {
    if (postgresJsonbByteUpperBound([record]) > maxBytes) recordTooLarge();
    const candidate = [...chunk, record];
    if (chunk.length > 0 && (candidate.length > maxRecords || postgresJsonbByteUpperBound(candidate) > maxBytes)) {
      chunks.push(JSON.stringify(chunk));
      chunk = [record];
    } else chunk = candidate;
  }
  if (chunk.length > 0) chunks.push(JSON.stringify(chunk));
  if (chunks.some(chunkValue => postgresJsonbByteUpperBound(JSON.parse(chunkValue)) > maxBytes)) invalid(`${field}.chunkBytes`);
  return { records: ordered, chunks };
}

async function appendChunks(database: NeonQueryable, entrypoint: typeof APPROVED_IMPORT_STAGING_ENTRYPOINTS[number], hostname: string, batchId: string, chunks: readonly string[]) {
  for (const chunk of chunks) {
    if (entrypoint === "append_neon_import_sheets") await database.query("select public.append_neon_import_sheets($1::text,$2::uuid,$3::jsonb)", [hostname, batchId, chunk]);
    else if (entrypoint === "append_neon_import_field_mappings") await database.query("select public.append_neon_import_field_mappings($1::text,$2::uuid,$3::jsonb)", [hostname, batchId, chunk]);
    else if (entrypoint === "append_neon_import_source_rows") await database.query("select public.append_neon_import_source_rows($1::text,$2::uuid,$3::jsonb)", [hostname, batchId, chunk]);
    else if (entrypoint === "append_neon_import_issues") await database.query("select public.append_neon_import_issues($1::text,$2::uuid,$3::jsonb)", [hostname, batchId, chunk]);
    else if (entrypoint === "append_neon_import_source_labels") await database.query("select public.append_neon_import_source_labels($1::text,$2::uuid,$3::jsonb)", [hostname, batchId, chunk]);
    else invalid("append.entrypoint");
  }
}

function buildDatabaseManifest(batchId: string, batch: JsonRecord, sheets: readonly JsonRecord[], mappings: readonly JsonRecord[], rows: readonly JsonRecord[], issues: readonly JsonRecord[], labels: readonly JsonRecord[]): JsonRecord {
  return {
    algorithm: "e5b-canonical-json-sha256-v1",
    batch: { id: batchId, detectedSheetCount: batch.detectedSheetCount, totalSourceRows: batch.totalSourceRows, validRows: batch.validRows, warningRows: batch.warningRows, errorRows: batch.errorRows, selectedSheetId: batch.selectedSheetId },
    sheets: [...sheets].sort((left, right) => Number(left.index) - Number(right.index) || compareUtf8(String(left.id), String(right.id))).map(sheet => e5bSha256(postgresJsonbText(sheet))),
    fieldMappings: [...mappings].sort((left, right) => compareUtf8(String(left.sheetId), String(right.sheetId)) || Number(left.sourceColumnIndex) - Number(right.sourceColumnIndex) || compareUtf8(String(left.id), String(right.id))).map(mapping => e5bSha256(postgresJsonbText(fieldMappingManifestProjection(mapping)))),
    sourceRows: [...rows].sort((left, right) => compareUtf8(String(left.sheetId), String(right.sheetId)) || Number(left.sourceRowNumber) - Number(right.sourceRowNumber) || compareUtf8(String(left.id), String(right.id))).map(row => e5bSha256(postgresJsonbText(row))),
    issues: [...issues].sort((left, right) => compareUtf8(String(left.sourceRowId), String(right.sourceRowId)) || compareUtf8(String(left.issueType), String(right.issueType)) || compareUtf8(String(left.id), String(right.id))).map(issue => e5bSha256(postgresJsonbText(issueManifestProjection(issue)))),
    sourceLabels: [...labels].sort((left, right) => compareUtf8(String(left.resolutionType), String(right.resolutionType)) || compareUtf8(String(batch.selectedSheetId), String(batch.selectedSheetId)) || compareUtf8(String(left.normalizedSourceLabel), String(right.normalizedSourceLabel))).map(label => e5bSha256(postgresJsonbText(sourceLabelManifestProjection(label, String(batch.selectedSheetId))))),
  };
}

function fieldMappingManifestProjection(mapping: JsonRecord): JsonRecord {
  return {
    sheetId: mapping.sheetId,
    sourceColumnName: mapping.sourceColumnName,
    sourceColumnIndex: mapping.sourceColumnIndex,
    targetField: mapping.targetField,
    transformationRule: mapping.transformationRule,
    isRequired: mapping.isRequired,
    mappingStatus: mapping.mappingStatus,
  };
}

function issueManifestProjection(issue: JsonRecord): JsonRecord {
  return {
    sourceRowId: issue.sourceRowId,
    issueType: issue.issueType,
    severity: issue.severity,
    sourceField: null,
    sourceValueProjection: null,
    message: issue.message,
    resolutionStatus: "open",
  };
}

function sourceLabelManifestProjection(label: JsonRecord, selectedSheetId: string): JsonRecord {
  return {
    sheetId: selectedSheetId,
    resolutionType: label.resolutionType,
    sourceLabel: label.sourceLabel,
    normalizedSourceLabel: label.normalizedSourceLabel,
    affectedRowCount: label.affectedRowCount,
    resolutionStatus: "pending",
  };
}

/** PostgreSQL jsonb textual form has canonical keys and commas/colons with spaces. */
function postgresJsonbText(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(postgresJsonbText).join(", ")}]`;
  const keys = Object.keys(value).sort((left, right) => left.length - right.length || compareUtf8(left, right));
  return `{${keys.map(key => `${JSON.stringify(key)}: ${postgresJsonbText(value[key])}`).join(", ")}}`;
}

function e5bSha256(value: string): string {
  const bytes = UTF8.encode(value).byteLength;
  return createHash("sha256").update(`e5b-utf8-frame-v1:${bytes}:${value}`, "utf8").digest("hex");
}

function postgresJsonbByteUpperBound(value: JsonValue): number {
  return utf8ByteLength(postgresJsonbText(value)) + jsonNodeCount(value) * 16 + 64;
}

function jsonNodeCount(value: JsonValue): number {
  if (value === null || typeof value !== "object") return 1;
  if (Array.isArray(value)) return 1 + value.reduce((total, child) => total + jsonNodeCount(child), 0);
  return 1 + Object.values(value).reduce((total, child) => total + jsonNodeCount(child), 0);
}

function sourceRowFingerprint(rawValues: readonly JsonRecord[]): string {
  return e5bSha256(postgresJsonbText([...rawValues].sort((left, right) => Number(left.sourceColumnIndex) - Number(right.sourceColumnIndex) || compareUtf8(String(left.sourceColumnName), String(right.sourceColumnName)) || compareUtf8(String(left.targetField), String(right.targetField)))));
}

/** Mirrors 092's `neon_import_source_row_fingerprint` for parser preflight. */
export function computeImportSourceRowFingerprint(rawValues: readonly unknown[]): string {
  const mapped = rawValues.map((value, index) => mapRawCell(value, `rawValues.${index}`));
  if (mapped.length === 0 || new Set(mapped.map(cell => String(cell.sourceColumnIndex))).size !== mapped.length) invalid("rawValues");
  return sourceRowFingerprint(mapped);
}

function deterministicUuid(namespace: string, value: JsonRecord): string {
  const digest = createHash("sha256").update(`${namespace}:${stableJson(value)}`, "utf8").digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort(compareUtf8).map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function mapUploadIntent(value: unknown, tenantId: string, propertyId: string, expectedBatchId: string): ImportUploadIntent {
  const row = exactRecord(value, ["batch_id", "bucket", "object_path", "storage_lifecycle", "workbook_lifecycle", "verification_status", "version"], "createUploadIntent.payload");
  const batchId = uuid(row.batch_id, "createUploadIntent.payload.batch_id");
  if (batchId !== expectedBatchId || row.bucket !== "property-import-files") invalid("createUploadIntent.payload");
  const prefix = `${tenantId}/${propertyId}/imports/${batchId}/`;
  const objectPath = boundedString(row.object_path, "createUploadIntent.payload.object_path", 1000);
  if (!objectPath.startsWith(prefix) || objectPath.length === prefix.length) invalid("createUploadIntent.payload.object_path");
  const state = mapSagaFields(row, "createUploadIntent.payload");
  if (state.storageLifecycle !== "intent_created" || state.workbookLifecycle !== "intent_created" || state.verificationStatus !== "pending") invalid("createUploadIntent.payload.lifecycle");
  return { batchId, objectPath, storageLifecycle: "intent_created", workbookLifecycle: "intent_created", verificationStatus: "pending", version: state.version };
}

function mapSagaState(value: unknown, expectedBatchId: string): ImportSagaState {
  const row = exactRecord(value, ["batch_id", "storage_lifecycle", "workbook_lifecycle", "verification_status", "version"], "saga.payload");
  const batchId = uuid(row.batch_id, "saga.payload.batch_id");
  if (batchId !== expectedBatchId) invalid("saga.payload.batch_id");
  return { batchId, ...mapSagaFields(row, "saga.payload") };
}

function mapSagaFields(row: Record<string, unknown>, field: string) {
  return { storageLifecycle: enumValue(row.storage_lifecycle, STORAGE_LIFECYCLES, `${field}.storage_lifecycle`), workbookLifecycle: enumValue(row.workbook_lifecycle, WORKBOOK_LIFECYCLES, `${field}.workbook_lifecycle`), verificationStatus: enumValue(row.verification_status, VERIFICATION_STATUSES, `${field}.verification_status`), version: positiveInteger(row.version, `${field}.version`) };
}

function mapCleanupClaim(value: unknown, tenantId: string, propertyId: string, expectedClaimId: string, field: string): ImportCleanupClaim {
  const row = exactRecord(value, ["batch_id", "operation_id", "bucket", "object_path", "claim_id", "attempt_count", "lease_expires_at"], field);
  const batchId = uuid(row.batch_id, `${field}.batch_id`);
  const claimId = uuid(row.claim_id, `${field}.claim_id`);
  const objectPath = boundedString(row.object_path, `${field}.object_path`, 1000);
  if (row.bucket !== "property-import-files" || claimId !== expectedClaimId || !objectPath.startsWith(`${tenantId}/${propertyId}/imports/${batchId}/`)) invalid(field);
  return { batchId, operationId: uuid(row.operation_id, `${field}.operation_id`), bucket: "property-import-files", objectPath, claimId, attemptCount: positiveInteger(row.attempt_count, `${field}.attempt_count`), leaseExpiresAt: boundedString(row.lease_expires_at, `${field}.lease_expires_at`, 100) };
}

function mapWorkflow(value: unknown, expectedBatchId?: string, field = "workflow.payload"): ImportWorkflowProjection {
  const row = exactRecord(value, ["batch_id", "file_name", "storage_lifecycle", "workbook_lifecycle", "verification_status", "checksum_status", "counts", "cleanup_attention_required", "version", "created_at", "updated_at"], field);
  const batchId = uuid(row.batch_id, `${field}.batch_id`);
  if (expectedBatchId !== undefined && batchId !== expectedBatchId) invalid(`${field}.batch_id`);
  const counts = exactRecord(row.counts, ["sheets", "total", "valid", "warning", "error"], `${field}.counts`);
  if (!["verified", "pending", "failed"].includes(stringValue(row.checksum_status, `${field}.checksum_status`))) invalid(`${field}.checksum_status`);
  booleanValue(row.cleanup_attention_required, `${field}.cleanup_attention_required`);
  return { batchId, fileName: boundedString(row.file_name, `${field}.file_name`, 255), ...mapSagaFields(row, field), counts: { total: boundedInteger(counts.total, `${field}.counts.total`, 0, 2_147_483_647), valid: boundedInteger(counts.valid, `${field}.counts.valid`, 0, 2_147_483_647), warning: boundedInteger(counts.warning, `${field}.counts.warning`, 0, 2_147_483_647), error: boundedInteger(counts.error, `${field}.counts.error`, 0, 2_147_483_647) }, createdAt: boundedString(row.created_at, `${field}.created_at`, 100), updatedAt: boundedString(row.updated_at, `${field}.updated_at`, 100) };
}

function evidenceValue(value: unknown, field: string): ImportEvidenceValue { if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value; return invalid(field); }
function exactRecord(value: unknown, keys: readonly string[], field: string): Record<string, unknown> { const row = exactRecordValue(value, field); const actual = Object.keys(row).sort(compareUtf8); const expected = [...keys].sort(compareUtf8); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) invalid(field); return row; }
function exactRecordValue(value: unknown, field: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field); return value as Record<string, unknown>; }
function array(value: unknown, field: string): unknown[] { if (!Array.isArray(value) || Object.keys(value).length !== value.length) invalid(field); return value; }
function stringArray(value: unknown, field: string): string[] { return array(value, field).map((item, index) => boundedString(item, `${field}.${index}`, 1000)); }
function stringValue(value: unknown, field: string): string { if (typeof value !== "string" || value.trim().length === 0) invalid(field); return value; }
function nonemptyString(value: unknown, field: string): string { return stringValue(value, field).trim(); }
function boundedString(value: unknown, field: string, max: number): string { const text = nonemptyString(value, field); if ([...text].length > max) invalid(field); return text; }
function boundedAsciiBtrimString(value: unknown, field: string, max: number): string { const raw = stringValue(value, field); const text = trimAsciiSpace(raw); if (text.length === 0 || [...text].length > max) invalid(field); return text; }
function nullableBoundedString(value: unknown, field: string, max: number): string | null { return value === null ? null : boundedString(value, field, max); }
function sanitizedFilename(value: unknown, field: string): string { const text = boundedString(value, field, 181); if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(text) || text.includes("..")) invalid(field); return text; }
function importMime(value: unknown, field: string): string { const text = boundedString(value, field, 100); if (!new Set(["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv"]).has(text)) invalid(field); return text; }
function uuid(value: unknown, field: string): string { const text = stringValue(value, field); if (!UUID.test(text)) invalid(field); return text.toLowerCase(); }
function sha256(value: unknown, field: string): string { const text = stringValue(value, field); if (!SHA256.test(text)) invalid(field); return text; }
function targetField(value: unknown, field: string): string { const text = stringValue(value, field); if (!TARGET_FIELDS.has(text)) invalid(field); return text; }
function positiveInteger(value: unknown, field: string): number { return boundedInteger(value, field, 1, Number.MAX_SAFE_INTEGER); }
function boundedInteger(value: unknown, field: string, min: number, max: number): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid(field); return value; }
function booleanValue(value: unknown, field: string): boolean { if (typeof value !== "boolean") invalid(field); return value; }
function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, field: string): T { if (typeof value !== "string" || !allowed.has(value as T)) invalid(field); return value as T; }
function compareUtf8(left: string, right: string): number { const a = UTF8.encode(left); const b = UTF8.encode(right); for (let index = 0; index < Math.min(a.length, b.length); index += 1) if (a[index] !== b[index]) return a[index] - b[index]; return a.length - b.length; }
function utf8ByteLength(value: string): number { return UTF8.encode(value).byteLength; }
function normalizeImportSourceLabel(value: string): string { return trimAsciiSpace(value).normalize("NFKC").replace(/[A-Z]/g, character => character.toLowerCase()); }
function trimAsciiSpace(value: string): string { return value.replace(/^ +| +$/g, ""); }
function recordTooLarge(): never { throw new Error("E5B_IMPORT_STAGING_RECORD_TOO_LARGE"); }
function invalid(field: string): never { throw new Error(`NEON_IMPORT_STAGING_PAYLOAD_INVALID:${field}`); }
