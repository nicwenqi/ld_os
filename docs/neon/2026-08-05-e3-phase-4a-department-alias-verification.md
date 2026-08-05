# E3 Phase 4A — Department Alias verification

## Scope and activation

This record covers only the child Neon branch `br-aged-river-az1gke14` at
endpoint `ep-sparkling-shape-az9gxtuh`. Production's denied branch and
endpoint were not connected. The Organization registry continues to construct
`createSupabaseDepartmentRepository`; the two Phase 4A HTTP routes are dark
server boundaries and no UI calls them.

Migration source:
`neon/migrations/202608050008_e3_organization_department_alias.sql`

- SHA-256: `509f9088e61aad68c772d68a2a2fe2f9b80572bc452d079d533950605cae1629`
- rollback rehearsal: passed in one transaction before apply
- apply: child branch only, using the direct bootstrap owner credential

## Security and catalog evidence

`scripts/neon/validate-e3-phase4a.mjs catalog` passed with the approved direct
bootstrap connection. It verified:

- `public.read_neon_organization_department_aliases(text)` and
  `public.resolve_neon_organization_department_alias(text,uuid,text,uuid)`
  exist, are owned by `hotel_ld_migration_owner`, use `SECURITY DEFINER`, have
  fixed `search_path=''`, revoke `PUBLIC EXECUTE`, and grant execute only to
  `hotel_ld_application`.
- `public.department_aliases` and the new
  `app_private.organization_alias_resolution_audit_events` use enabled and
  forced RLS.
- `hotel_ld_application` retains zero raw `department_aliases` table
  privileges. No runtime role, membership, ownership, or BYPASSRLS capability
  was added.
- Alias reads require an active property manager or an active scoped department
  administrator; writes additionally require an active property manager. Both
  predicates bind the actor's transaction-local property.
- Resolution permits only `department`, `ignore`, and `defer`. A Department
  target is locked, current-property, and active before the alias changes.
- The append-only audit relation contains no source value. Its update/delete
  trigger rejects mutation; every successful resolution records request, auth,
  actor, property, prior/result state, and action atomically.

## Application-role negative matrix

`scripts/neon/validate-e3-phase4a.mjs runtime` passed through the pooled
`hotel_ld_application` credential. It proved:

| Case | Result |
| --- | --- |
| application role is NOBYPASSRLS | pass |
| raw alias SELECT is denied | pass |
| raw alias UPDATE is denied | pass |
| exact read/resolve entrypoint execute grants exist | pass |
| entrypoint without actor context is denied | pass |

The test uses neither `SET ROLE` nor an owner connection. It runs in a
read-only transaction; each expected denial is isolated by a savepoint.

## Identity-dependent runtime matrix

The project has no accepted hotel production identity set. The following are
therefore explicitly deferred—not simulated with `neondb_owner`, forged actor
settings, JWT claims, or direct table access:

| Case | Status |
| --- | --- |
| manager property-wide alias read | deferred |
| department administrator property-wide alias read | deferred |
| department administrator resolution denial | deferred |
| manager department / ignore / defer resolution | deferred |
| cross-property and inactive target denial | deferred |
| alias plus audit atomic rollback under a real manager | deferred |
| concurrent alias lock serialization under real actors | deferred |

These tests must run only after development identity acceptance is intentionally
seeded and reviewed. They must use server-side Supabase Auth → trusted hostname
→ `withNeonResolvedActorContext()` → pooled application credential.

## Rollback procedure

Only an approved child-branch migration owner may roll back Phase 4A, after
stopping dark route traffic. In a single transaction: revoke the two public
entrypoint grants; drop the public entrypoints and private payload/predicate
helpers; remove Phase 4A RLS policies; drop the append-only audit relation and
trigger; then revoke the added migration-owner alias/Department column grants.
Re-run the Phase 3 catalog/runtime validation before declaring the child back at
the prior boundary. This is not a Production procedure.

## Regression evidence

- scratch contract tests: 3 passed
- `npm test`: 201 passed, 0 failed
- `npm run build`: passed
- Import still uses the actor-scoped `stage_employee_import` RPC contract.
