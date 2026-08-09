import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  validateE5bImportStagingCatalog,
  validateE5bImportStagingEntrypoints,
} from "./validate-e5b-import-staging.mjs";

const sourceUrl = new URL("../../neon/canonical/e5b/092_import_staging_entrypoints.sql", import.meta.url);

test("E5B staging entrypoints require an atomic begin guard before any append", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.throws(
    () => validateE5bImportStagingEntrypoints(
      source.replace("pg_try_advisory_xact_lock", "pg_advisory_lock"),
    ),
    /E5B_IMPORT_STAGING_XACT_LOCK_GUARD_MISSING/,
  );
});

test("E5B staging entrypoints bind chunks to the begin transaction provenance", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.throws(
    () => validateE5bImportStagingEntrypoints(
      source.replace("batch.xmin = pg_catalog.pg_current_xact_id()::xid", "batch.xmin = batch.xmin"),
    ),
    /E5B_IMPORT_STAGING_TRANSACTION_PROVENANCE_MISSING/,
  );
});

test("E5B begin records tuple provenance alongside the batch transaction guard", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.throws(
    () => validateE5bImportStagingEntrypoints(
      source.replaceAll("app.e5b_import_staging_xmin", "app.e5b_import_staging_provenance_omitted"),
    ),
    /E5B_IMPORT_STAGING_TRANSACTION_PROVENANCE_MISSING/,
  );
});

test("E5B source labels bind only to the unique selected employee-master sheet", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.throws(
    () => validateE5bImportStagingEntrypoints(
      source.replaceAll("sheet.id = batch.selected_sheet_id", "sheet.id = sheet.id"),
    ),
    /E5B_IMPORT_STAGING_SELECTED_SHEET_LABEL_BINDING_MISSING/,
  );
});

test("E5B finalization requires bidirectional mapping and row evidence key sets", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.throws(
    () => validateE5bImportStagingEntrypoints(
      source.replace("not (row.normalized_values ? mapping.target_field)", "false"),
    ),
    /E5B_IMPORT_STAGING_BIDIRECTIONAL_MAPPING_MISSING/,
  );
});

test("E5B evidence hashing uses canonical JSON and UTF-8 length framing", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.throws(
    () => validateE5bImportStagingEntrypoints(
      source.replace("pg_catalog.octet_length", "pg_catalog.char_length"),
    ),
    /E5B_IMPORT_STAGING_CANONICAL_JSON_ENCODING_MISSING/,
  );
});

test("E5B catalog inventory requires pgcrypto for database-side evidence sealing", () => {
  assert.throws(
    () => validateE5bImportStagingCatalog({ extensions: [] }, { extensions: ["pgcrypto"] }),
    /E5B_IMPORT_STAGING_CATALOG_EXTENSION_MISSING: pgcrypto/,
  );
});

test("E5B staging entrypoints reject a finalizer without canonical evidence sealing", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.throws(
    () => validateE5bImportStagingEntrypoints(
      source.replaceAll("app_private.neon_import_staging_manifest_sha256", "app_private.neon_import_staging_manifest_omitted"),
    ),
    /E5B_IMPORT_STAGING_CANONICAL_MANIFEST_MISSING/,
  );
});

test("E5B staging entrypoints restrict all public routines to the application function boundary", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.throws(
    () => validateE5bImportStagingEntrypoints(
      source.replace(
        "revoke all on function public.append_neon_import_sheets(text,uuid,jsonb) from public;",
        "grant execute on function public.append_neon_import_sheets(text,uuid,jsonb) to public;",
      ),
    ),
    /E5B_IMPORT_STAGING_ENTRYPOINT_SECURITY/,
  );
});
