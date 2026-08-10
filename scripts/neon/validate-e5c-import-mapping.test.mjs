import assert from "node:assert/strict";
import test from "node:test";

import {
  validateE5cImportMappingSource,
  validateE5cImportMappingRepositorySource,
} from "./validate-e5c-import-mapping.mjs";

test("E5C source gate requires the canonical schema and constrained entrypoints", async () => {
  const result = await validateE5cImportMappingSource();
  assert.equal(result.schema, "e5c-import-mapping");
  assert.deepEqual(result.entrypoints, [
    "read_neon_import_mapping_workflow",
    "save_neon_import_field_mapping_decisions",
    "save_neon_import_source_label_decisions",
    "save_neon_import_issue_resolutions",
    "preview_neon_import_batch",
  ]);
  assert.equal(result.immutableEvidence, true);
  assert.equal(result.previewPersisted, false);
});

test("E5C repository source is server-only and uses only the five entrypoints", async () => {
  const result = await validateE5cImportMappingRepositorySource();
  assert.equal(result.serverOnly, true);
  assert.equal(result.rawTableQueries, 0);
  assert.equal(result.entrypointQueries, 5);
  assert.equal(result.clientScopeInputs, false);
});
