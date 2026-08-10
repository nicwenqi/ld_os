# E5E Import Runtime Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the complete Import workflow through same-origin HTTP and canonical Neon while retaining Supabase Auth/Storage only as adapters.

**Architecture:** Browser code receives an explicit rehearsal runtime registry. In Neon mode the Import repository is an HTTP adapter and never imports Supabase or Neon credentials. Server routes resolve Supabase Auth, Actor Context, property scope, and constrained Neon entrypoints; Storage I/O remains the existing read-back/checksum/cleanup saga adapter.

**Tech Stack:** TypeScript, Next/Vinext HTTP routes, PostgreSQL 18 canonical entrypoints, Supabase Auth/Storage adapter, Node test runner.

## Global Constraints

- APP_DATA_MODE=neon and explicit rehearsal mode are required; Neon failure never silently falls back.
- Browser requests are same-origin HTTP only; no DATABASE_URL, pg, or Supabase business-data client in Neon Import pages.
- Actor Context, `hotel_ld_application`, FORCE RLS, constrained entrypoints, and raw privilege zero remain unchanged.
- No Auth provider change, Storage provider replacement, Production access, legacy Import replay, or registry activation outside rehearsal.
- Seed is isolated, deterministic, idempotent, and contains no old Supabase rows.

### Task 1: RED contracts and runtime manifest

**Files:**
- Create: `scripts/neon/validate-e5e-import-runtime.mjs`
- Create: `scripts/neon/validate-e5e-import-runtime.test.mjs`
- Modify: `app/repositories/runtime/neon-domain-registry.ts`
- Modify: `app/repositories/runtime/load-domain-registry.ts`

- [ ] Add failing assertions for explicit Import source, lazy runtime loading, and no browser Supabase/Neon credential imports.
- [ ] Run the focused test and record the intended RED failure.

### Task 2: HTTP Import repository and registry wiring

**Files:**
- Create: `app/repositories/http/import-repository.ts`
- Modify: `app/repositories/registry.ts`
- Modify: `app/repositories/runtime/neon-domain-registry.ts`
- Modify: `app/repositories/runtime/supabase-domain-registry.ts`

- [ ] Implement same-origin adapter for history, workflow, mapping, label, issue, preview, commit, and guarded revert routes.
- [ ] Map the E5C/E5D server projections without fabricating impact counts; unavailable impact remains explicit.
- [ ] In Neon mode select HTTP repositories before any Supabase browser client is created.

### Task 3: Neon inspection route and deterministic development seed

**Files:**
- Modify: `app/api/import/inspect/route.ts`
- Create: `scripts/neon/e5e-development-seed.mjs`
- Create: `scripts/neon/validate-e5e-seed.test.mjs`

- [ ] Add RED checks for Neon inspection using the existing Storage saga and no `actorClient.rpc("stage_employee_import")` path.
- [ ] Implement the Neon branch using read-back verification, parser evidence, and scoped staging entrypoints.
- [ ] Provide a canonical, repeatable seed plan for tenant/property/manager/department/position/employee scenarios; no old data.

### Task 4: Browser and Storage runtime validation

**Files:**
- Create: `docs/neon/e5e-import-runtime-verification.md`
- Modify: `scripts/neon/validate-e5e-import-runtime.mjs`
- Modify: `tests/repository-registry.test.mjs`

- [ ] Validate browser request graph, no Supabase business requests, no Neon credentials, and explicit fallback behavior.
- [ ] Validate upload/read-back checksum/MIME mismatch, cleanup retry, and exact-path protection using the existing injected Storage adapter.
- [ ] Run source, focused tests, full `npm test`, and `npm run build`.

### Task 5: Commit and handoff

- [ ] Stage only E5E files; retain unrelated worktree changes.
- [ ] Commit with `feat(neon): activate e5e import runtime`.
- [ ] Report runtime status, seed strategy, registry changes, browser validation, and remaining Supabase exit blockers.
