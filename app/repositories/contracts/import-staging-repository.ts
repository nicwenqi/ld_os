/**
 * E5B is intentionally separate from the legacy ImportRepository.  These
 * types model immutable parser evidence and the server-side storage saga; they
 * do not create an Import commit, revert, or browser storage contract.
 */

export type ImportStorageLifecycle =
  | "intent_created"
  | "uploaded_unverified"
  | "verification_failed"
  | "verified"
  | "linked"
  | "cleanup_pending"
  | "cleanup_in_progress"
  | "cleanup_failed"
  | "cleanup_completed";

export type ImportWorkbookLifecycle =
  | "intent_created"
  | "inspecting"
  | "mapping_required"
  | "failed";

export type ImportVerificationStatus = "pending" | "passed" | "failed";

/** A parsed cell value, never a database row or authorization payload. */
export type ImportEvidenceValue = string | number | boolean | null;
export type ImportEvidenceValues = Readonly<Record<string, ImportEvidenceValue>>;

export type ImportBatchStagingEvidence = {
  detectedSheetCount: number;
  totalSourceRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  selectedSheetName: string;
};

export type ImportSheetStagingEvidence = {
  id: string;
  name: string;
  index: number;
  headerRow: number | null;
  rowCount: number;
  columnCount: number;
  hidden: boolean;
  selected: boolean;
  purpose: "employee_master" | "excluded";
};

export type ImportFieldMappingStagingEvidence = {
  sheetId: string;
  sourceColumnName: string;
  sourceColumnIndex: number;
  targetField: string;
  transformationRule: Readonly<{
    trim: boolean;
    preserveText: boolean;
  }>;
  isRequired: boolean;
};

export type ImportSourceRowStagingEvidence = {
  id: string;
  sheetId: string;
  sourceRowNumber: number;
  rawValues: ImportEvidenceValues;
  normalizedValues: ImportEvidenceValues;
  rowFingerprint: string;
  processingStatus: "staged" | "warning" | "error";
  proposedAction: "unresolved";
  validationSummary: Readonly<{
    blockingIssues: readonly string[];
    warningIssues: readonly string[];
  }>;
};

export type ImportIssueStagingEvidence = {
  sourceRowId: string;
  issueType: string;
  severity: "warning" | "error";
  message: string;
};

export type ImportSourceLabelStagingEvidence = {
  resolutionType: "department" | "position";
  sourceLabel: string;
  normalizedSourceLabel: string;
  sourceSheet: string;
  affectedRowCount: number;
};

export type CreateImportUploadIntentInput = {
  batchId: string;
  originalFilename: string;
  sanitizedFilename: string;
  declaredChecksumSha256: string;
  declaredSizeBytes: number;
  declaredMimeType: string;
  sourceSystem: string;
};

export type RecordImportObjectVerificationInput = {
  batchId: string;
  expectedVersion: number;
  verifiedChecksumSha256: string;
  verifiedSizeBytes: number;
  verifiedMimeType: string;
  status: "passed" | "failed";
  failureReason: string | null;
};

/** Server-only: the path is intentionally absent from browser projections. */
export type ImportUploadIntent = {
  batchId: string;
  objectPath: string;
  storageLifecycle: "intent_created";
  workbookLifecycle: "intent_created";
  verificationStatus: "pending";
  version: number;
};

export type ImportSagaState = {
  batchId: string;
  storageLifecycle: ImportStorageLifecycle;
  workbookLifecycle: ImportWorkbookLifecycle;
  verificationStatus: ImportVerificationStatus;
  version: number;
};

export type StageVerifiedWorkbookInput = {
  batchId: string;
  expectedVersion: number;
  evidence: Readonly<{
    batch: ImportBatchStagingEvidence;
    sheets: readonly ImportSheetStagingEvidence[];
    fieldMappings: readonly ImportFieldMappingStagingEvidence[];
    sourceRows: readonly ImportSourceRowStagingEvidence[];
    issues: readonly ImportIssueStagingEvidence[];
    sourceLabels: readonly ImportSourceLabelStagingEvidence[];
  }>;
};

export type ImportStagingResult = ImportSagaState & {
  storageLifecycle: "linked";
  workbookLifecycle: "mapping_required";
};

export type MarkCleanupPendingInput = {
  batchId: string;
  expectedVersion: number;
  reason: string;
};

export type ClaimDueCleanupInput = { limit: number; claimId: string };

/** Server-only: exact paths are supplied only to the cleanup executor. */
export type ImportCleanupClaim = {
  batchId: string;
  bucket: "property-import-files";
  objectPath: string;
  claimId: string;
  attemptCount: number;
  leaseExpiresAt: string;
};

export type CompleteCleanupInput = { batchId: string; claimId: string };

export type FailCleanupInput = {
  batchId: string;
  claimId: string;
  error: string;
  nextAttemptAt: string;
};

/** Browser-safe lifecycle/history view: no raw evidence, path, or checksum. */
export type ImportWorkflowProjection = {
  batchId: string;
  fileName: string;
  storageLifecycle: ImportStorageLifecycle;
  workbookLifecycle: ImportWorkbookLifecycle;
  verificationStatus: ImportVerificationStatus;
  counts: Readonly<{
    total: number;
    valid: number;
    warning: number;
    error: number;
  }>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ImportHistoryItem = ImportWorkflowProjection;

/**
 * Construct implementations with trusted hostname/property scope in the
 * server authorization layer. Storage I/O stays outside this database-only
 * repository.
 */
export interface ImportStagingRepository {
  createUploadIntent(input: CreateImportUploadIntentInput): Promise<ImportUploadIntent>;
  recordObjectUploaded(batchId: string, expectedVersion: number): Promise<ImportSagaState>;
  recordObjectVerification(input: RecordImportObjectVerificationInput): Promise<ImportSagaState>;
  stageVerifiedWorkbook(input: StageVerifiedWorkbookInput): Promise<ImportStagingResult>;
  markCleanupPending(input: MarkCleanupPendingInput): Promise<ImportSagaState>;
  claimDueCleanup(input: ClaimDueCleanupInput): Promise<ImportCleanupClaim | null>;
  completeCleanup(input: CompleteCleanupInput): Promise<ImportSagaState>;
  failCleanup(input: FailCleanupInput): Promise<ImportSagaState>;
  getWorkflow(batchId: string): Promise<ImportWorkflowProjection | null>;
  listHistory(): Promise<readonly ImportHistoryItem[]>;
}
