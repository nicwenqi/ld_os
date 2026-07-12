import assert from "node:assert/strict";
import test from "node:test";

import { dataSourceForModule } from "../app/repositories/registry.ts";

test("Review Stop 2C-A activates real data only for Hotel Settings", () => {
  assert.equal(dataSourceForModule("hotel-settings", "hybrid"), "supabase");
  for (const moduleName of [
    "executive-dashboard", "organization-dashboard", "calendar", "sessions", "qr-check-in",
    "qr-feedback", "risk", "course-effectiveness", "kpi", "people", "import",
  ]) assert.equal(dataSourceForModule(moduleName, "hybrid"), "mock", moduleName);
});

test("mock mode never selects a Supabase repository", () => {
  assert.equal(dataSourceForModule("hotel-settings", "mock"), "mock");
  assert.equal(dataSourceForModule("people", "mock"), "mock");
});
