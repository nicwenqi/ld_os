import type {
  EmployeeUpdatePreview,
  ImportBatch,
  ImportFieldMapping,
  ImportFieldMappingDecision,
  ImportIssue,
  ImportIssueResolution,
  ImportRepository,
  ImportSourceLabelResolution,
} from "../repositories/contracts/import-repository.ts";

type ImportWorkflowRepository = Pick<
  ImportRepository,
  | "getBatch"
  | "listFieldMappings"
  | "listIssues"
  | "listSourceLabelResolutions"
  | "confirmFieldMappings"
  | "resolveSourceLabel"
  | "resolveIssue"
  | "preparePreview"
  | "commitBatch"
  | "getBatchAudit"
  | "previewRevert"
  | "revertBatch"
>;

export type EmployeeUpdateWorkflow = {
  batch: ImportBatch;
  fieldMappings: readonly ImportFieldMapping[];
  departmentLabels: readonly ImportSourceLabelResolution[];
  positionLabels: readonly ImportSourceLabelResolution[];
  issues: readonly ImportIssue[];
  progress: ReturnType<typeof deriveEmployeeUpdateProgress>;
};

export type EmployeeUpdateDecisionDraft = {
  baseVersion: number;
  fieldMappings: readonly ImportFieldMappingDecision[];
  sourceLabels: readonly {
    type: "department" | "position";
    sourceValue: string;
    targetId: string | null;
    decision: string;
  }[];
  issueResolutions: readonly {
    issueId: string;
    resolution: ImportIssueResolution;
  }[];
  dirty: boolean;
};

export function createEmployeeUpdateDecisionDraft(workflow: EmployeeUpdateWorkflow): EmployeeUpdateDecisionDraft {
  return {
    baseVersion: workflow.batch.version,
    fieldMappings: [],
    sourceLabels: [],
    issueResolutions: [],
    dirty: false,
  };
}

export function updateEmployeeUpdateDecisionDraft(
  draft: EmployeeUpdateDecisionDraft,
  changes: Partial<Omit<EmployeeUpdateDecisionDraft, "baseVersion" | "dirty">>,
): EmployeeUpdateDecisionDraft {
  return { ...draft, ...changes, dirty: true };
}

export type EmployeeUpdateProgressInput = {
  status: string;
  fieldMappingsConfirmed: boolean;
  departmentUnresolved: number;
  positionUnresolved: number;
  blockingIssues: number;
  previewReady: boolean;
};

export function deriveEmployeeUpdateProgress(input: EmployeeUpdateProgressInput) {
  const attributionPending = input.departmentUnresolved > 0 || input.positionUnresolved > 0;
  const currentStep =
    !input.fieldMappingsConfirmed
      ? "field_recognition"
      : attributionPending
        ? "attribution"
        : input.blockingIssues > 0
          ? "issue_resolution"
          : input.previewReady || input.status === "ready_for_review"
            ? "confirmation"
            : "preview";
  return {
    currentStep,
    canPreview: input.fieldMappingsConfirmed && !attributionPending && input.blockingIssues === 0,
    canConfirm: input.status === "ready_for_review" && input.previewReady && input.blockingIssues === 0,
  };
}

export function createImportService(repository: ImportWorkflowRepository) {
  const readBatch = async (batchId: string) => {
    const batch = await repository.getBatch(batchId);
    if (!batch) throw new Error("员工资料更新批次不存在或无权访问");
    return batch;
  };
  const readWorkflow = async (batchId: string): Promise<EmployeeUpdateWorkflow> => {
    const [batch, fieldMappings, issues, departmentLabels, positionLabels] = await Promise.all([
      readBatch(batchId),
      repository.listFieldMappings(batchId),
      repository.listIssues(batchId),
      repository.listSourceLabelResolutions(batchId, "department"),
      repository.listSourceLabelResolutions(batchId, "position"),
    ]);
    const progress = deriveEmployeeUpdateProgress({
      status: batch.status,
      fieldMappingsConfirmed: fieldMappings.length > 0 && fieldMappings.every(item => item.mappingStatus !== "suggested"),
      departmentUnresolved: departmentLabels.filter(item => item.decision === "pending" || item.decision === "deferred").length,
      positionUnresolved: positionLabels.filter(item => item.decision === "pending" || item.decision === "deferred").length,
      blockingIssues: issues.filter(item => item.severity === "error" && (item.resolutionStatus === "unresolved" || item.resolutionStatus === "deferred")).length,
      previewReady: batch.status === "ready_for_review",
    });
    return { batch, fieldMappings, issues, departmentLabels, positionLabels, progress };
  };
  return {
    resume(batchId: string): Promise<EmployeeUpdateWorkflow> {
      return readWorkflow(batchId);
    },
    async confirmFieldMappings(batchId: string, expectedVersion: number, mappings: readonly ImportFieldMappingDecision[]) {
      await repository.confirmFieldMappings(batchId, expectedVersion, mappings);
      return readWorkflow(batchId);
    },
    async resolveSourceLabel(
      batchId: string,
      expectedVersion: number,
      type: "department" | "position",
      sourceValue: string,
      targetId: string | null,
      decision: string,
    ) {
      await repository.resolveSourceLabel(batchId, expectedVersion, type, sourceValue, targetId, decision);
      return readWorkflow(batchId);
    },
    async resolveIssue(
      batchId: string,
      expectedVersion: number,
      issueId: string,
      resolution: ImportIssueResolution,
    ) {
      await repository.resolveIssue(batchId, expectedVersion, issueId, resolution);
      return readWorkflow(batchId);
    },
    async preparePreview(
      batchId: string,
      expectedVersion: number,
      options: Record<string, unknown>,
    ): Promise<{ preview: EmployeeUpdatePreview; workflow: EmployeeUpdateWorkflow }> {
      if (!options.statusTreatment) throw new Error("请选择本批次员工状态处理方式");
      const preview = await repository.preparePreview(batchId, expectedVersion, options);
      const workflow = await readWorkflow(batchId);
      return { preview, workflow };
    },
    async confirmUpdate(batchId: string, expectedVersion: number, acknowledged: boolean) {
      if (!acknowledged) throw new Error("请先确认更新范围、排除行与状态处理方式");
      const commitId = await repository.commitBatch(batchId, expectedVersion);
      const [batch, audit] = await Promise.all([
        readBatch(batchId),
        repository.getBatchAudit(batchId),
      ]);
      return { commitId, batch, audit };
    },
    previewRevert(batchId: string) {
      return repository.previewRevert(batchId);
    },
    async revert(batchId: string, token: string) {
      if (!token) throw new Error("撤销预览已失效，请重新预览");
      await repository.revertBatch(batchId, token);
      return readBatch(batchId);
    },
  };
}
