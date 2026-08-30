# Supabase Runtime-Zero Production Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove and, where necessary, repair a zero-Supabase Training App runtime, then place the verified Neon + Better Auth artifact in Production without exposing credentials or disturbing unrelated work.

**Architecture:** `codex/canonical-neon-baseline` is the reference implementation, but every runtime boundary is re-derived from source, tests, generated output, and Vercel state. Business data and authorization stay in Neon, identity/session lifecycle stays in Better Auth on the isolated `app_auth` schema, and object storage stays behind the server-only Vercel Blob adapter.

**Tech Stack:** TypeScript/Vinext, Node test runner, PostgreSQL 18/Neon, Better Auth, Vercel Blob, Vercel CLI/Git integration.

**Spec:** `docs/superpowers/specs/2026-08-11-supabase-exit-design.md` plus the 2026-08-31 operator request recorded in the task transcript.

## Global Constraints

- Do not recreate Supabase or migrate data again.
- Do not print secret, credential, token, cookie, connection-string, or database-row values.
- Preserve every pre-existing dirty or untracked file in all existing worktrees.
- Do not weaken authentication, authorization, property scope, role scope, RLS, Actor Context, or raw-table denial.
- Do not perform a Production mutation until all local source, focused, full-test, lint, and build gates pass.
- Do not force-push or rewrite branch history.
- Any live fixture must be disposable, exact-targeted, and verified absent after cleanup.

---

### Task 1: Establish repository and branch truth

**Files:**
- Create: `docs/neon/2026-08-31-supabase-runtime-zero-audit.md`

**Interfaces:**
- Consumes: local `main`, `codex/canonical-neon-baseline`, remote refs, all worktree status.
- Produces: immutable start branch/HEAD, divergence, dirty-worktree inventory, and CURRENT/TARGET/UNKNOWN classification.

- [ ] **Step 1: Capture identity without changing branches**

Run `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git worktree list --porcelain`, `git branch -r`, and recent logs for `main` and `codex/canonical-neon-baseline`.

- [ ] **Step 2: Refresh remote evidence safely**

Run `git fetch --all --prune`, then compare local and remote refs. Do not merge, rebase, reset, or clean.

- [ ] **Step 3: Prove branch ancestry and application contents**

Run `git rev-list --left-right --count main...codex/canonical-neon-baseline`, `git merge-base`, `git diff --name-status`, and targeted `git show` checks for the application, Neon, and Better Auth boundaries.

- [ ] **Step 4: Record the evidence**

Write only commit IDs, branch names, status classifications, and file paths to the audit record.

### Task 2: Inventory and classify all Supabase references

**Files:**
- Modify: `docs/neon/2026-08-31-supabase-runtime-zero-audit.md`
- Test: `scripts/neon/validate-supabase-free-baseline.test.mjs`
- Modify if the failing test proves a gap: `scripts/neon/validate-supabase-free-baseline.mjs`

**Interfaces:**
- Consumes: tracked source, scripts, configuration, tests, generated browser output, and archived migration evidence.
- Produces: an A-E classification for every non-archive hit and a fail-closed executable-path gate.

- [ ] **Step 1: Enumerate filenames before content**

Search case-insensitively for `supabase`, Supabase environment names, `@supabase/`, `.supabase.co`, `/rest/v1`, RPC/client calls, Auth, Storage, Realtime, Functions, and `createClient`, excluding only `.git`, dependencies, and generated cache directories.

- [ ] **Step 2: Classify hits**

Classify active runtime as A, deployment/environment as B, negative validation as C, historical/archive as D, and unrelated factories/error-code substrings as E. Do not delete C or D evidence.

- [ ] **Step 3: Add a failing validator regression only for a proven blind spot**

Create a controlled fixture containing a Supabase dependency in a production-capable executable/config path the current validator misses, run `node --test scripts/neon/validate-supabase-free-baseline.test.mjs`, and require the new test to fail for the expected missed-path reason.

- [ ] **Step 4: Make the smallest validator/runtime repair**

Extend the gate or remove the confirmed active path without broad historical deletion, then rerun the focused validator test and source mode.

### Task 3: Trace database, auth, authorization, and storage paths

**Files:**
- Modify: `docs/neon/2026-08-31-supabase-runtime-zero-audit.md`

**Interfaces:**
- Consumes: environment parser, server pools, API routes, services, repositories, migration manifest, initialization/import scripts, and storage gateways.
- Produces: end-to-end runtime maps showing provider, server boundary, authorization step, property scope, and connection type.

- [ ] **Step 1: Trace database entrypoints**

Follow `DATABASE_URL` into the Neon application pool and `AUTH_DATABASE_URL` into Better Auth; verify Neon hostname/TLS/role checks, pooled-versus-direct use, and that bootstrap credentials are operator-only.

- [ ] **Step 2: Trace every business domain**

Map property, organization, people, departments, positions, employees, initialization, import/export, admin, server actions, and background/operator scripts to their repositories and constrained Neon entrypoints.

- [ ] **Step 3: Trace complete authentication and authorization**

Map login, logout, session read, password change, middleware/provider guards, API authentication, role checks, property/department scope, and admin routes from Better Auth subject through Neon authorization and Actor Context.

- [ ] **Step 4: Trace storage and external services**

Verify import and branding object paths use the existing server-only Vercel Blob gateway and that no Supabase Storage, signed URL, Realtime, or Functions path is executable.

### Task 4: Audit repository and Vercel environment contracts

**Files:**
- Modify if proven wrong: `.env.example`, `vercel.json`, runtime environment tests, and deployment documentation.
- Modify: `docs/neon/2026-08-31-supabase-runtime-zero-audit.md`

**Interfaces:**
- Consumes: repository env templates plus Vercel `hotel-ld-os` Development, Preview, and Production variable-name metadata.
- Produces: variable-name-only PRESENT/ABSENT/REQUIRED/OBSOLETE matrices.

- [ ] **Step 1: Derive required variables from code**

Confirm requirements for `APP_ENV`, `APP_DATA_MODE`, `APP_BASE_DOMAIN`, `DATABASE_URL`, `AUTH_DATABASE_URL`, `BETTER_AUTH_SECRET`, `BLOB_READ_WRITE_TOKEN`, and any explicitly used Vercel/Neon target identifiers.

- [ ] **Step 2: Inspect Vercel metadata without values**

Verify CLI identity and project link, list environment variable names and targets, and inspect project Git/deployment configuration. Redact values even if the CLI returns them.

- [ ] **Step 3: Repair environment metadata only after offline gates**

Remove exact obsolete Supabase names and add only missing required names with already-authorized values available in the connected platform. If a required value is unavailable, stop and report it rather than inventing one.

### Task 5: Run offline verification gate

**Files:**
- Modify: `docs/neon/2026-08-31-supabase-runtime-zero-audit.md`

**Interfaces:**
- Consumes: final local diff.
- Produces: fresh focused/full/lint/build/source-gate evidence before Production.

- [ ] **Step 1: Run focused Neon and Better Auth tests**

Run the Supabase-free, Better Auth, auth-authorization split, Neon runtime, repository, import, property, and Vercel Blob test/validator suites selected from existing scripts.

- [ ] **Step 2: Run full project checks**

Run `npm test`, `npm run lint`, a standalone `npm run build`, `git diff --check`, and the strongest existing Supabase-exit source/live command supported by the repository.

- [ ] **Step 3: Stop on any failure**

Do not change Production or Vercel environment metadata while any required local check is red.

### Task 6: Audit and, if necessary, cut over Vercel Production

**Files:**
- Modify: `docs/neon/2026-08-31-supabase-runtime-zero-audit.md`

**Interfaces:**
- Consumes: verified local commit, Vercel project/deployment/domain metadata, and Preview artifact evidence.
- Produces: one verified Production deployment sourced from the canonical Neon + Better Auth implementation.

- [ ] **Step 1: Inspect topology read-only**

Determine the Production branch, Production deployment commit, latest relevant Preview deployment commit, aliases/custom domains, protection, status, and whether Production is behind the canonical source.

- [ ] **Step 2: Select the minimal cutover**

Prefer promoting an already-verified immutable Preview artifact when its Git commit exactly matches the reviewed source; otherwise push the scoped branch and use the project’s Git/Production-branch configuration without rewriting history.

- [ ] **Step 3: Apply only the authorized cutover**

Make no schema/data migration and no Supabase action. Record deployment ID, commit, environment, and aliases without credentials.

### Task 7: Production smoke, logs, cleanup, and handoff

**Files:**
- Modify: `docs/neon/2026-08-31-supabase-runtime-zero-audit.md`

**Interfaces:**
- Consumes: new Production URL and safe disposable credentials/fixtures if available.
- Produces: runtime smoke matrix, bounded log scan, exact fixture-cleanup proof, commit/push status, and final PASS/FAIL matrix.

- [ ] **Step 1: Run safe smoke checks**

Check app load and login boundary, then authenticated session, representative read, safe write, property scope, and manager/admin denial/allow paths only when disposable identity authority exists.

- [ ] **Step 2: Inspect bounded runtime logs**

Search Production logs for Supabase markers, deleted-project hostnames, DNS/connection/auth errors, and stale environment errors without printing user data or credentials.

- [ ] **Step 3: Clean exact fixtures**

Delete only fixture identities/objects/rows created by this plan, verify zero remain, and report `NOT_CREATED` when no fixture was needed.

- [ ] **Step 4: Re-run final source and diff checks**

Run the Supabase-free validator, relevant smoke assertion, `git status --short`, `git diff --check`, and inspect the final commit diff before pushing.

- [ ] **Step 5: Report the required matrix**

Return the exact requested fields and use `RESULT=PASS` only if source, configuration, deployment, tests/build, live validation, and Production smoke all have fresh passing evidence.

## Plan self-review

The plan covers all ten requested phases, separates local/Preview/Production evidence, prevents secret disclosure and re-migration, preserves dirty worktrees, requires test-first repair of validator/runtime blind spots, and gates all Production mutation behind fresh offline validation. No placeholder implementation, compatibility shim, force-push, Supabase recreation, or data migration is authorized.
