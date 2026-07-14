import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("wizard navigation is independent from step confirmation and responds immediately", async () => {
  const page = await readFile(new URL("app/initialize/page.tsx", root), "utf8");
  const contract = await readFile(new URL("app/repositories/contracts/initialization-repository.ts", root), "utf8");
  const adapter = await readFile(new URL("app/repositories/supabase/initialization-repository.ts", root), "utf8");
  const migrationNames = await readdir(new URL("supabase/migrations/", root));
  const migrationSources = await Promise.all(migrationNames.map(name => readFile(new URL(`supabase/migrations/${name}`, root), "utf8")));

  assert.match(contract, /saveNavigation\(/);
  assert.match(adapter, /save_property_initialization_navigation/);
  assert.match(migrationSources.join("\n"), /create or replace function public\.save_property_initialization_navigation/);
  assert.match(page, /setStep\(next\);[\s\S]*saveNavigation/);
  assert.doesNotMatch(page, /stepKey:stepKeys\[Math\.min\(step - 1, 7\)\]/);
});

test("readiness review actions remain real navigation controls", async () => {
  const page = await readFile(new URL("app/initialize/page.tsx", root), "utf8");
  assert.match(page, /button[^>]+onClick=\{\(\)=>void changeStep\(item\.number\)\}>查看<\/button>/);
});
