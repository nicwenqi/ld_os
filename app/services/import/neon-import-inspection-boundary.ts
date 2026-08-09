import "server-only";

import { createHash } from "node:crypto";

import { runAuthorizedNeonImportStaging } from "../neon-import-staging-authorization.ts";
import { createStorageSagaCoordinator } from "./storage-saga-coordinator.ts";
import { prepareEmployeeMasterStaging } from "./production-workbook-staging.ts";
import { sanitizeWorkbookFilename } from "./workbook-parser.ts";
import type {
  ImportBatchStagingEvidence,
  ImportEvidenceValue,
  ImportEmployeeMasterTargetField,
  ImportFieldMappingStagingEvidence,
  ImportIssueStagingEvidence,
  ImportNormalizedEmployeeValues,
  ImportRawCellStagingEvidence,
  ImportSheetStagingEvidence,
  ImportSourceLabelStagingEvidence,
  ImportSourceRowStagingEvidence,
  ImportStagingRepository,
} from "../../repositories/contracts/import-staging-repository.ts";

const SOURCE_SYSTEM = "manual-upload";
const MAX_FILENAME_LENGTH = 160;
const MIME_TYPES = Object.freeze({
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

export type BrowserSafeImportSummary = Readonly<{
  sanitizedFilename: string;
  checksumPrefix: string;
  sizeBytes: number;
  detectedSheets: readonly { name: string; rowCount: number; columnCount: number; hidden: boolean }[];
  selectedSheet: string;
  headerRow: number;
  sourceRows: number;
  structurallyValid: number;
  blockedRows: number;
  warningRows: number;
  uniqueDepartmentLabels: number;
  uniquePositionLabels: number;
  exclusions: Readonly<Record<string, unknown>>;
  excludedColumns: readonly { sourceColumnName: string; reason: string }[];
  excludedSheets: readonly { name: string; reason: string }[];
  warnings: readonly string[];
  employeesImported: 0;
  trainingHistoryImported: false;
  ctcGtcImported: false;
}>;

export type NeonInspectionResult = Readonly<{
  batchId: string;
  status: "mapping_required";
  summary: BrowserSafeImportSummary;
}>;

export async function inspectAndStageWorkbookInNeon(input: {
  request: Request;
  requestId: string;
  file: File;
}): Promise<NeonInspectionResult> {
  const file = input.file;
  if (!(file instanceof File)) throw new Error("IMPORT_FILE_REQUIRED");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const filename = sanitizeWorkbookFilename(file.name).slice(0, MAX_FILENAME_LENGTH) || "workbook";
  const mimeType = declaredMimeType(filename, file.type);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const batchId = crypto.randomUUID();
  let summary: BrowserSafeImportSummary | null = null;

  const result = await runAuthorizedNeonImportStaging(
    input.request,
    input.requestId,
    async context => {
      const saga = createStorageSagaCoordinator({
        repository: context.repository,
        storage: context.storage,
        requestId: input.requestId,
      });
      const staged = await saga.uploadAndStage({
        batchId,
        originalFilename: file.name,
        sanitizedFilename: filename,
        declaredChecksumSha256: checksum,
        declaredSizeBytes: bytes.byteLength,
        declaredMimeType: mimeType,
        sourceSystem: SOURCE_SYSTEM,
        bytes,
        prepareEvidence: async (verifiedBytes, verified) => {
          const prepared = prepareEmployeeMasterStaging({
            fileName: filename,
            mimeType: verified.contentDerivedMimeType,
            bytes: verifiedBytes,
          });
          summary = browserSafeSummary(prepared.safeSummary);
          return buildStagingEvidence(prepared);
        },
      });
      if (!summary) throw new Error("IMPORT_SUMMARY_UNAVAILABLE");
      return { batchId: staged.batchId, status: "mapping_required" as const, summary };
    },
  );

  return result.data;
}

function declaredMimeType(filename: string, supplied: string) {
  const extension = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  const expected = extension === "xls" ? MIME_TYPES.xls : extension === "xlsx" ? MIME_TYPES.xlsx : extension === "csv" ? MIME_TYPES.csv : "";
  if (!expected) throw new Error("IMPORT_FILE_TYPE_UNSUPPORTED");
  // The server derives and validates content MIME during read-back. A browser
  // MIME value is only a declaration and never an authorization input.
  return supplied.trim().toLowerCase() || expected;
}

function buildStagingEvidence(prepared: ReturnType<typeof prepareEmployeeMasterStaging>) {
  const selected = prepared.inspection.sheets.find(sheet => sheet.name === prepared.safeSummary.selectedSheet);
  if (!selected) throw new Error("IMPORT_SELECTED_SHEET_MISSING");
  const sheets: ImportSheetStagingEvidence[] = prepared.inspection.sheets.map(sheet => ({
    id: crypto.randomUUID(),
    name: sheet.name,
    index: sheet.index,
    headerRow: sheet.likelyHeaderRow,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    hidden: sheet.hidden,
    selected: sheet.name === selected.name,
    purpose: sheet.name === selected.name ? "employee_master" : "excluded",
  }));
  const selectedSheet = sheets.find(sheet => sheet.selected);
  if (!selectedSheet) throw new Error("IMPORT_SELECTED_SHEET_MISSING");

  const fieldMappings: ImportFieldMappingStagingEvidence[] = prepared.fieldMappings.map(mapping => ({
    sheetId: selectedSheet.id,
    sourceColumnName: mapping.sourceColumnName,
    sourceColumnIndex: mapping.sourceColumnIndex,
    targetField: targetField(mapping.targetField),
    transformationRule: {
      trim: mapping.transformationRule.trim === true,
      preserveText: mapping.transformationRule.preserveText === true,
    },
    isRequired: mapping.isRequired === true,
  }));
  const sourceRows: ImportSourceRowStagingEvidence[] = prepared.sourceRows.map(row => ({
    id: row.id,
    sheetId: selectedSheet.id,
    sourceRowNumber: row.sourceRowNumber,
    rawValues: rawCells(row.rawValues, prepared.fieldMappings),
    normalizedValues: normalizedValues(row.normalizedValues),
    rowFingerprint: row.rowFingerprint,
    processingStatus: row.processingStatus,
    proposedAction: "unresolved",
    validationSummary: {
      blockingIssues: row.validationSummary.blockingIssues,
      warningIssues: row.validationSummary.warningIssues,
    },
  }));
  const issues: ImportIssueStagingEvidence[] = prepared.sourceRows.flatMap(row => [
    ...row.validationSummary.blockingIssues.map(issueType => ({ sourceRowId: row.id, issueType, severity: "error" as const, message: issueMessage(issueType) })),
    ...row.validationSummary.warningIssues.map(issueType => ({ sourceRowId: row.id, issueType, severity: "warning" as const, message: issueMessage(issueType) })),
  ]);
  const sourceLabels: ImportSourceLabelStagingEvidence[] = [
    ...prepared.sourceLabels.departments.map(label => ({ resolutionType: "department" as const, sourceLabel: label.sourceValue, normalizedSourceLabel: label.normalizedSourceValue, sourceSheet: label.sourceSheet, affectedRowCount: label.sourceRowCount })),
    ...prepared.sourceLabels.positions.map(label => ({ resolutionType: "position" as const, sourceLabel: label.sourceValue, normalizedSourceLabel: label.normalizedSourceValue, sourceSheet: label.sourceSheet, affectedRowCount: label.sourceRowCount })),
  ];
  const batch: ImportBatchStagingEvidence = {
    detectedSheetCount: sheets.length,
    totalSourceRows: prepared.sourceRows.length,
    validRows: prepared.sourceRows.filter(row => row.processingStatus !== "error").length,
    warningRows: prepared.sourceRows.filter(row => row.processingStatus === "warning").length,
    errorRows: prepared.sourceRows.filter(row => row.processingStatus === "error").length,
    selectedSheetName: selected.name,
  };
  return { batch, sheets, fieldMappings, sourceRows, issues, sourceLabels };
}

function rawCells(values: Record<string, unknown>, mappings: readonly { sourceColumnName: string; sourceColumnIndex: number; targetField: string }[]): ImportRawCellStagingEvidence[] {
  return mappings.map(mapping => ({
    sourceColumnIndex: mapping.sourceColumnIndex,
    sourceColumnName: mapping.sourceColumnName,
    targetField: targetField(mapping.targetField),
    value: evidenceValue(values[mapping.sourceColumnName]),
  }));
}

function normalizedValues(values: Record<string, unknown>): ImportNormalizedEmployeeValues {
  const result: Record<string, ImportEvidenceValue> = {};
  for (const field of ["employee_number", "name_zh", "name_en", "department_source_label", "position_source_label", "grade_or_band", "hire_date", "probation_or_confirmation_date", "employment_status"] as const) {
    if (field in values) result[field] = evidenceValue(values[field]);
  }
  return result as ImportNormalizedEmployeeValues;
}

function evidenceValue(value: unknown): ImportEvidenceValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function targetField(value: string): ImportEmployeeMasterTargetField {
  if (["employee_number", "name_zh", "name_en", "department_source_label", "position_source_label", "grade_or_band", "hire_date", "probation_or_confirmation_date", "employment_status"].includes(value)) return value as ImportEmployeeMasterTargetField;
  throw new Error("IMPORT_TARGET_FIELD_INVALID");
}

function browserSafeSummary(summary: ReturnType<typeof prepareEmployeeMasterStaging>["safeSummary"]): BrowserSafeImportSummary {
  return {
    sanitizedFilename: summary.sanitizedFilename,
    checksumPrefix: summary.checksumPrefix,
    sizeBytes: summary.sizeBytes,
    detectedSheets: summary.detectedSheets,
    selectedSheet: summary.selectedSheet,
    headerRow: summary.headerRow,
    sourceRows: summary.sourceRows,
    structurallyValid: summary.structurallyValid,
    blockedRows: summary.blockedRows,
    warningRows: summary.warningRows,
    uniqueDepartmentLabels: summary.uniqueDepartmentLabels,
    uniquePositionLabels: summary.uniquePositionLabels,
    exclusions: summary.exclusions,
    excludedColumns: summary.excludedColumns,
    excludedSheets: summary.excludedSheets,
    warnings: summary.warnings,
    employeesImported: 0,
    trainingHistoryImported: false,
    ctcGtcImported: false,
  };
}

function issueMessage(issueType: string) {
  return ({
    missing_employee_number: "缺少员工编号",
    missing_name: "缺少员工姓名",
    unresolved_department: "缺少部门来源值",
    unresolved_position: "缺少职位来源值",
    invalid_date: "日期值需要人工确认",
    duplicate_employee_number_in_file: "工作簿内员工编号重复",
    unsupported_status: "员工状态需要人工确认",
  } as Record<string, string>)[issueType] ?? "来源记录需要人工确认";
}
