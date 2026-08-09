# E5B Task 4 — Atomic workbook-staging entrypoints

## Scope

`092_import_staging_entrypoints.sql` adds the E5B evidence-only mutation
boundary. It does not create employee writes, Import commit/revert authority,
Supabase database compatibility objects, Auth changes, or Storage policies.

## Transaction protocol

The server must call `begin`, all non-empty append chunks, and `finalize` on
one actor-context database transaction/client. `begin` updates the authoritative
batch tuple, whose `xmin` is then required to equal
`pg_current_xact_id()::xid` by every append and finalizer. It also holds a batch
advisory transaction lock and records both the batch ID and resulting `xmin` in
transaction-local guards. This means a
different transaction cannot continue staging even if it forges the local GUC:
its current XID cannot equal the `xmin` written by `begin`.

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

The database computes `e5b-canonical-json-sha256-v1`: PostgreSQL `jsonb`
canonicalization supplies unique, ordered object keys, while
`e5b-utf8-frame-v1` prefixes every hashed payload with its UTF-8 octet length.
The independent E5B manifest inventories the required `pgcrypto` extension and
the catalog validator rejects a runtime catalog that lacks it. Finalization
accepts only an identical JSON manifest and SHA-256, recomputes counts, verifies
exactly one selected employee-master sheet, mapping/row consistency, each row
fingerprint, and source-label coverage/counts. It then makes the one allowed
successful lifecycle transition: `verified/inspecting` to
`linked/mapping_required`, incrementing the batch version exactly once and
appending an activity event.

Source labels resolve only through the unique selected `employee_master` sheet
ID. Their source values must equal the locale-independent NFKC + `C` collation
normalization persisted by the entrypoint; same-name/excluded-sheet ambiguity is
rejected. Every selected-sheet row has bidirectional raw-cell ↔ mapping and
normalized-key ↔ mapping key-set validation.

Raw cells carry the immutable source column index as well as the column name and
target. Duplicate headers are therefore distinguished by the exact evidence
identity `(sheetId, sourceColumnIndex, sourceColumnName, targetField)`. The
stored raw-cell array and row fingerprint are ordered by that identity; both
directions of the final mapping check use the same tuple.

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
