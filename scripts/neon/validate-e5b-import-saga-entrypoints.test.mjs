import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateE5bImportStagingSource } from "./validate-e5b-import-staging.mjs";

const repositoryRoot = join(import.meta.dirname, "../..");

test("E5B source rejects a saga claim without a current-time lease guard before workbook staging checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "e5b-saga-validator-"));
  try {
    await mkdir(join(root, "neon/canonical/e5b"), { recursive: true });
    await cp(
      join(repositoryRoot, "neon/canonical/e5b/090_import_staging_schema.sql"),
      join(root, "neon/canonical/e5b/090_import_staging_schema.sql"),
    );
    await cp(
      join(repositoryRoot, "neon/canonical/e5b/e5b-import-staging-manifest.json"),
      join(root, "neon/canonical/e5b/e5b-import-staging-manifest.json"),
    );
    const sagaSource = await readFile(
      join(repositoryRoot, "neon/canonical/e5b/091_import_saga_entrypoints.sql"),
      "utf8",
    );
    await writeFile(
      join(root, "neon/canonical/e5b/091_import_saga_entrypoints.sql"),
      sagaSource.replace(
        "v_now := pg_catalog.clock_timestamp();",
        "v_now := pg_catalog.transaction_timestamp();",
      ),
    );

    await assert.rejects(
      validateE5bImportStagingSource({ root }),
      /E5B_IMPORT_STAGING_SAGA_CURRENT_TIME_LEASE_GUARD_MISSING/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
