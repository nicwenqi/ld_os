import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const organization = await readFile(new URL("../app/organization/page.tsx", import.meta.url), "utf8");
const positions = await readFile(new URL("../app/positions/page.tsx", import.meta.url), "utf8");
const accounts = await readFile(new URL("../app/accounts/page.tsx", import.meta.url), "utf8");
const legacy = await readFile(new URL("../app/permissions/page.tsx", import.meta.url), "utf8");
const saveState = await readFile(new URL("../app/components/administration/AdministrationSaveState.tsx", import.meta.url), "utf8");
const registry = await readFile(new URL("../app/repositories/registry.ts", import.meta.url), "utf8");

test("organization workspace covers hierarchy mutation and move confirmation", () => {
  for (const phrase of ["正式部门架构", "新增一级部门", "新增下级部门", "保存正式部门", "调整组织路径", "预览影响", "确认移动", "运营单元"]) assert.match(organization, new RegExp(phrase));
  for (const phrase of ["currentPath", "proposedPath", "childDepartmentsAffected", "aliasesAffected", "operationalUnitsAffected"]) assert.match(organization, new RegExp(phrase));
  assert.match(organization, /useUnsavedChangesWarning/);
});

test("the dense legacy administration hub is replaced by dedicated routes", () => {
  assert.match(legacy, /redirect\(["']\/organization["']\)/);
  assert.doesNotMatch(legacy, /registry\.department|registry\.position|部门认领与映射|职位来源映射/);
  for (const route of ["/organization", "/positions", "/accounts"]) {
    assert.match(`${organization}\n${positions}\n${accounts}`, new RegExp(route.replace("/", "\\/")));
  }
});

test("position workspace supports families, official positions, and department applicability", () => {
  for (const phrase of ["职位族", "正式职位", "新增职位族", "新增正式职位", "适用部门", "保存职位族", "保存正式职位"]) assert.match(positions, new RegExp(phrase));
  assert.match(positions, /savePositionFamily/);
  assert.match(positions, /savePositionWithDepartments/);
  assert.match(positions, /useUnsavedChangesWarning/);
});

test("dedicated pages use foundation repositories and one shared persistent save contract", () => {
  assert.match(organization, /registry\.department/);
  assert.match(positions, /registry\.position/);
  assert.match(accounts, /createBackendAccount|updateBackendAccount/);
  assert.doesNotMatch(`${organization}\n${positions}\n${accounts}`, /\.from\(|createClient|supabase/i);
  for (const token of ["未修改", "有未保存更改", "保存中", "已保存", "保存失败，点击重试", "保存冲突，请重新读取"]) {
    assert.match(saveState, new RegExp(token));
  }
  assert.match(registry, /organization-management/);
  assert.match(registry, /position-management/);
  assert.match(registry, /foundationModules/);
  assert.match(registry, /return "unavailable"/);
});
