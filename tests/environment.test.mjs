import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseAppEnvironment } from "../app/lib/environment.ts";

test("mock mode remains the safe default without external provider credentials", () => {
  assert.deepEqual(parseAppEnvironment({}), {
    appEnv: "local",
    dataMode: "mock",
    appBaseDomain: "ldchub.cn",
    devPropertyHostname: null,
    previewPropertyHostname: null,
  });
});

test("production can never fall back to local-review mock data", () => {
  assert.throws(
    () => parseAppEnvironment({ VERCEL_ENV: "production" }),
    /Production must use the explicit Neon runtime/,
  );
  assert.throws(
    () => parseAppEnvironment({ APP_ENV: "production", APP_DATA_MODE: "mock" }),
    /Production must use the explicit Neon runtime/,
  );
  assert.throws(
    () => parseAppEnvironment({
      APP_ENV: "local",
      APP_DATA_MODE: "mock",
      VERCEL_ENV: "production",
    }),
    /Vercel Production must run with APP_ENV=production/,
  );
});

test("removed legacy data modes are rejected", () => {
  assert.throws(
    () => parseAppEnvironment({ APP_DATA_MODE: "supabase" }),
    /APP_DATA_MODE must be mock or neon/,
  );
  assert.throws(
    () => parseAppEnvironment({ APP_DATA_MODE: "hybrid" }),
    /APP_DATA_MODE must be mock or neon/,
  );
});

test("environment names, URLs, and property hostnames are validated", () => {
  assert.throws(() => parseAppEnvironment({ APP_ENV: "staging" }), /APP_ENV/);
  assert.throws(() => parseAppEnvironment({ APP_DATA_MODE: "real" }), /APP_DATA_MODE/);
  assert.throws(
    () => parseAppEnvironment({ DEV_PROPERTY_HOSTNAME: "https://hotel.example.test/path" }),
    /DEV_PROPERTY_HOSTNAME/,
  );
  assert.throws(() => parseAppEnvironment({ APP_DATA_MODE: "legacy" }), /APP_DATA_MODE/);
});

test("Neon mode requires the property hostname for local and preview environments", () => {
  const base = {
    APP_DATA_MODE: "neon",
  };
  assert.throws(() => parseAppEnvironment({ ...base, APP_ENV: "local" }), /DEV_PROPERTY_HOSTNAME/);
  assert.throws(() => parseAppEnvironment({ ...base, APP_ENV: "preview" }), /PREVIEW_PROPERTY_HOSTNAME/);
  assert.equal(parseAppEnvironment({
    ...base,
    APP_ENV: "local",
    DEV_PROPERTY_HOSTNAME: "training-demo.example.test",
  }).devPropertyHostname, "training-demo.example.test");
});

test("browser-visible secret and service-role variables are rejected", () => {
  assert.throws(
    () => parseAppEnvironment({ NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "forbidden" }),
    /must never be browser-visible/,
  );
  assert.throws(
    () => parseAppEnvironment({ NEXT_PUBLIC_SUPABASE_SECRET_KEY: "forbidden" }),
    /must never be browser-visible/,
  );
});

test("the application build invokes environment validation", async () => {
  const source = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(source, /parseAppEnvironment\(/);
  assert.match(source, /loadEnv\(/);
});
