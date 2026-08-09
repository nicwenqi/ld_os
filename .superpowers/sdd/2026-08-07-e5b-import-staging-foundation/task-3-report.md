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
- Cleanup claims lock the ledger and matching batch together through a single
  `FOR UPDATE OF operation, batch SKIP LOCKED` selection. Lease eligibility and
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

- `node --test scripts/neon/validate-e5b-import-saga-entrypoints.test.mjs scripts/neon/validate-e5b-import-staging-schema.test.mjs scripts/neon/validate-e5b-import-staging.test.mjs` — 30/30 passed.
- `node scripts/neon/validate-e5b-import-staging.mjs source` — correctly stops
  at `E5B_IMPORT_STAGING_WORKBOOK_ENTRYPOINT_MISSING`, the next unimplemented
  Task 4 boundary.
- `npm test` — 201/201 passed, including build and rendered route check.
- Canonical source/contract focused suite — 91/91 passed.
- `git diff --check` — passed.

No PostgreSQL parser/apply/catalog/runtime check was run: Task 4 is intentionally
not installed and E5B live validation remains the later approved Task 9 gate.

## Review correction

The Task 3 review required four lifecycle/concurrency corrections. The current
implementation and focused RED→GREEN fixtures now prove that:

- `uploaded_unverified` may transition directly to `cleanup_pending` for an
  ambiguous upload outcome;
- verification failure and every cleanup-pending transition terminalize the
  workbook as `failed`; verification failure also records failed verification
  status;
- every ledger mutation path (verification retry, cleanup-pending retry,
  claim, completion, and failure) refreshes `updated_at`; and
- `claim_neon_import_cleanup` accepts an optional server-targeted batch while
  using its real bounded `p_limit` for property-wide claims. It acquires the
  ledger and matching batch through one `FOR UPDATE OF operation, batch SKIP
  LOCKED` query, then rechecks the lease with current time after locking.

The correction fixtures were RED before these changes: transition removal,
non-terminal verification/cleanup state, a missing ledger timestamp refresh,
an ignored limit, and a blocking pre-claim batch lock each failed the static
validator. They now pass without a database connection.
