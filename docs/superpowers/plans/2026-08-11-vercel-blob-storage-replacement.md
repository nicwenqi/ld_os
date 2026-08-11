# Vercel Blob Storage Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace active Import Supabase Storage calls with a private server-only Vercel Blob adapter while preserving E5B and Neon authorization.

**Architecture:** The active Import authorization boundary constructs the existing `ImportStorageGateway` from Vercel Blob after its current Supabase Auth identity and Neon Actor Context checks. The Blob adapter accepts only the fixed logical bucket and exact server-derived object path; the storage saga and cleanup executor remain unchanged consumers.

**Tech Stack:** TypeScript, `@vercel/blob` 2.3.0, Vinext/Vercel route handlers, Node test runner.

## Global Constraints

- Supabase Auth remains unchanged; Supabase Storage and its access token leave the active Import path.
- No Import schema, Actor Context, RLS, privilege, Production, browser token, signed browser upload, or legacy object change.
- Vercel Blob objects are private. Provider failures fail closed except exact-object not-found cleanup.

---

### Task 1: Server-only Vercel Blob gateway

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `app/services/import/vercel-blob-storage-gateway.ts`
- Test: `scripts/neon/validate-vercel-blob-storage-gateway.test.mjs`

**Interfaces:** Consumes `ImportStorageGateway`; produces `createVercelBlobImportStorageGateway(): ImportStorageGateway`.

- [ ] Write RED tests proving blank token fails, only `property-import-files` is accepted, `put()` receives `{ access: "private", addRandomSuffix: false, allowOverwrite: false }`, `get()` yields one complete byte array, and only provider not-found makes exact `del()` idempotent.
- [ ] Run `node --experimental-strip-types --test scripts/neon/validate-vercel-blob-storage-gateway.test.mjs`; expect missing-adapter failure.
- [ ] Pin `@vercel/blob` to `2.3.0`; implement the server-only gateway using `put`, private `get`, and `del`, with a server-only `BLOB_READ_WRITE_TOKEN` lookup and exact path/bucket validation.
- [ ] Run the focused test and `node --check app/services/import/vercel-blob-storage-gateway.ts`; expect PASS.
- [ ] Commit `feat(storage): add private Vercel Blob gateway`.

### Task 2: Active Import boundary replacement

**Files:**
- Modify: `app/services/neon-import-staging-authorization.ts`
- Modify: `scripts/neon/validate-auth-authorization-split.mjs`
- Modify: `tests/auth-authorization-split.test.mjs`
- Test: `scripts/neon/validate-e5b-storage-saga.test.mjs`

**Interfaces:** Consumes Task 1 gateway; preserves `AuthorizedImportStagingContext.storage` exactly.

- [ ] Write RED source tests rejecting `createServerActorClient`, `.storage.from`, Supabase actor token forwarding, and any Storage fallback in active Import authorization; require the Vercel Blob gateway import.
- [ ] Run `node --experimental-strip-types --test tests/auth-authorization-split.test.mjs scripts/neon/validate-e5b-storage-saga.test.mjs`; expect the old actor Storage construction failure.
- [ ] Replace only the active gateway construction with `createVercelBlobImportStorageGateway()`. Remove active-path actor-client types and implementation, retaining request identity, trusted Neon scope, repositories, headers, and saga callback shape.
- [ ] Extend the AST source audit to reject Supabase Storage operations in active Import code while permitting the server-only Vercel gateway.
- [ ] Run the focused suite and `node scripts/neon/validate-auth-authorization-split.mjs source`; expect PASS.
- [ ] Commit `feat(storage): route Import through Vercel Blob`.

### Task 3: Provider live validator

**Files:**
- Create: `scripts/neon/validate-vercel-blob-storage-live.mjs`
- Create: `scripts/neon/validate-vercel-blob-storage-live.test.mjs`
- Create: `docs/operations/vercel-blob-import-validation.md`

**Interfaces:** Consumes Task 1 gateway and existing verifier/cleanup executor; produces a redacted live result.

- [ ] Write RED tests for absent environment rejection and for exact upload, one read-back, SHA-256, size, MIME, exact deletion, retry, and idempotent not-found cleanup with an injected fake gateway.
- [ ] Run `node --experimental-strip-types --test scripts/neon/validate-vercel-blob-storage-live.test.mjs`; expect missing-validator failure.
- [ ] Implement a `--token-stdin` validator restricted to local/preview. It creates one `validation/<uuid>/workbook.csv` object, checks its returned full bytes, deletes exactly that path in `finally`, and never emits token, URL, or object ID.
- [ ] Run the focused test and `node --check scripts/neon/validate-vercel-blob-storage-live.mjs`; expect PASS.
- [ ] Commit `test(storage): validate private Blob lifecycle`.

### Task 4: Final verification and evidence

**Files:**
- Modify: `docs/neon/2026-08-11-canonical-clean-validation.md`

- [ ] Run focused gateway/live/source/saga tests, `npm test`, `npm run build`, and `git diff --check`; every command must exit zero.
- [ ] With a protected non-production token, run `APP_ENV=preview node scripts/neon/validate-vercel-blob-storage-live.mjs --token-stdin`; accept only a compact redacted PASS matrix.
- [ ] Record environment class, lifecycle result, exact cleanup outcome, Supabase Auth-only dependency, and no object URL/credential.
- [ ] Commit `docs(storage): record Blob validation`.

## Plan self-review

Tasks 1–2 remove active Supabase Storage without touching Auth, schema, RLS, or Actor Context. Task 3 validates all required provider semantics; Task 4 supplies the final test/build and non-production evidence.
