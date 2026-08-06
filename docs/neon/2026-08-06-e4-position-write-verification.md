# E4B Position Write — child-branch verification

## Scope and data classification

This is Recovery E0 migration infrastructure for current organizational
reference data only. It does not create or migrate employee, training,
attendance, KPI, effectiveness, or other historical facts. All database work
was performed against the isolated Neon child endpoint
`ep-sparkling-shape-az9gxtuh` / database `neondb`; Production's endpoint is
explicitly rejected by the validator.

## Applied migrations

- `202608060012_e4_position_write.sql`: audit table, constrained entrypoints,
  RLS policies and ACLs for Position Family and atomic Position saves.
- `202608060013_e4_position_write_lock_hardening.sql`: preserves 012 as
  immutable history and replaces only the Position entrypoint to enforce the
  canonical update lock order: property → family → position → departments →
  assignments. It also makes the Position version increment explicit.

`012` was dry-run with `ROLLBACK` before application. `013` received the same
dry-run treatment before it was applied. Bootstrap uses the direct child URL
only; the pooled `hotel_ld_application` credential is used only for runtime
checks.

## Authorization and audit controls

- API verifies the Supabase session server-side and resolves the hostname's
  property scope server-side. Request tenant/property values are injected from
  that resolved scope, never accepted from the browser.
- `withNeonResolvedActorContext()` remains the sole transaction-scoped actor
  context boundary. E4B does not change Actor Context implementation.
- Only `hotel_ld_application` has `EXECUTE` on
  `save_neon_position_family` and `save_neon_position_with_departments`.
  The application role has no raw privileges on position families, positions,
  assignments, or the private audit relation.
- Both entrypoints are owned by `hotel_ld_migration_owner`, use fixed empty
  `search_path`, are `SECURITY DEFINER`, and revoke `PUBLIC EXECUTE`.
- The audit relation has `FORCE ROW LEVEL SECURITY` and an append-only trigger.
  Each successful mutation appends request, actor, scope, operation, version,
  assignment-count and changed-field metadata in the same transaction.
- Position department replacement is one entrypoint transaction; no Neon
  endpoint exposes the legacy two-step assignment mutation.

## Executed validator matrix

`scripts/neon/validate-e4-position-write.mjs` is source-guarded to the child
endpoint/database and supports `source`, `dry-run`, `apply`, `catalog`, and
`runtime` commands.

| Check | Result |
| --- | --- |
| Source transaction, constrained entrypoints, atomic boundary, hardened lock order | pass |
| 013 bootstrap dry-run rollback | pass |
| 013 child apply | pass |
| Entrypoint owner / SECURITY DEFINER / fixed search path / PUBLIC revoked / exact runtime EXECUTE | pass |
| Audit FORCE RLS and append-only trigger | pass |
| Position update explicitly increments version | pass |
| Application raw privileges on Position/audit tables | denied |
| Entrypoint without actor context | denied |
| Transaction rollback clears actor context | pass |
| Reused connection begins with clear actor context | pass |

## Positive mutation matrix — explicit fixture prerequisite

No synthetic manager identity/property fixture is configured in this child
environment. The following positive behavior matrix therefore remains a
deliberate pre-activation prerequisite, not an inferred result:

| Fixture-backed case | Expected result |
| --- | --- |
| Property manager creates/updates Position Family | success and one audit row |
| Property manager saves Position with ordered department IDs | atomic replacement; first ID is primary; one audit row |
| Department administrator write | `403` / database authorization failure |
| Foreign-property target or inactive family/department | denied or `422`, with rollback |
| Stale family/position version | `409`, no assignment/audit partial write |
| Concurrent saves of one Position | canonical locks serialize; retryable serialization/deadlock maps to `409` |

The fixture must be child-only and disposable. It must run through the pooled
`hotel_ld_application` credential with a server-verified Supabase identity;
never with owner credentials, `SET ROLE`, browser-supplied actor values, or
Production data.

## Activation state

E4B is a dark server boundary only. The Position registry remains on its
Supabase fallback, UI routing is unchanged, and no Import, Employee write, or
Actor Context work is included.
