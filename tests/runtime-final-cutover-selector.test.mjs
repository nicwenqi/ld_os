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
  NEXT_PUBLIC_SUPABASE_URL: "https://auth-adapter.example.test",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
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

test("Neon selection without explicit rehearsal fails closed instead of selecting Supabase", () => {
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

test("Supabase fallback is selected only by an explicit Supabase data mode", () => {
  const environment = parseAppEnvironment({
    ...realData,
    APP_ENV: "preview",
    APP_DATA_MODE: "supabase",
  });

  assert.equal(
    resolveRuntimeDomainSelection(environment, {}).source,
    "supabase",
  );
});

test("a Neon registry failure stays visible and never invokes the Supabase loader", async () => {
  let supabaseLoads = 0;

  await assert.rejects(
    () => loadRuntimeDomainRegistryWith({
      fetchMode: async () => ({
        ok: true,
        json: async () => ({ source: "neon", domains: allNeonDomains }),
      }),
      createNeon: async () => {
        throw new Error("Neon unavailable");
      },
      createSupabase: async () => {
        supabaseLoads += 1;
        return {};
      },
      createMock: async () => ({}),
    }),
    /Neon unavailable/,
  );

  assert.equal(supabaseLoads, 0);
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
