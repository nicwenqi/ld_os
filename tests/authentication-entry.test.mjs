import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { homeForRole, canRoleAccessPath } from "../app/services/auth-routing.ts";
import { authenticateSyntheticAccount } from "../app/services/authentication-service.ts";
import { deriveWizardState } from "../app/services/initialization-wizard-service.ts";

const identity={nameZh:"示范酒店",nameEn:"Synthetic Hotel",shortName:"示范",code:"demo",brand:"Demo",city:"测试城市",countryRegion:"CN",timezone:"Asia/Shanghai",defaultLanguage:"zh-CN"};
const rules={newEmployeeDays:90,probationFieldMeaning:"confirmation_date",employeeStatusSource:"manual",ctcMandatory:true,gtcMandatory:true};

test("effective roles route to fixed server-authorized homes",()=>{
  assert.equal(homeForRole("platform_admin"),"/platform");
  assert.equal(homeForRole("tenant_admin"),"/");
  assert.equal(homeForRole("property_ld_manager"),"/");
  assert.equal(homeForRole("department_training_admin"),"/department");
  assert.equal(homeForRole("employee"),"/my-training");
  assert.equal(homeForRole("unauthorized"),"/access-denied");
  assert.equal(canRoleAccessPath("department_training_admin","/import"),false);
  assert.equal(canRoleAccessPath("employee","/settings/hotel"),false);
  assert.equal(canRoleAccessPath("property_ld_manager","/initialize"),true);
});

test("local synthetic authentication is gated and does not reveal account existence",async()=>{
  await assert.rejects(()=>authenticateSyntheticAccount({loginId:"property-manager",password:"wrong-pass",hostname:"training-demo.example.test",appEnv:"local",dataMode:"mock"}),/账号或密码错误/);
  await assert.rejects(()=>authenticateSyntheticAccount({loginId:"disabled-user",password:"HotelDemo2026",hostname:"training-demo.example.test",appEnv:"local",dataMode:"mock"}),/账号或密码错误/);
  await assert.rejects(()=>authenticateSyntheticAccount({loginId:"property-manager",password:"HotelDemo2026",hostname:"training-demo.example.test",appEnv:"preview",dataMode:"mock"}),/本地合成登录不可用/);
  const session=await authenticateSyntheticAccount({loginId:"property-manager",password:"HotelDemo2026",hostname:"training-demo.example.test",appEnv:"local",dataMode:"mock"});
  assert.equal(session.role,"property_ld_manager");
  assert.equal(session.internalAuthIdentity,undefined);
});

test("minimum readiness no longer requires operational onboarding completion",()=>{
  const progress={lastActiveStep:3,steps:{organization:{explicitlyConfirmed:true}}};
  const state=deriveWizardState({identity,rules,activeDepartments:1,activePositions:0,inspectedEmployeeMaster:false,unresolvedDepartmentLabels:2,unresolvedPositionLabels:3,activePropertyAdministrator:true,progress});
  assert.equal(state.minimumReady,true);
  assert.equal(state.operationalReady,false);
  assert.equal(state.ready,false);
  assert.match(state.operationalBlockingReasons.join(" "),/职位|工作簿|映射/);
});

test("login page is Chinese-first, branded and contains no selectors or email",async()=>{
  const page=await readFile(new URL("../app/login/page.tsx",import.meta.url),"utf8");
  const css=await readFile(new URL("../app/login/login.css",import.meta.url),"utf8");
  for(const token of ["用户 ID","密码","登录","账号或密码错误","账号已停用，请联系管理员","当前账号无权访问此酒店","Hotel Learning & Development OS"]) assert.match(page,new RegExp(token));
  assert.doesNotMatch(page,/type=["']email|角色选择|酒店选择/);
  assert.match(page,/minLength=\{8\}/);
  assert.match(css,/min-height:\s*48px/);
  assert.match(css,/@media\s*\(max-width:\s*760px\)/);
});

test("server login boundary keeps secret resolution out of browser",async()=>{
  const route=await readFile(new URL("../app/api/auth/login/route.ts",import.meta.url),"utf8");
  const server=await readFile(new URL("../app/lib/supabase/server-admin.ts",import.meta.url),"utf8");
  const client=await readFile(new URL("../app/state/auth-session.tsx",import.meta.url),"utf8");
  assert.match(route,/resolveAccountForLogin/);
  assert.match(server,/SUPABASE_SECRET_KEY/);
  assert.match(server,/persistSession:\s*false/);
  assert.doesNotMatch(client,/SUPABASE_SECRET_KEY|service_role|internalAuthIdentity|\.internal/);
  assert.doesNotMatch(route,/user_metadata/);
});

test("root and role pages express the recovered entry behavior",async()=>{
  const root=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
  const department=await readFile(new URL("../app/department/page.tsx",import.meta.url),"utf8");
  const employee=await readFile(new URL("../app/my-training/page.tsx",import.meta.url),"utf8");
  const denied=await readFile(new URL("../app/access-denied/page.tsx",import.meta.url),"utf8");
  assert.match(root,/InitializationStatusCard/);
  assert.doesNotMatch(root,/replace\([^)]*initialize/);
  assert.match(department,/部门培训工作台/);
  assert.match(employee,/我的学习/);
  assert.match(denied,/当前账号无权访问此酒店/);
});

test("every authenticated role landing page exposes a logout action",async()=>{
  for(const route of ["department","my-training","platform","access-denied"]){
    const source=await readFile(new URL(`../app/${route}/page.tsx`,import.meta.url),"utf8");
    assert.match(source,/退出登录/);
    assert.match(source,/logout\(\)/);
  }
});

test("normal navigation is role-aware and has no simulated role switcher",async()=>{
  const shell=await readFile(new URL("../app/components/shell/AppShell.tsx",import.meta.url),"utf8");
  const navigation=await readFile(new URL("../app/services/role-navigation.ts",import.meta.url),"utf8");
  assert.doesNotMatch(shell,/RoleSwitcher|useMockRole/);
  for(const token of ["学习与发展总览","酒店设置","组织与人员基础","用户与权限","数据管理"]) assert.match(navigation,new RegExp(token));
  assert.match(shell,/logout/);
});

test("initialization remains an administrator tool with return and persisted save states",async()=>{
  const page=await readFile(new URL("../app/initialize/page.tsx",import.meta.url),"utf8");
  const saveState=await readFile(new URL("../app/services/save-state.ts",import.meta.url),"utf8");
  assert.match(page,/返回运营首页/);
  assert.doesNotMatch(page,/useMockRole/);
  assert.match(page,/const current\s*=\s*state\.steps\[step\s*-\s*1\]/);
  for(const token of ["未修改","有未保存更改","保存中","已保存","保存失败，点击重试"]) assert.match(saveState,new RegExp(token));
  assert.match(page,/re-read|reload|load\(/i);
});

test("production sources do not expose fake role selectors or service secrets",async()=>{
  const providers=await readFile(new URL("../app/providers.tsx",import.meta.url),"utf8");
  const environment=await readFile(new URL("../app/lib/environment.ts",import.meta.url),"utf8");
  const serverEnvironment=await readFile(new URL("../app/lib/supabase/server-admin.ts",import.meta.url),"utf8");
  assert.doesNotMatch(providers,/MockRoleProvider/);
  assert.match(environment,/VERCEL_ENV/);
  assert.match(serverEnvironment,/SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(environment,/NEXT_PUBLIC_SUPABASE_SECRET_KEY/);
});
