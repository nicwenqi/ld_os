import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { deriveWizardState } from "../app/services/initialization-wizard-service.ts";

const identity = { nameZh: "示范酒店", nameEn: "Synthetic Hotel", shortName: "示范酒店", code: "demo-01", brand: "Demo", city: "测试城市", countryRegion: "CN", timezone: "Asia/Shanghai", defaultLanguage: "zh-CN" };
const rules = { newEmployeeDays: 90, probationFieldMeaning: "confirmation_date", employeeStatusSource: "manual", ctcMandatory: true, gtcMandatory: true };

test("wizard derives finite activation readiness from required persisted facts", () => {
  const incomplete = deriveWizardState({ identity, rules, activeDepartments: 0, activePositions: 0, inspectedEmployeeMaster: false, unresolvedDepartmentLabels: 0, unresolvedPositionLabels: 0, activePropertyAdministrator: true, progress: { lastActiveStep: 1, steps: {} } });
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.lastIncompleteStep, 2);
  const ready = deriveWizardState({ identity, rules, activeDepartments: 1, activePositions: 0, inspectedEmployeeMaster: false, unresolvedDepartmentLabels: 2, unresolvedPositionLabels: 3, activePropertyAdministrator: true, progress: { lastActiveStep: 5, steps: {} } });
  assert.equal(ready.ready, true);
  assert.equal(ready.minimumReady, true);
  assert.equal(ready.operationalReady, false);
});

test("activation is a standalone five-section route with no direct Supabase query", async () => {
  const page = await readFile(new URL("../app/initialize/page.tsx", import.meta.url), "utf8");
  const model = await readFile(new URL("../app/services/initialization-wizard-service.ts", import.meta.url), "utf8");
  for (const token of ["酒店信息与规则", "正式部门", "管理员账号", "员工资料准备", "启用复核", "保存并稍后继续", "启用酒店"]) assert.match(`${page}\n${model}`, new RegExp(token));
  assert.match(page, /createRepositoryRegistry/);
  assert.doesNotMatch(page, /\.from\(|createBrowserSupabaseClient/);
  assert.doesNotMatch(page, /PositionSetupStep|WorkbookSetupStep|MappingSetupStep/);
});

test("shell preserves the wizard as an administrator maintenance route", async () => {
  const shell = await readFile(new URL("../app/components/shell/AppShell.tsx", import.meta.url), "utf8");
  const navigation = await readFile(new URL("../app/services/role-navigation.ts", import.meta.url), "utf8");
  assert.match(navigation, /\/initialize/);
  assert.match(shell, /SessionGate/);
  assert.doesNotMatch(shell, /InitializationGuard/);
});

test("employee data preparation is visible but non-blocking", async () => {
  const page = await readFile(new URL("../app/initialize/page.tsx", import.meta.url), "utf8");
  assert.match(page, /员工资料准备不会阻塞酒店启用/);
  assert.match(page, /href=["']\/import["']/);
});
