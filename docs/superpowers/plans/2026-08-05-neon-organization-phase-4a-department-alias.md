# Neon Organization Phase 4A Department Alias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a child-only, actor-scoped Neon Department Alias read and atomic
resolution boundary while the browser Organization registry remains Supabase.

**Architecture:** Supabase Auth, trusted hostname resolution, and the unchanged
transaction-scoped Actor Context establish the caller. The existing application
role calls exact constrained PostgreSQL entry points; forced RLS constrains the
NOBYPASSRLS migration-owner definer to the actor's live property/role. A new
server-only alias repository and dark API routes preserve the existing
`DepartmentRepository` alias contract without activating the registry.

**Tech Stack:** Neon PostgreSQL, `pg`, TypeScript, Next-compatible route
handlers, Supabase Auth SSR, Node.js test runner.

## Global Constraints

- Database writes run only on child branch `br-aged-river-az1gke14`, endpoint
  `ep-sparkling-shape-az9gxtuh`, database `neondb`.
- Bootstrap uses only direct `NEON_BOOTSTRAP_DATABASE_URL` as `neondb_owner`;
  runtime uses only pooled `DATABASE_URL` as `hotel_ld_application`.
- Never connect to Production branch `br-twilight-leaf-azmowo1k` or endpoint
  `ep-wild-wave-azjmgdif`; do not print or commit connection material.
- Do not modify E1 Actor Context, E2 People topology, Position, Import,
  Employee write, Operational Units, Supabase Auth, Supabase Storage, or the
  Organization registry.
- Keep Supabase Organization fallback active. Do not modify files under
  `tests/`; temporary TDD tests live under `.superpowers/sdd/` and are never
  staged.
- Add no role/membership, do not give `hotel_ld_application` raw table or
  column privilege, object ownership, `BYPASSRLS`, or bootstrap credentials.
- Public definer entry points require fixed `search_path=''`, PUBLIC EXECUTE
  revoked, exact application EXECUTE grants, actor/property checks, and
  migration-owner ownership.

---

## File map

- Create `neon/migrations/202608050008_e3_organization_department_alias.sql`:
  child-only preflight, constrained helpers/policies/audit, read/resolution
  entry points, postflight, and rollback notes.
- Create `app/repositories/neon/department-alias-repository.ts`: strict
  `listAliases`/`approveMapping` implementation over exact entry points.
- Create `app/api/organization/departments/aliases/route.ts`: dark reader API.
- Create `app/api/organization/departments/aliases/[id]/resolution/route.ts`:
  dark manager-only resolver API.
- Modify `app/services/neon-organization-authorization.ts`: narrow alias
  repository authorization runners reusing the existing Actor Context.
- Modify `app/services/neon-organization-errors.ts`: map alias business codes.
- Create `scripts/neon/validate-e3-phase4a.mjs`: guarded child migration,
  catalog, and runtime-denial checks.
- Create `docs/neon/2026-08-05-e3-phase-4a-department-alias-verification.md`:
  applied checksum, security/runtime evidence, fallback status, and deferred
  identity acceptance if applicable.

### Task 1: Write failing alias boundary contracts

**Files:**
- Create `.superpowers/sdd/2026-08-05-neon-organization-phase-4a/department-alias-contract.test.mjs`
- Create `.superpowers/sdd/2026-08-05-neon-organization-phase-4a/connection-guard.test.mjs`

- [ ] Write a source-level test that imports the future repository and asserts
  `listAliases()` calls only `read_neon_organization_department_aliases`, while
  `approveMapping()` calls only
  `resolve_neon_organization_department_alias` with `[hostname, aliasId,
  action, targetDepartmentId]` parameters.
- [ ] Assert `department` requires a UUID target; `ignore` and `defer` require
  no target; `operational_unit`, `merge`, `created_top_level`, and
  `created_child` fail before a query can be issued.
- [ ] Assert child URL guards accept only direct bootstrap owner and pooled
  application URLs for the approved child and reject the Production endpoint.
- [ ] Run both scratch tests and record RED failures caused by missing repository
  and validator files. Do not stage scratch tests.

### Task 2: Implement the constrained database and validation harness

**Files:**
- Create `neon/migrations/202608050008_e3_organization_department_alias.sql`
- Create `scripts/neon/validate-e3-phase4a.mjs`

- [ ] Add a single transaction with preflight that asserts child bootstrap
  identity, unchanged runtime role topology, FORCE RLS on aliases/Departments,
  Phase 3 baseline objects, zero raw application privileges, and absence of
  Phase 4A objects.
- [ ] Create private invoker helpers for property-wide alias reader and manager
  resolver predicates. The reader accepts a live manager or an active scoped
  department admin; the resolver accepts only a live manager. Both require
  `session_user='hotel_ld_application'` and current actor property equality.
- [ ] Add only the migration-owner SELECT/UPDATE columns needed for aliases,
  target Department visibility, and a new private append-only audit table.
  Create forced-RLS SELECT/UPDATE/INSERT policies matching the helpers.
- [ ] Create exact public entry points with `SECURITY DEFINER` and
  `search_path=''`. The read entry point returns the existing `DepartmentAlias`
  data shape. The resolver executes `FOR UPDATE` on the alias, locks/rechecks a
  same-property active target for `department`, updates resolution/approval,
  appends an audit record, and returns the authoritative alias. Unsupported
  actions raise a Phase 4A 422 code.
- [ ] Revoke PUBLIC/unrelated execute and grant only exact signatures to
  `hotel_ld_application`. Postflight asserts ownership, paths, ACLs, policies,
  append-only audit trigger, zero raw runtime privilege, and no topology drift.
- [ ] Implement commands `dry-run`, `apply`, `catalog`, and `runtime` in the
  validator. Guards must never emit URLs. `runtime` proves runtime identity,
  NOBYPASSRLS, no raw alias access, entrypoint actor-context denial, and direct
  table-read denial.
- [ ] Run `dry-run` before `apply`; apply only after it rolls back successfully;
  then run `catalog` and `runtime` against the child.

### Task 3: Add server repository and dark HTTP boundary

**Files:**
- Create `app/repositories/neon/department-alias-repository.ts`
- Modify `app/services/neon-organization-authorization.ts`
- Modify `app/services/neon-organization-errors.ts`
- Create `app/api/organization/departments/aliases/route.ts`
- Create `app/api/organization/departments/aliases/[id]/resolution/route.ts`

- [ ] Implement `Pick<DepartmentRepository, 'listAliases' | 'approveMapping'>`
  using parameterized calls and strict payload mapping. `approveMapping`
  supports only `department`, `ignore`, and `defer`; it rejects every
  operational-unit or create/merge action with a local 422-equivalent error.
- [ ] Add alias read/write authorization runners that reuse the existing
  server-side identity, hostname/property resolver, request ID, and
  `withNeonResolvedActorContext`. Do not change Actor Context or existing
  Department read/write runners.
- [ ] Add dark routes. GET accepts no query parameters and uses the reader
  runner. POST canonicalizes alias UUID and only allow-lists `{ action,
  targetDepartmentId }`, then uses manager-write runner. Malformed/forged input
  returns 400; missing session 401; database property/role denial 403; missing
  current-property records 404; unsupported/inactive target 422.
- [ ] Run scratch tests to prove GREEN; run `npm test` and `npm run build`.

### Task 4: Validate and document the non-activated vertical slice

**Files:**
- Create `docs/neon/2026-08-05-e3-phase-4a-department-alias-verification.md`

- [ ] Record child-only migration checksum, direct/pooled role guards, public
  function owner/path/ACL results, RLS policies, zero raw alias privilege, and
  actor-context/direct-read denials.
- [ ] Run the real development identity matrix when eligible accounts exist:
  manager property-wide read and each resolution; department-admin property-wide
  read with mutation denied; cross-property target denied; inactive target
  denied; alias/audit rollback atomicity; append-only audit accuracy. If no
  matching identities exist, mark only those positive cases deferred and do not
  bypass with owner credentials or claims.
- [ ] Re-run full `npm test` (201/201) and separate `npm run build`; confirm
  registry continues to instantiate the Supabase Department repository and
  Import retains `actorClient.rpc('stage_employee_import')`.
