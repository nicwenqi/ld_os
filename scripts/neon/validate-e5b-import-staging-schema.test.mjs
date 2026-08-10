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
      validSchemaSql().replaceAll(
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

test("E5B source rejects a time-dependent cleanup lease CHECK", async () => {
  await withSchemaOnlyFixture(async root => {
    await writeFile(
      join(root, "neon/canonical/e5b/090_import_staging_schema.sql"),
      validSchemaSql().replace(
        "claim_id is not null and lease_expires_at is not null and last_attempt_at is not null and lease_expires_at > last_attempt_at",
        "claim_id is not null and lease_expires_at > pg_catalog.transaction_timestamp() and lease_expires_at <= pg_catalog.transaction_timestamp() + interval '5 minutes'",
      ),
    );
    await assert.rejects(
      validateE5bImportStagingSource({ root }),
      /E5B_IMPORT_STAGING_SCHEMA_TIME_DEPENDENT_LEASE_CHECK/,
    );
  });
});

test("E5B source rejects a scope policy without actor-property semantics", async () => {
  await withSchemaOnlyFixture(async root => {
    await writeFile(
      join(root, "neon/canonical/e5b/090_import_staging_schema.sql"),
      validSchemaSql().replace(
        "create policy canonical_import_batches_scope on public.import_batches for all to hotel_ld_migration_owner using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id()) with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());",
        "create policy canonical_import_batches_scope on public.import_batches for all to hotel_ld_migration_owner using (true) with check (true);",
      ),
    );
    await assert.rejects(
      validateE5bImportStagingSource({ root }),
      /E5B_IMPORT_STAGING_SCHEMA_POLICY_SEMANTICS_MISSING:.*canonical_import_batches_scope/,
    );
  });
});

test("E5B source rejects a storage ledger path not bound to its batch", async () => {
  await withSchemaOnlyFixture(async root => {
    await writeFile(
      join(root, "neon/canonical/e5b/090_import_staging_schema.sql"),
      validSchemaSql().replace(
        "foreign key (batch_id, tenant_id, property_id, object_path) references public.import_batches(id, tenant_id, property_id, object_path)",
        "foreign key (batch_id, tenant_id, property_id) references public.import_batches(id, tenant_id, property_id)",
      ),
    );
    await assert.rejects(
      validateE5bImportStagingSource({ root }),
      /E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING:\s*storage_operation_object_path_binding/,
    );
  });
});

test("E5B source rejects verified storage without exact verified evidence", async () => {
  await withSchemaOnlyFixture(async root => {
    await writeFile(
      join(root, "neon/canonical/e5b/090_import_staging_schema.sql"),
      validSchemaSql().replace(
        "storage_lifecycle not in ('verified', 'linked') or (verification_status = 'passed' and verified_checksum_sha256 is not null and verified_size_bytes is not null and verified_mime_type is not null and verified_checksum_sha256 = declared_checksum_sha256 and verified_size_bytes = declared_size_bytes and verified_mime_type = declared_mime_type)",
        "storage_lifecycle not in ('verified', 'linked') or verification_status = 'passed'",
      ),
    );
    await assert.rejects(
      validateE5bImportStagingSource({ root }),
      /E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING:\s*storage_verification_state/,
    );
  });
});

test("E5B source rejects verification failure outside the failure lifecycle", async () => {
  await withSchemaOnlyFixture(async root => {
    await writeFile(
      join(root, "neon/canonical/e5b/090_import_staging_schema.sql"),
      validSchemaSql().replace(
        "(storage_lifecycle <> 'verification_failed' or verification_status = 'failed') and (verification_status <> 'failed' or storage_lifecycle in ('verification_failed', 'cleanup_pending', 'cleanup_in_progress', 'cleanup_failed', 'cleanup_completed'))",
        "true",
      ),
    );
    await assert.rejects(
      validateE5bImportStagingSource({ root }),
      /E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING:\s*verification_failure_state/,
    );
  });
});

test("E5B source rejects a batch immutable trigger that permits source-system rewrites", async () => {
  await withSchemaOnlyFixture(async root => {
    await writeFile(
      join(root, "neon/canonical/e5b/090_import_staging_schema.sql"),
      validSchemaSql().replace(
        "source_system is distinct from old.source_system or ",
        "",
      ),
    );
    await assert.rejects(
      validateE5bImportStagingSource({ root }),
      /E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING:\s*batch_immutable_source_system/,
    );
  });
});

test("E5B source rejects missing selected-sheet exactness constraint triggers", async () => {
  await withSchemaOnlyFixture(async root => {
    await writeFile(
      join(root, "neon/canonical/e5b/090_import_staging_schema.sql"),
      validSchemaSql().replace(
        "create constraint trigger canonical_import_selected_sheet_integrity_sheets after insert or update or delete on public.import_sheets deferrable initially deferred for each row execute function app_private.enforce_neon_import_selected_sheet();\n",
        "",
      ),
    );
    await assert.rejects(
      validateE5bImportStagingSource({ root }),
      /E5B_IMPORT_STAGING_SCHEMA_INVARIANT_MISSING:\s*selected_sheet_integrity/,
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
      "app_private.enforce_neon_import_batch_lifecycle_transition",
      "app_private.enforce_neon_import_selected_sheet",
      "app_private.neon_import_storage_transition_allowed",
      "app_private.neon_import_workbook_transition_allowed",
      "app_private.reject_import_activity_audit_mutation",
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
      "canonical_import_selected_sheet_integrity_batches",
      "canonical_import_selected_sheet_integrity_sheets",
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
create table public.import_batches (id uuid primary key, tenant_id uuid not null, property_id uuid not null, source_system text not null, sanitized_filename text not null, object_path text not null, declared_checksum_sha256 text not null check (declared_checksum_sha256 ~ '^[0-9a-f]{64}$'), declared_size_bytes bigint not null check (declared_size_bytes between 1 and 52428800), declared_mime_type text not null check (declared_mime_type in ('application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv')), verified_checksum_sha256 text, verified_size_bytes bigint, verified_mime_type text, verification_status public.import_verification_status not null default 'pending', storage_lifecycle public.import_storage_lifecycle not null default 'intent_created', workbook_lifecycle public.import_workbook_lifecycle not null default 'intent_created', version bigint not null default 1, check (object_path = tenant_id::text || '/' || property_id::text || '/imports/' || id::text || '/' || sanitized_filename), check (verification_status <> 'passed' or (verified_checksum_sha256 = declared_checksum_sha256 and verified_size_bytes = declared_size_bytes and verified_mime_type = declared_mime_type)), constraint import_batches_storage_verification_state_check check (storage_lifecycle not in ('verified', 'linked') or (verification_status = 'passed' and verified_checksum_sha256 is not null and verified_size_bytes is not null and verified_mime_type is not null and verified_checksum_sha256 = declared_checksum_sha256 and verified_size_bytes = declared_size_bytes and verified_mime_type = declared_mime_type)), constraint import_batches_verification_failure_coherence_check check ((storage_lifecycle <> 'verification_failed' or verification_status = 'failed') and (verification_status <> 'failed' or storage_lifecycle in ('verification_failed', 'cleanup_pending', 'cleanup_in_progress', 'cleanup_failed', 'cleanup_completed'))), constraint import_batches_linked_evidence_check check (storage_lifecycle <> 'linked' or (verification_status = 'passed' and workbook_lifecycle = 'mapping_required' and sealed_evidence_sha256 is not null and linked_at is not null)), unique (id, tenant_id, property_id), unique (id, tenant_id, property_id, object_path));
${publicTables.slice(1).map(table => `create table public.${table} (id uuid primary key, tenant_id uuid not null, property_id uuid not null, batch_id uuid not null, foreign key (batch_id, tenant_id, property_id) references public.import_batches(id, tenant_id, property_id));`).join("\n")}
create table app_private.import_storage_operations (id uuid primary key, tenant_id uuid not null, property_id uuid not null, batch_id uuid not null, object_path text not null, cleanup_state public.import_cleanup_state not null, claim_id uuid, lease_expires_at timestamptz, last_attempt_at timestamptz, constraint import_storage_operations_cleanup_lease_check check (cleanup_state <> 'cleanup_in_progress' or (claim_id is not null and lease_expires_at is not null and last_attempt_at is not null and lease_expires_at > last_attempt_at)), constraint import_storage_operations_cleanup_completion_check check (true), foreign key (batch_id, tenant_id, property_id, object_path) references public.import_batches(id, tenant_id, property_id, object_path));
create table app_private.import_activity_events (id bigint generated always as identity primary key, tenant_id uuid not null, property_id uuid not null, batch_id uuid not null, foreign key (batch_id, tenant_id, property_id) references public.import_batches(id, tenant_id, property_id));
create function app_private.reject_import_activity_audit_mutation() returns trigger language plpgsql security invoker set search_path = '' as $$ begin raise exception using errcode = '42501'; end $$;
create trigger import_activity_events_append_only before update or delete on app_private.import_activity_events for each row execute function app_private.reject_import_activity_audit_mutation();
create function app_private.neon_import_storage_transition_allowed() returns boolean language sql as $$ select true; $$;
create function app_private.neon_import_workbook_transition_allowed() returns boolean language sql as $$ select true; $$;
create function app_private.enforce_neon_import_batch_lifecycle_transition() returns trigger language plpgsql as $$ begin if new.source_system is distinct from old.source_system or new.object_path is distinct from old.object_path then raise exception; end if; return new; end $$;
create function app_private.enforce_neon_import_selected_sheet() returns trigger language plpgsql as $$ begin select count(*), count(*) filter (where id = v_selected_sheet_id and is_selected) into v_selected_count, v_matching_selected_count from public.import_sheets where is_selected; if v_selected_sheet_id is null and v_selected_count <> 0 then raise exception; elsif v_selected_count <> 1 or v_matching_selected_count <> 1 then raise exception; end if; return null; end $$;
create trigger canonical_import_batch_lifecycle_transition before update on public.import_batches for each row execute function app_private.enforce_neon_import_batch_lifecycle_transition();
create constraint trigger canonical_import_selected_sheet_integrity_batches after insert or update or delete on public.import_batches deferrable initially deferred for each row execute function app_private.enforce_neon_import_selected_sheet();
create constraint trigger canonical_import_selected_sheet_integrity_sheets after insert or update or delete on public.import_sheets deferrable initially deferred for each row execute function app_private.enforce_neon_import_selected_sheet();
${tables.map(table => `alter table ${table} owner to hotel_ld_migration_owner;\nalter table ${table} enable row level security;\nalter table ${table} force row level security;\nrevoke all on table ${table} from public, hotel_ld_application;`).join("\n")}
create policy canonical_import_batches_scope on public.import_batches for all to hotel_ld_migration_owner using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id()) with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_sheets_scope on public.import_sheets for all to hotel_ld_migration_owner using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id()) with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_source_rows_scope on public.import_source_rows for all to hotel_ld_migration_owner using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id()) with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_field_mappings_scope on public.import_field_mappings for all to hotel_ld_migration_owner using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id()) with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_issues_scope on public.import_issues for all to hotel_ld_migration_owner using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id()) with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_source_label_resolutions_scope on public.import_source_label_resolutions for all to hotel_ld_migration_owner using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id()) with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_storage_operations_scope on app_private.import_storage_operations for all to hotel_ld_migration_owner using (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id()) with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
create policy canonical_import_activity_events_insert on app_private.import_activity_events for insert to hotel_ld_migration_owner with check (session_user = 'hotel_ld_application' and property_id = app_private.current_actor_property_id());
revoke all on all sequences in schema public from public, hotel_ld_application;
revoke all on all sequences in schema app_private from public, hotel_ld_application;
commit;
`;
}
