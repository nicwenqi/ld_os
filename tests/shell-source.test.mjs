import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("application shell exposes Chinese-first navigation and scope controls", async () => {
  const shell = await readFile(new URL("../app/components/shell/AppShell.tsx", import.meta.url), "utf8");
  const navigation = await readFile(new URL("../app/services/role-navigation.ts", import.meta.url), "utf8");
  for (const label of ["学习与发展总览","组织培训看板","培训日历","课程成效","风险看板","员工中心","KPI 目标中心","组织与人员基础","用户与权限","导入中心"]) {
    assert.match(navigation, new RegExp(label));
  }
  assert.match(shell, /DepartmentScopePicker/);
  assert.match(shell, /useAuthSession/);
  assert.doesNotMatch(shell, /RoleSwitcher/);
  assert.match(shell, /showToast/);
  assert.doesNotMatch(shell, /\["01"|\["02"|\["03"/);
  assert.match(shell, /brand-signature/);
  assert.match(shell, /control-cluster/);
});

test("foundation page uses an executive cockpit hierarchy", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /executive-cockpit/);
  assert.match(page, /health-hero/);
  assert.match(page, /KPI 目标完成/);
  assert.match(page, /培训健康度为/);
  assert.match(page, /department-comparison/);
  assert.doesNotMatch(page, /MANAGEMENT INSIGHT|FOUNDATION CHECKPOINT|SCOPE FOUNDATION/);
});
