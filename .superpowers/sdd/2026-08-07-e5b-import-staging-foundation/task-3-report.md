# E5B Task 3 — storage saga and read entrypoints

## Scope

Added the canonical post-baseline module
`neon/canonical/e5b/091_import_saga_entrypoints.sql`. It implements only the
E5B storage-saga mutation/read boundary:

- manager-authorized upload intent, upload observation, and read-back evidence
  recording;
- durable cleanup-pending state, targeted `FOR UPDATE SKIP LOCKED` claim,
  claim-matched completion/failure, five-minute current-time lease checks, and
  bounded retry/error evidence;
- browser-safe workflow and bounded history projections; and
- append-only lifecycle audit evidence.

The schema itself remains in 090. Workbook evidence staging remains deliberately
absent in 092. No Import commit/revert, employee write, Storage policy, Auth,
legacy compatibility object, registry activation, database connection, or
network operation was added.

## Security boundary

- Every public entrypoint is owned by `hotel_ld_migration_owner`, is
  `SECURITY DEFINER`, fixes `search_path = ''`, revokes `PUBLIC EXECUTE`, and
  grants execution only to `hotel_ld_application`.
- Manager authorization derives hostname, property, actor, tenant, and request
  identity from the existing E1 transaction-scoped Actor Context and live Neon
  membership. No caller-supplied property, role, tenant, actor, object path, or
  request identity is trusted.
- Existing 090 `FORCE RLS` and raw-table privilege zero remain unchanged.
- Cleanup locks batch then ledger consistently. Lease eligibility and
  completion/failure claim freshness use `clock_timestamp()` inside entrypoints,
  never a time-dependent table `CHECK`.
- Public workflow/history projections omit object paths, full checksums,
  cleanup errors, and internal actor data. The Storage object path is returned
  only by server-only intent/claim mutation entrypoints.

## TDD evidence

RED was observed with a malformed claim migration: source validation reached
`E5B_IMPORT_STAGING_WORKBOOK_ENTRYPOINT_MISSING` before it had a saga lease
guard. The new focused test required
`E5B_IMPORT_STAGING_SAGA_CURRENT_TIME_LEASE_GUARD_MISSING`; it failed as
expected before the saga validator was implemented, then passed after GREEN.

## Validation

- `node --test scripts/neon/validate-e5b-import-saga-entrypoints.test.mjs scripts/neon/validate-e5b-import-staging-schema.test.mjs scripts/neon/validate-e5b-import-staging.test.mjs` — 24/24 passed.
- `node scripts/neon/validate-e5b-import-staging.mjs source` — correctly stops
  at `E5B_IMPORT_STAGING_WORKBOOK_ENTRYPOINT_MISSING`, the next unimplemented
  Task 4 boundary.
- `npm test` — 201/201 passed, including build and rendered route check.
- Canonical source/contract focused suite — 91/91 passed.
- `git diff --check` — passed.

No PostgreSQL parser/apply/catalog/runtime check was run: Task 4 is intentionally
not installed and E5B live validation remains the later approved Task 9 gate.
