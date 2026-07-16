import assert from "node:assert/strict";
import {readFile}from"node:fs/promises";
import test from"node:test";
const read=p=>readFile(new URL(p,import.meta.url),"utf8");

test("Employee Center is a truthful identity-first foundation",async()=>{
  const page=await read("../app/people/page.tsx");
  for(const token of ["员工中心","员工主数据","员工不是后台登录账号","培训数据尚未接入","ProtectedAppProviders","session.propertyId"]) assert.match(page,new RegExp(token));
  assert.doesNotMatch(page,/showToast|useDepartmentScope|synthetic-property-a1|分配培训|创建补训/);
});

test("KPI route suppresses actuals, forecasts and health until sources exist",async()=>{
  const page=await read("../app/kpi/page.tsx");
  assert.match(page,/UnavailableOperationalPage/);
  assert.doesNotMatch(page,/healthScore|departmentTree|保存全部目标|showToast/);
});

test("navigation retains employee and KPI destinations with availability labels",async()=>{
  const nav=await read("../app/services/role-navigation.ts");
  assert.match(nav,/item\("员工"[^\n]*"\/people"[^\n]*"foundation"/);
  assert.match(nav,/item\("KPI 与目标"[^\n]*"\/kpi"[^\n]*"unavailable"/);
});
