import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatFoundationCount,
  foundationPresentationState,
} from "../app/services/foundation-readiness.ts";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("manager home starts with a truthful operating judgment", async () => {
  const page = await read("../app/page.tsx");
  for (const token of [
    "运营工作台",
    "当前无法判断酒店培训运营是否受控",
    "尚未接入真实数据",
    "酒店基础准备",
    "下一步",
    "数据更新于",
    "loadFoundationReadiness",
  ]) {
    assert.match(page, new RegExp(token));
  }
  for (const obsolete of [
    "scopeProfiles",
    "health-orbit",
    "培训健康度为",
    "risk-ranking",
    "4.2",
    "91.8",
    "较上月",
  ]) {
    assert.doesNotMatch(page, new RegExp(obsolete));
  }
  assert.doesNotMatch(page, /InitializationStatusCard|showToast/);
});

test("missing foundation facts remain unavailable rather than becoming zero", () => {
  assert.equal(formatFoundationCount(null), "—");
  assert.equal(formatFoundationCount(undefined), "—");
  assert.equal(formatFoundationCount(0), "0");
  assert.equal(foundationPresentationState("mock", false), "demo");
  assert.equal(foundationPresentationState("supabase", false), "real");
  assert.equal(foundationPresentationState("supabase", true), "partial");
});

test("foundation loader degrades by source and reads only approved repositories", async () => {
  const service = await read("../app/services/foundation-readiness.ts");
  assert.match(service, /Promise\.allSettled/);
  for (const repository of [
    "registry.property",
    "registry.department",
    "registry.position",
    "registry.employee",
    "registry.import",
    "registry.initialization",
  ]) {
    assert.match(service, new RegExp(repository.replace(".", "\\.")));
  }
  assert.doesNotMatch(service, /attendance|feedback|forecast|healthScore|trainingHours/);
  assert.doesNotMatch(service, /\?\?\s*0/);
});

test("manager home styling is premium and responsive without metric theatre", async () => {
  const css = await read("../app/recovery-a.css");
  for (const token of [
    "manager-command-center",
    "operating-verdict",
    "foundation-facts-grid",
    "availability-grid",
    "@media(max-width:760px)",
  ]) {
    assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
