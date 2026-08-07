# E5A Neon Employee Write Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one child-only, server-side Neon `saveEmployeeWithIdentifiers` mutation boundary as the prerequisite for a later Import commit migration.

**Architecture:** Supabase Auth resolves identity, the unchanged E1 actor transaction injects trusted actor/property/request context, and a pooled `hotel_ld_application` session calls one constrained `SECURITY DEFINER` entrypoint. Employee, complete identifier replacement, version increment, and append-only audit are one transaction. The existing registry, Import, Auth, Storage, and UI remain unchanged.

**Tech Stack:** PostgreSQL on Neon, `pg`, TypeScript, Next route handlers, Supabase Auth SSR, Node.js test runner.

## Global Constraints

- Child only: branch `br-aged-river-az1gke14`, endpoint `ep-sparkling-shape-az9gxtuh`; Production branch/endpoint are hard denied.
- Direct `NEON_BOOTSTRAP_DATABASE_URL` is migration-only; pooled `DATABASE_URL` must be `hotel_ld_application` for runtime.
- Do not change Actor Context, registry activation, Import routes/contracts, Auth, Storage, Employee facts/history, Training, payroll, or CTC.
- Never accept browser tenant/property/role/actor/request/source-batch fields or `isNewEmployee`/`is_new_employee`.
- Runtime gets no raw Employee/identifier/audit table privileges and owns no object.
- Do not edit existing files under `tests/`; RED scratch stays untracked under `.superpowers/sdd/`.

## File Map

- Create: `neon/migrations/202608070015_e5a_employee_write.sql`
- Create: `neon/migrations/202608070016_e5a_employee_write_hardening.sql`
- Create: `scripts/neon/validate-e5a-employee-write.mjs`
- Create: `app/repositories/contracts/employee-write-repository.ts`
- Create: `app/repositories/neon/employee-write-repository.ts`
- Create: `app/api/people/employees/save/input.ts`
- Create: `app/api/people/employees/save/route.ts`
- Create: `app/services/neon-employee-write-authorization.ts`
- Create: `docs/neon/2026-08-07-e5a-employee-write-verification.md`

## Tasks

### Task 1: RED contract

- [x] Add isolated failing tests for strict browser input, `is_new_employee` rejection, the one repository SQL entrypoint, complete identifier replacement, and child URL guards.
- [x] Run the scratch suite and capture an assertion failure caused by missing production modules.

### Task 2: Database migration and validator

- [x] Add source and URL/role guards, dry-run rollback, child apply, catalog, and runtime commands.
- [x] Add fail-closed preflight for E1/E2/E3/E4 prerequisites, current ownership, constraints, and FORCE RLS.
- [x] Add minimal migration-owner grants and command policies; keep application raw privileges at zero.
- [x] Add append-only Employee-write audit and rejection trigger.
- [x] Implement one `save_neon_employee_with_identifiers(...)` entrypoint with trusted context, manager authorization, deterministic locks, optimistic concurrency, referential validation, atomic identifier replacement, and audit.
- [x] Revoke all broad execute access, grant exact application execute, and assert catalog invariants.

### Task 3: Repository and dark API

- [x] Define a write-only contract whose result contains E5A authoritative facts, identifiers, and version but no `isNewEmployee`.
- [x] Implement the server-only repository with one parameterized entrypoint call.
- [x] Implement strict input parsing and reject every browser authorization/context field and `is_new_employee` spelling.
- [x] Implement the server authorization runner and `POST /api/people/employees/save`; keep existing People read routes unchanged.
- [x] Map authorization, not-found, conflict, validation, and dependency errors without silent fallback.

### Task 4: Child validation and handoff

- [x] Run source, corrected base + hardening fresh-install rollback, hardening apply, catalog, and runtime validation against the confirmed child only.
- [x] Verify owner/search path/ACL, FORCE RLS, raw-table denial, NOBYPASSRLS, audit append-only, existing facts-boundary preservation, actor cleanup, and connection reuse. Positive mutation semantics remain pending a configured accepted identity.
- [x] Record any positive identity matrix item that cannot be exercised with current development identities as explicitly deferred; never simulate with owner or `SET ROLE`.
- [x] Run `npm test` and `npm run build`; document evidence and report merge readiness without touching the main worktree's B-class changes.
