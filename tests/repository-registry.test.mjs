import assert from "node:assert/strict";
import test from "node:test";

import { dataSourceForModule } from "../app/repositories/registry.ts";

test("Review Stop 2C-C keeps performance and training modules on mock data", () => {
  assert.equal(dataSourceForModule("hotel-settings", "hybrid"), "supabase");
  for (const moduleName of [
    "executive-dashboard", "organization-dashboard", "calendar", "sessions", "qr-check-in",
    "qr-feedback", "risk", "course-effectiveness", "kpi",
  ]) assert.equal(dataSourceForModule(moduleName, "hybrid"), "mock", moduleName);
});

test("mock mode never selects a Supabase repository", () => {
  assert.equal(dataSourceForModule("hotel-settings", "mock"), "mock");
  assert.equal(dataSourceForModule("people", "mock"), "mock");
});

test("Review Stop 2C-C activates organization, employee master and import repositories in hybrid mode", () => {
  assert.equal(dataSourceForModule("organization-management", "hybrid"), "supabase");
  assert.equal(dataSourceForModule("position-management", "hybrid"), "supabase");
  assert.equal(dataSourceForModule("organization-dashboard", "hybrid"), "mock");
  assert.equal(dataSourceForModule("people", "hybrid"), "supabase");
  assert.equal(dataSourceForModule("import", "hybrid"), "supabase");
});
