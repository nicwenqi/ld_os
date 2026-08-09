# Property / Initialization Authority Migration Plan

> **For the implementation agent:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Add provider-neutral Property and Initialization authority to the canonical Neon baseline while preserving the existing repository contracts, actor-context transaction boundary, and Supabase Auth/Storage responsibilities.

**Architecture:** Extend the canonical SQL bootstrap with property settings and initialization state owned by the existing migration owner. Expose only constrained `SECURITY DEFINER` entrypoints to `hotel_ld_application`; resolve hostname and actor property inside `withNeonResolvedActorContext`. Browser code uses same-origin HTTP adapters. Logo upload/cleanup remains a Storage boundary and is not moved into Neon.

**Tech stack:** PostgreSQL 18 / Neon, existing `pg` actor-context helpers, Next.js route handlers, TypeScript repository contracts, connection-free Node contract validators.

**Global constraints:** Do not modify the old Supabase environment, legacy migrations, Import, Auth, Storage, Production, or the main worktree’s uncommitted B-class files. Do not add raw table privileges to `hotel_ld_application`. Do not use persistent session `SET`; all actor context is transaction-local. Do not create business seed data.

## Task 1: Freeze the contract and canonical object manifest

**Files:** `neon/canonical/manifest.json`, `scripts/neon/validate-canonical-property-authority.mjs`, `scripts/neon/validate-canonical-property-authority.test.mjs`

1. Add a RED fixture requiring one ordered Property/Initialization module and exact table/routine/entrypoint inventories.
2. Record the existing `PropertyRepository` and `InitializationRepository` contracts, including Storage methods as explicitly out-of-scope.
3. Make the validator fail closed for missing modules, legacy Supabase/auth/storage/import objects, raw runtime grants, non-fixed search paths, and incomplete descriptor inventories.
4. Run the focused validator and preserve the intended RED evidence.

## Task 2: Add canonical Property and Initialization SQL

**Files:** `neon/canonical/080_property_initialization.sql`, `neon/canonical/manifest.json`

1. Add property identity columns required by the application contract without introducing Auth or Storage tables.
2. Add `property_settings`, `property_initialization_steps`, and append-only property/initialization audit tables with tenant/property composite integrity.
3. Add hostname context, property read, identity/settings mutation, progress read, navigation/step save, completion, and access-summary entrypoints.
4. Enforce actor/property authorization in each entrypoint; manager-only writes; active scoped admin read where the existing contract requires it.
5. Apply `FORCE ROW LEVEL SECURITY`, `SECURITY DEFINER`, fixed `search_path`, exact `EXECUTE` grants, `REVOKE PUBLIC`, and zero raw table DML grants for the application role.
6. Keep logo metadata/storage out of this module; return `logoUrl: null` from Neon context until a separate Storage adapter is authorized.

## Task 3: Implement server repositories and HTTP adapters

**Files:** `app/repositories/http/property-repository.ts`, `app/repositories/http/initialization-repository.ts`, `app/services/neon-property-authorization.ts`, `app/api/property/context/route.ts`, `app/api/property/route.ts`, `app/api/initialization/progress/route.ts`, `app/api/initialization/access/route.ts`

1. Use Supabase Auth verification only to obtain the user identity; never trust browser property/tenant/role fields.
2. Resolve hostname and property inside the same Neon repeatable-read actor transaction.
3. Map database error classes to stable HTTP statuses and preserve refresh-cookie behavior.
4. Make Storage methods explicit non-Neon boundaries; do not create a browser Supabase client for Neon property/settings reads.

## Task 4: Wire rehearsal selection without silent fallback

**Files:** `app/repositories/runtime/neon-domain-registry.ts`, `app/repositories/runtime/load-domain-registry.ts`, `app/repositories/registry.ts`, `scripts/neon/validate-canonical-property-authority.mjs`

1. Add Property and Initialization to the explicit Neon rehearsal registry.
2. Keep Supabase as the explicit fallback for Property/Initialization when the runtime mode is not Neon.
3. Reject Neon failures instead of silently switching to Supabase.
4. Keep Import/Auth/Storage on their existing boundaries.

## Task 5: Validate offline and against an authorized non-production staging target

**Files:** `scripts/neon/validate-canonical-property-authority.mjs`, `docs/neon/property-initialization-authority-verification.md`

1. Run source, SQL lexical, ACL/RLS, repository contract, and browser-bundle scans without a database.
2. After an explicitly approved child/staging target is supplied, run dry-run → apply → catalog → runtime matrix; never use Production.
3. Verify empty business rows, actor cleanup/reuse, manager/admin visibility, stale-version conflict, cross-property denial, and readiness transition atomicity.
4. Run `npm test` and `npm run build` before reporting readiness for E5B.
