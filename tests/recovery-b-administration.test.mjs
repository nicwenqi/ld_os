import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("manager administration navigation uses dedicated Recovery B destinations", async () => {
  const navigation = await read("../app/services/role-navigation.ts");
  for (const [label, href] of [
    ["组织架构", "/organization"],
    ["职位体系", "/positions"],
    ["账号与部门授权", "/accounts"],
    ["酒店设置", "/settings/hotel"],
    ["酒店启用", "/initialize"],
  ]) {
    assert.match(navigation, new RegExp(label));
    assert.match(navigation, new RegExp(href.replace("/", "\\/")));
  }
  assert.doesNotMatch(navigation, /permissions\?section=/);
});

test("legacy permissions route is a compatibility redirect, not a dense workspace", async () => {
  const page = await read("../app/permissions/page.tsx");
  assert.match(page, /redirect\(["']\/organization["']\)/);
  assert.doesNotMatch(page, /OrganizationWorkspace|账号与部门授权管理尚未在此页面接入/);
});

test("organization and position administration expose real persistent editors", async () => {
  const [organization, positions, saveState] = await Promise.all([
    read("../app/organization/page.tsx"),
    read("../app/positions/page.tsx"),
    read("../app/components/administration/AdministrationSaveState.tsx"),
  ]);

  for (const token of [
    "正式部门架构",
    "运营单元",
    "registry.department",
    "expectedVersion",
    "有未保存更改",
  ]) assert.match(`${organization}${saveState}`, new RegExp(token));

  for (const token of [
    "职位族",
    "正式职位",
    "适用部门",
    "registry.position",
    "version",
    "有未保存更改",
  ]) assert.match(positions, new RegExp(token));

  assert.doesNotMatch(positions, /nameZh:\s*["']新正式职位["']/);
  assert.doesNotMatch(organization, /员工影响占位|合成员工受影响/);
});

test("account administration is restricted to the two approved backend roles", async () => {
  const [page, route, service] = await Promise.all([
    read("../app/accounts/page.tsx"),
    read("../app/api/admin/accounts/route.ts"),
    read("../app/services/account-administration.ts"),
  ]);

  for (const token of [
    "酒店学习与发展经理",
    "部门培训负责人",
    "部门授权范围",
    "includeDescendants",
  ]) assert.match(page, new RegExp(token.replace("/", "\\/")));
  assert.match(service, /\/api\/admin\/accounts/);

  assert.match(route, /requirePropertyManager/);
  assert.match(route, /requireLocalReviewManager/);
  assert.match(route, /Neon-first 初始化 operator/);
  assert.doesNotMatch(route, /auth\.admin|create_property_backend_account_foundation|update_property_backend_account|\.from\s*\(/);
  assert.doesNotMatch(route, /employee_participant|property_member/);
  assert.match(service, /property_ld_manager/);
  assert.match(service, /department_training_admin/);
  assert.doesNotMatch(service, /employee_participant|property_member/);
});

test("Recovery B administration visual layer is responsive and readable", async () => {
  const [globals, css] = await Promise.all([
    read("../app/globals.css"),
    read("../app/recovery-b.css"),
  ]);
  assert.match(globals, /recovery-b\.css/);
  for (const token of [
    "administration-page",
    "administration-hero",
    "organization-admin-layout",
    "position-admin-layout",
    "account-admin-layout",
    "@media(max-width:900px)",
    "@media(max-width:640px)",
    "min-height:44px",
  ]) assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
