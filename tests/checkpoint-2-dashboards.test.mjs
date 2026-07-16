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

test("obsolete organization and risk dashboards are removed", async () => {
  await assert.rejects(access(new URL("../app/organization/page.tsx",import.meta.url)));
  await assert.rejects(access(new URL("../app/risk/page.tsx",import.meta.url)));
});

test("frequency navigation points to approved periodic routes", async () => {
  const navigation = await read("../app/services/role-navigation.ts");
  for (const route of ["/department-performance","/effectiveness","/interventions"]) assert.match(navigation,new RegExp(route.replaceAll("/","\\/")));
  assert.doesNotMatch(navigation,/href:\s*["']\/(organization|risk)["']/);
});
