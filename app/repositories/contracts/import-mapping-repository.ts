/** E5C decision state over immutable E5B staging evidence. */

export type ImportMappingStatus = "confirmed" | "excluded" | "pending";
export type ImportSourceLabelAction =
  | "department"
  | "operational_unit"
  | "position"
  | "family"
  | "external"
  | "ignore"
  | "defer"
  | "pending";
export type ImportIssueDecisionStatus =
  | "accepted"
  | "corrected"
  | "excluded"
  | "ignored"
  | "deferred"
  | "open";

export type ImportMappingWorkflow = {
  batchId: string;
  batchVersion: number;
  decisionVersion: number;
  evidenceHash: string;
  previewHash: string;
  state: "blocked" | "ready";
  mappings: {
    items: readonly ImportMappingWorkflowItem[];
    pendingCount: number;
    confirmedCount: number;
    excludedCount: number;
  };
  sourceLabels: {
    items: readonly ImportSourceLabelWorkflowItem[];
    pendingCount: number;
    resolvedCount: number;
  };
  issues: {
    items: readonly ImportIssueWorkflowItem[];
    openCount: number;
    blockingCount: number;
  };
  impact: { state: "unavailable"; reason: "employee_commit_not_migrated" };
};

export type ImportMappingWorkflowItem = {
  mappingId: string;
  sourceColumnName: string;
  sourceColumnIndex: number;
  targetField: string | null;
  mappingStatus: ImportMappingStatus;
  transformationRule: Readonly<Record<string, unknown>>;
  isRequired: boolean;
};

export type ImportSourceLabelWorkflowItem = {
  sourceLabelId: string;
  resolutionType: "department" | "position";
  sourceLabel: string;
  normalizedSourceLabel: string;
  affectedRowCount: number;
  action: ImportSourceLabelAction;
  targetDepartmentId: string | null;
  targetOperationalUnitId: string | null;
  targetPositionId: string | null;
  targetPositionFamilyId: string | null;
  externalRoleCode: string | null;
  externalRoleName: string | null;
};

export type ImportIssueWorkflowItem = {
  issueId: string;
  issueType: string;
  severity: "warning" | "error";
  sourceField: string | null;
  sourceValueProjection: string | null;
  message: string;
  status: ImportIssueDecisionStatus;
  correction: Readonly<Record<string, unknown>>;
  resolutionNote: string | null;
};

export type SaveFieldMappingDecisionsInput = {
  batchId: string;
  expectedDecisionVersion: number;
  decisions: readonly {
    mappingId: string;
    mappingStatus: "confirmed" | "excluded";
    targetField: string | null;
    transformationRule: Readonly<Record<string, unknown>>;
  }[];
};

export type SaveSourceLabelDecisionsInput = {
  batchId: string;
  expectedDecisionVersion: number;
  decisions: readonly {
    sourceLabelId: string;
    action: Exclude<ImportSourceLabelAction, "pending">;
    targetDepartmentId?: string | null;
    targetOperationalUnitId?: string | null;
    targetPositionId?: string | null;
    targetPositionFamilyId?: string | null;
    externalRoleCode?: string | null;
    externalRoleName?: string | null;
  }[];
};

export type SaveIssueResolutionsInput = {
  batchId: string;
  expectedDecisionVersion: number;
  decisions: readonly {
    issueId: string;
    status: Exclude<ImportIssueDecisionStatus, "open">;
    correction: Readonly<Record<string, unknown>>;
    resolutionNote: string | null;
  }[];
};

export interface ImportMappingRepository {
  getWorkflow(batchId: string): Promise<ImportMappingWorkflow | null>;
  saveFieldMappingDecisions(input: SaveFieldMappingDecisionsInput): Promise<ImportMappingWorkflow>;
  saveSourceLabelDecisions(input: SaveSourceLabelDecisionsInput): Promise<ImportMappingWorkflow>;
  saveIssueResolutions(input: SaveIssueResolutionsInput): Promise<ImportMappingWorkflow>;
  preview(batchId: string, expectedDecisionVersion: number): Promise<ImportMappingWorkflow>;
}
