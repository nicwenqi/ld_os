# E5B Task 2 brief

Read the E5B implementation plan first. The canonical E1–E5A baseline remains
modules 010–080; this task adds the post-baseline capability module
`neon/canonical/e5b/090_import_staging_schema.sql`.
Do not create or restore `neon/migrations` legacy files, do not touch existing
tests or `app/api/import/inspect/route.ts`, and do not connect to any database.

The E5B validator owns the independent
`neon/canonical/e5b/e5b-import-staging-manifest.json` inventory. Do not alter
the E1–E5A baseline manifest or validator. Implement the eight E5B
staging/saga tables from the frozen design:

- `public.import_batches`
- `public.import_sheets`
- `public.import_source_rows`
- `public.import_field_mappings`
- `public.import_issues`
- `public.import_source_label_resolutions`
- `app_private.import_storage_operations`
- `app_private.import_activity_events`

Use tenant/property composite foreign keys for every child, server-generated
object paths, strict SHA-256/size/MIME checks, separate storage/workbook
lifecycle enums/checks, verification/link invariants, bounded cleanup lease
fields, indexes, append-only audit trigger, ownership by
`hotel_ld_migration_owner`, ENABLE+FORCE RLS, exact internal policies, PUBLIC
and application raw privilege revokes. No Auth/Storage schemas, legacy Import
objects, employee commit/revert, or business seed rows.

Extend the Task1 validator and focused fixtures so source advances past schema
checks and fails at the expected missing-saga-entrypoint boundary. Reuse vetted
schema invariants only after adapting them to canonical module ordering; do not
copy compatibility objects. Preserve RED→GREEN evidence, write the report to
`.superpowers/sdd/2026-08-07-e5b-import-staging-foundation/task-2-report.md`,
and commit only Task2 files. No DB/network.
