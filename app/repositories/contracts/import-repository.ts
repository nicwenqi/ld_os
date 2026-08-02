import type { WorkbookInspection } from "../../services/import/workbook-parser.ts";
import type { EmployeeBaselineClassification } from "../../services/pilot-employee-baseline.ts";

export type ImportConflict =
  | "batch_stale"
  | "employee_stale"
  | "mapping_stale"
  | "identifier_conflict"
  | "revert_conflict";

export class ImportRepositoryError extends Error {
  readonly conflict: ImportConflict | null;

  constructor(
    message: string,
    conflict: ImportConflict | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ImportRepositoryError";
    this.conflict = conflict;
  }
}

export function mapImportRepositoryError(reason: unknown): ImportRepositoryError {
  if (reason instanceof ImportRepositoryError) return reason;
  const value = reason as { code?: string; message?: string } | null;
  const code = value?.code ?? "";
  const message = value?.message ?? (reason instanceof Error ? reason.message : "员工资料更新失败");
  let conflict: ImportConflict | null = null;
  if (code === "P3001") conflict = "batch_stale";
  else if (code === "P3005") conflict = "employee_stale";
  else if (code === "P3202") conflict = "mapping_stale";
  else if (code === "P3006" || /identifier/i.test(message)) conflict = "identifier_conflict";
  else if (code === "P3011" || code === "P3012") conflict = "revert_conflict";
  return new ImportRepositoryError(message, conflict, reason instanceof Error ? { cause: reason } : undefined);
}

export type EmployeeUpdatePreview = {
  additions: number;
  updates: number;
  unchanged: number;
  exclusions: number;
  blocked: number;
  unresolved: number;
  version: number;
  status: "mapping_required" | "ready_for_review";
  effectiveDate: string;
  previewHash: string;
  rows: readonly EmployeeUpdatePreviewRow[];
};

export type EmployeeUpdatePreviewValue = string | number | boolean | null;

export type EmployeeUpdatePreviewChange = {
  field: string;
  before: EmployeeUpdatePreviewValue;
  after: EmployeeUpdatePreviewValue;
  reason: string;
};

export type EmployeeUpdatePreviewRow = {
  rowId: string;
  rowNumber: number;
  action: "insert" | "update" | "unchanged" | "excluded" | "unresolved";
  employeeNumber: string | null;
  employeeName: string | null;
  effectiveDate: string;
  changes: readonly EmployeeUpdatePreviewChange[];
};

export type EmployeeUpdateApproval = {
  acknowledged: boolean;
  previewHash: string;
  baseline: EmployeeBaselineClassification;
};

export type ImportBatchBaselineEvidence = EmployeeBaselineClassification & {
  approvedAt: string;
};

export type ImportBatch = {
  id: string;
  tenantId: string;
  propertyId: string;
  fileName: string;
  status: string;
  version: number;
  createdAt: string;
  baseline: ImportBatchBaselineEvidence | null;
  summary: {
    inserted: number;
    updated: number;
    unchanged: number;
    excluded: number;
    blocked: number;
    unresolved: number;
  };
};

export type ImportIssue = {
  id: string;
  rowNumber: number;
  sheetName: string;
  type: string;
  severity: "warning" | "error";
  field: string | null;
  value: string | null;
  message: string;
  resolutionStatus: string;
};

export type ImportMutationResult = {
  version: number;
  status: string;
};

export type ImportFieldMapping = {
  id: string;
  sourceColumnName: string;
  targetField: string;
  mappingStatus: "suggested" | "confirmed" | "excluded";
  transformationRule: Record<string, unknown>;
  isRequired: boolean;
};

export type ImportFieldMappingDecision = {
  mappingId: string;
  mappingStatus: "confirmed" | "excluded";
  targetField?: string;
  transformationRule?: Record<string, unknown>;
};

export type ImportIssueResolution = {
  status: "accepted" | "corrected" | "excluded" | "ignored" | "deferred";
  payload?: {
    corrections?: Record<string, unknown>;
    normalizedValues?: Record<string, unknown>;
  };
};

export type ImportSourceLabelDecision = "mapped" | "excluded" | "deferred";

export type EmployeeImportPreviewOptions = {
  statusTreatment:
    | "use_recognized_status"
    | "retain_existing_set_additions_active";
  effectiveDate: string;
};

export type ImportSourceLabelResolution = {
  sourceValue: string;
  sourceRowCount: number;
  decision: ImportSourceLabelDecision | "pending";
  decisionMode?: "pending" | "create" | "map" | "exclude" | "defer";
  targetId?: string | null;
  targetName?: string | null;
};

export type PositionAttributionBatchDecision = {
  sourceValue: string;
  action: "create" | "map" | "exclude" | "defer";
  targetPositionId?: string | null;
  /** Required only when an active same-name position exists and the manager explicitly chooses a distinct new one. */
  createDistinct?: boolean;
};

export type PositionAttributionBatchPreview = {
  previewHash: string;
  expectedVersion: number;
  expiresAt: string;
  summary: {
    sourceLabels: number;
    affectedRows: number;
    create: number;
    map: number;
    exclude: number;
    defer: number;
  };
  decisions: readonly {
    sourceValue: string;
    affectedRows: number;
    action: PositionAttributionBatchDecision["action"];
    status: "ready" | "same_name_requires_choice" | "blocked";
    targetPositionId: string | null;
    targetPositionName: string | null;
    matchingPositions?: readonly { id: string; name: string }[];
    reason?: string | null;
  }[];
};

export type ImportRevertPreview = {
  safe: boolean;
  conflicts: number;
  strategy: string;
  token: string | null;
  expiresAt: string | null;
};

export interface ImportRepository {
  createBatch(input: {
    tenantId: string;
    propertyId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    checksum: string;
    sourceSystem: string;
  }): Promise<ImportBatch>;
  uploadFileReference(batchId: string, file: File): Promise<{ objectPath: string }>;
  inspectWorkbook(batchId: string): Promise<WorkbookInspection>;
  getBatch(batchId: string): Promise<ImportBatch | null>;
  listSheets(batchId: string): Promise<readonly unknown[]>;
  listFieldMappings(batchId: string): Promise<readonly ImportFieldMapping[]>;
  selectSheet(sheetId: string, selected: boolean, headerRow: number): Promise<void>;
  saveFieldMappings(batchId: string, mappings: readonly unknown[]): Promise<void>;
  confirmFieldMappings(batchId: string, expectedVersion: number, mappings: readonly ImportFieldMappingDecision[]): Promise<ImportMutationResult>;
  stageRows(batchId: string, rows: readonly unknown[]): Promise<void>;
  listDepartmentLabels(batchId: string): Promise<readonly unknown[]>;
  listPositionLabels(batchId: string): Promise<readonly unknown[]>;
  listSourceLabelResolutions(batchId: string, type: "department" | "position"): Promise<readonly ImportSourceLabelResolution[]>;
  resolveSourceLabel(
    batchId: string,
    expectedVersion: number,
    type: "department" | "position",
    sourceValue: string,
    targetId: string | null,
    decision: ImportSourceLabelDecision,
  ): Promise<ImportMutationResult>;
  previewPositionAttributionBatch(
    batchId: string,
    expectedVersion: number,
    decisions: readonly PositionAttributionBatchDecision[],
  ): Promise<PositionAttributionBatchPreview>;
  confirmPositionAttributionBatch(
    batchId: string,
    expectedVersion: number,
    previewHash: string,
  ): Promise<ImportMutationResult>;
  validateBatch(batchId: string): Promise<ImportBatch>;
  listIssues(batchId: string): Promise<readonly ImportIssue[]>;
  resolveIssue(
    batchId: string,
    expectedVersion: number,
    issueId: string,
    resolution: ImportIssueResolution,
  ): Promise<ImportMutationResult>;
  preparePreview(batchId: string, expectedVersion: number, options: EmployeeImportPreviewOptions): Promise<EmployeeUpdatePreview>;
  readPreparedPreview(batchId: string): Promise<EmployeeUpdatePreview | null>;
  previewCommit(batchId: string): Promise<ImportBatch["summary"]>;
  commitBatch(batchId: string, expectedVersion: number, approval: EmployeeUpdateApproval): Promise<string>;
  previewRevert(batchId: string): Promise<ImportRevertPreview>;
  revertBatch(batchId: string, token: string): Promise<void>;
  listImportHistory(propertyId: string): Promise<readonly ImportBatch[]>;
  getBatchAudit(batchId: string): Promise<readonly unknown[]>;
}
