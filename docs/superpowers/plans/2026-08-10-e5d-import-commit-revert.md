# E5D Import Commit / Revert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Neon-only Import commit and guarded revert boundary that consumes E5C preview evidence and writes employees atomically through the existing employee mutation core.

**Architecture:** E5D stores commit headers/items and append-only audit, then exposes constrained SECURITY DEFINER entrypoints. Commit revalidates actor, batch/mapping/preview versions, staged evidence, organization/position targets, and employee conflicts inside one transaction; each approved employee mutation calls the existing internal-authority employee write path without HTTP. Revert is a version-guarded compensating mutation and never deletes employee rows.

**Tech Stack:** PostgreSQL 18 canonical migrations, SECURITY DEFINER PL/pgSQL entrypoints, server-only TypeScript repository, same-origin dark API, connection-free source gates plus canonical child validation.

## Global Constraints

- Preserve Actor Context, `hotel_ld_application`, FORCE RLS, constrained entrypoints, and raw table privilege zero.
- Do not modify Auth, Storage provider, registry activation, Production, or Supabase.
- Do not mutate E5B raw rows or E5C decisions during commit/revert.
- Do not call an E5A HTTP route; use the internal employee mutation core in the same transaction.
- Commit requires preview hash, batch version, mapping decision version, and a server acknowledgement.
- Revert requires post-commit version equality and dependency checks; never delete employees or restore stale state.

### Task 1: E5D source contract and RED gate

**Files:**
- Create: `scripts/neon/validate-e5d-import-commit.mjs`
- Create: `scripts/neon/validate-e5d-import-commit.test.mjs`
- Create: `neon/canonical/e5d/e5d-import-commit-manifest.json`

- [ ] Write RED assertions for the two migration modules, exact entrypoint signatures, immutable staged evidence, no raw-row mutation, no employee HTTP calls, and fail-closed commit/revert inputs.
- [ ] Run the focused test and capture the expected missing-module failure.
- [ ] Add the source validator and manifest only; keep the aggregate source gate RED until later tasks.

### Task 2: Commit/revert schema

**Files:**
- Create: `neon/canonical/e5d/095_import_commit_schema.sql`
- Modify: `neon/canonical/e5d/e5d-import-commit-manifest.json`

- [ ] Add commit status, item action, and revert status enums.
- [ ] Add `import_commits`, `import_commit_items`, and `app_private.import_commit_audit_events` with composite batch/property FKs, before/after snapshots, expected/post employee versions, preview/mapping evidence, and append-only trigger.
- [ ] Enable + FORCE RLS, exact manager policies, owner/ACL grants, and no runtime raw DML.

### Task 3: Atomic commit/revert entrypoints

**Files:**
- Create: `neon/canonical/e5d/096_import_commit_entrypoints.sql`
- Modify: `scripts/neon/validate-e5d-import-commit.mjs`

- [ ] Implement private helpers that re-read E5B/E5C authoritative state, canonicalize the same preview payload, and validate hash/version/evidence.
- [ ] Implement `commit_neon_import_batch(text,uuid,bigint,bigint,text,boolean)` with property-manager authorization, deterministic row order, organization/position target checks, employee identifier conflict checks, internal employee mutation calls, commit item/audit writes, and one transaction.
- [ ] Implement `preview_neon_import_revert(text,uuid)` and `revert_neon_import_batch(text,uuid,bigint,boolean)` with version/dependency checks and compensating E5A mutations only.
- [ ] Keep all raw source rows and E5C decisions read-only.

### Task 4: Server repository and dark API

**Files:**
- Create: `app/repositories/contracts/import-commit-repository.ts`
- Create: `app/repositories/neon/import-commit-repository.ts`
- Create: `app/api/import/batches/[id]/commit/route.ts`
- Create: `app/api/import/batches/[id]/revert/route.ts`
- Modify: `app/services/neon-import-staging-authorization.ts`

- [ ] Add server-only commit/revert methods with closed payload validation; no tenant/property/role inputs.
- [ ] Route commit and revert through same-origin HTTP and `runAuthorizedNeonImportStaging`; map SQL conflicts to stable repository errors.
- [ ] Do not activate registry or alter existing inspect/Storage routes.

### Task 5: Validation and canonical child execution

**Files:**
- Modify: `scripts/neon/validate-e5d-import-commit.mjs`
- Create: `docs/neon/e5d-import-commit-verification.md`

- [ ] Run source and focused tests, then `npm test` and `npm run build`.
- [ ] Run canonical child dry-run with outer rollback and empty-state proof.
- [ ] Apply only E5D modules, then catalog owner/SECURITY DEFINER/search_path/ACL/FORCE RLS/raw privilege/audit checks.
- [ ] Run runtime probes for preview hash mismatch, stale batch/mapping versions, organization/position denial, employee identifier conflict, atomic rollback, commit audit, revert dependency/version conflicts, and no-delete guarantees.
- [ ] Leave Production, Supabase, registry, Auth, Storage, and existing progress ledger untouched.
