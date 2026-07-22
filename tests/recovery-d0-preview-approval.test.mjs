import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createEmployeeUpdateDecisionDraft,
  createImportService,
} from "../app/services/import-service.ts";

const batch = {
  id: "batch-d0",
  tenantId: "tenant-1",
  propertyId: "property-1",
  fileName: "employee-master.xlsx",
  status: "mapping_required",
  version: 3,
  createdAt: "2026-07-22T08:00:00.000Z",
  summary: { inserted: 0, updated: 0, unchanged: 0, excluded: 0, blocked: 0, unresolved: 0 },
};

function repository() {
  const calls = [];
  let current = structuredClone(batch);
  let preparedPreview = null;
  return {
    calls,
    async getBatch() { return structuredClone(current); },
    async listFieldMappings() {
      return [{
        id: "mapping-1",
        sourceColumnName: "Empid",
        targetField: "employee_number",
        mappingStatus: "confirmed",
        transformationRule: { preserveText: true },
        isRequired: true,
      }];
    },
    async listIssues() { return []; },
    async listSourceLabelResolutions() { return []; },
    async confirmFieldMappings() { throw new Error("unused"); },
    async resolveSourceLabel() { throw new Error("unused"); },
    async resolveIssue() { throw new Error("unused"); },
    async preparePreview(id, version, options) {
      calls.push(["preparePreview", id, version, options]);
      current = { ...current, status: "ready_for_review", version: version + 1 };
      preparedPreview = {
        additions: 0,
        updates: 1,
        unchanged: 0,
        exclusions: 0,
        blocked: 0,
        unresolved: 0,
        version: current.version,
        status: "ready_for_review",
        effectiveDate: "2026-07-22",
        previewHash: "sha256:d0-preview",
        rows: [{
          rowId: "row-1",
          rowNumber: 4,
          action: "update",
          employeeNumber: "0007",
          employeeName: "示例员工",
          effectiveDate: "2026-07-22",
          changes: [{
            field: "department_id",
            before: "Front Office",
            after: "Rooms",
            reason: "经理确认的部门归属",
          }],
        }],
      };
      return structuredClone(preparedPreview);
    },
    async readPreparedPreview() {
      return preparedPreview ? structuredClone(preparedPreview) : null;
    },
    async commitBatch(id, version, approval) {
      calls.push(["commitBatch", id, version, approval]);
      current = { ...current, status: "completed", version: version + 1 };
      return "commit-d0";
    },
    async getBatchAudit() {
      return [{ action: "update", approvedPreviewHash: "sha256:d0-preview" }];
    },
    async previewRevert() { throw new Error("unused"); },
    async revertBatch() { throw new Error("unused"); },
  };
}

test("D0 preview returns exact row and field evidence and binds commit approval to its hash", async () => {
  const repo = repository();
  const service = createImportService(repo);
  const workflow = await service.resume("batch-d0");
  const prepared = await service.preparePreview(
    "batch-d0",
    workflow.batch.version,
    {
      statusTreatment: "retain_existing_set_additions_active",
      effectiveDate: "2026-07-22",
    },
    createEmployeeUpdateDecisionDraft(workflow),
  );

  assert.equal(prepared.preview.rows[0].employeeNumber, "0007");
  assert.deepEqual(prepared.preview.rows[0].changes[0], {
    field: "department_id",
    before: "Front Office",
    after: "Rooms",
    reason: "经理确认的部门归属",
  });

  const approval = {
    acknowledged: true,
    previewHash: prepared.preview.previewHash,
  };
  await service.confirmUpdate(
    "batch-d0",
    prepared.workflow.batch.version,
    approval,
    createEmployeeUpdateDecisionDraft(prepared.workflow),
  );
  assert.deepEqual(repo.calls.at(-1), [
    "commitBatch",
    "batch-d0",
    prepared.workflow.batch.version,
    approval,
  ]);
});

test("D0 confirmation rejects acknowledgement that is not bound to a preview hash", async () => {
  const repo = repository();
  const service = createImportService(repo);
  const workflow = await service.resume("batch-d0");
  await assert.rejects(
    service.confirmUpdate(
      "batch-d0",
      workflow.batch.version,
      { acknowledged: true, previewHash: "" },
      createEmployeeUpdateDecisionDraft(workflow),
    ),
    /预览证据/,
  );
  assert.equal(repo.calls.some(call => call[0] === "commitBatch"), false);
});

test("D0 preview UI exposes exact changes, effective date, and immutable approval evidence", async () => {
  const source = await readFile(
    new URL("../app/components/import/EmployeeUpdatePreviewStep.tsx", import.meta.url),
    "utf8",
  );
  for (const token of ["逐员工逐字段", "原值", "新值", "修改依据", "资料生效日", "审批证据"]) {
    assert.match(source, new RegExp(token));
  }
});
