import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("C1 platform provisioning UI is a separate, scoped, mobile-safe control plane", async () => {
  const [login, provisioning, styles, route] = await Promise.all([
    readFile("app/platform/login/page.tsx", "utf8"),
    readFile("app/platform/properties/new/page.tsx", "utf8"),
    readFile("app/platform/platform.css", "utf8"),
    readFile("app/api/platform/properties/route.ts", "utf8"),
  ]);

  assert.match(login, /平台开通/);
  assert.match(login, /平台账号/);
  assert.match(provisioning, /创建 Pilot Property/);
  assert.match(provisioning, /预览开通内容/);
  assert.match(provisioning, /确认创建 Property 并发出经理交接/);
  assert.match(route, /本地验证未创建 Property、Auth 用户或酒店业务事实/);
  assert.doesNotMatch(provisioning, /员工资料更新|课程管理|培训场次|出勤与反馈/);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /@media\s*\(max-width:\s*760px\)/);
});

test("C1 platform provisioning UI has no route into hotel business workspaces", async () => {
  const source = await readFile("app/platform/properties/new/page.tsx", "utf8");
  assert.doesNotMatch(source, /href=["']\/(?!platform)|router\.push\(["']\/(?!platform)/);
  assert.match(source, /\/api\/platform\/properties/);
  assert.match(source, /\/api\/platform\/auth\/logout/);
});
