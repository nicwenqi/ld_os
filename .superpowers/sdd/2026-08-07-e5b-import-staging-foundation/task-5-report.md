# E5B Task 5 — Neon staging repository

## Delivered

- Added the server-only `ImportStagingRepository` adapter. It calls only the
  approved 090–092 constrained entrypoints using standalone literal queries
  and typed parameters; it never issues raw-table SQL.
- Added strict parser-evidence preflight before `begin_neon_import_staging`:
  exact named fields, UUID/checksum/enums, NFKC source-label evidence,
  source-row fingerprints, selected-sheet/mapping/issue/label relationships,
  deterministic IDs for evidence types that intentionally have no parser ID,
  and deterministic ordering.
- The finalize manifest now mirrors 092’s authoritative projections exactly:
  field-mapping transport IDs are excluded; issue defaults are represented as
  `sourceField: null`, `sourceValueProjection: null`, and
  `resolutionStatus: "open"`; label projections derive `sheetId` and use
  `resolutionStatus: "pending"`.
- Added fixed transport bounds: 250 records / 1 MiB for source rows and 250
  records / 512 KiB for the other evidence collections. Bounds use a
  conservative PostgreSQL-JSONB textual/structural upper bound rather than
  JSON transport text alone. A single oversized record fails before any
  staging SQL.
- Source-label normalization follows PostgreSQL ordering precisely: U+0020
  `btrim`, then NFKC normalization, then `COLLATE "C"` equivalent ASCII-only
  lowercase. It deliberately does not pre-trim non-breaking spaces or apply
  Unicode case folding.
- Added the minimal server-only cleanup `operationId` correction. It matches
  the frozen 091 cleanup entrypoint signatures. Cleanup claim remains an
  array because 091 claims a bounded batch; operation IDs remain absent from
  all browser-safe projections.
- Added a source audit for the repository’s server-only boundary, exact
  16-query allowlist, preflight order, canonical evidence functions, chunk
  limits, and raw-table/employee-mutation/query-alias/reflection rejection.
  The token audit permits only direct `database.query(<approved literal>,
  [typed values])` calls; function extraction, destructuring, database aliases,
  optional chaining, bracket/computed access, `Object.create`,
  `call`/`apply`/`bind`, `Reflect`, and `Proxy` are fail-closed.

## Verification

```text
node --experimental-strip-types --test \
  scripts/neon/validate-e5b-import-staging.test.mjs \
  scripts/neon/validate-e5b-import-staging-schema.test.mjs \
  scripts/neon/validate-e5b-import-staging-entrypoints.test.mjs \
  scripts/neon/validate-e5b-import-staging-repository.test.mjs
# 45 passed, 0 failed

npm run build
# passed

node scripts/neon/validate-e5b-import-staging.mjs source
# expected RED: E5B_IMPORT_STAGING_READBACK_VERIFICATION_MISSING
```

No database, Storage, Supabase, or network operation was run.

## Deferred boundary

The aggregate E5B source gate now deliberately stops at the next required
capability: full server read-back object verification. Task 6 must provide it
before the source gate can proceed to saga coordination and dark API work.
