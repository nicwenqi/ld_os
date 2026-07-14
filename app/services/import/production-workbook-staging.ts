import * as XLSX from "xlsx";
import { inspectEmployeeMasterAggregate, inspectWorkbook, stableRowFingerprint, type WorkbookFile } from "./workbook-parser.ts";
import { isMissingSourceValue } from "./employee-staging-preview.ts";

const requiredTargets = new Set(["employee_number", "name_zh", "department_source_label", "position_source_label"]);

export type PreparedSourceRow = {
  id: string;
  sourceRowNumber: number;
  rawValues: Record<string, unknown>;
  normalizedValues: Record<string, unknown>;
  rowFingerprint: string;
  processingStatus: "staged" | "warning" | "error";
  proposedAction: "unresolved";
  validationSummary: { blockingIssues: readonly string[]; warningIssues: readonly string[] };
};

export type PreparedFieldMapping = {
  sourceColumnName: string;
  sourceColumnIndex: number;
  targetField: string;
  transformationRule: Record<string, unknown>;
  isRequired: boolean;
};

export function prepareEmployeeMasterStaging(input: WorkbookFile) {
  const inspection = inspectWorkbook(input);
  const aggregate = inspectEmployeeMasterAggregate(input);
  const workbook = XLSX.read(input.bytes, { type: "array", cellDates: true, cellFormula: true, cellStyles: true, sheetStubs: true, raw: true });
  const selectedInspection = inspection.sheets.find(sheet => sheet.name === aggregate.selectedSheet);
  const sheet = workbook.Sheets[aggregate.selectedSheet];
  const range = sheet?.["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]!) : null;
  if (!selectedInspection || !sheet || !range) throw new Error("员工主数据工作表为空");

  const headerIndex = aggregate.headerRow - 1;
  const headers = Array.from({ length: range.e.c - range.s.c + 1 }, (_, offset) =>
    String((sheet[XLSX.utils.encode_cell({ r: headerIndex, c: range.s.c + offset })] as XLSX.CellObject | undefined)?.v ?? `Column ${offset + 1}`).trim() || `Column ${offset + 1}`,
  );
  const recognized = new Map(selectedInspection.suggestedMappings.filter(mapping => mapping.targetField && !mapping.excluded).map(mapping => [mapping.sourceColumn, mapping.targetField!]));
  const fieldMappings: PreparedFieldMapping[] = headers.flatMap((sourceColumnName, sourceColumnIndex) => {
    const targetField = recognized.get(sourceColumnName);
    return targetField ? [{ sourceColumnName, sourceColumnIndex, targetField, transformationRule: { trim: true, preserveText: targetField === "employee_number" }, isRequired: requiredTargets.has(targetField) }] : [];
  });

  const sourceRows: PreparedSourceRow[] = [];
  for (let rowIndex = headerIndex + 1; rowIndex <= range.e.r; rowIndex += 1) {
    const rawValues: Record<string, unknown> = {};
    const normalizedValues: Record<string, unknown> = {};
    headers.forEach((header, offset) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: range.s.c + offset })] as XLSX.CellObject | undefined;
      rawValues[header] = jsonValue(cell?.v);
      const target = recognized.get(header);
      if (target) normalizedValues[target] = normalizeTargetValue(target, cell);
    });
    if (Object.values(normalizedValues).every(isMissingSourceValue)) continue;
    const blockingIssues: string[] = [];
    const warningIssues: string[] = [];
    if (isMissingSourceValue(normalizedValues.employee_number)) blockingIssues.push("missing_employee_number");
    if (isMissingSourceValue(normalizedValues.name_zh) && isMissingSourceValue(normalizedValues.name_en)) blockingIssues.push("missing_name");
    if (isMissingSourceValue(normalizedValues.department_source_label)) blockingIssues.push("unresolved_department");
    if (isMissingSourceValue(normalizedValues.position_source_label)) blockingIssues.push("unresolved_position");
    for (const target of ["hire_date", "probation_or_confirmation_date"] as const) {
      const value = normalizedValues[target];
      if (value && typeof value === "object" && "invalid" in value) { warningIssues.push("invalid_date"); normalizedValues[target] = null; }
    }
    sourceRows.push({ id: crypto.randomUUID(), sourceRowNumber: rowIndex + 1, rawValues, normalizedValues, rowFingerprint: stableRowFingerprint(rawValues), processingStatus: blockingIssues.length ? "error" : warningIssues.length ? "warning" : "staged", proposedAction: "unresolved", validationSummary: { blockingIssues, warningIssues } });
  }

  const byEmployeeNumber = new Map<string, PreparedSourceRow[]>();
  for (const row of sourceRows) {
    const employeeNumber = String(row.normalizedValues.employee_number ?? "").trim();
    if (employeeNumber) byEmployeeNumber.set(employeeNumber, [...(byEmployeeNumber.get(employeeNumber) ?? []), row]);
  }
  for (const rows of byEmployeeNumber.values()) if (rows.length > 1) for (const row of rows) {
    row.validationSummary = { ...row.validationSummary, blockingIssues: [...row.validationSummary.blockingIssues, "duplicate_employee_number_in_file"] };
    row.processingStatus = "error";
  }

  return {
    inspection,
    selectedSheet: selectedInspection,
    sourceRows,
    fieldMappings,
    safeSummary: {
      sanitizedFilename: inspection.sanitizedFilename,
      checksum: inspection.checksum,
      sizeBytes: inspection.sizeBytes,
      detectedSheets: inspection.sheets.map(item => ({ name: item.name, rowCount: item.rowCount, columnCount: item.columnCount, hidden: item.hidden })),
      selectedSheet: aggregate.selectedSheet,
      headerRow: aggregate.headerRow,
      sourceRows: sourceRows.length,
      structurallyValid: sourceRows.filter(row => row.processingStatus !== "error").length,
      blockedRows: sourceRows.filter(row => row.processingStatus === "error").length,
      warningRows: sourceRows.filter(row => row.processingStatus === "warning").length,
      uniqueDepartmentLabels: aggregate.mapping.uniqueDepartmentLabels,
      uniquePositionLabels: aggregate.mapping.uniquePositionLabels,
      exclusions: aggregate.exclusions,
      warnings: aggregate.warnings,
      employeesImported: 0,
      trainingHistoryImported: false,
      ctcGtcImported: false,
    },
  };
}

function normalizeTargetValue(target: string, cell: XLSX.CellObject | undefined): unknown {
  if (!cell || isMissingSourceValue(cell.v)) return null;
  if (target === "employee_number") return String(cell.v).trim();
  if (target === "hire_date" || target === "probation_or_confirmation_date") {
    if (cell.v instanceof Date) return Number.isNaN(cell.v.getTime()) ? { invalid: true } : cell.v.toISOString().slice(0, 10);
    const text = String(cell.v).trim();
    const tokens = text.match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/g) ?? [];
    const date = new Date(text);
    return tokens.length > 1 || Number.isNaN(date.getTime()) ? { invalid: true } : date.toISOString().slice(0, 10);
  }
  return typeof cell.v === "string" ? cell.v.trim() : cell.v;
}

function jsonValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value === undefined ? null : value;
}
