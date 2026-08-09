import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateE5bImportStagingEntrypoints } from "./validate-e5b-import-staging.mjs";

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
