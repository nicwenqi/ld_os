# E5B Import Staging Verification

This record covers the canonical Neon E5B staging capability only. It does not
apply, repair, or inspect the retired Supabase/Neon migration environments.

## Approved target

Validation is fail-closed to this exact non-production target tuple:

| Field | Redacted evidence |
| --- | --- |
| project | `delicate-wind-06430851` |
| branch | `br-icy-scene-aukkzv69` |
| endpoint | `ep-frosty-math-audxlq88` |
| database | `neondb` |
| PostgreSQL | 18 |
| migration role | `neondb_owner` (direct endpoint only) |
| runtime role | `hotel_ld_application` (pooled endpoint only) |

The production branch and endpoint deny-list is enforced in
`scripts/neon/validate-e5b-import-staging.mjs`. Connection strings, passwords,
object contents, and checksums are intentionally absent from this record.

## Validation gates

| Gate | Command | Result in this worktree |
| --- | --- | --- |
| Source contract | `node scripts/neon/validate-e5b-import-staging.mjs source` | PASS (connection-free) |
| Bootstrap dry-run | `... dry-run` | PENDING approved child credential |
| Child apply | `... apply` | PENDING approved child credential |
| Catalog/RLS/ACL | `... catalog` | PENDING approved child credential |
| Runtime matrix | `... runtime` | PENDING approved pooled runtime credential |
| Storage adapter matrix | `... storage-runtime` | DEFERRED until synthetic adapter is explicitly supplied |

The pending gates are deliberately not simulated. The validator reads
`NEON_BOOTSTRAP_DATABASE_URL` only for `dry-run`, `apply`, and `catalog`, and
reads pooled `DATABASE_URL` only for `runtime`. It never connects until the
source gate passes and both URLs match the approved target and role topology.

## What each gate proves

### Dry-run

All three E5B modules are stripped only of their module-level `BEGIN/COMMIT`
frames and executed inside one outer transaction. The validator runs the full
catalog matrix, rolls the transaction back, and compares a redacted catalog
state proof before and after. Any state drift fails the gate.

### Apply and catalog

`apply` uses the direct bootstrap role, runs the modules in order, validates
the catalog before committing, and returns only counts and booleans. `catalog`
uses `BEGIN READ ONLY` and checks:

- all eight E5B relations are present and owned by `hotel_ld_migration_owner`;
- RLS and FORCE RLS are enabled;
- every public entrypoint is owned by the migration owner, SECURITY DEFINER,
  fixed to `search_path = ''`, not executable by PUBLIC, and executable by
  `hotel_ld_application`;
- `hotel_ld_application` is login/NOBYPASSRLS, owns no runtime object, and has
  no raw table, sequence, column, schema, or private-table privilege;
- the append-only activity audit trigger is enabled;
- Auth/Storage schemas, legacy commit/revert/provenance/compatibility objects,
  and unexpected E5B rows are absent.

### Runtime

The runtime gate opens a separate pooled connection as
`hotel_ld_application`. It checks identity and catalog through the bootstrap
connection, then runs only transaction-scoped actor-context and connection
reuse probes plus the injected runtime matrix. It does not use `SET ROLE`,
does not return a credential, and does not fall back to Supabase on failure.

## Task 10 offline matrix

The connection-free Task 10 fixture exercises the same runtime contract without
opening Neon or Storage:

| Probe | Offline result |
| --- | --- |
| application raw table read | PASS (SQLSTATE 42501 fixture) |
| application raw table write | PASS (SQLSTATE 42501 fixture) |
| transaction-local actor cleanup | PASS |
| pooled connection reuse cleanup | PASS |
| concurrent actor isolation | PASS (two injected clients) |
| automatic Supabase fallback | OFF |
| Storage read-back checksum/size/content MIME | PASS (synthetic adapter) |
| exact-path cleanup retry | PASS (synthetic adapter) |

The live child runtime gate remains pending until an explicitly approved
pooled `hotel_ld_application` credential is supplied. The default matrix is
fail-closed when a pooled runtime fixture is unavailable; it never reports a
synthetic PASS for a missing connection or Storage adapter.

## Safety notes

- No Production endpoint or branch is accepted by the URL guard.
- The validator never executes SQL during `source` validation.
- Storage upload/read-back/deletion is outside Neon transactions; the
  `storage-runtime` gate remains adapter-injected and synthetic-only.
- Existing `app/api/import/inspect/route.ts` remains unchanged and retains its
  actor-scoped `actorClient.rpc("stage_employee_import")` contract.
- No Import commit/revert, Auth migration, Storage policy change, or registry
  activation is part of E5B staging validation.
