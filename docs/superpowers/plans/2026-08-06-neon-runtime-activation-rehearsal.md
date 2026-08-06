# Neon Runtime Activation Rehearsal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In approved local or preview rehearsal mode, make Organization, People, and Position browser pages use only same-origin HTTP adapters backed by Neon.

**Architecture:** A small server-resolved mode endpoint chooses a dynamically loaded domain registry. The Neon registry imports only HTTP adapters; the Supabase registry remains dynamically loaded for the explicit fallback mode. API handlers establish existing Actor Context and never accept browser property, tenant, or role values as authority.

**Tech Stack:** Next/Vinext, TypeScript, same-origin fetch, Supabase Auth, Neon PostgreSQL, existing HTTP/Neon repositories.

## Global Constraints

- Never modify Actor Context, Import, Auth, Storage, or Production configuration.
- Rehearsal is local/preview only, requires `APP_DATA_MODE=neon`, and is hard denied in Production.
- No automatic Neon-to-Supabase fallback; configuration is the only rollback mechanism.
- Do not modify current main-worktree B-class files, including `app/repositories/registry.ts`.
- Browser code never reads `DATABASE_URL`, imports `pg`, or holds a Neon credential.
- Keep `npm test` at 201 passing tests and `npm run build` passing after each phase.

---

### Task 1: RED contract evidence

**Files:**
- Create: `.superpowers/sdd/2026-08-06-neon-runtime-activation/activation-contract.test.mjs`

- [ ] Assert the absent Position HTTP adapter fails the contract test.
- [ ] Assert rehearsal mode selection and its Production denial fail before implementation.
- [ ] Assert the target runtime loader cannot be found before implementation.
- [ ] Run the scratch test and record the expected RED failures.

### Task 2: Position HTTP adapter

**Files:**
- Create: `app/repositories/http/position-repository.ts`
- Modify: `app/repositories/contracts/position-repository.ts` only if a type export is required by the adapter.

- [ ] Implement same-origin reads for families, positions, source labels, and impact preview.
- [ ] Implement create/update family, atomic Position save, and mapping resolution using existing dark APIs.
- [ ] Implement `savePosition` and `assignPositionToDepartments` as compatibility wrappers that issue only atomic Position-save mutations.
- [ ] Strip `propertyId`, `tenantId`, and role fields from every browser mutation payload.
- [ ] Run the scratch test green and run `npm test` plus `npm run build`.

### Task 3: Rehearsal mode and domain registry

**Files:**
- Create: `app/lib/runtime-rehearsal-mode.ts`
- Create: `app/api/runtime/rehearsal-mode/route.ts`
- Create: `app/repositories/runtime/neon-domain-registry.ts`
- Create: `app/repositories/runtime/supabase-domain-registry.ts`
- Create: `app/repositories/runtime/load-domain-registry.ts`

- [ ] Parse a read-only `APP_RUNTIME_REHEARSAL=enabled` mode only with `APP_DATA_MODE=neon`.
- [ ] Reject any rehearsal request in Production or Vercel Production.
- [ ] Return only public domain source selection from the mode route; it never mutates configuration or grants access.
- [ ] Dynamically load the Neon HTTP registry for rehearsal and the legacy Supabase domain registry for explicit fallback.
- [ ] Ensure the Neon registry has no static import of Supabase browser code, Supabase business repositories, `pg`, or server Neon modules.
- [ ] Run scratch validation, `npm test`, and `npm run build`.

### Task 4: Organization scope hardening and target-page wiring

**Files:**
- Modify: `app/services/neon-organization-authorization.ts`
- Modify: `app/api/organization/departments/input.ts`
- Modify: `app/api/organization/departments/route.ts`
- Modify: `app/api/organization/operational-units/route.ts`
- Modify: `app/repositories/http/department-repository.ts`
- Modify: `app/organization/page.tsx`
- Modify: `app/people/page.tsx`
- Modify: `app/positions/page.tsx`

- [ ] Inject trusted property/tenant scope in the Organization write boundary instead of accepting it from the browser.
- [ ] Remove client scope fields from Department and operational-unit HTTP writes.
- [ ] Make the three target pages asynchronously load the selected domain registry.
- [ ] In rehearsal, use only Organization, People, and Position HTTP adapters; leave Property, Initialization, Import, Auth, and Storage unchanged.
- [ ] Propagate Neon errors to the UI without a fallback request.
- [ ] Run scratch validation, `npm test`, and `npm run build`.

### Task 5: Child validation and browser evidence

**Files:**
- Create: `scripts/neon/validate-runtime-activation-rehearsal.mjs`
- Create: `docs/neon/2026-08-06-runtime-activation-rehearsal-verification.md`

- [ ] Reject Production endpoints and credentials before any validator query.
- [ ] Verify application-role ACL, Actor Context rollback, and connection reuse using existing child-only protections.
- [ ] Record browser network evidence: Organization, People, and Position issue same-origin HTTP only and no Supabase business-data request.
- [ ] Record the explicit Supabase configuration rollback path.
- [ ] Run the full test suite and standalone build; commit only approved rehearsal assets.
