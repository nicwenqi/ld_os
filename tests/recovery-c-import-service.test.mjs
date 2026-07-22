import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmployeeUpdateDecisionDraft,
  createImportService,
  deriveEmployeeUpdateProgress,
  updateEmployeeUpdateDecisionDraft,
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
  let departmentDecision = "pending";
  let positionDecision = "pending";
  let issueStatus = "unresolved";
  let preparedPreview = null;
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
        resolutionStatus: issueStatus,
      }];
    },
    async listFieldMappings(id) {
      calls.push(["listFieldMappings", id]);
      return [{
        id: "11111111-1111-4111-8111-111111111111",
        sourceColumnName: "Empid",
        targetField: "employee_number",
        mappingStatus: "confirmed",
        transformationRule: { preserveText: true },
        isRequired: true,
      }];
    },
    async listSourceLabelResolutions(id, type) {
      calls.push(["listSourceLabelResolutions", id, type]);
      return type === "department"
        ? [{ sourceValue: "Front Office", sourceRowCount: 8, decision: departmentDecision }]
        : [{ sourceValue: "Associate", sourceRowCount: 8, decision: positionDecision }];
    },
    async confirmFieldMappings(id, version, mappings) {
      calls.push(["confirmFieldMappings", id, version, mappings]);
      current = { ...current, version: version + 1 };
      return { version: current.version, status: current.status };
    },
    async resolveSourceLabel(id, version, type, sourceValue, targetId, decision) {
      calls.push(["resolveSourceLabel", id, version, type, sourceValue, targetId, decision]);
      if (type === "department") departmentDecision = decision;
      else positionDecision = decision;
      current = { ...current, version: version + 1 };
      return { version: current.version, status: current.status };
    },
    async resolveIssue(id, version, issueId, resolution) {
      calls.push(["resolveIssue", id, version, issueId, resolution]);
      issueStatus = resolution.status;
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
      preparedPreview = {
        additions: 194,
        updates: 0,
        unchanged: 0,
        exclusions: 2,
        blocked: 0,
        unresolved: 0,
        version: current.version,
        status: "ready_for_review",
        effectiveDate: options.effectiveDate,
        previewHash: "recovery-c-preview-hash",
        rows: [],
      };
      return structuredClone(preparedPreview);
    },
    async readPreparedPreview() {
      return preparedPreview ? structuredClone(preparedPreview) : null;
    },
    async commitBatch(id, version, approval) {
      calls.push(["commitBatch", id, version, approval]);
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
  assert.equal(resumed.progress.currentStep, "attribution");

  const mapped = await service.confirmFieldMappings("batch-1", 4, [{
    mappingId: "11111111-1111-4111-8111-111111111111",
    targetField: "employee_number",
    mappingStatus: "confirmed",
  }]);
  assert.equal(mapped.batch.version, 5);
  assert.equal(repository.calls.filter(call => call[0] === "listFieldMappings").length >= 2, true);

  const attributed = await service.resolveSourceLabel(
    "batch-1",
    5,
    "department",
    "Front Office",
    "department-1",
    "mapped",
  );
  assert.equal(attributed.batch.version, 6);
  assert.equal(attributed.departmentLabels[0].decision, "mapped");

  const position = await service.resolveSourceLabel(
    "batch-1",
    6,
    "position",
    "Associate",
    "position-1",
    "mapped",
  );
  assert.equal(position.batch.version, 7);

  const corrected = await service.resolveIssue("batch-1", 7, "issue-1", {
    status: "corrected",
    payload: { corrections: { department_id: "department-1" } },
  });
  assert.equal(corrected.batch.version, 8);
  assert.equal(corrected.issues[0].resolutionStatus, "corrected");
  assert.equal(corrected.progress.currentStep, "preview");

  const cleanDraft = createEmployeeUpdateDecisionDraft(corrected);
  const dirtyDraft = updateEmployeeUpdateDecisionDraft(cleanDraft, {
    sourceLabels: [{
      type: "department",
      sourceValue: "Front Office",
      targetId: "department-2",
      decision: "mapped",
    }],
  });
  await assert.rejects(
    () => service.preparePreview("batch-1", 8, {
      statusTreatment: "retain_existing_set_additions_active",
      effectiveDate: "2026-07-22",
    }, dirtyDraft),
    /未保存/,
  );
  const preview = await service.preparePreview("batch-1", 8, {
    statusTreatment: "retain_existing_set_additions_active",
    effectiveDate: "2026-07-22",
  }, cleanDraft);
  assert.equal(preview.preview.additions, 194);
  assert.equal(preview.workflow.batch.status, "ready_for_review");
  assert.equal(repository.calls.some(call => call[0] === "commitBatch"), false);
  const confirmationDraft = createEmployeeUpdateDecisionDraft(preview.workflow);

  await assert.rejects(
    () => service.confirmUpdate("batch-1", preview.workflow.batch.version, {
      acknowledged: false,
      previewHash: preview.preview.previewHash,
    }, confirmationDraft),
    /请先确认更新范围/,
  );
  const committed = await service.confirmUpdate("batch-1", preview.workflow.batch.version, {
    acknowledged: true,
    previewHash: preview.preview.previewHash,
  }, confirmationDraft);
  assert.equal(committed.commitId, "commit-1");
  assert.equal(committed.batch.status, "completed");
  assert.equal(committed.audit.length, 1);

  const revertPreview = await service.previewRevert("batch-1");
  assert.equal(revertPreview.token, "preview-token");
  const reverted = await service.revert("batch-1", revertPreview.token);
  assert.equal(reverted.status, "reverted");
});

test("Recovery C decision drafts have an authoritative base version and explicit dirty state", async () => {
  const service = createImportService(fakeRepository());
  const workflow = await service.resume("batch-1");
  const clean = createEmployeeUpdateDecisionDraft(workflow);
  assert.equal(clean.baseVersion, 4);
  assert.equal(clean.dirty, false);
  const dirty = updateEmployeeUpdateDecisionDraft(clean, {
    fieldMappings: [{
      mappingId: "11111111-1111-4111-8111-111111111111",
      mappingStatus: "confirmed",
    }],
  });
  assert.equal(dirty.dirty, true);
  assert.equal(clean.dirty, false);
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
  assert.deepEqual(
    deriveEmployeeUpdateProgress({
      status: "completed",
      fieldMappingsConfirmed: true,
      departmentUnresolved: 0,
      positionUnresolved: 0,
      blockingIssues: 0,
      previewReady: false,
    }),
    { currentStep: "completed", canPreview: false, canConfirm: false },
  );
  assert.deepEqual(
    deriveEmployeeUpdateProgress({
      status: "reverted",
      fieldMappingsConfirmed: true,
      departmentUnresolved: 0,
      positionUnresolved: 0,
      blockingIssues: 0,
      previewReady: false,
    }),
    { currentStep: "reverted", canPreview: false, canConfirm: false },
  );
});

test("Recovery C maps database concurrency failures into stable business conflicts", () => {
  assert.equal(mapImportRepositoryError({ code: "P3001", message: "stale" }).conflict, "batch_stale");
  assert.equal(mapImportRepositoryError({ code: "P3005", message: "employee stale" }).conflict, "employee_stale");
  assert.equal(mapImportRepositoryError({ code: "P3202", message: "mapping stale" }).conflict, "mapping_stale");
  assert.equal(mapImportRepositoryError({ code: "P3203", message: "invalid target" }).conflict, null);
  assert.equal(mapImportRepositoryError({ code: "P3210", message: "invalid correction" }).conflict, null);
  assert.equal(mapImportRepositoryError({ code: "P3006", message: "identifier" }).conflict, "identifier_conflict");
  assert.equal(mapImportRepositoryError({ code: "P3011", message: "revert" }).conflict, "revert_conflict");
  assert.equal(mapImportRepositoryError(new Error("validation")).conflict, null);
  assert.equal(new ImportRepositoryError("x", "batch_stale").conflict, "batch_stale");
});
