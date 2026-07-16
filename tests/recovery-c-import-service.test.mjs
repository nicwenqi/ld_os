import assert from "node:assert/strict";
import test from "node:test";

import {
  createImportService,
  deriveEmployeeUpdateProgress,
} from "../app/services/import-service.ts";
import {
  ImportRepositoryError,
  mapImportRepositoryError,
} from "../app/repositories/contracts/import-repository.ts";

const batch = {
  id: "batch-1",
  tenantId: "tenant-1",
  propertyId: "property-1",
  fileName: "review-workbook.xlsx",
  status: "mapping_required",
  version: 4,
  createdAt: "2026-07-16T09:00:00.000Z",
  summary: {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    excluded: 0,
    blocked: 2,
    unresolved: 2,
  },
};

function fakeRepository() {
  const calls = [];
  let current = structuredClone(batch);
  return {
    calls,
    async getBatch(id) {
      calls.push(["getBatch", id]);
      return id === current.id ? structuredClone(current) : null;
    },
    async listIssues(id) {
      calls.push(["listIssues", id]);
      return [{
        id: "issue-1",
        rowNumber: 18,
        sheetName: "Sheet1",
        type: "unresolved_department",
        severity: "error",
        field: "Department",
        value: null,
        message: "缺少部门来源值",
        resolutionStatus: "unresolved",
      }];
    },
    async listSourceLabelResolutions(id, type) {
      calls.push(["listSourceLabelResolutions", id, type]);
      return type === "department"
        ? [{ sourceValue: "Front Office", sourceRowCount: 8, decision: "pending" }]
        : [{ sourceValue: "Associate", sourceRowCount: 8, decision: "pending" }];
    },
    async confirmFieldMappings(id, version, mappings) {
      calls.push(["confirmFieldMappings", id, version, mappings]);
      current = { ...current, version: version + 1 };
      return { version: current.version, status: current.status };
    },
    async resolveSourceLabel(id, version, type, sourceValue, targetId, decision) {
      calls.push(["resolveSourceLabel", id, version, type, sourceValue, targetId, decision]);
      current = { ...current, version: version + 1 };
      return { version: current.version, status: current.status };
    },
    async resolveIssue(id, version, issueId, resolution) {
      calls.push(["resolveIssue", id, version, issueId, resolution]);
      current = { ...current, version: version + 1 };
      return { version: current.version, status: current.status };
    },
    async preparePreview(id, version, options) {
      calls.push(["preparePreview", id, version, options]);
      current = {
        ...current,
        version: version + 1,
        status: "ready_for_review",
        summary: {
          inserted: 194,
          updated: 0,
          unchanged: 0,
          excluded: 2,
          blocked: 0,
          unresolved: 0,
        },
      };
      return {
        additions: 194,
        updates: 0,
        unchanged: 0,
        exclusions: 2,
        blocked: 0,
        unresolved: 0,
        version: current.version,
        status: "ready_for_review",
      };
    },
    async commitBatch(id, version) {
      calls.push(["commitBatch", id, version]);
      current = { ...current, version: version + 1, status: "completed" };
      return "commit-1";
    },
    async getBatchAudit(id) {
      calls.push(["getBatchAudit", id]);
      return [{ action: "insert", employeeNumber: "0007" }];
    },
    async previewRevert(id) {
      calls.push(["previewRevert", id]);
      return {
        safe: true,
        conflicts: 0,
        strategy: "新增员工停用；更新员工恢复审计快照",
        token: "preview-token",
        expiresAt: "2026-07-16T09:10:00.000Z",
      };
    },
    async revertBatch(id, token) {
      calls.push(["revertBatch", id, token]);
      current = { ...current, version: current.version + 1, status: "reverted" };
    },
  };
}

test("Recovery C import service resumes, persists decisions, rereads authority, previews without committing, and confirms explicitly", async () => {
  const repository = fakeRepository();
  const service = createImportService(repository);

  const resumed = await service.resume("batch-1");
  assert.equal(resumed.batch.version, 4);
  assert.equal(resumed.departmentLabels.length, 1);
  assert.equal(resumed.positionLabels.length, 1);
  assert.equal(resumed.issues.length, 1);

  const mapped = await service.confirmFieldMappings("batch-1", 4, [{
    sourceColumnName: "Empid",
    targetField: "employee_number",
    mappingStatus: "confirmed",
  }]);
  assert.equal(mapped.version, 5);
  assert.deepEqual(repository.calls.at(-1), ["getBatch", "batch-1"]);

  const attributed = await service.resolveSourceLabel(
    "batch-1",
    5,
    "department",
    "Front Office",
    "department-1",
    "mapped",
  );
  assert.equal(attributed.version, 6);

  const corrected = await service.resolveIssue("batch-1", 6, "issue-1", {
    status: "corrected",
    payload: { department_id: "department-1" },
  });
  assert.equal(corrected.version, 7);

  const preview = await service.preparePreview("batch-1", 7, {
    statusTreatment: "retain_existing_and_activate_additions",
  });
  assert.equal(preview.preview.additions, 194);
  assert.equal(preview.batch.status, "ready_for_review");
  assert.equal(repository.calls.some(call => call[0] === "commitBatch"), false);

  await assert.rejects(
    () => service.confirmUpdate("batch-1", preview.batch.version, false),
    /请先确认更新范围/,
  );
  const committed = await service.confirmUpdate("batch-1", preview.batch.version, true);
  assert.equal(committed.commitId, "commit-1");
  assert.equal(committed.batch.status, "completed");
  assert.equal(committed.audit.length, 1);

  const revertPreview = await service.previewRevert("batch-1");
  assert.equal(revertPreview.token, "preview-token");
  const reverted = await service.revert("batch-1", revertPreview.token);
  assert.equal(reverted.status, "reverted");
});

test("Recovery C progress derives only eligible next steps and keeps unresolved rows blocking", () => {
  assert.deepEqual(
    deriveEmployeeUpdateProgress({
      status: "mapping_required",
      fieldMappingsConfirmed: true,
      departmentUnresolved: 0,
      positionUnresolved: 0,
      blockingIssues: 2,
      previewReady: false,
    }),
    {
      currentStep: "issue_resolution",
      canPreview: false,
      canConfirm: false,
    },
  );
});

test("Recovery C maps database concurrency failures into stable business conflicts", () => {
  assert.equal(mapImportRepositoryError({ code: "P3001", message: "stale" }).conflict, "batch_stale");
  assert.equal(mapImportRepositoryError({ code: "P3005", message: "employee stale" }).conflict, "employee_stale");
  assert.equal(mapImportRepositoryError({ code: "P3202", message: "mapping stale" }).conflict, "mapping_stale");
  assert.equal(mapImportRepositoryError({ code: "P3006", message: "identifier" }).conflict, "identifier_conflict");
  assert.equal(mapImportRepositoryError({ code: "P3011", message: "revert" }).conflict, "revert_conflict");
  assert.equal(mapImportRepositoryError(new Error("validation")).conflict, null);
  assert.equal(new ImportRepositoryError("x", "batch_stale").conflict, "batch_stale");
});
