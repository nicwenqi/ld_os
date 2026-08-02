import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);

async function readAccountMigration() {
  const files = (await readdir(migrationDirectory)).filter(file =>
    file.endsWith("_platform_property_account_management.sql"),
  );
  assert.equal(files.length, 1, "one platform account-management migration must exist");
  return readFile(new URL(files[0], migrationDirectory), "utf8");
}

test("platform account-management migration is narrow, audited, and globally unique", async () => {
  const sql = await readAccountMigration();
  assert.match(sql, /create table public\.platform_account_management_events\b/i);
  assert.match(sql, /create trigger platform_account_management_events_append_only[\s\S]*before update or delete/i);
  assert.match(sql, /create unique index[\s\S]*user_accounts[\s\S]*normalized_login_id/i);
  for (const functionName of [
    "platform_list_properties",
    "platform_list_property_manager_accounts",
    "platform_create_property_manager_account",
    "platform_prepare_manager_password_reset",
    "platform_record_manager_password_reset_result",
    "platform_set_property_manager_status",
    "platform_replace_property_manager",
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${functionName}\\b`, "i"));
    assert.match(sql, new RegExp(`${functionName}[\\s\\S]*assert_platform_provisioner`, "i"));
    assert.match(sql, new RegExp(`${functionName}[\\s\\S]*set search_path = ''`, "i"));
  }
  assert.doesNotMatch(sql, /grant\s+.*on\s+table[\s\S]*to\s+service_role/i);
  assert.match(sql, /revoke all on function public\.platform_list_properties[\s\S]*from public, anon, service_role/i);
});

test("platform account routes use the platform RPC boundary and do not expose hotel facts", async () => {
  const [overview, accountRoute] = await Promise.all([
    readFile(new URL("../app/api/platform/properties/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/properties/[propertyId]/accounts/route.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [overview, accountRoute]) {
    assert.match(source, /requirePlatformProvisioner/);
    assert.match(source, /createServerActorClient/);
    assert.match(source, /\.rpc\(/);
    assert.doesNotMatch(source, /from\(["']employees["']\)|from\(["']departments["']\)|from\(["']training_/);
  }
  assert.doesNotMatch(accountRoute, /internalEmail|auth_user_id|SUPABASE_SECRET_KEY/);
  assert.match(accountRoute, /createServerAdminClient/);
  assert.match(accountRoute, /auth\.admin\.createUser/);
  assert.match(accountRoute, /auth\.admin\.deleteUser/);
});

test("platform console has existing-property routes separate from new-property provisioning", async () => {
  const [index, detail, newProperty] = await Promise.all([
    readFile(new URL("../app/platform/properties/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/platform/properties/[propertyId]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/platform/properties/new/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(index, /已有 Property|Property 管理/);
  assert.match(index, /\/platform\/properties\/new/);
  assert.match(detail, /重置密码|禁用|启用|更换管理员/);
  assert.match(detail, /\/platform\/properties/);
  assert.doesNotMatch(`${index}\n${detail}`, /部门 scope|部门授权范围|员工资料更新|培训场次/);
  assert.match(newProperty, /创建 Pilot Property/);
  assert.match(newProperty, /确认创建 Property 并发出经理交接/);
  const loginRoute = await readFile(new URL("../app/api/platform/auth/login/route.ts", import.meta.url), "utf8");
  assert.match(loginRoute, /destination:\s*["']\/platform\/properties["']/);
});

test("platform manager validation keeps User ID global and Auth email internal", async () => {
  const service = await import("../app/services/platform-property-accounts.ts");
  assert.deepEqual(service.normalizePlatformManagerDraft({
    displayName: "王经理",
    loginId: "wang.manager",
    temporaryPassword: "ValidManager2026",
  }), {
    displayName: "王经理",
    loginId: "wang.manager",
    temporaryPassword: "ValidManager2026",
  });
  assert.throws(() => service.normalizePlatformManagerDraft({
    displayName: "王经理",
    loginId: "bad id",
    temporaryPassword: "ValidManager2026",
  }), /用户 ID/);
  assert.throws(() => service.normalizePlatformManagerDraft({
    displayName: "王经理",
    loginId: "wang.manager",
    temporaryPassword: "short",
    email: "manager@example.com",
  }), /密码/);
  assert.throws(() => service.normalizePlatformManagerDraft({
    displayName: "王经理",
    loginId: "wang.manager",
    temporaryPassword: "ValidManager2026",
    roleCode: "department_training_admin",
  }), /平台仅管理酒店学习与发展经理/);
});

test("platform account lifecycle maps stale and unsafe RPC failures to business-safe HTTP results", async () => {
  const service = await import("../app/services/platform-property-accounts.ts");
  assert.deepEqual(
    service.mapPlatformAccountError({ code: "P0003", message: "PLATFORM_MANAGER_ACCOUNT_STALE" }),
    { status: 409, code: "ACCOUNT_STALE", message: "账号资料已由其他平台管理员更新，请重新读取后再试。" },
  );
  assert.deepEqual(
    service.mapPlatformAccountError({ code: "P5006", message: "P5006: final active hotel L&D manager is protected" }),
    { status: 409, code: "FINAL_MANAGER_PROTECTED", message: "当前 Property 至少需要一位已启用的学习与发展经理。" },
  );
  const fallback = service.mapPlatformAccountError({ code: "XX000", message: "relation auth.users does not exist" });
  assert.equal(fallback.status, 500);
  assert.doesNotMatch(fallback.message, /auth|relation|users/i);
});

test("password reset keeps Auth UUID server-only and cleanup has auditable compensation", async () => {
  const accountRoute = await readFile(new URL("../app/api/platform/properties/[propertyId]/accounts/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(accountRoute, /prepared\?\.authUserId|prepared\.authUserId/);
  assert.match(accountRoute, /resolvePlatformManagerAuthIdentity/);
  assert.match(accountRoute, /recordPlatformManagerAuthCleanup/);
  const files = await readdir(migrationDirectory);
  const hardening = files.find(file => file.endsWith("_platform_property_account_management_hardening.sql"));
  assert.ok(hardening, "a follow-up hardening migration must exist");
  const sql = await readFile(new URL(hardening, migrationDirectory), "utf8");
  assert.match(sql, /platform_record_manager_auth_cleanup_result/i);
  assert.match(sql, /manager_create_auth_cleanup_failed/i);
  assert.match(sql, /manager_replace_auth_cleanup_failed/i);
  assert.match(sql, /'eventId',\s*event_id[\s\S]*'version'/i);
  assert.doesNotMatch(sql, /'authUserId'/i);
});
