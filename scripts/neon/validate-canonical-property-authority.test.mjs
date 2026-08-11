import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateCanonicalPropertyAuthority, PROPERTY_ENTRYPOINT_SIGNATURES, PROPERTY_TABLES } from "./validate-canonical-property-authority.mjs";

test("canonical property authority is connection-free and security constrained", async () => {
  const result = await validateCanonicalPropertyAuthority();
  assert.deepEqual(result, { module: "080_property_initialization.sql", tables: 5, entrypoints: 9, storageBoundary: "no-branding-object-storage", importAuthority: "excluded" });
});

test("property authority inventories remain explicit", async () => {
  const manifest = JSON.parse(await readFile(resolve("neon/canonical/manifest.json"), "utf8"));
  assert.deepEqual(PROPERTY_TABLES.filter(value => !manifest.tables.includes(value)), []);
  assert.deepEqual(PROPERTY_ENTRYPOINT_SIGNATURES.filter(value => !manifest.entrypointSignatures.includes(value)), []);
  assert.ok(manifest.exclusions.schemas.includes("auth"));
  assert.ok(manifest.exclusions.schemas.includes("storage"));
  assert.ok(manifest.exclusions.objects.includes("import_commit"));
});
