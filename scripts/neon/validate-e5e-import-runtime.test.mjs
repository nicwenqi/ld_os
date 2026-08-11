import assert from "node:assert/strict";
import test from "node:test";
import { validateE5eImportRuntimeSource } from "./validate-e5e-import-runtime.mjs";

test("E5E runtime source contract includes explicit Neon Import HTTP activation", async () => {
  const result = await validateE5eImportRuntimeSource();
  assert.equal(result.runtimeImport, "neon");
  assert.equal(result.sameOriginHttpOnly, true);
  assert.equal(result.noBrowserNeonCredential, true);
  assert.equal(result.storageSaga, true);
  assert.equal(result.legacyInspectRpc, "disabled");
});
