import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateE5bImportStagingSource } from "./validate-e5b-import-staging.mjs";

test("E5B source validates the complete schema before requiring saga entrypoints", async () => {
  await withSchemaOnlyFixture(async root => {
    await assert.rejects(
      validateE5bImportStagingSource({ root }),
      /E5B_IMPORT_STAGING_SAGA_ENTRYPOINT_MISSING/,
    );
  });
});

test("E5B source rejects a schema without read-back verification invariants", async () => {
  await withSchemaOnlyFixture(async root => {
    await writeFile(
      join(root, "neon/canonical/e5b/090_import_staging_schema.sql"),
      validSchemaSql().replace(
        "verified_checksum_sha256 = declared_checksum_sha256 and verified_size_bytes = declared_size_bytes and verified_mime_type = declared_mime_type",
        "verified_checksum_sha256 is not null",
      ),
    );
    await assert.rejects(
      validateE5bImportStagingSource({ root }),
      /E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING:\s*verification_equality/,
    );
  });
});

async function withSchemaOnlyFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "e5b-schema-validator-"));
  try {
    await Promise.all([
      mkdir(join(root, "neon/canonical/e5b"), { recursive: true }),
      mkdir(join(root, "app/api/import/inspect"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, "neon/canonical/e5b/090_import_staging_schema.sql"), validSchemaSql()),
      writeFile(join(root, "neon/canonical/e5b/e5b-import-staging-manifest.json"), validSchemaManifest()),
      writeFile(join(root, "app/api/import/inspect/route.ts"), 'actorClient.rpc(\n        "stage_employee_import"'),
    ]);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function validSchemaManifest() {
  return JSON.stringify({
    capability: "e5b-import-staging",
    modules: [
      "090_import_staging_schema.sql",
      "091_import_saga_entrypoints.sql",
      "092_import_staging_entrypoints.sql",
    ],
    schemaTypes: [
      "public.import_cleanup_state",
      "public.import_storage_lifecycle",
      "public.import_verification_status",
      "public.import_workbook_lifecycle",
    ],
    schemaTables: [
      "app_private.import_activity_events",
      "app_private.import_storage_operations",
      "public.import_batches",
      "public.import_field_mappings",
      "public.import_issues",
      "public.import_sheets",
      "public.import_source_label_resolutions",
      "public.import_source_rows",
    ],
    schemaRoutines: [
      "app_private.neon_import_storage_transition_allowed",
      "app_private.neon_import_workbook_transition_allowed",
      "app_private.reject_import_activity_mutation",
    ],
    schemaPolicies: [
      "canonical_import_activity_events_insert",
      "canonical_import_batches_scope",
      "canonical_import_field_mappings_scope",
      "canonical_import_issues_scope",
      "canonical_import_sheets_scope",
      "canonical_import_source_label_resolutions_scope",
      "canonical_import_source_rows_scope",
      "canonical_import_storage_operations_scope",
    ],
    schemaTriggers: [
      "canonical_import_batch_lifecycle_transition",
      "import_activity_events_append_only",
    ],
    excluded: [
      "auth schema",
      "storage schema",
      "legacy import commit",
      "legacy import revert",
      "legacy provenance",
      "compatibility objects",
      "business seed data",
    ],
  });
}

function validSchemaSql() {
  const publicTables = [
    "import_batches",
    "import_sheets",
    "import_source_rows",
    "import_field_mappings",
    "import_issues",
    "import_source_label_resolutions",
  ];
  const privateTables = ["import_storage_operations", "import_activity_events"];
  const tables = [
    ...publicTables.map(table => `public.${table}`),
    ...privateTables.map(table => `app_private.${table}`),
  ];
  return `begin;
set local role hotel_ld_migration_owner;
create type public.import_storage_lifecycle as enum ('intent_created','uploaded_unverified','verification_failed','verified','linked','cleanup_pending','cleanup_in_progress','cleanup_failed','cleanup_completed');
create type public.import_workbook_lifecycle as enum ('intent_created','inspecting','mapping_required','failed');
create type public.import_verification_status as enum ('pending','passed','failed');
create type public.import_cleanup_state as enum ('not_required','cleanup_pending','cleanup_in_progress','cleanup_completed','cleanup_failed');
create table public.import_batches (id uuid primary key, tenant_id uuid not null, property_id uuid not null, sanitized_filename text not null, object_path text not null, declared_checksum_sha256 text not null check (declared_checksum_sha256 ~ '^[0-9a-f]{64}$'), declared_size_bytes bigint not null check (declared_size_bytes between 1 and 52428800), declared_mime_type text not null check (declared_mime_type in ('application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv')), verified_checksum_sha256 text, verified_size_bytes bigint, verified_mime_type text, verification_status public.import_verification_status not null default 'pending', storage_lifecycle public.import_storage_lifecycle not null default 'intent_created', workbook_lifecycle public.import_workbook_lifecycle not null default 'intent_created', version bigint not null default 1, check (object_path = tenant_id::text || '/' || property_id::text || '/imports/' || id::text || '/' || sanitized_filename), check (verification_status <> 'passed' or (verified_checksum_sha256 = declared_checksum_sha256 and verified_size_bytes = declared_size_bytes and verified_mime_type = declared_mime_type)), check (storage_lifecycle <> 'linked' or (verification_status = 'passed' and workbook_lifecycle = 'mapping_required')), unique (id, tenant_id, property_id));
${publicTables.slice(1).map(table => `create table public.${table} (id uuid primary key, tenant_id uuid not null, property_id uuid not null, batch_id uuid not null, foreign key (batch_id, tenant_id, property_id) references public.import_batches(id, tenant_id, property_id));`).join("\n")}
create table app_private.import_storage_operations (id uuid primary key, tenant_id uuid not null, property_id uuid not null, batch_id uuid not null, cleanup_state public.import_cleanup_state not null, claim_id uuid, lease_expires_at timestamptz, check (cleanup_state <> 'cleanup_in_progress' or (claim_id is not null and lease_expires_at > pg_catalog.transaction_timestamp())), foreign key (batch_id, tenant_id, property_id) references public.import_batches(id, tenant_id, property_id));
create table app_private.import_activity_events (id bigint generated always as identity primary key, tenant_id uuid not null, property_id uuid not null, batch_id uuid not null, foreign key (batch_id, tenant_id, property_id) references public.import_batches(id, tenant_id, property_id));
create function app_private.reject_import_activity_mutation() returns trigger language plpgsql security invoker set search_path = '' as $$ begin raise exception using errcode = '42501'; end $$;
create trigger import_activity_events_append_only before update or delete on app_private.import_activity_events for each row execute function app_private.reject_import_activity_mutation();
create function app_private.neon_import_storage_transition_allowed() returns boolean language sql as $$ select true; $$;
create function app_private.neon_import_workbook_transition_allowed() returns boolean language sql as $$ select true; $$;
create trigger canonical_import_batch_lifecycle_transition before update on public.import_batches for each row execute function app_private.neon_import_storage_transition_allowed();
${tables.map(table => `alter table ${table} owner to hotel_ld_migration_owner;\nalter table ${table} enable row level security;\nalter table ${table} force row level security;\nrevoke all on table ${table} from public, hotel_ld_application;`).join("\n")}
create policy canonical_import_batches_scope on public.import_batches for all to hotel_ld_migration_owner using (true) with check (true);
create policy canonical_import_sheets_scope on public.import_sheets for all to hotel_ld_migration_owner using (true) with check (true);
create policy canonical_import_source_rows_scope on public.import_source_rows for all to hotel_ld_migration_owner using (true) with check (true);
create policy canonical_import_field_mappings_scope on public.import_field_mappings for all to hotel_ld_migration_owner using (true) with check (true);
create policy canonical_import_issues_scope on public.import_issues for all to hotel_ld_migration_owner using (true) with check (true);
create policy canonical_import_source_label_resolutions_scope on public.import_source_label_resolutions for all to hotel_ld_migration_owner using (true) with check (true);
create policy canonical_import_storage_operations_scope on app_private.import_storage_operations for all to hotel_ld_migration_owner using (true) with check (true);
create policy canonical_import_activity_events_insert on app_private.import_activity_events for insert to hotel_ld_migration_owner with check (true);
revoke all on all sequences in schema public from public, hotel_ld_application;
revoke all on all sequences in schema app_private from public, hotel_ld_application;
commit;
`;
}
