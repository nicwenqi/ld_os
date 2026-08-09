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
intent evidence; structurally valid cleanup lease state; a durable cleanup ledger; history and
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
# tests 18; pass 18; fail 0

node scripts/neon/validate-canonical-neon-baseline.mjs source
# root modules 010–080; pass

node --experimental-strip-types --test scripts/neon/canonical-neon-bootstrap-contract.test.mjs scripts/neon/validate-canonical-neon-baseline.test.mjs
# tests 86; pass 86; fail 0
```

`git diff --check` also passed. `psql --version` confirmed the local client is
PostgreSQL 18.4; no target URL was read and no SQL was sent to any database.

## Review-fix round

The review identified two Task 2 concerns. Both are resolved within the E5B
capability layer; the E1–E5A manifest and baseline validator remain unchanged.

- The cleanup-lease CHECK is now strictly structural: an in-progress cleanup
  requires a claim, both timestamps, and `lease_expires_at > last_attempt_at`.
  It contains no current-time function or five-minute comparison. Task 3's
  constrained claim/complete/fail entrypoints will enforce authoritative
  `transaction_timestamp()` and five-minute lease rules at mutation time.
- The source validator now parses every scope policy and requires `FOR ALL TO
  hotel_ld_migration_owner` plus the exact session-user and actor-property
  predicates in both `USING` and `WITH CHECK`. The append-only activity policy
  must instead be `FOR INSERT TO hotel_ld_migration_owner`, omit `USING`, and
  contain the same predicate in `WITH CHECK`.

RED was captured before this implementation: the two new negative fixtures
failed because the missing semantic gates allowed validation to reach the
expected future saga-entrypoint boundary. GREEN adds the policy and
time-dependent-lease gates; the focused suite now passes 18/18.

## Re-review integrity fix

The Task 2 re-review added two release blockers and two hardening checks.
They are now enforced in the 090 schema and its independent source validator:

- `import_storage_operations.object_path` is a server-only ledger copy, but is
  now bound exactly to its batch by the `(batch_id, tenant_id, property_id,
  object_path)` composite foreign key against a matching batch unique key.
- `verified` and `linked` storage states require `verification_status =
  'passed'` plus non-null SHA-256, size, and MIME values exactly equal to the
  declared evidence. A failed verification may only occupy the failed-cleanup
  lifecycle track, while `verification_failed` itself must carry a failed
  verification status.
- The immutable batch-evidence trigger now includes `source_system`.
- Deferred constraint triggers enforce that a non-null `selected_sheet_id`
  identifies the sole selected sheet for its batch, and that a null selection
  has no selected sheet. They run on both batch and sheet changes so a later
  sheet update cannot invalidate a batch selection.

Focused RED captured the four review gaps at the source stage (each advanced
incorrectly to `E5B_IMPORT_STAGING_SAGA_ENTRYPOINT_MISSING`). GREEN adds
validator fixtures for ledger path binding, verified/failed state coherence,
source-system immutability, and selected-sheet exactness. The source suite now
passes 23/23 and the real 090 source gate again stops only at the intentional
Task 3 saga-entrypoint boundary.

## Deferred gates and concerns

- 090 has not been parsed/applied by a PostgreSQL server. Task 9 must execute
  the approved non-production E5B dry-run → apply → catalog → runtime matrix
  after Tasks 3–8 complete. This task performed no network/database work.
- Storage remains a server adapter boundary. The schema contains only provider
  evidence and a cleanup ledger; it creates no Storage schema or policy.
- The timestamp freshness and maximum five-minute cleanup lease are
  intentionally deferred to Task 3's constrained mutation entrypoints; static
  table CHECKs cannot safely use a changing current-time value.
- This source-only task has not parsed or applied the new deferred constraint
  triggers in PostgreSQL. Task 9 remains the approved place for non-production
  dry-run, apply, catalog, and runtime validation.
- Employee commit/revert, mapping decisions and Import activation remain out of
  scope. E5B source rows and labels are immutable staging evidence only.
