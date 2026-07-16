import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("application shell exposes Chinese-first frequency navigation",async()=>{
  const [shell,navigation]=await Promise.all([readFile(new URL("../app/components/shell/AppShell.tsx",import.meta.url),"utf8"),readFile(new URL("../app/services/role-navigation.ts",import.meta.url),"utf8")]);
  for (const label of ["运营工作台","培训日历","培训场次","出勤与反馈","员工","干预与提醒","培训计划","部门表现","KPI 与目标","课程成效","数据质量","管理设置"]) assert.match(navigation,new RegExp(label));
  assert.match(shell,/navigationForRole|aria-current|aria-expanded|brand-signature|logout/);
  assert.doesNotMatch(shell,/DepartmentScopePicker|RoleSwitcher|showToast|快速新建/);
});

test("manager home uses an operations command-center hierarchy",async()=>{
  const page=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
  for (const token of ["manager-command-center","operating-verdict","foundation-facts-grid","availability-grid"]) assert.match(page,new RegExp(token));
  assert.match(page,/当前无法判断酒店培训运营是否受控/);
  assert.doesNotMatch(page,/health-hero|KPI 目标完成|培训健康度为/);
});
