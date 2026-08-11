import type {
  EmployeeImportPreviewOptions,
  EmployeeUpdatePreview,
  ImportBatch,
  ImportFieldMapping,
  ImportFieldMappingDecision,
  ImportIssue,
  ImportIssueResolution,
  ImportMutationResult,
  ImportRepository,
  ImportRevertPreview,
  ImportSourceLabelDecision,
  ImportSourceLabelResolution,
} from "../contracts/import-repository.ts";
import type { WorkbookInspection } from "../../services/import/workbook-parser.ts";

type MappingWorkflow = {
  batchId: string;
  batchVersion: number;
  decisionVersion: number;
  previewHash: string;
  state: "blocked" | "ready";
  mappings: { items: readonly Record<string, unknown>[]; pendingCount: number; confirmedCount: number; excludedCount: number };
  sourceLabels: { items: readonly Record<string, unknown>[]; pendingCount: number; resolvedCount: number };
  issues: { items: readonly Record<string, unknown>[]; openCount: number; blockingCount: number };
  impact: { state: "unavailable"; reason: string };
};
type StagingWorkflow = { batchId: string; fileName: string; workbookLifecycle: string; storageLifecycle: string; verificationStatus: string; version: number; createdAt: string; counts: { total: number; valid: number; warning: number; error: number } };

/** Browser-safe adapter. It has no provider SDK, pg, or scope-selection inputs. */
export function createHttpImportRepository(): ImportRepository {
  return {
    createBatch: unsupported("createBatch", "文件上传必须通过 /api/import/inspect"),
    uploadFileReference: unsupported("uploadFileReference", "文件上传必须通过 /api/import/inspect"),
    inspectWorkbook: unsupported("inspectWorkbook", "文件上传必须通过 /api/import/inspect"),
    async getBatch(batchId) {
      const staging = await request<StagingWorkflow>(`/api/import/batches/${encodeURIComponent(batchId)}`);
      const mapping = await readMapping(batchId);
      return mapBatch(staging, mapping);
    },
    async listSheets(batchId) {
      const workflow = await request<StagingWorkflow & { sheets?: readonly unknown[] }>(`/api/import/batches/${encodeURIComponent(batchId)}`);
      return workflow.sheets ?? [];
    },
    async listFieldMappings(batchId) {
      const workflow = await readMapping(batchId);
      return workflow.mappings.items.map(mapFieldMapping);
    },
    selectSheet: unsupported("selectSheet", "工作表选择由可信解析服务完成"),
    saveFieldMappings: unsupported("saveFieldMappings", "字段决定必须使用受保护决策 API"),
    async confirmFieldMappings(batchId, expectedVersion, mappings) {
      const workflow = await postMapping(batchId, { expectedDecisionVersion: expectedVersion, decisions: mappings });
      return mutation(workflow);
    },
    stageRows: unsupported("stageRows", "来源行只能由验证后的 Storage saga 暂存"),
    async listDepartmentLabels(batchId) { return this.listSourceLabelResolutions(batchId, "department"); },
    async listPositionLabels(batchId) { return this.listSourceLabelResolutions(batchId, "position"); },
    async listSourceLabelResolutions(batchId, type) {
      const workflow = await readMapping(batchId);
      return workflow.sourceLabels.items.filter(item => item.resolutionType === type).map(mapSourceLabel);
    },
    async resolveSourceLabel(batchId, expectedVersion, type, sourceValue, targetId, decision) {
      const workflow = await readMapping(batchId);
      const label = workflow.sourceLabels.items.find(item => item.resolutionType === type && item.sourceLabel === sourceValue);
      if (!label || typeof label.sourceLabelId !== "string") throw new Error("来源标签不存在或当前无权访问");
      const action = sourceDecision(decision, type);
      const body = { expectedDecisionVersion: expectedVersion, decisions: [{ sourceLabelId: label.sourceLabelId, action, ...(type === "department" && action === "department" ? { targetDepartmentId: targetId } : {}), ...(type === "department" && action === "operational_unit" ? { targetOperationalUnitId: targetId } : {}), ...(type === "position" && action === "position" ? { targetPositionId: targetId } : {}), ...(type === "position" && action === "family" ? { targetPositionFamilyId: targetId } : {}) }] };
      return mutation(await postLabels(batchId, body));
    },
    async validateBatch(batchId) {
      const batch = await this.getBatch(batchId);
      if (!batch) throw new Error("导入批次不存在或无权访问");
      return batch;
    },
    async listIssues(batchId) {
      const workflow = await readMapping(batchId);
      return workflow.issues.items.map(mapIssue);
    },
    async resolveIssue(batchId, expectedVersion, issueId, resolution) {
      const workflow = await postIssues(batchId, { expectedDecisionVersion: expectedVersion, decisions: [{ issueId, status: resolution.status, correction: resolution.payload?.corrections ?? resolution.payload?.normalizedValues ?? {}, resolutionNote: null }] });
      return mutation(workflow);
    },
    async preparePreview(batchId, expectedVersion, _options) {
      const workflow = await readMapping(batchId);
      const preview = await request<MappingWorkflow>(`/api/import/batches/${encodeURIComponent(batchId)}/preview?decisionVersion=${expectedVersion}`);
      return mapPreview(preview, workflow);
    },
    async readPreparedPreview(batchId) {
      const workflow = await readMapping(batchId);
      if (workflow.state !== "ready") return null;
      return mapPreview(workflow, workflow);
    },
    async previewCommit(batchId) { return (await this.getBatch(batchId))?.summary ?? emptySummary(); },
    async commitBatch(batchId, _expectedVersion, approval) {
      const batch = await this.getBatch(batchId);
      if (!batch) throw new Error("导入批次不存在或无权访问");
      const workflow = await readMapping(batchId);
      const result = await request<{ commitId: string }>(`/api/import/batches/${encodeURIComponent(batchId)}/commit`, json("POST", { expectedBatchVersion: batch.version, expectedDecisionVersion: workflow.decisionVersion, previewHash: approval.previewHash, confirmed: approval.acknowledged }));
      return result.commitId;
    },
    async previewRevert(batchId) {
      const result = await request<{ safe: boolean; conflicts: number; strategy: string; commitVersion: number }>(`/api/import/batches/${encodeURIComponent(batchId)}/revert`);
      return { safe: result.safe, conflicts: result.conflicts, strategy: result.strategy, token: result.safe ? String(result.commitVersion) : null, expiresAt: null } satisfies ImportRevertPreview;
    },
    async revertBatch(batchId, token) {
      const expectedCommitVersion = Number(token);
      if (!Number.isSafeInteger(expectedCommitVersion) || expectedCommitVersion < 1) throw new Error("撤销预览已失效，请重新预览");
      await request(`/api/import/batches/${encodeURIComponent(batchId)}/revert`, json("POST", { expectedCommitVersion, confirmed: true }));
    },
    async listImportHistory(_propertyId) {
      const payload = await request<{ items: readonly (StagingWorkflow & { batch?: StagingWorkflow })[] }>("/api/import/batches?limit=100&offset=0");
      return Promise.all(payload.items.map(async item => {
        const staging = item.batch ?? item;
        return mapBatch(staging, await readMapping(staging.batchId));
      }));
    },
    async getBatchAudit() { return []; },
  };
}

function mapBatch(staging: StagingWorkflow, mapping: MappingWorkflow): ImportBatch {
  return {
    id: staging.batchId,
    tenantId: "server-scoped",
    propertyId: "server-scoped",
    fileName: staging.fileName,
    status: mapping.state === "ready" ? "ready_for_review" : "mapping_required",
    version: staging.version,
    createdAt: staging.createdAt,
    summary: {
      inserted: null,
      updated: null,
      unchanged: null,
      excluded: mapping.sourceLabels.items.filter(item => ["ignore", "defer", "external"].includes(String(item.action))).length,
      blocked: mapping.issues.blockingCount,
      unresolved: mapping.sourceLabels.pendingCount + mapping.mappings.pendingCount,
    },
  };
}

function mapFieldMapping(value: Record<string, unknown>): ImportFieldMapping {
  return { id: String(value.mappingId), sourceColumnName: String(value.sourceColumnName), targetField: value.targetField === null ? null : String(value.targetField), mappingStatus: value.mappingStatus === "confirmed" ? "confirmed" : value.mappingStatus === "excluded" ? "excluded" : "suggested", transformationRule: (value.transformationRule ?? {}) as Record<string, unknown>, isRequired: Boolean(value.isRequired) };
}
function mapSourceLabel(value: Record<string, unknown>): ImportSourceLabelResolution { return { sourceValue: String(value.sourceLabel), sourceRowCount: Number(value.affectedRowCount), decision: value.action === "pending" ? "pending" : value.action === "defer" ? "deferred" : value.action === "ignore" ? "excluded" : "mapped", targetId: targetId(value) }; }
function targetId(value: Record<string, unknown>) { return [value.targetDepartmentId, value.targetOperationalUnitId, value.targetPositionId, value.targetPositionFamilyId].find(item => typeof item === "string") as string | undefined; }
function mapIssue(value: Record<string, unknown>): ImportIssue { return { id: String(value.issueId), rowNumber: 0, sheetName: "Employee Master", type: String(value.issueType), severity: value.severity === "warning" ? "warning" : "error", field: value.sourceField === null ? null : String(value.sourceField), value: value.sourceValueProjection === null ? null : String(value.sourceValueProjection), message: String(value.message), resolutionStatus: String(value.status) }; }
function mapPreview(workflow: MappingWorkflow, _current: MappingWorkflow): EmployeeUpdatePreview {
  const unavailable = workflow.impact.state === "unavailable";
  return { additions: unavailable ? null : 0, updates: unavailable ? null : 0, unchanged: unavailable ? null : 0, exclusions: 0, blocked: workflow.issues.blockingCount, unresolved: workflow.mappings.pendingCount + workflow.sourceLabels.pendingCount, version: workflow.batchVersion, status: workflow.state === "ready" ? "ready_for_review" : "mapping_required", effectiveDate: new Date().toISOString().slice(0, 10), previewHash: workflow.previewHash, rows: [] };
}
function mutation(workflow: MappingWorkflow): ImportMutationResult { return { version: workflow.decisionVersion, status: workflow.state }; }
function sourceDecision(decision: ImportSourceLabelDecision, type: "department" | "position") { if (decision === "mapped") return type === "department" ? "department" : "position"; if (decision === "excluded") return "ignore"; return "defer"; }
async function readMapping(batchId: string) { return request<MappingWorkflow>(`/api/import/batches/${encodeURIComponent(batchId)}/mapping`); }
async function postMapping(batchId: string, body: unknown) { return request<MappingWorkflow>(`/api/import/batches/${encodeURIComponent(batchId)}/mapping`, json("POST", body)); }
async function postLabels(batchId: string, body: unknown) { return request<MappingWorkflow>(`/api/import/batches/${encodeURIComponent(batchId)}/labels`, json("POST", body)); }
async function postIssues(batchId: string, body: unknown) { return request<MappingWorkflow>(`/api/import/batches/${encodeURIComponent(batchId)}/issues`, json("POST", body)); }
function emptySummary() { return { inserted: 0, updated: 0, unchanged: 0, excluded: 0, blocked: 0, unresolved: 0 }; }
function unsupported(name: string, message: string): (...args: any[]) => Promise<never> { return async () => { throw new Error(`E5E_IMPORT_${name.toUpperCase()}_UNAVAILABLE:${message}`); }; }
function json(method: "POST", body: unknown): RequestInit { return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }
async function request<T>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store" }); const payload = await response.json() as T & { message?: string }; if (!response.ok) throw new Error(payload.message ?? "Import Neon 服务暂时不可用"); return payload; }
