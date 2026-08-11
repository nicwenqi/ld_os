import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("wizard navigation is independent from step confirmation and responds immediately", async () => {
  const page = await readFile(new URL("app/initialize/page.tsx", root), "utf8");
  const contract = await readFile(new URL("app/repositories/contracts/initialization-repository.ts", root), "utf8");
  const adapter = await readFile(new URL("app/repositories/neon/initialization-repository.ts", root), "utf8");
  const migration = await readFile(new URL("neon/canonical/080_property_initialization.sql", root), "utf8");

  assert.match(contract, /saveNavigation\(/);
  assert.match(adapter, /save_neon_initialization_navigation/);
  assert.match(migration, /save_neon_initialization_navigation/);
  assert.match(page, /Math\.min\(5/);
  assert.match(page, /saveNavigation/);
  assert.doesNotMatch(page, /stepKey:stepKeys\[Math\.min\(step - 1, 7\)\]/);
});

test("readiness review actions remain real navigation controls", async () => {
  const page = await readFile(new URL("app/initialize/page.tsx", root), "utf8");
  assert.match(page, /button[^>]+onClick=\{\(\)=>void changeStep\(item\.number\)\}>查看<\/button>/);
});
