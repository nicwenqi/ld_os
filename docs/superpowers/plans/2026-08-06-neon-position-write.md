# E4B Neon Position Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a child-only, server-side Neon mutation boundary for Position families and atomic Position-with-department-assignment saves while the application registry remains Supabase-backed.

**Architecture:** Existing Supabase Auth resolves the actor, then the unchanged E1 transaction context establishes actor/property/request state for a pooled `hotel_ld_application` connection. Two constrained `SECURITY DEFINER` entrypoints owned by `hotel_ld_migration_owner` perform the entire mutation under forced RLS; a dark server repository/API calls only those entrypoints. No browser reaches Neon, and no independent Position/assignment mutation route exists.

**Tech Stack:** PostgreSQL 18 on Neon, `pg`, TypeScript, Next-compatible route handlers, Supabase Auth SSR, Node.js test runner.

## Global Constraints

- Child branch only: `br-aged-river-az1gke14` / `ep-sparkling-shape-az9gxtuh` / `neondb`; never connect to the Production deny-list.
- Use direct `NEON_BOOTSTRAP_DATABASE_URL` only for migration; use pooled `DATABASE_URL` only as `hotel_ld_application` for runtime validation; never print credentials.
- Do not change `app/lib/neon/actor-context.ts`, E1/E2/E3 migrations, E4A read migration, registry, UI, Import, or Position aliases/mapping.
- Do not add roles or grant `hotel_ld_application`, `hotel_ld_people_read`, or `hotel_ld_readonly` raw Position table/column privileges.
- Each public entrypoint is `SECURITY DEFINER`, owner `hotel_ld_migration_owner`, `search_path=''`, no PUBLIC execute, and an exact `hotel_ld_application` execute grant.
- All protected writes require runtime session, actor context, trusted hostname/property, active property-manager authority, property scope validation, RLS, and append-only audit.
- The only Neon Position mutation path is atomic `savePositionWithDepartments` semantics. Do not port `savePosition()` plus `assignPositionToDepartments()`.
- Do not edit files in `tests/`; leave TDD scratch under `.superpowers/sdd/` untracked. Preserve 201/201 and a successful build.

---

## File map

- Create: `neon/migrations/202608060012_e4_position_write.sql`
- Create: `app/repositories/neon/position-write-repository.ts`
- Create: `app/api/organization/position-families/[id]/route.ts`
- Create: `app/api/organization/positions/[id]/route.ts`
- Modify: `app/api/organization/position-families/route.ts`
- Modify: `app/api/organization/positions/route.ts`
- Modify: `app/services/neon-position-authorization.ts`
- Modify: `app/services/neon-organization-errors.ts`
- Create: `scripts/neon/validate-e4-position-write.mjs`
- Create: `docs/neon/2026-08-06-e4-position-write-verification.md`

## Tasks

### Task 1: RED contracts and child validator

**Files:** scratch only under `.superpowers/sdd/2026-08-06-e4-position-write/`; create `scripts/neon/validate-e4-position-write.mjs` after RED.

- [ ] Write separate failing tests for the missing write repository, atomic entrypoint names, explicit `department_ids` payload, and child-only URL guards.
- [ ] Run the scratch tests and capture the expected missing-module failure.
- [ ] Implement only sanitized URL guard exports and re-run their tests; do not connect until the migration source exists.

### Task 2: Atomic Position database boundary

**Files:** create `neon/migrations/202608060012_e4_position_write.sql`; modify validator.

- [ ] Add fail-closed bootstrap/catalog preflight for E1/E3/E4A prerequisites, forced RLS, roles, zero raw runtime privileges, and object absence.
- [ ] Add minimal migration-owner grants plus command-specific RLS policies needed by constrained definer writes; never grant runtime raw access.
- [ ] Create append-only `app_private.position_write_audit_events`, FORCE RLS, update/delete rejection trigger, and private writer/audit helpers.
- [ ] Create `public.save_neon_position_family(...)` and `public.save_neon_position_with_departments(...)`, each asserting runtime/actor/hostname/manager/property before mutation.
- [ ] In Position save, lock in order: property → optional family (`FOR KEY SHARE`) → target Position (`FOR UPDATE`) → target Departments ordered by UUID (`FOR KEY SHARE`) → existing assignments ordered by department ID (`FOR UPDATE`). Validate all input before delete/insert; replace assignments in one transaction and mark the first request-array ID primary.
- [ ] Use `expectedVersion=0` only for create; update must lock, verify version, increment once, and return Position plus ordered `department_ids`.
- [ ] Revoke PUBLIC and all non-runtime function execution, grant only application EXECUTE, and assert exact owner/search path/ACL/RLS/raw privilege/audit invariants in postflight.
- [ ] Run source → dry-run → apply → catalog with child-only validator.

### Task 3: Server repository and dark mutation APIs

**Files:** create write repository and `[id]` routes; modify two existing E4A route files, position authorization, and error mapping.

- [ ] Write RED tests for strict body parsing, forbidden query parameters, method boundaries, and 401/403/404/409/422 mapping.
- [ ] Implement a server-only `Pick<PositionRepository, "savePositionFamily" | "savePositionWithDepartments">` write repository using parameterized entrypoint calls only.
- [ ] Add server actor-transaction write runner that reuses existing property resolution and never accepts browser identity/scope as proof.
- [ ] Add dark POST/PATCH routes for the two contracts. Position routes accept the full department array and never expose a separate assignment mutation endpoint.
- [ ] Keep reads unchanged, leave registry/UI on Supabase, and confirm no client bundle imports `pg`.

### Task 4: Runtime matrix and handoff evidence

**Files:** modify validator; create verification record.

- [ ] Validate application role identity, NOBYPASSRLS, raw Position/assignment/audit denial, exact entrypoint EXECUTE, no-actor denial, rollback cleanup, and connection reuse.
- [ ] With configured child identities, validate manager success; department-admin denial; cross-property denial; stale family/Position conflicts; invalid/duplicate/inactive departments; inactive/cross-property family; atomic rollback; primary ordering; and audit ACL/append-only behavior. Record unavailable identity cases as deferred without owner/`SET ROLE` simulation.
- [ ] Run `npm test` and `npm run build`, write evidence-only verification documentation, and commit only E4B assets from the isolated branch.
