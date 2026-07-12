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
    () => parseAppEnvironment({ DEV_PROPERTY_HOSTNAME: "https://ktsz.ldchub.cn/path" }),
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

test("the application build invokes environment validation", async () => {
  const source = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(source, /parseAppEnvironment\(/);
  assert.match(source, /loadEnv\(/);
});
