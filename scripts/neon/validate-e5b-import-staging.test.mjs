import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  E5B_ENTRYPOINT_SIGNATURES,
  assertE5bBootstrapUrl,
  assertE5bRuntimeUrl,
  validateE5bImportStagingSource,
} from "./validate-e5b-import-staging.mjs";

test("E5B bootstrap guard accepts only the canonical final direct target", () => {
  const target = assertE5bBootstrapUrl(
    "postgresql://neondb_owner:secret@ep-frosty-math-audxlq88.neon.tech/neondb?sslmode=require",
  );

  assert.deepEqual(target, {
    project: "delicate-wind-06430851",
    branch: "br-icy-scene-aukkzv69",
    endpoint: "ep-frosty-math-audxlq88",
    database: "neondb",
    role: "neondb_owner",
    pooled: false,
    kind: "bootstrap",
  });
});

test("E5B target guard rejects retired, production, and direct runtime URLs", () => {
  assert.throws(
    () => assertE5bBootstrapUrl(
      "postgresql://neondb_owner:secret@ep-sparkling-shape-az9gxtuh.neon.tech/neondb",
    ),
    /E5B_IMPORT_STAGING_CHILD_ENDPOINT_REQUIRED/,
  );
  assert.throws(
    () => assertE5bBootstrapUrl(
      "postgresql://neondb_owner:secret@ep-wild-wave-azjmgdif.neon.tech/neondb",
    ),
    /E5B_IMPORT_STAGING_PRODUCTION_DENIED/,
  );
  assert.throws(
    () => assertE5bRuntimeUrl(
      "postgresql://hotel_ld_application:secret@ep-frosty-math-audxlq88.neon.tech/neondb",
    ),
    /E5B_IMPORT_STAGING_POOLED_RUNTIME_REQUIRED/,
  );
});

test("source validation rejects a secured overload that is not the exact entrypoint signature", async () => {
  await withSourceFixture(async root => {
    const expected = E5B_ENTRYPOINT_SIGNATURES[0];
    const wrongDeclaration = expected.replace("text,uuid,text,text,text,bigint,text,text", "text,uuid");
    await writeFile(
      join(root, "neon/canonical/091_import_saga_entrypoints.sql"),
      entrypointSql(E5B_ENTRYPOINT_SIGNATURES, { expected, wrongDeclaration }),
    );

    await assert.rejects(
      validateE5bImportStagingSource({ root }),
      /E5B_IMPORT_STAGING_ENTRYPOINT_SECURITY/,
    );
  });
});

test("source validation ignores commented raw grants", async () => {
  await withSourceFixture(async root => {
    await writeFile(
      join(root, "neon/canonical/090_import_staging_schema.sql"),
      schemaSql(`
        -- grant select on table public.import_batches to hotel_ld_application;
        /* grant usage on schema storage to hotel_ld_application; */
      `),
    );

    await assert.doesNotReject(validateE5bImportStagingSource({ root }));
  });
});

test("source validation rejects grouped comma-separated raw grants", async () => {
  await withSourceFixture(async root => {
    await writeFile(
      join(root, "neon/canonical/090_import_staging_schema.sql"),
      schemaSql(`
        grant select on table public.import_batches, app_private.import_activity_events
          to group "hotel_ld_application";
        grant usage on schema public to "hotel_ld_application";
        grant usage, select on sequence public.import_batches_id_seq
          to "hotel_ld_application";
      `),
    );

    await assert.rejects(
      validateE5bImportStagingSource({ root }),
      /E5B_IMPORT_STAGING_RAW_APPLICATION_GRANT/,
    );
  });
});

test("E5B staging evidence is named and allowlisted rather than an arbitrary record", async () => {
  const source = await readFile(
    new URL("../../app/repositories/contracts/import-staging-repository.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /type ImportRawCellStagingEvidence = \{/);
  assert.match(source, /type ImportNormalizedEmployeeValues = Readonly<\{/);
  assert.match(source, /rawValues: readonly ImportRawCellStagingEvidence\[\];/);
  assert.match(source, /normalizedValues: ImportNormalizedEmployeeValues;/);
  assert.doesNotMatch(source, /\bRecord\s*</);
  assert.doesNotMatch(source, /\b(?:tenantId|propertyId|authUserId|role):/);
});

async function withSourceFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "e5b-validator-"));
  try {
    await Promise.all([
      mkdir(join(root, "neon/canonical"), { recursive: true }),
      mkdir(join(root, "app/repositories/contracts"), { recursive: true }),
      mkdir(join(root, "app/repositories/neon"), { recursive: true }),
      mkdir(join(root, "app/services/import"), { recursive: true }),
      mkdir(join(root, "app/services"), { recursive: true }),
      mkdir(join(root, "app/api/import/inspect"), { recursive: true }),
      mkdir(join(root, "app/api/import/batches/[id]"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, "neon/canonical/090_import_staging_schema.sql"), schemaSql()),
      writeFile(join(root, "neon/canonical/091_import_saga_entrypoints.sql"), entrypointSql(E5B_ENTRYPOINT_SIGNATURES)),
      writeFile(join(root, "neon/canonical/092_import_staging_entrypoints.sql"), "begin;\ncommit;\n"),
      writeFile(join(root, "app/api/import/inspect/route.ts"), 'actorClient.rpc(\n        "stage_employee_import"'),
      writeFile(join(root, "app/repositories/contracts/import-staging-repository.ts"), "export {};\n"),
      writeFile(join(root, "app/repositories/neon/import-staging-repository.ts"), "export {};\n"),
      writeFile(join(root, "app/services/neon-import-staging-authorization.ts"), "export {};\n"),
      writeFile(join(root, "app/services/import/storage-object-verification.ts"), 'download(); createHash("sha256"); timingSafeEqual(); contentDerivedMimeType;\n'),
      writeFile(join(root, "app/services/import/storage-saga-coordinator.ts"), "export {};\n"),
      writeFile(join(root, "app/services/import/storage-cleanup-executor.ts"), "export {};\n"),
      writeFile(join(root, "app/services/import/neon-import-inspection-boundary.ts"), "export {};\n"),
      writeFile(join(root, "app/api/import/batches/route.ts"), "export {};\n"),
      writeFile(join(root, "app/api/import/batches/[id]/route.ts"), "export {};\n"),
      writeFile(join(root, "app/api/import/batches/input.ts"), "export {};\n"),
    ]);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function schemaSql(extra = "") {
  const tables = [
    "public.import_batches",
    "public.import_sheets",
    "public.import_source_rows",
    "public.import_field_mappings",
    "public.import_issues",
    "public.import_source_label_resolutions",
    "app_private.import_storage_operations",
    "app_private.import_activity_events",
  ];
  return `begin;\n${tables.map(table => `alter table ${table} force row level security;`).join("\n")}\n${extra}\ncommit;\n`;
}

function entrypointSql(signatures, replacement = null) {
  const declarations = signatures.map(signature => {
    const declaration = replacement && signature === replacement.expected ? replacement.wrongDeclaration : signature;
    const name = declaration.slice(0, declaration.indexOf("("));
    const args = declaration.slice(declaration.indexOf("(") + 1, -1);
    return `create function ${name}(${args}) returns void language sql security definer set search_path = '' as $$ select null; $$;`;
  });
  const grants = signatures.flatMap(signature => [
    `revoke all on function ${signature} from public;`,
    `grant execute on function ${signature} to hotel_ld_application;`,
  ]);
  return `begin;\n${[...declarations, ...grants].join("\n")}\ncommit;\n`;
}
