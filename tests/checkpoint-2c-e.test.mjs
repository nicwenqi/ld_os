import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { deriveWizardState } from "../app/services/initialization-wizard-service.ts";
import { filterMappingItems, getMappingSummary, selectHighConfidenceMappings } from "../app/services/mapping-workflow.ts";
import { classifyEmployeeStagingRows, isMissingSourceValue } from "../app/services/import/employee-staging-preview.ts";
import { createMockInitializationRepository } from "../app/repositories/mock/initialization-repository.ts";

const identity = { nameZh:"示范酒店", nameEn:"Synthetic Hotel", shortName:"示范", code:"demo", brand:"Demo", city:"测试城市", countryRegion:"CN", timezone:"Asia/Shanghai", defaultLanguage:"zh-CN" };
const rules = { newEmployeeDays:90, probationFieldMeaning:"confirmation_date", employeeStatusSource:"manual", ctcMandatory:true, gtcMandatory:true };
const progress = steps => ({ lastActiveStep:1, steps });
const facts = overrides => ({ identity, rules, activeDepartments:1, activePositions:1, inspectedEmployeeMaster:true, unresolvedDepartmentLabels:0, unresolvedPositionLabels:0, activePropertyAdministrator:true, progress:progress({ organization:{explicitlyConfirmed:true}, positions:{explicitlyConfirmed:true}, upload:{explicitlyConfirmed:true}, mapping:{explicitlyConfirmed:true}, access:{explicitlyConfirmed:true} }), ...overrides });

test("finite activation separates minimum activation from optional operational readiness", () => {
  const employeePending = deriveWizardState(facts({ activePositions:0, inspectedEmployeeMaster:false, unresolvedDepartmentLabels:2 }));
  assert.equal(employeePending.minimumReady, true);
  assert.equal(employeePending.ready, true);
  assert.equal(employeePending.operationalReady, false);
  assert.equal(employeePending.steps[3].blocked, false);
  assert.equal(employeePending.nextRecommendedAction, "完成酒店启用复核");
});

test("employee preparation facts change optional readiness without blocking activation", () => {
  const uploadPending = deriveWizardState(facts({ inspectedEmployeeMaster:false }));
  assert.equal(uploadPending.steps[3].complete, false);
  assert.equal(uploadPending.ready, true);
  const mappingPending = deriveWizardState(facts({ unresolvedDepartmentLabels:2 }));
  assert.equal(mappingPending.steps[3].blocked, false);
  assert.equal(mappingPending.operationalReady, false);
  const accessPending = deriveWizardState(facts({ activePropertyAdministrator:false }));
  assert.equal(accessPending.steps[2].complete, false);
  assert.equal(accessPending.ready, false);
  assert.match(accessPending.nextRecommendedAction, /管理员账号/);
});

test("official department completion follows the persisted tree fact", () => {
  const complete = deriveWizardState(facts({ progress: progress({}) }));
  assert.equal(complete.steps[1].complete, true);
  assert.equal(complete.ready, true);
});

test("saved step confirmations survive repository reload and change the derived recommendation", async () => {
  const repository=createMockInitializationRepository();
  let saved=await repository.getProgress("20000000-0000-0000-0000-000000000011");
  for(const [stepKey,lastActiveStep] of [["organization",2],["access",3],["upload",4]]) saved=await repository.saveStep({propertyId:"20000000-0000-0000-0000-000000000011",stepKey,lastActiveStep,explicitlyConfirmed:true,expectedVersion:saved.version});
  const reloaded=await repository.getProgress("20000000-0000-0000-0000-000000000011");
  const derived=deriveWizardState(facts({progress:reloaded}));
  assert.equal(reloaded.lastActiveStep,4);
  assert.equal(derived.ready,true);
  assert.equal(derived.nextRecommendedAction,"完成酒店启用复核");
});

const mappings = [
  { id:"d1", type:"department", sourceLabel:"Front Office", affectedRows:25, sourceSheet:"Synthetic Departments", suggestedTarget:"前厅部", confidence:96, suggestionReason:"名称高度匹配", targetLabel:"房务部 / 前厅部", status:"pending", blocked:false },
  { id:"d2", type:"department", sourceLabel:"Unknown Unit", affectedRows:3, sourceSheet:"Synthetic Departments", suggestedTarget:null, confidence:20, suggestionReason:"缺少正式结构", targetLabel:null, status:"blocked", blocked:true },
  { id:"p1", type:"position", sourceLabel:"Guest Agent", affectedRows:12, sourceSheet:"Synthetic Positions", suggestedTarget:"宾客服务专员", confidence:91, suggestionReason:"岗位含义相近", targetLabel:"宾客服务专员", status:"pending", blocked:false },
  { id:"p2", type:"position", sourceLabel:"Legacy", affectedRows:1, sourceSheet:"Synthetic Positions", suggestedTarget:null, confidence:10, suggestionReason:"信息不足", targetLabel:null, status:"deferred", blocked:false },
];

test("mapping workflow supports search, filters, unresolved-only and deterministic sorting", () => {
  assert.deepEqual(filterMappingItems(mappings,{query:"guest",type:"position",status:"all",unresolvedOnly:true,sortBy:"affectedRows"}).map(x=>x.id),["p1"]);
  assert.deepEqual(filterMappingItems(mappings,{query:"",type:"all",status:"pending",unresolvedOnly:false,sortBy:"confidence"}).map(x=>x.id),["d1","p1"]);
  const summary = getMappingSummary(mappings);
  assert.deepEqual(summary,{total:4,resolved:0,pending:2,deferred:1,ignored:0,blocked:1,unresolved:4,affectedRows:41,progressPercent:0});
});

test("batch acceptance applies only to selected, unblocked suggestions at or above threshold", () => {
  assert.deepEqual(selectHighConfidenceMappings(mappings,new Set(["d1","d2","p1","p2"]),90),["d1","p1"]);
  assert.deepEqual(selectHighConfidenceMappings([{...mappings[0],batchEligible:false}],new Set(["d1"]),90),[]);
});

test("mapping workflow paginates and filters a synthetic 143-label workload deterministically", () => {
  const volume=Array.from({length:143},(_,index)=>({id:`synthetic-${index}`,type:index<30?"department":"position",sourceLabel:`Synthetic Label ${String(index+1).padStart(3,"0")}`,affectedRows:(index%17)+1,sourceSheet:index<30?"Synthetic Departments":"Synthetic Positions",suggestedTarget:index%4?"Synthetic target":null,confidence:60+(index%40),suggestionReason:"Synthetic confidence rule",targetLabel:null,status:index%13===0?"deferred":"pending",blocked:index%11===0}));
  const filtered=filterMappingItems(volume,{query:"",type:"all",status:"all",unresolvedOnly:true,sortBy:"affectedRows"});
  assert.equal(filtered.length,143);
  assert.equal(filtered.slice(0,8).length,8);
  assert.equal(filterMappingItems(volume,{query:"",type:"department",status:"all",unresolvedOnly:true,sortBy:"sourceLabel"}).length,30);
  assert.equal(filterMappingItems(volume,{query:"",type:"position",status:"all",unresolvedOnly:true,sortBy:"sourceLabel"}).length,113);
});

test("staging preview distinguishes blank and whitespace-only required values", () => {
  assert.equal(isMissingSourceValue(""),true);
  assert.equal(isMissingSourceValue("   "),true);
  assert.equal(isMissingSourceValue(null),true);
  const preview = classifyEmployeeStagingRows([
    { employeeNumber:"0007",nameZh:"示例员工甲",department:"Front Office",position:"Guest Agent",hireDateValid:true },
    { employeeNumber:"0008",nameZh:"示例员工乙",department:"   ",position:"Guest Agent",hireDateValid:true },
  ]);
  assert.equal(preview.totalCandidates,2);
  assert.equal(preview.structurallyValid,1);
  assert.equal(preview.missingDepartment,1);
  assert.equal(preview.readyAfterMapping,1);
});

test("activation UI has one save-later action and a scalable official-department workspace", async () => {
  const page = await readFile(new URL("../app/initialize/page.tsx",import.meta.url),"utf8");
  const css = await readFile(new URL("../app/initialization-wizard.css",import.meta.url),"utf8");
  const organization = await readFile(new URL("../app/initialize/OrganizationSetupStep.tsx",import.meta.url),"utf8");
  const route = await readFile(new URL("../app/api/local-workbook-inspection/route.ts",import.meta.url),"utf8");
  const progressRoute = await readFile(new URL("../app/api/mock-initialization-progress/route.ts",import.meta.url),"utf8");
  const mockProgressRepository = await readFile(new URL("../app/repositories/mock/initialization-repository.ts",import.meta.url),"utf8");
  const source = `${page}\n${organization}`;
  assert.equal((page.match(/保存并稍后继续/g) ?? []).length,1);
  for (const token of ["新增一级部门","新增下级部门","移动影响预览","员工资料准备不会阻塞酒店启用","启用复核"]) assert.match(source,new RegExp(token));
  assert.match(css,/wizard-organization-editor/);
  assert.match(css,/@media\(max-width:980px\)/);
  assert.match(route,/parseAppEnvironment/);
  assert.match(route,/environment\.dataMode/);
  assert.match(route,/environment\.appEnv/);
  assert.match(route,/Cache-Control/);
  assert.doesNotMatch(route,/service_role|SUPABASE_SERVICE/);
  assert.match(progressRoute,/Cache-Control/);
  assert.match(progressRoute,/parseAppEnvironment/);
  assert.match(progressRoute,/environment\.appEnv/);
  assert.match(progressRoute,/environment\.dataMode/);
  assert.match(progressRoute,/expectedVersion/);
  assert.match(mockProgressRepository,/mock-initialization-progress/);
});
