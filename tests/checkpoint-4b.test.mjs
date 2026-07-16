import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = path => readFile(new URL(path,import.meta.url),"utf8");

test("organization and position management keep validated real repository actions",async()=>{
  const page=await read("../app/permissions/page.tsx");
  for(const label of ["组织、职位与访问管理","正式部门架构","部门归属维护","职位与职位族","registry.department","registry.position"]) assert.match(page,new RegExp(label.replace(".","\\.")));
  assert.doesNotMatch(page,/切换体验角色|合成培训员|邀请账号面板已打开|部门范围预览已打开/);
});

test("accounts and roles are explicitly unavailable instead of mocked",async()=>{
  const page=await read("../app/permissions/page.tsx");
  assert.match(page,/账号与部门授权管理尚未在此页面接入/);
  assert.match(page,/普通员工.*后台应用账号/s);
  assert.match(page,/disabled title="账号管理将在 Recovery B/);
});

test("employee data update separates real inspection from later Recovery C work",async()=>{
  const page=await read("../app/import/page.tsx");
  for (const token of ["员工资料更新","文件检查","employeesImported","员工更新尚未提交","Recovery C","培训历史"]) assert.match(page,new RegExp(token));
  assert.doesNotMatch(page,/commitBatch|确认导入|synthetic-batch-202607/);
});

test("administration navigation has real query destinations and no hashes",async()=>{
  const nav=await read("../app/services/role-navigation.ts");
  for(const token of ["员工资料更新","组织与职位","账号与角色","酒店设置","启用与系统检查"]) assert.match(nav,new RegExp(token));
  assert.doesNotMatch(nav,/#/);
});
