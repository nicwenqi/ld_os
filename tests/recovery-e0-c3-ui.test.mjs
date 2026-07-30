import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("C3 keeps baseline classification inside the zero-write preview and requires explicit manager choice", async () => {
  const [panel, preview, page, history] = await Promise.all([
    readFile(new URL("../app/components/import/BaselineClassificationPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/import/EmployeeUpdatePreviewStep.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/import/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/import/EmployeeUpdateHistory.tsx", import.meta.url), "utf8"),
  ]);
  for (const token of [
    "员工基线适用范围",
    "Full · 酒店完整基线",
    "Restricted · 有声明限制",
    "Pilot Limited · 仅限试运行范围",
    "限制说明",
    "包含下级部门",
  ]) assert.match(panel, new RegExp(token));
  assert.match(preview, /BaselineClassificationPanel/);
  assert.match(panel, /尚未选择员工基线分类/);
  assert.match(page, /previewHash: preview\.previewHash, baseline/);
  assert.match(page, /useState<EmployeeBaselineClassification \| null>\(null\)/);
  assert.match(history, /基线分类/);
  assert.match(history, /仅限试运行范围/);
});
