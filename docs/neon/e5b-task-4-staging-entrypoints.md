# E5B Task 4 — Atomic workbook-staging entrypoints

## Scope

`092_import_staging_entrypoints.sql` adds the E5B evidence-only mutation
boundary. It does not create employee writes, Import commit/revert authority,
Supabase database compatibility objects, Auth changes, or Storage policies.

## Transaction protocol

The server must call `begin`, all non-empty append chunks, and `finalize` on
one actor-context database transaction/client. `begin` holds a batch advisory
transaction lock and writes only a transaction-local guard. Every append and
finalize requires the guard and a still-verified/inspecting batch, so a later
transaction cannot continue the staging attempt.

The public entrypoints are:

- `begin_neon_import_staging`
- `append_neon_import_sheets`
- `append_neon_import_field_mappings`
- `append_neon_import_source_rows`
- `append_neon_import_issues`
- `append_neon_import_source_labels`
- `finalize_neon_import_staging`

All are `SECURITY DEFINER`, migration-owner-owned, run with an empty
`search_path`, revoke `PUBLIC EXECUTE`, and grant only
`hotel_ld_application`. E5B tables remain FORCE RLS with no application raw
table, sequence, or schema privileges.

## Evidence sealing

The database computes `e5b-canonical-json-sha256-v1`: a canonical JSON manifest
with deterministic collection ordering and SHA-256 record hashes. Finalization
accepts only an identical JSON manifest and SHA-256, recomputes counts, verifies
exactly one selected employee-master sheet, mapping/row consistency, each row
fingerprint, and source-label coverage/counts. It then makes the one allowed
successful lifecycle transition: `verified/inspecting` to
`linked/mapping_required`, incrementing the batch version exactly once and
appending an activity event.

Chunk limits are 250 records. Source-row chunks are capped at 1 MiB; all other
evidence chunks are capped at 512 KiB. Unknown keys, duplicate identifiers,
wrong batch/sheet scope, malformed JSON, unauthorized label types, and append
attempts outside the begun transaction fail closed.

## Offline verification

The Task 4 fixture suite verifies the transaction guard, canonical sealing,
and exact public function ACL. The aggregate E5B source gate now reaches the
expected next failure (`E5B_IMPORT_STAGING_SERVER_BOUNDARY_MISSING`) because
Task 5's server repository has not yet been implemented.

No database connection, migration apply, Storage I/O, Production, Supabase
policy change, or legacy Import state operation was performed for this task.
