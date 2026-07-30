import assert from "node:assert/strict";
import test from "node:test";

import {
  baselineClassificationLabels,
  validateEmployeeBaselineClassification,
} from "../app/services/pilot-employee-baseline.ts";
import {
  createEmployeeUpdateDecisionDraft,
  createImportService,
} from "../app/services/import-service.ts";

test("Full baseline rejects a department boundary and undeclared limitation", () => {
  assert.throws(() => validateEmployeeBaselineClassification({
    state: "full",
    departmentId: "official-department-id",
    includeDescendants: true,
    limitations: "仅限一个部门",
  }), /Full 基线不能限定部门范围或保留限制说明/);
});

test("Restricted baseline preserves a visible limitation instead of implying complete coverage", () => {
  assert.throws(() => validateEmployeeBaselineClassification({
    state: "restricted",
    departmentId: null,
    includeDescendants: false,
    limitations: "  ",
  }), /Restricted 基线必须说明限制/);

  assert.deepEqual(validateEmployeeBaselineClassification({
    state: "restricted",
    departmentId: null,
    includeDescendants: false,
    limitations: "  夜班外包人员尚待确认  ",
  }), {
    state: "restricted",
    departmentId: null,
    includeDescendants: false,
    limitations: "夜班外包人员尚待确认",
  });
});

test("Pilot Limited baseline requires an explicit official department and declared limitation", () => {
  assert.throws(() => validateEmployeeBaselineClassification({
    state: "pilot_limited",
    departmentId: null,
    includeDescendants: true,
    limitations: "仅验证前厅部",
  }), /Pilot Limited 基线必须选择正式部门/);
  assert.throws(() => validateEmployeeBaselineClassification({
    state: "pilot_limited",
    departmentId: "official-department-id",
    includeDescendants: false,
    limitations: " ",
  }), /Pilot Limited 基线必须说明限制/);
});

test("baseline state labels make scope boundaries visible to the manager", () => {
  assert.equal(baselineClassificationLabels.full, "Full · 酒店完整基线");
  assert.match(baselineClassificationLabels.restricted, /有声明限制/);
  assert.match(baselineClassificationLabels.pilot_limited, /仅限试运行范围/);
});

test("C3 requires a validated baseline classification and forwards it with exact preview approval", async () => {
  const calls = [];
  const batch = {
    id: "batch-c3",
    tenantId: "tenant-c3",
    propertyId: "property-c3",
    fileName: "employee-master.xlsx",
    status: "ready_for_review",
    version: 8,
    createdAt: "2026-07-30T09:00:00.000Z",
    summary: { inserted: 2, updated: 0, unchanged: 0, excluded: 0, blocked: 0, unresolved: 0 },
  };
  const repository = {
    async getBatch() { return structuredClone(batch); },
    async listFieldMappings() { return [{ id: "mapping", sourceColumnName: "工号", targetField: "employee_number", mappingStatus: "confirmed", transformationRule: {}, isRequired: true }]; },
    async listIssues() { return []; },
    async listSourceLabelResolutions() { return []; },
    async readPreparedPreview() { return { additions: 2, updates: 0, unchanged: 0, exclusions: 0, blocked: 0, unresolved: 0, version: 8, status: "ready_for_review", effectiveDate: "2026-07-30", previewHash: "c3-preview-hash", rows: [] }; },
    async commitBatch(...args) { calls.push(args); return "commit-c3"; },
    async getBatchAudit() { return []; },
    async confirmFieldMappings() { throw new Error("unused"); },
    async resolveSourceLabel() { throw new Error("unused"); },
    async resolveIssue() { throw new Error("unused"); },
    async preparePreview() { throw new Error("unused"); },
    async previewRevert() { throw new Error("unused"); },
    async revertBatch() { throw new Error("unused"); },
  };
  const service = createImportService(repository);
  const workflow = await service.resume(batch.id);
  const draft = createEmployeeUpdateDecisionDraft(workflow);

  await assert.rejects(
    service.confirmUpdate(batch.id, batch.version, {
      acknowledged: true,
      previewHash: "c3-preview-hash",
    }, draft),
    /员工基线分类/,
  );
  assert.equal(calls.length, 0);

  const baseline = {
    state: "pilot_limited",
    departmentId: "official-department-c3",
    includeDescendants: true,
    limitations: "仅限已确认的试运行部门",
  };
  await service.confirmUpdate(batch.id, batch.version, {
    acknowledged: true,
    previewHash: "c3-preview-hash",
    baseline,
  }, draft);
  assert.deepEqual(calls[0][2].baseline, baseline);
});
