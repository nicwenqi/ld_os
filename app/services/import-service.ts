import type {
  EmployeeUpdatePreview,
  ImportBatch,
  ImportIssue,
  ImportRepository,
  ImportSourceLabelResolution,
} from "../repositories/contracts/import-repository.ts";

type ImportWorkflowRepository = Pick<
  ImportRepository,
  | "getBatch"
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
  departmentLabels: readonly ImportSourceLabelResolution[];
  positionLabels: readonly ImportSourceLabelResolution[];
  issues: readonly ImportIssue[];
};

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
  return {
    async resume(batchId: string): Promise<EmployeeUpdateWorkflow> {
      const [batch, issues, departmentLabels, positionLabels] = await Promise.all([
        readBatch(batchId),
        repository.listIssues(batchId),
        repository.listSourceLabelResolutions(batchId, "department"),
        repository.listSourceLabelResolutions(batchId, "position"),
      ]);
      return { batch, issues, departmentLabels, positionLabels };
    },
    async confirmFieldMappings(batchId: string, expectedVersion: number, mappings: readonly unknown[]) {
      await repository.confirmFieldMappings(batchId, expectedVersion, mappings);
      return readBatch(batchId);
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
      return readBatch(batchId);
    },
    async resolveIssue(
      batchId: string,
      expectedVersion: number,
      issueId: string,
      resolution: { status: string; payload?: Record<string, unknown> },
    ) {
      await repository.resolveIssue(batchId, expectedVersion, issueId, resolution);
      return readBatch(batchId);
    },
    async preparePreview(
      batchId: string,
      expectedVersion: number,
      options: Record<string, unknown>,
    ): Promise<{ preview: EmployeeUpdatePreview; batch: ImportBatch }> {
      if (!options.statusTreatment) throw new Error("请选择本批次员工状态处理方式");
      const preview = await repository.preparePreview(batchId, expectedVersion, options);
      const batch = await readBatch(batchId);
      return { preview, batch };
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
