import type {
  EmployeeUpdatePreview,
  ImportBatch,
  ImportRepository,
  ImportSourceLabelResolution,
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
  const labels: Record<"department" | "position", ImportSourceLabelResolution[]> = {
    department: [
      { sourceValue: "Concierge", sourceRowCount: 19, decision: "mapped", targetId: "concierge" },
      { sourceValue: "Guest Services", sourceRowCount: 2, decision: "pending" },
    ],
    position: [
      { sourceValue: "Guest Service Associate", sourceRowCount: 12, decision: "mapped", targetId: "guest-service-associate" },
      { sourceValue: "Legacy Title", sourceRowCount: 1, decision: "deferred" },
    ],
  };
  const reread = () => structuredClone(batch);
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
    async selectSheet() {},
    async saveFieldMappings() {},
    async confirmFieldMappings() {
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
    async resolveSourceLabel(_batchId, _version, type, sourceValue, targetId, decision) {
      const item = labels[type].find(row => row.sourceValue === sourceValue);
      if (item) Object.assign(item, { targetId, decision });
      return advance();
    },
    async validateBatch() {
      return reread();
    },
    async listIssues() {
      return [{
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
    },
    async resolveIssue() {
      return advance();
    },
    async preparePreview() {
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
    async commitBatch() {
      batch = { ...batch, status: "completed", version: batch.version + 1 };
      return "synthetic-commit";
    },
    async previewRevert() {
      return {
        safe: true,
        conflicts: 0,
        strategy: "新增员工停用；更新员工恢复审计快照",
        token: "synthetic-revert-preview-token",
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      };
    },
    async revertBatch() {
      batch = { ...batch, status: "reverted", version: batch.version + 1 };
    },
    async listImportHistory() {
      return [reread()];
    },
    async getBatchAudit() {
      return [{ action: "insert", rowNumber: 4, before: null, after: { employeeNumber: "0007" } }];
    },
  };
}
