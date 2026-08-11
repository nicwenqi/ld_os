# Supabase Exit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every active Supabase dependency while preserving Neon as the sole business authorization authority.

**Architecture:** Better Auth is a server-only, same-origin identity/session provider backed by a non-production Neon `app_auth` schema and a least-privileged service role. The subject ID from a verified Better Auth session is mapped by existing Neon authorization entrypoints; no token claim authorizes a business operation. Property branding uses private Vercel Blob through a server-only gateway while Neon owns the metadata.

**Tech Stack:** Better Auth (pinned), PostgreSQL 18/Neon, Vercel Blob, Vercel Preview environment, existing Neon actor-context/repository boundaries.

## Global Constraints

- Never touch Production, Supabase data, or legacy Supabase state.
- Never change canonical business RLS, FORCE RLS, Actor Context, or `hotel_ld_application` raw privileges.
- `app_auth` contains only identity, credential, session, and verification data.
- `hotel_ld_auth_service` must have no public/app_private object privilege or membership in business roles.
- Browser code receives neither database nor Blob/auth-service credentials.
- No active Supabase import, data client, RPC, Storage call, business repository, or fallback survives.
- Use new disposable non-production identities and objects only.

---

### Task 1: Auth-schema operator boundary

**Files:**
- Create: `neon/canonical/086_better_auth_boundary.sql`
- Create: `scripts/neon/bootstrap-better-auth-preview.mjs`
- Create: `scripts/neon/validate-better-auth-boundary.mjs`
- Test: `scripts/neon/validate-better-auth-boundary.test.mjs`

**Consumes:** canonical 010–085 role topology and the approved direct non-production bootstrap connection.

**Produces:** `app_auth`, `hotel_ld_auth_service`, a safe non-production `AUTH_DATABASE_URL` injection contract, and source/catalog assertions.

- [ ] **Step 1: Write failing boundary tests**

```js
test("auth boundary owns only app_auth and grants nothing to application", () => {
  assert.throws(() => validateBoundary(brokenBusinessGrant), /AUTH_SERVICE_BUSINESS_PRIVILEGE/);
  assert.throws(() => validateBoundary(brokenApplicationGrant), /APPLICATION_AUTH_SCHEMA_PRIVILEGE/);
});
```

- [ ] **Step 2: Run the boundary test**

Run: `node --test scripts/neon/validate-better-auth-boundary.test.mjs`

Expected: FAIL because module 086 and the boundary validator do not exist.

- [ ] **Step 3: Implement the minimal operator-only bootstrap**

```sql
begin;
create schema if not exists app_auth;
create role hotel_ld_auth_service noinherit nosuperuser nobypassrls login password :'generated_secret';
revoke all on schema public, app_private from hotel_ld_auth_service;
revoke all on schema app_auth from hotel_ld_application;
grant usage, create on schema app_auth to hotel_ld_auth_service;
alter role hotel_ld_auth_service set search_path = app_auth, pg_catalog;
commit;
```

The script validates the exact project/branch/endpoint allowlist before a
single direct bootstrap transaction, generates the credential in memory, adds
only Preview-scoped `AUTH_DATABASE_URL` and `BETTER_AUTH_SECRET` through
Vercel, and never prints either value.

- [ ] **Step 4: Verify source and catalog contracts**

Run: `node --test scripts/neon/validate-better-auth-boundary.test.mjs && node scripts/neon/validate-better-auth-boundary.mjs source`

Expected: PASS; later live catalog phase verifies role memberships, ownership,
schema ACLs, and zero business object privileges.

- [ ] **Step 5: Commit**

```bash
git add neon/canonical/086_better_auth_boundary.sql scripts/neon/bootstrap-better-auth-preview.mjs scripts/neon/validate-better-auth-boundary.mjs scripts/neon/validate-better-auth-boundary.test.mjs
git commit -m "feat(auth): add isolated Better Auth boundary"
```

### Task 2: Same-origin Better Auth provider

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `app/lib/auth/better-auth-server.ts`
- Create: `app/lib/auth/better-auth-client.ts`
- Create: `app/api/auth/[...all]/route.ts`
- Test: `tests/better-auth-provider.test.mjs`

**Consumes:** `AUTH_DATABASE_URL`, `BETTER_AUTH_SECRET`, deterministic login
identity helper, and `app_auth` boundary.

**Produces:** a pinned Better Auth provider exposing only same-origin session,
email/password sign-in, sign-out, refresh-on-session-read, and server-side
subject verification.

- [ ] **Step 1: Write failing provider tests**

```js
test("provider verifies its own session subject and exposes no authorization claims", async () => {
  const identity = await resolveBetterAuthIdentity(requestWithSession("auth-user-a"));
  assert.deepEqual(identity, { userId: "auth-user-a" });
  assert.doesNotMatch(serializedSession, /property|role|department/i);
});
```

- [ ] **Step 2: Run the provider test**

Run: `node --experimental-strip-types --test tests/better-auth-provider.test.mjs`

Expected: FAIL because no Better Auth provider is installed.

- [ ] **Step 3: Implement server-only Better Auth**

Pin Better Auth exactly in `package.json`. Configure its PostgreSQL pool with
`AUTH_DATABASE_URL`, `app_auth,pg_catalog` search path, email/password enabled,
new-user sign-up disabled outside the initialization operator, short server
session lifetime, secure HttpOnly same-origin cookies, and session revocation
on password reset. Mount its Fetch handler at `/api/auth/[...all]`; no browser
database client or provider credential is created.

- [ ] **Step 4: Verify RED-to-GREEN and client exclusion**

Run: `node --experimental-strip-types --test tests/better-auth-provider.test.mjs && node scripts/neon/validate-better-auth-boundary.mjs source`

Expected: PASS; generated client bundle source contains no `AUTH_DATABASE_URL`
or `BETTER_AUTH_SECRET`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json app/lib/auth/better-auth-server.ts app/lib/auth/better-auth-client.ts app/api/auth/[...all]/route.ts tests/better-auth-provider.test.mjs
git commit -m "feat(auth): add same-origin Better Auth provider"
```

### Task 3: Auth session and Neon authorization replacement

**Files:**
- Modify: `app/services/authentication-service.ts`
- Modify: `app/services/request-authentication.ts`
- Modify: `app/api/auth/login/route.ts`
- Modify: `app/api/auth/session/route.ts`
- Modify: `app/api/auth/logout/route.ts`
- Delete: `app/api/auth/access-token/route.ts`
- Delete: `app/api/auth/cookies.ts`
- Delete: `app/lib/supabase/browser.ts`
- Delete: `app/lib/supabase/server-admin.ts`
- Test: `tests/auth-authorization-split.test.mjs`
- Test: `scripts/neon/validate-auth-authorization-split.mjs`

**Consumes:** verified Better Auth subject from Task 2 and existing
`resolveNeonAuthorizationForAuthUser`.

**Produces:** business APIs obtain only a server-verified auth subject, then
resolve Neon memberships/roles/scopes on every session projection or refresh.

- [ ] **Step 1: Write failing session tests**

```js
test("refresh re-resolves Neon authorization instead of reading token authority", async () => {
  const session = await resolveRequestAuthIdentity(request);
  assert.equal(session.userId, "better-auth-subject");
  assert.equal(neonResolveCalls, 1);
  assert.equal(session.role, undefined);
});
```

- [ ] **Step 2: Run the session test**

Run: `node --experimental-strip-types --test tests/auth-authorization-split.test.mjs`

Expected: FAIL because the active request path still imports Supabase Auth.

- [ ] **Step 3: Replace active identity handling**

Use `auth.api.getSession({ headers })` through the server-only Better Auth
module. The only durable value consumed by application code is `user.id`.
Pass that subject and trusted hostname to existing Neon authorization routines;
delete access-token cookies/endpoints and all Supabase client use.

- [ ] **Step 4: Verify authorization security matrix**

Run: `node --experimental-strip-types --test tests/auth-authorization-split.test.mjs && node scripts/neon/validate-auth-authorization-split.mjs source`

Expected: manager, department-admin, refresh re-resolution, cross-property
denial, raw-table denial, and Actor Context cleanup assertions pass; any
Supabase active source import fails closed.

- [ ] **Step 5: Commit**

```bash
git add app/services/authentication-service.ts app/services/request-authentication.ts app/api/auth/login/route.ts app/api/auth/session/route.ts app/api/auth/logout/route.ts tests/auth-authorization-split.test.mjs scripts/neon/validate-auth-authorization-split.mjs
git rm app/api/auth/access-token/route.ts app/api/auth/cookies.ts app/lib/supabase/browser.ts app/lib/supabase/server-admin.ts
git commit -m "feat(auth): resolve application sessions through Better Auth"
```

### Task 4: Neon-first identity initialization

**Files:**
- Create: `scripts/neon/create-preview-initial-admin.mjs`
- Modify: `scripts/neon/bootstrap-neon-initialization.mjs`
- Modify: `app/lib/auth/deterministic-login-identity.ts`
- Test: `scripts/neon/create-preview-initial-admin.test.mjs`
- Test: `tests/initialization-usability-fix.test.mjs`

**Consumes:** Task 2 Better Auth server API and the existing operator-only Neon
initialization bootstrap.

**Produces:** a disposable Preview administrator identity, then an auditable
Neon user-account/profile/membership/manager mapping without any business
authorization data in the Better Auth account.

- [ ] **Step 1: Write failing initialization test**

```js
test("preview initializer creates a new identity before Neon business mapping", async () => {
  const result = await createPreviewInitialAdmin(input, fakes);
  assert.equal(result.authSubjectId, "new-auth-subject");
  assert.equal(fakes.neonBootstrapCalls, 1);
  assert.equal(fakes.authSubjectClaims.includes("property"), false);
});
```

- [ ] **Step 2: Run the initialization test**

Run: `node --experimental-strip-types --test scripts/neon/create-preview-initial-admin.test.mjs`

Expected: FAIL because no Better Auth initializer exists.

- [ ] **Step 3: Implement the controlled Preview initializer**

Create a new Better Auth user from login ID/password through its server API,
verify the returned subject, then call the existing direct operator bootstrap
with that subject. Reject Production/unknown targets before a connection,
redact output, make retries idempotent only for the exact generated subject,
and delete the disposable user/seed on validation cleanup.

- [ ] **Step 4: Verify initializer isolation**

Run: `node --experimental-strip-types --test scripts/neon/create-preview-initial-admin.test.mjs tests/initialization-usability-fix.test.mjs`

Expected: PASS; source inspection proves the runtime application role gained no
bootstrap DML or `SET ROLE` path.

- [ ] **Step 5: Commit**

```bash
git add scripts/neon/create-preview-initial-admin.mjs scripts/neon/bootstrap-neon-initialization.mjs app/lib/auth/deterministic-login-identity.ts scripts/neon/create-preview-initial-admin.test.mjs tests/initialization-usability-fix.test.mjs
git commit -m "feat(auth): bootstrap Preview identities through Better Auth"
```

### Task 5: Property-branding Vercel Blob boundary

**Files:**
- Create: `app/services/property/vercel-blob-brand-storage.ts`
- Create: `app/services/neon-property-branding-authorization.ts`
- Modify: `app/repositories/neon/property-repository.ts`
- Modify: `app/api/property/identity/route.ts`
- Modify: `app/api/property/context/route.ts`
- Test: `tests/vercel-blob-property-branding.test.mjs`
- Test: `scripts/neon/validate-vercel-blob-property-branding-live.mjs`

**Consumes:** Vercel Blob server token and existing Neon property metadata
entrypoints.

**Produces:** private, server-only exact-path property-brand storage with
Neon-owned metadata and no Supabase Storage fallback.

- [ ] **Step 1: Write failing branding tests**

```js
test("brand gateway writes one exact private Blob object and never emits its token", async () => {
  await gateway.upload(input);
  assert.deepEqual(putCalls[0], { access: "private", addRandomSuffix: false });
  assert.equal(browserSource.includes("BLOB_READ_WRITE_TOKEN"), false);
});
```

- [ ] **Step 2: Run the branding test**

Run: `node --experimental-strip-types --test tests/vercel-blob-property-branding.test.mjs`

Expected: FAIL because branding still uses the Supabase repository.

- [ ] **Step 3: Implement the Blob-backed branding path**

Reuse the server-only Blob SDK with the fixed logical bucket
`property-brand-assets`; validate exact generated paths, upload/read back the
accepted image, create/remove Neon metadata through constrained entrypoints,
and make not-found cleanup idempotent. Do not alter Import gateway behavior.

- [ ] **Step 4: Verify private object lifecycle**

Run: `node --experimental-strip-types --test tests/vercel-blob-property-branding.test.mjs && node scripts/neon/validate-vercel-blob-property-branding-live.mjs`

Expected: PASS for upload, readback, byte/MIME verification, exact-path delete,
retry, and not-found cleanup on a Preview-only store.

- [ ] **Step 5: Commit**

```bash
git add app/services/property/vercel-blob-brand-storage.ts app/services/neon-property-branding-authorization.ts app/repositories/neon/property-repository.ts app/api/property/identity/route.ts app/api/property/context/route.ts tests/vercel-blob-property-branding.test.mjs scripts/neon/validate-vercel-blob-property-branding-live.mjs
git commit -m "feat(storage): move property branding to Vercel Blob"
```

### Task 6: Remove Supabase runtime, package, environment, and legacy code

**Files:**
- Delete: `app/repositories/supabase/`
- Delete: `app/repositories/runtime/supabase-domain-registry.ts`
- Delete: `app/services/import/legacy-supabase-import-inspection.ts`
- Modify: `app/repositories/runtime/load-domain-registry.ts`
- Modify: `app/lib/environment.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/neon/validate-supabase-exit.mjs`
- Test: `scripts/neon/validate-supabase-exit.test.mjs`
- Modify: affected tests under `tests/`

**Consumes:** Tasks 1–5 and their passing source/runtime validation.

**Produces:** zero active Supabase runtime/package/environment references and a
repeatable final deletion gate.

- [ ] **Step 1: Write failing deletion-gate tests**

```js
test("deletion gate rejects Supabase package, env, repository, and runtime fallback", async () => {
  assert.throws(() => await validateExit(fixtureWithSupabaseImport), /SUPABASE_EXIT_DRIFT/);
  assert.throws(() => await validateExit(fixtureWithSupabaseEnv), /SUPABASE_EXIT_ENV_DRIFT/);
});
```

- [ ] **Step 2: Run the deletion-gate test**

Run: `node --test scripts/neon/validate-supabase-exit.test.mjs`

Expected: FAIL because Supabase files, modes, package, and environment parsing
still exist.

- [ ] **Step 3: Remove all active and legacy Supabase surfaces**

Allow only `mock` and `neon` data modes; production remains hard-denied unless
it explicitly selects Neon. Delete all Supabase repositories, tests tied solely
to their historical behavior, migration/seed compatibility references, browser
and server clients, and `@supabase/supabase-js`. Remove all Supabase environment
variables from source and Preview/Production configuration only after Preview
end-to-end passes. Do not retain bridges or silent fallbacks.

- [ ] **Step 4: Run final source and build gates**

Run: `node --test scripts/neon/validate-supabase-exit.test.mjs && node scripts/neon/validate-supabase-exit.mjs source && npm test && npm run build && git diff --check`

Expected: all tests/build pass; client bundle and active source have no
Supabase, database credential, or Blob token.

- [ ] **Step 5: Commit**

```bash
git add -A
git restore --staged .superpowers/sdd/2026-08-07-e5b-import-staging-foundation/progress.md 'scripts/neon/validate-e5b-storage-saga.test 2.mjs'
git commit -m "refactor(runtime): remove Supabase dependencies"
```

### Task 7: Non-production end-to-end acceptance and deletion record

**Files:**
- Create: `scripts/neon/validate-supabase-exit-database.mjs`
- Create: `scripts/neon/validate-supabase-exit-runtime.mjs`
- Create: `docs/neon/supabase-deletion-gate.md`
- Test: `scripts/neon/validate-supabase-exit-database.test.mjs`

**Consumes:** exact Preview target, direct bootstrap credential, pooled
application credential, `AUTH_DATABASE_URL`, Better Auth Preview session, and
Vercel Blob Preview store.

**Produces:** an evidence-backed `SAFE TO DELETE` or a precise blocker record.

- [ ] **Step 1: Write failing live-gate test**

```js
test("live gate refuses unknown target, direct runtime, or a nonempty legacy inventory", async () => {
  await assert.rejects(() => runExitGate(unknownTarget), /TARGET_MISMATCH/);
  await assert.rejects(() => runExitGate(directRuntime), /POOLED_RUNTIME_REQUIRED/);
});
```

- [ ] **Step 2: Run the live-gate test**

Run: `node --test scripts/neon/validate-supabase-exit-database.test.mjs`

Expected: FAIL because the final exit gate does not exist.

- [ ] **Step 3: Implement constrained verification commands**

Require source -> dry-run rollback -> apply -> catalog -> pooled runtime. The
catalog verifies app_auth role/schema isolation, canonical business owner/RLS/
ACL invariants, zero legacy objects, and zero Supabase package/env source
surface. The runtime creates a disposable Better Auth user, initializes Neon
mapping, verifies login/refresh/manager/department-admin/cross-property/raw
denial/Actor Context reuse, exercises property-brand Blob lifecycle, then
deletes only its exact user and objects.

- [ ] **Step 4: Run Preview-only acceptance**

Run: `node scripts/neon/validate-supabase-exit.mjs source && node scripts/neon/validate-supabase-exit-database.mjs dry-run && node scripts/neon/validate-supabase-exit-database.mjs apply && node scripts/neon/validate-supabase-exit-database.mjs catalog && node scripts/neon/validate-supabase-exit-runtime.mjs`

Expected: each command passes without outputting a URL, token, password, cookie,
or database row; cleanup returns zero disposable artifacts.

- [ ] **Step 5: Commit the non-secret operational record**

```bash
git add scripts/neon/validate-supabase-exit-database.mjs scripts/neon/validate-supabase-exit-runtime.mjs scripts/neon/validate-supabase-exit-database.test.mjs docs/neon/supabase-deletion-gate.md
git commit -m "docs(runtime): record Supabase deletion gate"
```
