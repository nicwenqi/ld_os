import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("executive dashboard KPI contract is complete", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const field of ["实际值","目标值","达成率","目标差距","本月","较上月","statusLabel"]) {
    assert.match(page, new RegExp(field));
  }
  assert.match(page, /scopeProfiles/);
  assert.match(page, /departmentId/);
});

test("executive dashboard contains management-purpose views", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const section of ["部门表现对比","课程成效","部门风险","行动优先级"]) {
    assert.match(page, new RegExp(section));
  }
  assert.match(page, /department-comparison/);
  assert.match(page, /effectiveness-list/);
  assert.match(page, /risk-ranking/);
});
