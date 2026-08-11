import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Property branding has no legacy object-storage repository", async () => {
  const [http, neon] = await Promise.all([
    readFile(new URL("../app/repositories/http/property-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/repositories/neon/property-repository.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(`${http}\n${neon}`, /supabase|storage/i);
  assert.match(http, /不持久化 Property branding/);
  assert.match(neon, /不持久化 Property branding/);
});
