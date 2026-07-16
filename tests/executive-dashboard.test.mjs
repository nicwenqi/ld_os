import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manager home leads with a truthful operating judgment",async()=>{
  const page=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
  for (const token of ["培训运营判断等待真实事实","酒店基础状态不完整，培训运营判断暂不可用","酒店基础准备","尚未接入的培训运营事实","下一步","数据更新于"]) assert.match(page,new RegExp(token));
  assert.doesNotMatch(page,/当前无法判断酒店培训运营是否受控/);
  assert.doesNotMatch(page,/healthScore|培训健康度为|实际值|较上月|风险排名|showToast/);
});

test("home synthesizes connected foundations without inventing training results",async()=>{
  const page=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
  for (const token of ["activeDepartments","activeEmployees","activePositions","unresolvedMappings","DataStateBadge"]) assert.match(page,new RegExp(token));
  for (const fake of ["4.2","91.8","scopeProfiles","department-comparison","risk-ranking"]) assert.doesNotMatch(page,new RegExp(fake));
});
