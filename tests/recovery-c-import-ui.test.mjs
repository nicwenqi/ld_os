import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createMockImportRepository } from "../app/repositories/mock/import-repository.ts";
import {
  createEmployeeUpdateDecisionDraft,
  createImportService,
} from "../app/services/import-service.ts";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("employee data update exposes the approved seven-step hotel workflow", async () => {
  const [page, progress, file, fields, attribution, issues, preview, history] =
    await Promise.all([
      read("../app/import/page.tsx"),
      read("../app/components/import/EmployeeUpdateProgress.tsx"),
      read("../app/components/import/FileInspectionStep.tsx"),
      read("../app/components/import/FieldRecognitionStep.tsx"),
      read("../app/components/import/AttributionStep.tsx"),
      read("../app/components/import/IssueResolutionStep.tsx"),
      read("../app/components/import/EmployeeUpdatePreviewStep.tsx"),
      read("../app/components/import/EmployeeUpdateHistory.tsx"),
    ]);
  const source = [page, progress, file, fields, attribution, issues, preview, history].join("\n");
  for (const label of [
    "文件检查",
    "字段识别",
    "部门归属确认",
    "职位归属确认",
    "数据问题处理",
    "更新预览",
    "确认更新",
    "更新记录",
    "撤销预览",
  ]) assert.match(source, new RegExp(label));
  assert.match(page, /createImportService/);
  assert.match(page, /AdministrationSaveState/);
  assert.match(page, /useUnsavedChangesWarning/);
  assert.match(history, /id="update-history"/);
});

test("workflow separates source evidence, manager decisions, and the six-category zero-write preview", async () => {
  const [file, fields, attribution, issues, preview] = await Promise.all([
    read("../app/components/import/FileInspectionStep.tsx"),
    read("../app/components/import/FieldRecognitionStep.tsx"),
    read("../app/components/import/AttributionStep.tsx"),
    read("../app/components/import/IssueResolutionStep.tsx"),
    read("../app/components/import/EmployeeUpdatePreviewStep.tsx"),
  ]);
  for (const token of ["员工主数据", "培训历史", "CTC/GTC", "检查不等于更新"])
    assert.match(file, new RegExp(token));
  for (const token of ["来源字段", "目标字段", "保留前导零", "保存字段识别"])
    assert.match(fields, new RegExp(token));
  for (const token of ["来源值", "影响员工行", "正式部门", "正式职位", "不自动猜测"])
    assert.match(attribution, new RegExp(token));
  for (const token of ["来源行", "明确更正", "排除本次更新", "延后处理"])
    assert.match(issues, new RegExp(token));
  for (const token of ["新增", "更新", "不变", "排除", "阻塞", "未解决", "零写入预览"])
    assert.match(preview, new RegExp(token));
});

test("review data is explicit and Production cannot silently use it", async () => {
  const [page, environment, registry] = await Promise.all([
    read("../app/import/page.tsx"),
    read("../app/lib/environment.ts"),
    read("../app/repositories/registry.ts"),
  ]);
  assert.match(page, /受保护评审数据/);
  assert.match(page, /dataMode === "mock"/);
  assert.match(environment, /Production cannot use local-review repositories/);
  assert.match(registry, /assertProductionDataBoundary/);
  assert.doesNotMatch(page, /synthetic-batch-202607/);
});

test("save, conflict, explicit confirmation, and guarded revert are wired to authoritative services", async () => {
  const [page, history] = await Promise.all([
    read("../app/import/page.tsx"),
    read("../app/components/import/EmployeeUpdateHistory.tsx"),
  ]);
  for (const token of [
    "pristine",
    "dirty",
    "saving",
    "saved",
    "failed",
    "conflict",
    "confirmFieldMappings",
    "resolveSourceLabel",
    "resolveIssue",
    "preparePreview",
    "confirmUpdate",
  ]) assert.match(page, new RegExp(token));
  assert.match(history, /onPreviewRevert/);
  assert.match(history, /onRevert/);
  assert.match(history, /撤销不会删除审计证据/);
  assert.match(history, /更新预览尚未计算/);
  assert.doesNotMatch(`${page}${history}`, /toast|showToast|prototype/i);
});

test("position attribution offers preview-first batch initialization without bypassing employee confirmation", async () => {
  const [page, attribution] = await Promise.all([
    read("../app/import/page.tsx"),
    read("../app/components/import/AttributionStep.tsx"),
  ]);
  for (const token of [
    "批量职位归属初始化",
    "预览创建正式职位",
    "预览批量关联",
    "确认批量决定",
    "同名职位不会自动合并",
    "明确新建独立职位",
    "单项特殊处理",
  ]) assert.match(attribution, new RegExp(token));
  assert.match(page, /previewPositionAttributionBatch/);
  assert.match(page, /confirmPositionAttributionBatch/);
  assert.match(page, /员工主数据仍保持零写入/);
  assert.match(attribution, /decisionMode/);
});

test("mock workflow proves no employee write occurs before explicit confirmation", async () => {
  const repository = createMockImportRepository();
  const service = createImportService(repository);
  const batch = (await repository.listImportHistory("synthetic-property-a1"))[0];
  let workflow = await service.resume(batch.id);

  workflow = await service.confirmFieldMappings(
    batch.id,
    workflow.batch.version,
    workflow.fieldMappings.map(item => ({
      mappingId: item.id,
      mappingStatus: "confirmed",
      targetField: item.targetField,
      transformationRule: item.transformationRule,
    })),
  );
  workflow = await service.resolveSourceLabel(
    batch.id,
    workflow.batch.version,
    "department",
    "Guest Services",
    "synthetic-department",
    "mapped",
  );
  workflow = await service.resolveSourceLabel(
    batch.id,
    workflow.batch.version,
    "position",
    "Legacy Title",
    "synthetic-position",
    "mapped",
  );
  workflow = await service.resolveIssue(
    batch.id,
    workflow.batch.version,
    workflow.issues[0].id,
    { status: "excluded" },
  );
  const cleanDraft = createEmployeeUpdateDecisionDraft(workflow);
  const prepared = await service.preparePreview(
    batch.id,
    workflow.batch.version,
    {
      statusTreatment: "retain_existing_set_additions_active",
      effectiveDate: "2026-07-22",
    },
    cleanDraft,
  );
  assert.equal(prepared.preview.additions, 18);
  assert.equal(prepared.preview.updates, 7);
  assert.equal(prepared.preview.unchanged, 91);
  assert.equal(prepared.preview.exclusions, 3);
  assert.equal(prepared.preview.blocked, 0);
  assert.equal(prepared.preview.unresolved, 0);

  await assert.rejects(
    service.confirmUpdate(
      batch.id,
      prepared.workflow.batch.version,
      {
        acknowledged: false,
        previewHash: prepared.preview.previewHash,
        baseline: {
          state: "full",
          departmentId: null,
          includeDescendants: false,
          limitations: "",
        },
      },
      createEmployeeUpdateDecisionDraft(prepared.workflow),
    ),
    /请先确认更新范围/,
  );
  assert.equal((await repository.getBatch(batch.id)).status, "ready_for_review");

  const committed = await service.confirmUpdate(
    batch.id,
    prepared.workflow.batch.version,
    {
      acknowledged: true,
      previewHash: prepared.preview.previewHash,
      baseline: {
        state: "full",
        departmentId: null,
        includeDescendants: false,
        limitations: "",
      },
    },
    createEmployeeUpdateDecisionDraft(prepared.workflow),
  );
  assert.equal(committed.batch.status, "completed");
  assert.equal(committed.audit.length, 1);
  const revertPreview = await service.previewRevert(batch.id);
  assert.equal(revertPreview.safe, true);
  assert.ok(revertPreview.token);
  const reverted = await service.revert(batch.id, revertPreview.token);
  assert.equal(reverted.status, "reverted");
});

test("Recovery C import UI has responsive touch and focus contracts", async () => {
  const css = await read("../app/recovery-c.css");
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /focus-visible/);
  assert.match(css, /overflow-x:\s*(?:auto|hidden)/);
  assert.match(css, /@media\(max-width:\s*900px\)/);
  assert.match(css, /@media\(max-width:\s*640px\)/);
  assert.match(css, /minmax\(0,1fr\)/);
});
