# Neon Organization Phase 4B Operational Units Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an actor-scoped, Neon Operational Unit read/create/update boundary while the browser Organization registry remains Supabase.

**Architecture:** Server-side Supabase Auth and trusted hostname resolution establish the actor. Existing `withNeonResolvedActorContext()` supplies transaction-local identity/property/request data to the pooled application role. Exact constrained PostgreSQL entry points, forced RLS, and a server-only repository provide the dark vertical slice.

**Tech Stack:** Neon PostgreSQL, `pg`, TypeScript, Next-compatible route handlers, Node.js test runner.

## Global Constraints

- Work only in child branch `br-aged-river-az1gke14` / endpoint `ep-sparkling-shape-az9gxtuh`; deny Production.
- Bootstrap uses direct `NEON_BOOTSTRAP_DATABASE_URL` as `neondb_owner`; runtime uses pooled `DATABASE_URL` as `hotel_ld_application`.
- Do not change Actor Context, roles/membership, raw application privileges, registry, UI, Position, Import, Employee writes, or Operational Unit aliases.
- `hotel_ld_application` remains NOBYPASSRLS, non-owner, and has zero raw `operational_units` privilege.
- Public entry points are migration-owner `SECURITY DEFINER`, fixed `search_path=''`, PUBLIC EXECUTE revoked, and exact application EXECUTE granted.
- Scratch tests are under `.superpowers/sdd/` and are never staged. Existing `tests/` files are never edited.

---

### Task 1: Capture failing Operational Unit contracts

**Files:**
- Create: `.superpowers/sdd/2026-08-05-neon-organization-phase-4b/operational-unit-contract.test.mjs`
- Create: `.superpowers/sdd/2026-08-05-neon-organization-phase-4b/connection-guard.test.mjs`

**Produces:** A source-level contract that requires exact `read`, `create`, and `update` entrypoint names; rejects an alias route or registry activation; and validates child-only URL guards.

- [ ] Write tests asserting a future repository uses only `read_neon_organization_operational_units`, `create_neon_organization_operational_unit`, and `update_neon_organization_operational_unit` with parameterized queries.
- [ ] Write tests asserting dark read/create/update routes use Operational Unit runners and no `createRepositoryRegistry` import.
- [ ] Write tests asserting the validator includes explicit child/bootstrap/runtime/Production guards.
- [ ] Run the scratch tests and observe RED because the repository, routes, and validator do not exist.

### Task 2: Add the constrained database boundary

**Files:**
- Create: `neon/migrations/202608050009_e3_organization_operational_units.sql`
- Create: `scripts/neon/validate-e3-phase4b.mjs`

**Consumes:** E1 Actor Context, E3 Department reader/manager predicates, and the Phase 4A role topology.

**Produces:** `read_neon_organization_operational_units(text)`, `create_neon_organization_operational_unit(...)`, `update_neon_organization_operational_unit(...)`, forced RLS policies, and append-only audit records.

- [ ] Add a single transaction preflight that asserts child bootstrap identity, Phase 4A baseline, forced RLS, NOBYPASSRLS application role, and absent Phase 4B objects.
- [ ] Add private reader/mutation predicates: manager property-wide; department admin only if `neon_organization_actor_can_read_department(unit.department_id)` is true; mutation manager-only.
- [ ] Add migration-owner-only Operational Unit and Department column grants, forced-RLS SELECT/INSERT/UPDATE policies, plus a private append-only audit relation and trigger.
- [ ] Add read payload entrypoint and create/update entrypoints. Each validates runtime/actor/hostname/property; create validates active Department and parent; update locks the source and parent, checks expected version, same-Department parent, self/descendant cycles, and cross-Department-with-children rejection; all mutations append audit atomically.
- [ ] Revoke PUBLIC/unrelated EXECUTE, grant exact signatures only to application, and postflight-check owner/path/ACL/RLS/audit/raw privileges.
- [ ] Implement validator `dry-run`, `apply`, `catalog`, and `runtime`. Runtime proves no raw table privilege, no actor-context entrypoint denial, and direct raw table read/write denial.
- [ ] Run guarded `dry-run`, then child-only `apply`, `catalog`, and `runtime`.

### Task 3: Add server repository and dark HTTP routes

**Files:**
- Create: `app/repositories/neon/operational-unit-repository.ts`
- Modify: `app/services/neon-organization-authorization.ts`
- Modify: `app/services/neon-organization-errors.ts`
- Create: `app/api/organization/operational-units/route.ts`
- Create: `app/api/organization/operational-units/[id]/route.ts`

**Consumes:** Exact Phase 4B database functions and existing `DepartmentRepository` Operational Unit input/model types.

**Produces:** A server-only `Pick<DepartmentRepository, 'listOperationalUnits' | 'createOperationalUnit' | 'saveOperationalUnit'>` subset and dark same-origin APIs.

- [ ] Implement strict payload mapping, parameterized queries, UUID/type validation, and create/update scope checks in the repository.
- [ ] Add narrowly named Operational Unit read and write authorization runners which reuse server identity, property resolution, request ID, and existing Actor Context without modifying it.
- [ ] Add GET, POST, and PATCH routes with allow-listed input; canonical UUID and expected-version handling; and existing 400/401/403/404/409/422/503 response conventions.
- [ ] Run scratch tests GREEN, then `npm test` and `npm run build`.

### Task 4: Record runtime evidence and integration guardrails

**Files:**
- Create: `docs/neon/2026-08-05-e3-phase-4b-operational-units-verification.md`

**Produces:** Auditable child-only migration, role/RLS, negative matrix, deferred identity matrix, rollback, fallback, and regression evidence.

- [ ] Record migration checksum, guard results, function owner/path/ACL, forced RLS, zero raw privileges, and audit trigger results.
- [ ] Record real-manager and department-admin identity cases when approved accounts exist; otherwise mark only those positive cases deferred without owner/claim substitution.
- [ ] Record rollback procedure: revoke entrypoint grants, remove Phase 4B functions/policies/audit, revoke owner column grants, and re-run Phase 4A validation on child only.
- [ ] Verify `app/repositories/registry.ts` still creates the Supabase Department repository and Import retains `actorClient.rpc('stage_employee_import')`.
- [ ] Run fresh `npm test` (201/201) and `npm run build` before integration.
