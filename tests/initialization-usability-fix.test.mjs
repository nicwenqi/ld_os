import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";

import { prepareEmployeeMasterStaging } from "../app/services/import/production-workbook-staging.ts";
import { deriveWizardState } from "../app/services/initialization-wizard-service.ts";

const identity = { nameZh:"示范酒店", nameEn:"Synthetic Hotel", shortName:"示范", code:"demo", brand:"Demo", city:"测试城市", countryRegion:"CN", timezone:"Asia/Shanghai", defaultLanguage:"zh-CN" };
const rules = { newEmployeeDays:30, probationFieldMeaning:"probation_end_date", employeeStatusSource:"manual", ctcMandatory:false, gtcMandatory:false };

test("trusted workbook staging extracts auditable department and position label aggregates", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Synthetic employee master"], [],
    ["Empid", "CName", "EName", "Department", "Position", "JoinDate"],
    ["0007", "示例员工甲", "Synthetic Associate", "Front Office", "Guest Agent", "2026-06-01"],
    ["0008", "示例员工乙", "Synthetic Supervisor", "Front Office", "Supervisor", "2026-06-02"],
    ["0009", "示例员工丙", "Synthetic Engineer", "Engineering", "Engineer", "2026-06-03"],
  ]);
  const bytes = XLSX.write({ SheetNames:["Employee Master"], Sheets:{"Employee Master":sheet} }, { type:"buffer", bookType:"xlsx" });
  const prepared = prepareEmployeeMasterStaging({ fileName:"synthetic-master.xlsx", mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes:new Uint8Array(bytes) });
  assert.deepEqual(prepared.sourceLabels.departments.map(item => [item.sourceValue,item.sourceRowCount]), [["Engineering",1],["Front Office",2]]);
  assert.deepEqual(prepared.sourceLabels.positions.map(item => [item.sourceValue,item.sourceRowCount]), [["Engineer",1],["Guest Agent",1],["Supervisor",1]]);
  assert.equal(prepared.sourceLabels.departments.every(item => item.sourceSheet === "Employee Master"), true);
});

test("initialization UI replaces prototype actions with operational components", async () => {
  const [page, access, settings] = await Promise.all([
    readFile(new URL("../app/initialize/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/initialize/AccessSetupStep.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/settings/hotel/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /uploadLogo/);
  assert.match(page, /AccessSetupStep/);
  assert.doesNotMatch(page, /PositionSetupStep|WorkbookSetupStep|MappingSetupStep/);
  assert.match(page, /员工资料准备不会阻塞酒店启用/);
  assert.doesNotMatch(`${page}\n${settings}`, /本地示范|面板已打开|不上传生产环境/);
  assert.match(access, /activePropertyManagers/);
  assert.match(access, /\/accounts/);
});

test("administrator access is loaded through a restricted server boundary", async () => {
  const [route, contract, repository] = await Promise.all([
    readFile(new URL("../app/api/initialization/access/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/repositories/contracts/initialization-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/repositories/supabase/initialization-repository.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /runAuthorizedNeonInitialization/);
  assert.match(route, /repository => repository\.getAccessSummary\("server"\)/);
  assert.doesNotMatch(route, /createServerAdminClient|\.from\s*\(/);
  assert.doesNotMatch(route, /service.role|user_metadata/i);
  assert.match(contract, /getAccessSummary/);
  assert.match(repository, /\/api\/initialization\/access/);
});

test("activation requires only identity, rules, one active department, and one active manager", () => {
  const completeProgress = { lastActiveStep:5, steps:{} };
  const base = { identity, rules, activeDepartments:1, activePositions:1, inspectedEmployeeMaster:true, unresolvedDepartmentLabels:0, unresolvedPositionLabels:0, activePropertyAdministrator:true, progress:completeProgress };
  assert.equal(deriveWizardState({...base,activePositions:0,inspectedEmployeeMaster:false,unresolvedDepartmentLabels:1}).ready,true);
  assert.equal(deriveWizardState({...base,activeDepartments:0}).ready,false);
  assert.equal(deriveWizardState({...base,activePropertyAdministrator:false}).ready,false);
  assert.equal(deriveWizardState(base).ready,true);
});

test("production inspection stages source-label mappings but never employees", async () => {
  const [route, boundary] = await Promise.all([
    readFile(new URL("../app/api/import/inspect/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/services/import/neon-import-inspection-boundary.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /inspectAndStageWorkbookInNeon/);
  assert.match(boundary, /sourceLabels/);
  assert.match(boundary, /resolutionType:\s*"department"/);
  assert.match(boundary, /resolutionType:\s*"position"/);
  assert.doesNotMatch(boundary, /department_aliases|position_aliases/);
  assert.doesNotMatch(boundary, /from\(["']employees["']\).*insert/s);
});
