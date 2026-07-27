import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseAppEnvironment } from "../app/lib/environment.ts";

test("mock mode remains the safe default without Supabase credentials", () => {
  assert.deepEqual(parseAppEnvironment({}), {
    appEnv: "local",
    dataMode: "mock",
    appBaseDomain: "ldchub.cn",
    devPropertyHostname: null,
    previewPropertyHostname: null,
    supabaseUrl: null,
    supabasePublishableKey: null,
  });
});

test("production can never fall back to local-review mock data", () => {
  assert.throws(
    () => parseAppEnvironment({ VERCEL_ENV: "production" }),
    /Production cannot use local-review repositories/,
  );
  assert.throws(
    () => parseAppEnvironment({ APP_ENV: "production", APP_DATA_MODE: "mock" }),
    /Production cannot use local-review repositories/,
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

test("Supabase data modes require a URL and publishable key", () => {
  assert.throws(
    () => parseAppEnvironment({ APP_DATA_MODE: "supabase" }),
    /NEXT_PUBLIC_SUPABASE_URL is required/,
  );
  assert.throws(
    () => parseAppEnvironment({ APP_DATA_MODE: "hybrid", NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" }),
    /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required/,
  );
});

test("environment names, URLs, and property hostnames are validated", () => {
  assert.throws(() => parseAppEnvironment({ APP_ENV: "staging" }), /APP_ENV/);
  assert.throws(() => parseAppEnvironment({ APP_DATA_MODE: "real" }), /APP_DATA_MODE/);
  assert.throws(
    () => parseAppEnvironment({ DEV_PROPERTY_HOSTNAME: "https://hotel.example.test/path" }),
    /DEV_PROPERTY_HOSTNAME/,
  );
  assert.throws(
    () => parseAppEnvironment({
      APP_DATA_MODE: "supabase",
      NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    }),
    /NEXT_PUBLIC_SUPABASE_URL/,
  );
});

test("hybrid mode requires the property hostname for local and preview environments", () => {
  const base = {
    APP_DATA_MODE: "hybrid",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
  };
  assert.throws(() => parseAppEnvironment({ ...base, APP_ENV: "local" }), /DEV_PROPERTY_HOSTNAME/);
  assert.throws(() => parseAppEnvironment({ ...base, APP_ENV: "preview" }), /PREVIEW_PROPERTY_HOSTNAME/);
  assert.equal(parseAppEnvironment({
    ...base,
    APP_ENV: "local",
    DEV_PROPERTY_HOSTNAME: "training-demo.example.test",
  }).devPropertyHostname, "training-demo.example.test");
});

test("local real-data review permits only an HTTP loopback Supabase URL", () => {
  const local = parseAppEnvironment({
    APP_ENV: "local",
    APP_DATA_MODE: "supabase",
    DEV_PROPERTY_HOSTNAME: "training-demo.example.test",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
  });
  assert.equal(local.supabaseUrl, "http://127.0.0.1:54321");

  for (const invalid of [
    "http://example.supabase.co",
    "http://192.168.1.20:54321",
  ]) {
    assert.throws(
      () => parseAppEnvironment({
        APP_ENV: "local",
        APP_DATA_MODE: "supabase",
        DEV_PROPERTY_HOSTNAME: "training-demo.example.test",
        NEXT_PUBLIC_SUPABASE_URL: invalid,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
      }),
      /valid HTTPS URL or a local loopback URL/,
    );
  }

  assert.throws(
    () => parseAppEnvironment({
      APP_ENV: "preview",
      APP_DATA_MODE: "supabase",
      PREVIEW_PROPERTY_HOSTNAME: "training-demo.example.test",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    }),
    /valid HTTPS URL/,
  );
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
