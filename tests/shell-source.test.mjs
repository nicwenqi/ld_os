import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("application shell exposes Chinese-first navigation and scope controls", async () => {
  const shell = await readFile(new URL("../app/components/shell/AppShell.tsx", import.meta.url), "utf8");
  for (const label of ["学习与发展总览","组织培训看板","培训日历","课程成效","风险看板","员工中心","KPI 目标中心","组织与权限","导入中心"]) {
    assert.match(shell, new RegExp(label));
  }
  assert.match(shell, /DepartmentScopePicker/);
  assert.match(shell, /RoleSwitcher/);
  assert.match(shell, /showToast/);
  assert.doesNotMatch(shell, /\["01"|\["02"|\["03"/);
  assert.match(shell, /brand-signature/);
  assert.match(shell, /control-cluster/);
});

test("foundation page uses an executive cockpit hierarchy", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /executive-cockpit/);
  assert.match(page, /health-hero/);
  assert.match(page, /关键运营信号/);
  assert.match(page, /本月培训健康度保持稳健/);
  assert.match(page, /scope-compact/);
  assert.doesNotMatch(page, /MANAGEMENT INSIGHT|FOUNDATION CHECKPOINT|SCOPE FOUNDATION/);
});
