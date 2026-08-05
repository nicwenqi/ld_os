# E4A Neon Position Read-only Implementation Plan

> **For Codex:** Execute this plan in the isolated `codex/e4-position-readonly` worktree. Do not change the main worktree's B-class files.

**Goal:** Build and validate a dark, server-only Neon read path for position families, positions, and actor-visible department assignments, while leaving the registry and UI on Supabase.

**Architecture:** Supabase server auth resolves an authenticated actor and the existing property context. `withNeonResolvedActorContext` writes only transaction-local settings. The application role can execute narrow SECURITY DEFINER entrypoints but cannot select raw position tables. The repository maps returned JSON to existing contracts; dark HTTP routes are the only browser-facing boundary.

**Tech:** Next.js route handlers, TypeScript repositories, PostgreSQL/Neon migrations, Node validation scripts, existing npm test/build suite.

## File map

- Create: `neon/migrations/202608060011_e4_position_readonly.sql`
- Create: `app/repositories/neon/position-read-repository.ts`
- Create: `app/services/neon-position-authorization.ts`
- Create: `app/api/organization/position-families/route.ts`
- Create: `app/api/organization/positions/route.ts`
- Create: `scripts/neon/validate-e4-position-readonly.mjs`
- Create: `docs/neon/2026-08-06-e4-position-readonly-verification.md`
- Scratch only (untracked): `.superpowers/sdd/2026-08-06-e4-position-readonly/`

## Tasks

### 1. Capture the RED contract

- [ ] Add isolated, untracked Node tests for entrypoint names, repository mapping, no raw-table query, scoped assignment projection, and dark routes.
- [ ] Run them and capture the expected missing-module/missing-entrypoint failure.
- [ ] Run the existing suite before implementation; it must remain unchanged.

### 2. Add the child-Neon migration

- [ ] Add the private append-only audit relation and make it FORCE RLS.
- [ ] Define the two SECURITY DEFINER entrypoints with `SET search_path = ''`, owner verification, `REVOKE ALL ... FROM PUBLIC`, and the exact application `EXECUTE` grant.
- [ ] Implement manager and department-admin visibility using current actor/property context and active descendant scope.
- [ ] Filter assignment arrays for department admins; preserve unassigned position parity.
- [ ] Explicitly revoke all application role raw privileges on the three business tables and audit relation.
- [ ] Add migration self-checks that fail on insecure owner, PUBLIC EXECUTE, raw privileges, or disabled/unenforced RLS.

### 3. Add server repository and dark API

- [ ] Implement a focused read repository using `withNeonResolvedActorContext` and parameterized entrypoint calls only.
- [ ] Preserve contract field mappings, ordering, and empty-list behavior.
- [ ] Add server authorization helper and two GET routes that return auth/property failures without leaking cross-property data.
- [ ] Do not import the repository from the registry or client bundles.

### 4. Validate non-production runtime

- [ ] Implement a child-only validator with `source`, `dry-run`, `apply`, `catalog`, and `runtime` modes. It must deny known production branch and endpoint identifiers before connecting.
- [ ] Run source/dry-run, then apply only through `NEON_BOOTSTRAP_DATABASE_URL`; run catalog/runtime only through `DATABASE_URL` for `hotel_ld_application`.
- [ ] Verify raw table/audit denial, actor cleanup after rollback, connection reuse isolation, and the identity matrix or explicitly document child-identity deferrals.

### 5. Verify and hand off

- [ ] Run RED scratch tests through GREEN, then remove/leave scratch files untracked.
- [ ] Run `npm test` and `npm run build` without altering tests.
- [ ] Write the evidence-only verification record: endpoint redacted, migrations, functions, ACL/RLS evidence, runtime results, fallback state, and deferred identity cases.
- [ ] Commit only E4A assets in the isolated branch; do not merge or activate the registry without a separate authorization.
