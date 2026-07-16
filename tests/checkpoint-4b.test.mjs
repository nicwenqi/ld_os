import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = path => readFile(new URL(path,import.meta.url),"utf8");

test("organization and position management keep validated real repository actions",async()=>{
  const [organization,positions]=await Promise.all([read("../app/organization/page.tsx"),read("../app/positions/page.tsx")]);
  for(const label of ["组织架构","正式部门架构","运营单元","registry.department","AdministrationSaveState"]) assert.match(organization,new RegExp(label.replace(".","\\.")));
  for(const label of ["职位体系","职位族","正式职位","适用部门","registry.position","AdministrationSaveState"]) assert.match(positions,new RegExp(label.replace(".","\\.")));
  assert.doesNotMatch(`${organization}${positions}`,/切换体验角色|合成培训员|邀请账号面板已打开|部门范围预览已打开/);
});

test("accounts and department scopes are real and preserve hotel access protections",async()=>{
  const [page,service]=await Promise.all([read("../app/accounts/page.tsx"),read("../app/services/account-administration.ts")]);
  for(const token of ["账号与部门授权","新增后台账号","部门授权范围","包含下级部门","普通员工","最后一位活动经理","当前账号角色不可在此修改"]) assert.match(page,new RegExp(token));
  assert.match(page,/createBackendAccount|updateBackendAccount/);
  for(const token of ["property_ld_manager","department_training_admin","includeDescendants","temporaryPassword"]) assert.match(service,new RegExp(token));
  assert.doesNotMatch(page,/employee_participant|员工登录|共享管理员/);
});

test("employee data update separates real inspection from later Recovery C work",async()=>{
  const page=await read("../app/import/page.tsx");
  for (const token of ["员工资料更新","文件检查","employeesImported","员工更新尚未提交","Recovery C","培训历史"]) assert.match(page,new RegExp(token));
  assert.doesNotMatch(page,/commitBatch|确认导入|synthetic-batch-202607/);
});

test("administration navigation has real query destinations and no hashes",async()=>{
  const nav=await read("../app/services/role-navigation.ts");
  for(const token of ["员工资料更新","组织架构","职位体系","账号与部门授权","酒店设置","酒店启用","/organization","/positions","/accounts","/settings/hotel","/initialize"]) assert.match(nav,new RegExp(token));
  assert.doesNotMatch(nav,/#/);
});
