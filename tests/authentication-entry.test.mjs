import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { homeForRole, canRoleAccessPath } from "../app/services/auth-routing.ts";
import { authenticateSyntheticAccount } from "../app/services/authentication-service.ts";
import { canReleaseBrowserAccessToken } from "../app/services/request-authentication.ts";
import { deriveWizardState } from "../app/services/initialization-wizard-service.ts";
import {
  createMockSession,
  readMockSession,
} from "../app/api/auth/mock-session-store.ts";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const identity={nameZh:"示范酒店",nameEn:"Synthetic Hotel",shortName:"示范",code:"demo",brand:"Demo",city:"测试城市",countryRegion:"CN",timezone:"Asia/Shanghai",defaultLanguage:"zh-CN"};
const rules={newEmployeeDays:90,probationFieldMeaning:"confirmation_date",employeeStatusSource:"manual",ctcMandatory:true,gtcMandatory:true};

test("only the two approved authenticated roles have workspaces",()=>{
  assert.equal(homeForRole("property_ld_manager"),"/");
  assert.equal(homeForRole("department_training_responsible"),"/department");
  assert.equal(homeForRole("unauthorized"),"/access-denied");
  assert.equal(canRoleAccessPath("department_training_responsible","/import"),false);
  assert.equal(canRoleAccessPath("department_training_responsible","/settings/hotel"),false);
  assert.equal(canRoleAccessPath("property_ld_manager","/initialize"),true);
});

test("local synthetic authentication is gated and has no employee or platform account",async()=>{
  for (const loginId of ["employee", "platform-admin", "tenant-admin"]) {
    await assert.rejects(()=>authenticateSyntheticAccount({loginId,password:"HotelDemo2026",hostname:"training-demo.example.test",appEnv:"local",dataMode:"mock"}),/账号或密码错误/);
  }
  await assert.rejects(()=>authenticateSyntheticAccount({loginId:"disabled-user",password:"HotelDemo2026",hostname:"training-demo.example.test",appEnv:"local",dataMode:"mock"}),/账号或密码错误/);
  await assert.rejects(()=>authenticateSyntheticAccount({loginId:"property-manager",password:"HotelDemo2026",hostname:"training-demo.example.test",appEnv:"preview",dataMode:"mock"}),/本地合成登录不可用/);
  const session=await authenticateSyntheticAccount({loginId:"department-responsible",password:"HotelDemo2026",hostname:"training-demo.example.test",appEnv:"local",dataMode:"mock"});
  assert.equal(session.role,"department_training_responsible");
  assert.equal(session.departmentScopes.length,1);
  assert.equal(session.internalAuthIdentity,undefined);
});

test("local-review sessions survive serverless instance changes without widening role scope", async () => {
  const manager = await authenticateSyntheticAccount({
    loginId: "property-manager",
    password: "HotelDemo2026",
    hostname: "training-demo.example.test",
    appEnv: "local",
    dataMode: "mock",
  });
  const token = createMockSession(manager);
  assert.deepEqual(readMockSession(token), manager);
  assert.equal(readMockSession(`${token}tampered`), null);

  const forged = createMockSession({
    ...manager,
    userId: "synthetic-department-responsible",
    role: "property_ld_manager",
  });
  assert.equal(readMockSession(forged), null);
});

test("minimum readiness does not hijack operational entry",()=>{
  const progress={lastActiveStep:3,steps:{organization:{explicitlyConfirmed:true}}};
  const state=deriveWizardState({identity,rules,activeDepartments:1,activePositions:0,inspectedEmployeeMaster:false,unresolvedDepartmentLabels:2,unresolvedPositionLabels:3,activePropertyAdministrator:true,progress});
  assert.equal(state.minimumReady,true);
  assert.equal(state.operationalReady,false);
  assert.equal(state.ready,true);
});

test("login is Chinese-first User ID and password with no selectors or email",async()=>{
  const page=await read("../app/login/page.tsx");
  const css=await read("../app/login/login.css");
  for(const token of ["用户 ID","密码","登录","账号或密码错误","Hotel Learning & Development OS","safeReturnToForRole"]) assert.match(page,new RegExp(token));
  assert.doesNotMatch(page,/type=["']email|角色选择|酒店选择|Magic Link|OTP/);
  assert.match(page,/minLength=\{8\}/);
  assert.match(page,/<form onSubmit=\{submit\} method="post">/);
  assert.match(css,/min-height:\s*48px/);
});

test("server login keeps technical identities outside the browser",async()=>{
  const route=await read("../app/api/auth/login/route.ts");
  const server=await read("../app/lib/supabase/server-admin.ts");
  const client=await read("../app/state/auth-session.tsx");
  assert.match(route,/resolveAccountForLogin/);
  assert.match(server,/SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(client,/SUPABASE_SECRET_KEY|service_role|internalAuthIdentity|\.internal/);
});

test("browser repository tokens are released only to the two approved application roles", async () => {
  const base = {
    authenticated: true,
    userId: "user-a",
    displayName: "User",
    propertyId: "property-a",
    propertyNameZh: "酒店",
    propertyNameEn: "Hotel",
    propertyLogoUrl: null,
    departmentScopes: [],
    mustChangePassword: false,
  };
  assert.equal(canReleaseBrowserAccessToken({ ...base, role: "property_ld_manager" }), true);
  assert.equal(
    canReleaseBrowserAccessToken({
      ...base,
      role: "department_training_responsible",
      departmentScopes: [{
        departmentId: "front-office",
        departmentNameZh: "前厅部",
        departmentNameEn: "Front Office",
        breadcrumb: ["前厅部"],
        breadcrumbEn: ["Front Office"],
        includeDescendants: false,
      }],
    }),
    true,
  );
  assert.equal(canReleaseBrowserAccessToken({ ...base, role: "unauthorized" }), false);
  assert.equal(
    canReleaseBrowserAccessToken({ ...base, authenticated: false, role: "property_ld_manager" }),
    false,
  );
  assert.equal(
    canReleaseBrowserAccessToken({ ...base, propertyId: null, role: "property_ld_manager" }),
    false,
  );
  assert.equal(
    canReleaseBrowserAccessToken({
      ...base,
      role: "property_ld_manager",
      mustChangePassword: true,
    }),
    false,
  );
  assert.equal(
    canReleaseBrowserAccessToken({
      ...base,
      role: "department_training_responsible",
      mustChangePassword: true,
    }),
    false,
  );

  const [route, guard] = await Promise.all([
    read("../app/api/auth/access-token/route.ts"),
    read("../app/services/request-authentication.ts"),
  ]);
  assert.match(route, /resolveAuthenticatedRequest/);
  assert.match(guard, /resolveBackendRequest\(request, false\)/);
  assert.match(guard, /!session\.mustChangePassword/);
});

test("local login resolves the same hotel-branded property context as authentication",async()=>{
  const route=await read("../app/api/property/context/route.ts");
  assert.match(route,/getMockPropertyContext/);
  assert.match(route,/environment\.dataMode === "mock"/);
});

test("approved landing pages are truthful and obsolete workspaces are absent",async()=>{
  const [root,department,denied,shell]=await Promise.all([read("../app/page.tsx"),read("../app/department/page.tsx"),read("../app/access-denied/page.tsx"),read("../app/components/shell/AppShell.tsx")]);
  assert.match(root,/培训运营判断等待真实事实/);
  assert.match(root,/尚未接入的培训运营事实/);
  assert.doesNotMatch(root,/当前无法判断酒店培训运营是否受控/);
  assert.doesNotMatch(root,/InitializationStatusCard|replace\([^)]*initialize/);
  assert.match(department,/部门工作台/);
  assert.match(denied,/当前账号没有可用的酒店后台角色/);
  assert.match(shell,/logout/);
  for (const route of ["my-training","platform","check-in/session-1","feedback/session-1"]) {
    await assert.rejects(access(new URL(`../app/${route}/page.tsx`, import.meta.url)));
  }
});

test("access denied remains readable at a mobile viewport", async () => {
  const css = await read("../app/role-entry.css");
  assert.match(css, /\.role-entry-card\{[^}]*width:100%;[^}]*max-width:880px/);
  assert.match(css, /\.role-entry-card\{[^}]*box-sizing:border-box/);
});

test("navigation is role-aware, frequency-led and contains no role switcher",async()=>{
  const [shell,navigation]=await Promise.all([read("../app/components/shell/AppShell.tsx"),read("../app/services/role-navigation.ts")]);
  assert.doesNotMatch(shell,/RoleSwitcher|useMockRole|DepartmentScopePicker|showToast/);
  for(const token of ["日常运营","周期复盘","管理设置","部门运营","部门培训负责人"]) assert.match(`${shell}${navigation}`,new RegExp(token));
});

test("initialization remains a manager tool with a real return and save states",async()=>{
  const [page,saveState]=await Promise.all([read("../app/initialize/page.tsx"),read("../app/services/save-state.ts")]);
  assert.match(page,/返回运营首页/);
  assert.doesNotMatch(page,/tenant_admin|platform_admin/);
  for(const token of ["未修改","有未保存更改","保存中","已保存","保存失败，点击重试","保存冲突，请重新读取"]) assert.match(saveState,new RegExp(token));
});

test("hotel authentication uses only the approved identity and actor RPC boundary", async () => {
  const [service, requestAuthentication, sessionRoute] = await Promise.all([
    read("../app/services/authentication-service.ts"),
    read("../app/services/request-authentication.ts"),
    read("../app/api/auth/session/route.ts"),
  ]);
  assert.match(service, /rpc\(\s*["']resolve_hotel_login_identity["']/);
  assert.match(service, /rpc\(\s*["']resolve_hotel_application_session["']/);
  assert.match(service, /rpc\(\s*["']record_hotel_login_success["']/);
  assert.doesNotMatch(
    service,
    /\.from\(["'](?:property_domains|user_accounts|profiles|tenant_memberships|property_memberships|role_assignments|trainer_scopes|departments)["']\)/,
  );
  assert.doesNotMatch(service, /resolveSessionForAuthUser/);
  assert.match(requestAuthentication, /resolveSessionForAccessToken\(identity\.accessToken, identity\.hostname\)/);
  assert.match(sessionRoute, /resolveSessionForAccessToken\(identity\.accessToken,identity\.hostname\)/);
});

test("hotel session resolution accepts an access token and hostname, never browser authority fields", async () => {
  const service = await read("../app/services/authentication-service.ts");
  assert.match(
    service,
    /resolveSessionForAccessToken\(\s*accessToken:\s*string,\s*hostname:\s*string/,
  );
  assert.doesNotMatch(
    service,
    /resolveSessionForAccessToken\([^)]*(?:userId|propertyId|tenantId|role|departmentId|scope)/,
  );
});

test("the disposable C5-A browser harness uses the server runtime and derives local keys", async () => {
  const [harness, fixture, viteConfig] = await Promise.all([
    read("../scripts/c5a-local-browser-harness.mjs"),
    read("../supabase/snippets/c5a_local_browser_auth_fixture.sql"),
    read("../vite.config.ts"),
  ]);
  assert.match(harness, /command === "serve"/);
  assert.match(harness, /supabase", "status", "-o", "env"/);
  assert.match(harness, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local\.PUBLISHABLE_KEY/);
  assert.match(harness, /SUPABASE_SECRET_KEY: local\.SECRET_KEY/);
  assert.doesNotMatch(harness, /sb_(?:publishable|secret)_/);
  assert.match(harness, /randomBytes/);
  assert.match(fixture, /:'c5a_password'/);
  assert.doesNotMatch(fixture, /encrypted_password\s*=\s*extensions\.crypt\(\s*'/);
  assert.match(viteConfig, /environment\.appEnv === "local" && serverSecret/);
  assert.match(viteConfig, /vars:\s*localServerBindings/);
  assert.doesNotMatch(viteConfig, /browserEnvironmentDefines[^;]*SUPABASE_SECRET_KEY/s);
});
