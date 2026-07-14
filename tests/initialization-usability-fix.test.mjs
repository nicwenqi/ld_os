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
  const [page, workbook, mapping, positions, access, settings] = await Promise.all([
    readFile(new URL("../app/initialize/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/initialize/WorkbookSetupStep.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/initialize/MappingSetupStep.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/initialize/PositionSetupStep.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/initialize/AccessSetupStep.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/settings/hotel/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /uploadLogo/);
  assert.match(page, /PositionSetupStep/);
  assert.match(page, /AccessSetupStep/);
  assert.match(workbook, /\/api\/import\/inspect/);
  assert.doesNotMatch(workbook, /local-workbook-inspection/);
  for (const token of ["选择现有部门", "创建一级部门", "分类为运营单元", "选择正式职位", "仅作为外部 LMS 角色"]) assert.match(mapping, new RegExp(token));
  assert.doesNotMatch(`${page}\n${mapping}\n${settings}`, /本地示范|面板已打开|不上传生产环境/);
  assert.match(positions, /savePositionFamily/);
  assert.match(positions, /assignPositionToDepartments/);
  assert.match(access, /activePropertyManagers/);
});

test("administrator access is loaded through a restricted server boundary", async () => {
  const [route, contract, repository] = await Promise.all([
    readFile(new URL("../app/api/initialization/access/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/repositories/contracts/initialization-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/repositories/supabase/initialization-repository.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /requireProductionPropertyManager/);
  assert.match(route, /property_ld_manager/);
  assert.doesNotMatch(route, /service.role|user_metadata/i);
  assert.match(contract, /getAccessSummary/);
  assert.match(repository, /\/api\/initialization\/access/);
});

test("readiness blocks false completion when any persisted operational fact is absent", () => {
  const completeProgress = { lastActiveStep:8, steps:{ organization:{explicitlyConfirmed:true}, positions:{explicitlyConfirmed:true}, upload:{explicitlyConfirmed:true}, mapping:{explicitlyConfirmed:true}, access:{explicitlyConfirmed:true} } };
  const base = { identity, rules, activeDepartments:1, activePositions:1, inspectedEmployeeMaster:true, unresolvedDepartmentLabels:0, unresolvedPositionLabels:0, activePropertyAdministrator:true, progress:completeProgress };
  assert.equal(deriveWizardState({...base,activePositions:0}).ready,false);
  assert.equal(deriveWizardState({...base,inspectedEmployeeMaster:false}).ready,false);
  assert.equal(deriveWizardState({...base,unresolvedDepartmentLabels:1}).ready,false);
  assert.equal(deriveWizardState({...base,activePropertyAdministrator:false}).ready,false);
  assert.equal(deriveWizardState(base).ready,true);
});

test("production inspection stages source-label mappings but never employees", async () => {
  const route = await readFile(new URL("../app/api/import/inspect/route.ts", import.meta.url), "utf8");
  assert.match(route, /department_aliases/);
  assert.match(route, /position_aliases/);
  assert.match(route, /source_batch_id/);
  assert.doesNotMatch(route, /from\(["']employees["']\).*insert/s);
});
