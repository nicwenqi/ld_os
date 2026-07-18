import {
  ImportRepositoryError,
  type EmployeeUpdatePreview,
  type ImportBatch,
  type ImportFieldMapping,
  type ImportIssue,
  type ImportRepository,
  type ImportSourceLabelResolution,
} from "../contracts/import-repository.ts";

const initialBatch: ImportBatch = {
  id: "synthetic-batch-202607",
  tenantId: "synthetic-tenant-a",
  propertyId: "synthetic-property-a1",
  fileName: "synthetic_employee_master.xlsx",
  status: "mapping_required",
  version: 1,
  createdAt: "2026-07-13T09:00:00Z",
  summary: {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    excluded: 0,
    blocked: 2,
    unresolved: 2,
  },
};

export function createMockImportRepository(): ImportRepository {
  let batch = structuredClone(initialBatch);
  const fieldMappings: ImportFieldMapping[] = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      sourceColumnName: "Empid",
      targetField: "employee_number",
      mappingStatus: "suggested",
      transformationRule: { preserveText: true },
      isRequired: true,
    },
  ];
  const issues: ImportIssue[] = [{
    id: "issue-1",
    rowNumber: 27,
    sheetName: "Employee Master",
    type: "unresolved_department",
    severity: "error",
    field: "Department",
    value: null,
    message: "尚未匹配正式部门，当前行不能提交",
    resolutionStatus: "unresolved",
  }];
  let activeRevertToken: string | null = null;
  const labels: Record<"department" | "position", ImportSourceLabelResolution[]> = {
    department: [
      { sourceValue: "Concierge", sourceRowCount: 19, decision: "mapped", targetId: "61000000-0000-0000-0000-000000000013" },
      { sourceValue: "Guest Services", sourceRowCount: 2, decision: "pending" },
    ],
    position: [
      { sourceValue: "Guest Service Associate", sourceRowCount: 12, decision: "mapped", targetId: "p-associate" },
      { sourceValue: "Legacy Title", sourceRowCount: 1, decision: "deferred" },
    ],
  };
  const reread = () => structuredClone(batch);
  const assertVersion = (expectedVersion: number) => {
    if (expectedVersion !== batch.version) throw new ImportRepositoryError("批次版本已更新", "batch_stale");
  };
  const advance = () => {
    batch = { ...batch, version: batch.version + 1 };
    return { version: batch.version, status: batch.status };
  };
  return {
    async createBatch() {
      return reread();
    },
    async uploadFileReference() {
      return { objectPath: "synthetic/imports/private" };
    },
    async inspectWorkbook() {
      return {
        sanitizedFilename: batch.fileName,
        extension: "xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        checksum: "synthetic",
        sizeBytes: 1024,
        sheets: [{
          name: "Employee Master",
          index: 0,
          hidden: false,
          rowCount: 122,
          columnCount: 9,
          likelyHeaderRow: 3,
          mergedCellCount: 1,
          hiddenRowCount: 0,
          hiddenColumnCount: 0,
          formulaColumns: ["CTC Completion"],
          suggestedMappings: [],
        }],
      };
    },
    async getBatch(id) {
      return id === batch.id ? reread() : null;
    },
    async listSheets() {
      return [
        { name: "Employee Master", rows: 122, selected: true },
        { name: "Training History", rows: 480, selected: false, excludedReason: "本流程不导入培训历史" },
      ];
    },
    async listFieldMappings() {
      return structuredClone(fieldMappings);
    },
    async selectSheet() {},
    async saveFieldMappings() {},
    async confirmFieldMappings(_batchId, expectedVersion, decisions) {
      assertVersion(expectedVersion);
      for (const decision of decisions) {
        const mapping = fieldMappings.find(item => item.id === decision.mappingId);
        if (!mapping) throw new ImportRepositoryError("字段识别结果已变化", "mapping_stale");
        mapping.mappingStatus = decision.mappingStatus;
        if (decision.targetField) mapping.targetField = decision.targetField;
        if (decision.transformationRule) mapping.transformationRule = decision.transformationRule;
      }
      return advance();
    },
    async stageRows() {},
    async listDepartmentLabels() {
      return structuredClone(labels.department);
    },
    async listPositionLabels() {
      return structuredClone(labels.position);
    },
    async listSourceLabelResolutions(_batchId, type) {
      return structuredClone(labels[type]);
    },
    async resolveSourceLabel(_batchId, expectedVersion, type, sourceValue, targetId, decision) {
      assertVersion(expectedVersion);
      if (!["mapped", "excluded", "deferred"].includes(decision)) throw new Error("来源归属决定无效");
      const item = labels[type].find(row => row.sourceValue === sourceValue);
      if (!item) throw new Error("来源归属记录不存在");
      if (decision === "mapped" && !targetId) throw new Error("映射决定必须选择正式归属");
      Object.assign(item, { targetId, decision });
      return advance();
    },
    async validateBatch() {
      return reread();
    },
    async listIssues() {
      return structuredClone(issues);
    },
    async resolveIssue(_batchId, expectedVersion, issueId, resolution) {
      assertVersion(expectedVersion);
      const issue = issues.find(item => item.id === issueId);
      if (!issue) throw new Error("数据问题不存在");
      if (resolution.status === "corrected" && !resolution.payload?.corrections && !resolution.payload?.normalizedValues) {
        throw new Error("更正问题必须提供更正字段");
      }
      issue.resolutionStatus = resolution.status;
      return advance();
    },
    async preparePreview(_batchId, expectedVersion, options) {
      assertVersion(expectedVersion);
      if (options.statusTreatment !== "retain_existing_set_additions_active"
        && options.statusTreatment !== "use_recognized_status") {
        throw new Error("员工状态处理方式无效");
      }
      if (fieldMappings.some(item => item.mappingStatus === "suggested")) throw new Error("字段识别尚未确认");
      if (Object.values(labels).flat().some(item => item.decision === "pending" || item.decision === "deferred")) {
        throw new Error("部门或职位归属尚未完成");
      }
      if (issues.some(item => item.severity === "error" && (item.resolutionStatus === "unresolved" || item.resolutionStatus === "deferred"))) {
        throw new Error("仍有阻塞问题未处理");
      }
      const preview: EmployeeUpdatePreview = {
        additions: 18,
        updates: 7,
        unchanged: 91,
        exclusions: 3,
        blocked: 0,
        unresolved: 0,
        version: batch.version + 1,
        status: "ready_for_review",
      };
      batch = {
        ...batch,
        version: preview.version,
        status: preview.status,
        summary: {
          inserted: preview.additions,
          updated: preview.updates,
          unchanged: preview.unchanged,
          excluded: preview.exclusions,
          blocked: preview.blocked,
          unresolved: preview.unresolved,
        },
      };
      return preview;
    },
    async previewCommit() {
      return batch.summary;
    },
    async commitBatch(_batchId, expectedVersion) {
      assertVersion(expectedVersion);
      if (batch.status !== "ready_for_review") throw new Error("员工资料更新尚未准备好");
      batch = { ...batch, status: "completed", version: batch.version + 1 };
      return "synthetic-commit";
    },
    async previewRevert() {
      if (batch.status !== "completed") {
        return {
          safe: false,
          conflicts: 1,
          strategy: "仅已完成且未发生后续变更的批次可撤销",
          token: null,
          expiresAt: null,
        };
      }
      activeRevertToken = "synthetic-revert-preview-token";
      return {
        safe: true,
        conflicts: 0,
        strategy: "新增员工停用；更新员工恢复审计快照",
        token: activeRevertToken,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      };
    },
    async revertBatch(_batchId, token) {
      if (!activeRevertToken || token !== activeRevertToken) throw new ImportRepositoryError("撤销预览已失效", "revert_conflict");
      batch = { ...batch, status: "reverted", version: batch.version + 1 };
      activeRevertToken = null;
    },
    async listImportHistory() {
      return [reread()];
    },
    async getBatchAudit() {
      return [{ action: "insert", rowNumber: 4, before: null, after: { employeeNumber: "0007" } }];
    },
  };
}
