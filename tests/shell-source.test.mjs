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
});

test("foundation page uses the premium hierarchy story", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /今日运营重点/);
  assert.match(page, /组织范围/);
  assert.match(page, /Rooms 房务部/);
});
