import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { deriveWizardState } from "../app/services/initialization-wizard-service.ts";

const identity = { nameZh: "示范酒店", nameEn: "Synthetic Hotel", shortName: "示范酒店", code: "demo-01", brand: "Demo", city: "测试城市", countryRegion: "CN", timezone: "Asia/Shanghai", defaultLanguage: "zh-CN" };
const rules = { newEmployeeDays: 90, probationFieldMeaning: "confirmation_date", employeeStatusSource: "manual", ctcMandatory: true, gtcMandatory: true };

test("wizard derives readiness from setup facts and explicit confirmations", () => {
  const incomplete = deriveWizardState({ identity, rules, activeDepartments: 0, activePositions: 0, inspectedEmployeeMaster: false, unresolvedDepartmentLabels: 0, unresolvedPositionLabels: 0, activePropertyAdministrator: true, progress: { lastActiveStep: 1, steps: {} } });
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.lastIncompleteStep, 3);
  const ready = deriveWizardState({ identity, rules, activeDepartments: 1, activePositions: 1, inspectedEmployeeMaster: true, unresolvedDepartmentLabels: 0, unresolvedPositionLabels: 0, activePropertyAdministrator: true, progress: { lastActiveStep: 8, steps: { organization: { explicitlyConfirmed: true }, positions: { explicitlyConfirmed: true }, upload: { explicitlyConfirmed: true }, mapping: { explicitlyConfirmed: true }, access: { explicitlyConfirmed: true } } } });
  assert.equal(ready.ready, true);
  assert.equal(ready.completedSteps.length, 8);
});

test("initialization wizard is a standalone eight-step route with no direct Supabase query", async () => {
  const page = await readFile(new URL("../app/initialize/page.tsx", import.meta.url), "utf8");
  const model = await readFile(new URL("../app/services/initialization-wizard-service.ts", import.meta.url), "utf8");
  for (const token of ["酒店基本信息", "业务规则", "正式组织架构", "职位体系", "上传员工数据", "部门与职位认领", "管理员与权限", "完成检查", "保存并稍后继续", "进入系统"]) assert.match(`${page}\n${model}`, new RegExp(token));
  assert.match(page, /createRepositoryRegistry/);
  assert.doesNotMatch(page, /\.from\(|createBrowserSupabaseClient/);
});

test("shell preserves the wizard as an administrator maintenance route", async () => {
  const shell = await readFile(new URL("../app/components/shell/AppShell.tsx", import.meta.url), "utf8");
  const navigation = await readFile(new URL("../app/services/role-navigation.ts", import.meta.url), "utf8");
  assert.match(navigation, /\/initialize/);
  assert.match(shell, /SessionGate/);
  assert.doesNotMatch(shell, /InitializationGuard/);
});

test("mapping confirmation is enabled once source-label blockers are resolved", async () => {
  const page = await readFile(new URL("../app/initialize/page.tsx", import.meta.url), "utf8");
  const mapping = await readFile(new URL("../app/initialize/MappingSetupStep.tsx", import.meta.url), "utf8");
  assert.match(page, /blocked=\{state\.steps\[5\]\.blocked\}/);
  assert.match(mapping, /disabled=\{props\.blocked\}/);
});
