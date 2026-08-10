import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("Hotel Settings Center covers identity, branding, rules, and finite activation", async () => {
  const page = await read("../app/settings/hotel/page.tsx");
  for (const token of [
    "酒店设置中心", "基本信息", "酒店标识", "业务规则", "酒店启用", "正式中文名称",
    "正式英文名称", "显示简称", "酒店代码", "品牌", "城市", "国家 / 地区", "时区",
    "默认语言", "新员工定义", "试用期字段含义", "员工状态来源", "CTC", "GTC",
    "保存酒店信息", "保存业务规则", "仅支持 PNG、JPEG 或 WebP", "30 天",
  ]) assert.match(page, new RegExp(token));
  assert.match(page, /RuntimeDomainRegistryBoundary/);
  assert.match(page, /uploadLogo/);
  assert.doesNotMatch(page, /Synthetic tenant|初始化进度/);
});

test("application shell exposes Hotel Settings within the approved Recovery A route set", async () => {
  const shell = await read("../app/components/shell/AppShell.tsx");
  const navigation = await read("../app/services/role-navigation.ts");
  assert.match(navigation, /酒店设置/);
  assert.match(navigation, /\/settings\/hotel/);
  for (const route of ["/calendar", "/sessions", "/people", "/kpi", "/interventions", "/effectiveness"])
    assert.match(navigation, new RegExp(route.replaceAll("/", "\\/")));
  assert.doesNotMatch(navigation, /href:\s*["']\/(organization|risk)["']/);
  assert.match(shell,/navigationForRole/);
});

test("Review Stop 2C-A source and committed seeds contain synthetic property identity only", async () => {
  const seed = await read("../supabase/seed.sql");
  const mock = await read("../app/repositories/mock/property-repository.ts");
  for (const source of [seed, mock]) {
    assert.doesNotMatch(source, /ldchub\.cn/i);
    assert.doesNotMatch(source, /KIP Suzhou|苏州|Suzhou/i);
  }
  assert.match(seed, /demo-a1\.example\.test/);
  assert.match(mock, /training-demo\.example\.test/);
});
