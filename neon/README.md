# Neon migrations

This directory contains the reviewed Neon migration units for Hotel L&D OS.
E1 Authorization Foundation and E2 People read-only were applied on
2026-08-04, and E3 Organization Department read Phase 1 was applied on
2026-08-05. Every unit was applied only to the isolated development child:

- project: `flat-brook-43278549`
- branch: `br-aged-river-az1gke14`
- endpoint: `ep-sparkling-shape-az9gxtuh`
- database: `neondb`

The production branch `br-twilight-leaf-azmowo1k` and endpoint
`ep-wild-wave-azjmgdif` are an explicit deny-list. No migration in this
directory may be run against either identifier.

## Applied units

| Unit | Purpose | SHA-256 |
| --- | --- | --- |
| `202608040000_e1_role_bootstrap.sql` | Constrained migration, runtime, People-read, and dormant readonly roles | `0e317e74b81a4f99c42e3332f78cc4233295b62954cf00e6645dc83f98638792` |
| `202608040001_e1_actor_context.sql` | Private transaction-local actor readers and assertion | `27e75682e629f0b86e06e127bc295b6bb5d130074b8a9657b2b5246cc188a3d1` |
| `202608040002_e1_auth_uid_compatibility.sql` | Guarded `auth.uid()` bridge with dependency-drift assertions | `e3d22e956e0b718c6917139a03db132d8ed0e552b00ed25955bf8d4e8766797f` |
| `202608040003_e2_people_readonly.sql` | Live property/role/department authorization, forced-RLS policies, and narrow People read entry points | `bc23eb919c30d2eae98faa7c1f0b05ad6501442890238de4253c3297de1a84f7` |
| `202608040004_e3_organization_department_read.sql` | Narrow Organization Department read entry points; no write path | `a7cc39522062fb313d34417ea1754e50639454bffc9693744412014e87f3da5d` |

Each unit is independently preflighted and transaction-wrapped. A failed
preflight aborts the whole unit. Checksums identify the exact revisions that
were reviewed and applied; changing a file requires a new review and a new
execution decision.

## E3 Organization Phase 1 status

The E3 migration committed atomically on the approved child. Post-commit
application-role validation proved the exact two entry points, zero raw
Organization grants, 5/5 forced-RLS tables, unchanged E2 inventory, zero
runtime ownership, and transaction-context isolation across commit, rollback,
pool reuse, and concurrency.

Positive manager and department-scoped identity acceptance remains
**DEFERRED** because the child account system does not currently contain an
active identity matching the repository's synthetic fixture IDs. Registry
activation remains **NOT ACTIVATED** and the Supabase Organization fallback
remains **ACTIVE**. See
[`docs/neon/2026-08-04-e3-phase-1-department-read-verification.md`](../docs/neon/2026-08-04-e3-phase-1-department-read-verification.md)
for the exact evidence and remaining acceptance matrix. The completed migration
used `NEON_BOOTSTRAP_DATABASE_URL` only as a guarded child bootstrap input; it
was never substituted for runtime `DATABASE_URL` and was not used after the
migration committed. Phase 2's first hardening gate remains the approved legacy
closure-trigger exception before any Neon Department write.

## Role boundary

- `hotel_ld_migration_owner` is a constrained `LOGIN`, `NOINHERIT`,
  `NOBYPASSRLS` DDL/object owner. It is never a runtime credential.
- `hotel_ld_application` is the server runtime `LOGIN`, `NOINHERIT`,
  `NOBYPASSRLS`, and owns no database object.
- `hotel_ld_people_read` is a `NOLOGIN` permission group. The application role
  inherits it but cannot `SET ROLE` into it.
- `hotel_ld_readonly` is a dormant `NOLOGIN` group with no E1 data grants.
- `neondb_owner` remains bootstrap-only and must never be placed in
  `DATABASE_URL`.

The bootstrap owner retains the ability to `SET ROLE` to
`hotel_ld_migration_owner` for separately reviewed migration and rollback
transactions. That edge does not grant any privilege to the application role
and is never part of the runtime path.

The two login roles intentionally have no password in migration SQL. Credential
provisioning and child-only connection URLs are external secret-management
steps. E1 did not change local or deployed `DATABASE_URL` values and did not
activate the application role for existing repositories.

## Actor context contract

Server code verifies the Supabase Auth user, accepts only trusted server
hostname context, creates a request UUID, and calls
`withNeonResolvedActorContext()`. The wrapper checks out one pool client,
starts one `REPEATABLE READ` transaction, resolves the hostname to a live
property on that same client, and first proves that both `current_user` and
`session_user` are exactly
`hotel_ld_application`. It also rechecks the runtime role's `NOBYPASSRLS`
attributes, its single constrained membership, and zero application-object
ownership for both runtime roles before installing only:

- `app.actor_auth_user_id`
- `app.actor_property_id`
- `app.actor_request_id`

The values are set with `set_config(..., true)`, so they are transaction-local.
The wrapper checks for contamination both before `BEGIN` and after
`COMMIT`/`ROLLBACK`; a cleanup or transaction-safety failure discards the pool
connection. It never uses persistent session `SET`.

`app_private` actor functions are owner-only helpers for future constrained
repository entry points. The application login has no direct `app_private`
access. `auth.uid()` is a guarded compatibility bridge, not JWT-claim
simulation; the application login cannot execute it directly.

## E2 People boundary

E2 grants the runtime no raw business-table access. It exposes only five
reviewed `public` functions through `hotel_ld_people_read`; their predicates
derive property membership, role, department scope, and department descendants
from live Neon authorization rows. The application still reaches them only
through a server repository inside the actor transaction. Browser code uses
same-origin People HTTP endpoints and never receives a database connection
string.

E2 status is Architecture: **COMPLETE**; Runtime/RLS: **COMPLETE**; Production
identity acceptance: **DEFERRED**. The child-only pooled
`hotel_ld_application` credential, runtime role, RLS boundary, and
actor-context isolation have been verified. Production acceptance awaits the
future production account set and must not use owner or migration-role
substitution.

E3 Phase 2 may reuse this pattern only after its separately approved review
gate. Position, Employee writes, import commit, training facts, and broad
repository replacement remain out of scope.

See
[`docs/neon/2026-08-04-e1-implementation-record.md`](../docs/neon/2026-08-04-e1-implementation-record.md)
and
[`docs/neon/2026-08-04-e2-people-readonly-verification.md`](../docs/neon/2026-08-04-e2-people-readonly-verification.md)
for execution evidence, validation results, and rollback boundaries. The
earlier E1-A review package remains a historical pre-execution artifact.
