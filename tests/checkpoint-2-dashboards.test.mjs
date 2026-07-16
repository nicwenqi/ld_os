import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("periodic review modules are truthful until training facts exist", async () => {
  for (const path of ["../app/effectiveness/page.tsx","../app/department-performance/page.tsx","../app/interventions/page.tsx"]) {
    const page = await read(path);
    assert.match(page,/UnavailableOperationalPage/);
    assert.doesNotMatch(page,/showToast|scopeProfiles|departmentId/);
  }
});

test("dedicated organization administration replaces the obsolete organization dashboard", async () => {
  const organization = await read("../app/organization/page.tsx");
  for (const token of ["OrganizationAdministration", "正式部门架构", "运营单元", "registry.department"]) {
    assert.match(organization, new RegExp(token.replace(".", "\\.")));
  }
  await assert.rejects(access(new URL("../app/risk/page.tsx",import.meta.url)));
});

test("frequency navigation points to approved periodic routes", async () => {
  const navigation = await read("../app/services/role-navigation.ts");
  for (const route of ["/department-performance","/effectiveness","/interventions"]) assert.match(navigation,new RegExp(route.replaceAll("/","\\/")));
  assert.match(navigation,/\/organization/);
  assert.doesNotMatch(navigation,/["']\/risk["']/);
});
