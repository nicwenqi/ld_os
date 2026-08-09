# E5B Task 2 report — Import staging schema foundation

## Scope and canonical layering

Task 2 adds the first E5B capability module at:

- `neon/canonical/e5b/090_import_staging_schema.sql`
- `neon/canonical/e5b/e5b-import-staging-manifest.json`

E5B is intentionally a post-baseline capability. The immutable E1–E5A
canonical bootstrap remains the root `010`–`080` inventory, its manifest is
unchanged, and its validator remains responsible only for that baseline. The
E5B validator owns the independent capability manifest and future sibling
modules `091_import_saga_entrypoints.sql` and
`092_import_staging_entrypoints.sql` in the same directory.

No legacy `neon/migrations` file, Supabase object, Import route, Auth, Storage
policy, production target, business seed, or database connection was changed.

## Schema delivered

The 090 module creates the frozen E5B evidence and saga relations:

- `public.import_batches`
- `public.import_sheets`
- `public.import_source_rows`
- `public.import_field_mappings`
- `public.import_issues`
- `public.import_source_label_resolutions`
- `app_private.import_storage_operations`
- `app_private.import_activity_events`

It also defines independent Storage/workbook lifecycle types, verification,
cleanup, evidence and issue types; strict server-derived object-path, SHA-256,
size and MIME checks; composite tenant/property foreign keys; immutable batch
intent evidence; bounded cleanup leases; a durable cleanup ledger; history and
reconciliation indexes; and an append-only activity trigger.

Every E5B table is owned by `hotel_ld_migration_owner`, has RLS enabled and
forced, has an internal migration-owner policy bound to transaction-scoped actor
property context, and explicitly revokes raw table/identity-sequence privileges
from `PUBLIC` and `hotel_ld_application`. No application EXECUTE grant appears
in 090: the constrained entrypoints and their exact grants belong to Tasks 3
and 4.

## TDD evidence

RED was recorded before the schema implementation with:

```text
node --test scripts/neon/validate-e5b-import-staging-schema.test.mjs
```

The intended source-stage test failed because the previous validator emitted
the generic `E5B_IMPORT_STAGING_SOURCE_CONTRACT_MISSING` instead of advancing
through a valid 090 schema to the missing-saga boundary. The verification
equality negative case also failed for the same reason.

GREEN updates the E5B validator with a staged schema gate and its independent
manifest inventory. A complete 090 now reaches the exact next boundary:

```text
node scripts/neon/validate-e5b-import-staging.mjs source
E5B_IMPORT_STAGING_SAGA_ENTRYPOINT_MISSING
```

That non-zero result is the expected Task 2 state: 091/092 and server boundary
files are intentionally absent. It occurs before environment reads or any
database connection.

## Focused verification

Passed, connection-free:

```text
node --test scripts/neon/validate-e5b-import-staging-schema.test.mjs scripts/neon/validate-e5b-import-staging.test.mjs
# tests 16; pass 16; fail 0

node scripts/neon/validate-canonical-neon-baseline.mjs source
# root modules 010–080; pass

node --experimental-strip-types --test scripts/neon/canonical-neon-bootstrap-contract.test.mjs scripts/neon/validate-canonical-neon-baseline.test.mjs
# tests 86; pass 86; fail 0
```

`git diff --check` also passed. `psql --version` confirmed the local client is
PostgreSQL 18.4; no target URL was read and no SQL was sent to any database.

## Deferred gates and concerns

- 090 has not been parsed/applied by a PostgreSQL server. Task 9 must execute
  the approved non-production E5B dry-run → apply → catalog → runtime matrix
  after Tasks 3–8 complete. This task performed no network/database work.
- Storage remains a server adapter boundary. The schema contains only provider
  evidence and a cleanup ledger; it creates no Storage schema or policy.
- Employee commit/revert, mapping decisions and Import activation remain out of
  scope. E5B source rows and labels are immutable staging evidence only.
