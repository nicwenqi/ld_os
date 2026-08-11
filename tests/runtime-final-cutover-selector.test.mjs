import assert from "node:assert/strict";
import test from "node:test";

import { parseAppEnvironment } from "../app/lib/environment.ts";
import {
  resolveRuntimeDomainSelection,
} from "../app/lib/runtime-rehearsal-mode.ts";
import {
  createRetriableRuntimeDomainRegistryLoader,
  loadRuntimeDomainRegistryWith,
} from "../app/repositories/runtime/load-domain-registry.ts";

const realData = {
  PREVIEW_PROPERTY_HOSTNAME: "preview.hotel.example.test",
};

const allNeonDomains = {
  organization: "neon",
  people: "neon",
  position: "neon",
  employee: "neon",
  import: "neon",
  property: "neon",
  initialization: "neon",
};

test("enabled preview Neon selection gives every business domain the Neon source", () => {
  const environment = parseAppEnvironment({
    ...realData,
    APP_ENV: "preview",
    APP_DATA_MODE: "neon",
  });

  assert.deepEqual(
    resolveRuntimeDomainSelection(environment, {
      APP_DATA_MODE: "neon",
      APP_RUNTIME_REHEARSAL: "enabled",
    }),
    { source: "neon", domains: allNeonDomains },
  );
});

test("Neon selection without explicit rehearsal fails closed", () => {
  const environment = parseAppEnvironment({
    ...realData,
    APP_ENV: "preview",
    APP_DATA_MODE: "neon",
  });

  assert.throws(
    () => resolveRuntimeDomainSelection(environment, { APP_DATA_MODE: "neon" }),
    /APP_RUNTIME_REHEARSAL=enabled/,
  );
});

test("Production hard-denies the Neon rehearsal selection", () => {
  const environment = parseAppEnvironment({
    ...realData,
    APP_ENV: "production",
    APP_DATA_MODE: "neon",
  });

  assert.throws(
    () => resolveRuntimeDomainSelection(environment, {
      APP_DATA_MODE: "neon",
      APP_RUNTIME_REHEARSAL: "enabled",
    }),
    /denied in production/,
  );
});

test("removed fallback data modes fail before runtime selection", () => {
  assert.throws(
    () => parseAppEnvironment({ ...realData, APP_ENV: "preview", APP_DATA_MODE: "supabase" }),
    /APP_DATA_MODE must be mock or neon/,
  );
});

test("a Neon registry failure stays visible and never invokes a fallback loader", async () => {

  await assert.rejects(
    () => loadRuntimeDomainRegistryWith({
      fetchMode: async () => ({
        ok: true,
        json: async () => ({ source: "neon", domains: allNeonDomains }),
      }),
      createNeon: async () => {
        throw new Error("Neon unavailable");
      },
      createMock: async () => ({}),
    }),
    /Neon unavailable/,
  );

});

test("a later retry creates a fresh loader attempt after a rejected runtime selection", async () => {
  let attempts = 0;
  const registry = { source: "neon" };
  const load = createRetriableRuntimeDomainRegistryLoader(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("Neon unavailable");
    return registry;
  });

  await assert.rejects(load, /Neon unavailable/);
  assert.equal(await load(), registry);
  assert.equal(attempts, 2);
});
