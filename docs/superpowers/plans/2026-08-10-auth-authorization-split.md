# Auth / Authorization Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Supabase a pure Authentication adapter while canonical Neon resolves every session authorization fact.

**Architecture:** Login first resolves an internal identity through a constrained Neon pre-auth entrypoint, then verifies the exact returned Auth user through Supabase password sign-in. Every authenticated request verifies the Supabase Auth token, resolves the hostname and property in Neon, installs the existing transaction-local Actor Context, and obtains its account/membership/role/scope projection from one constrained Neon entrypoint.

**Tech Stack:** TypeScript, React server routes, `pg` pooled Neon application role, Supabase Auth SDK, PostgreSQL 18 canonical migrations, Node test runner.

## Global Constraints

- Supabase may perform only `signInWithPassword`, `getUser`, refresh, and optional Auth Admin operations.
- Supabase `.from()` and business `.rpc()` are forbidden in the active login, session, request-authentication, and manager-authorization paths.
- Neon remains the authorization authority; raw runtime table privilege stays zero.
- Actor Context GUC names, transaction scope, application role, and RLS policies are unchanged.
- Browser code uses same-origin APIs only and receives no Neon credential or Supabase business client.
- Do not change Storage, Production behavior, legacy Supabase repositories, or Auth provider configuration.
- Every production behavior begins with a failing connection-free test; live validation is non-production only.

---

## File structure

| File | Responsibility |
|---|---|
| `neon/canonical/085_auth_authorization.sql` | Exact pre-auth and actor-scoped authorization entrypoints, grants, audits, and no new RLS policy. |
| `neon/canonical/canonical-neon-manifest.json` | Adds module 085, public entrypoint signatures, and catalog inventory. |
| `app/lib/neon/pre-auth-authorization.ts` | Runs a short application-role transaction with no actor GUCs and calls only the pre-auth entrypoint. |
| `app/repositories/neon/authorization-session-repository.ts` | Maps exact Neon JSON projections into server-only authorization facts. |
| `app/services/authentication-service.ts` | Replaces Supabase business lookup with Neon pre-auth lookup and session authority. |
| `app/services/request-authentication.ts` | Carries private Neon tenant/property authorization facts with the verified Auth session. |
| `app/services/production-authorization.ts` | Validates property manager authority from Neon facts, not Supabase `properties`. |
| `scripts/neon/validate-auth-authorization-split.mjs` | Rejects Supabase business calls in active Auth/session paths and verifies browser boundary sources. |
| `tests/auth-authorization-split.test.mjs` | Executes login, session, refresh, scope, mismatch, and fail-closed behavior with injected Supabase Auth and Neon repositories. |

### Task 1: RED authorization contracts and server-only interfaces

**Files:**
- Create: `tests/auth-authorization-split.test.mjs`
- Create: `scripts/neon/validate-auth-authorization-split.mjs`
- Modify: `app/services/authentication-service.ts`
- Modify: `app/services/request-authentication.ts`

**Consumes:** Existing `AuthSession`, `ResolvedAccount`, `resolveRequestAuthIdentity`, and `RuntimeDomainRegistry` browser source gate.

**Produces:** The fixed interfaces used by later tasks:

```ts
export type NeonPreAuthLoginIdentity = Readonly<{
  authUserId: string;
  email: string;
}>;

export type NeonAuthorizationFacts = Readonly<{
  session: AuthSession;
  tenantId: string | null;
}>;

export type NeonAuthorizationRepository = Readonly<{
  resolveLoginIdentity(hostname: string, loginId: string): Promise<NeonPreAuthLoginIdentity | null>;
  readSessionAuthority(hostname: string): Promise<NeonAuthorizationFacts>;
}>;
```

- [ ] **Step 1: Write failing behavior tests**

```js
test('login rejects a Supabase Auth user ID that differs from Neon identity', async () => {
  const result = await resolveLoginWith({
    neon: fakeNeonIdentity('11111111-1111-4111-8111-111111111111'),
    auth: fakeAuthSignIn('22222222-2222-4222-8222-222222222222'),
  });
  assert.deepEqual(result, { kind: 'generic-login-failure' });
});

test('session authority never invokes Supabase from or rpc', async () => {
  const auth = authOnlyClient();
  await resolveSessionWith({ auth, neon: fakeManagerAuthority() });
  assert.equal(auth.businessCalls, 0);
});
```

- [ ] **Step 2: Run RED tests**

Run: `node --experimental-strip-types --test tests/auth-authorization-split.test.mjs`

Expected: FAIL because the new repository contract and injected Neon authority paths do not exist.

- [ ] **Step 3: Add minimal test seams without behavior changes**

Add exported dependency factories for login/session resolution. The default factory must keep current behavior until Tasks 2 and 3 replace it; test fakes must expose only Auth operations and throw if `.from` or `.rpc` is attempted.

- [ ] **Step 4: Re-run the focused test**

Run: `node --experimental-strip-types --test tests/auth-authorization-split.test.mjs`

Expected: still RED only for missing Neon authority implementation, proving the failure is behavioral rather than test setup.

- [ ] **Step 5: Commit the RED contract**

```bash
git add tests/auth-authorization-split.test.mjs scripts/neon/validate-auth-authorization-split.mjs app/services/authentication-service.ts app/services/request-authentication.ts
git commit -m "test(auth): define Neon authorization split contract"
```

### Task 2: Neon pre-auth identity and authorization-session entrypoints

**Files:**
- Create: `neon/canonical/085_auth_authorization.sql`
- Modify: `neon/canonical/canonical-neon-manifest.json`
- Modify: `scripts/neon/validate-canonical-neon-baseline.mjs`
- Modify: `scripts/neon/canonical-neon-bootstrap-contract.test.mjs`
- Modify: `tests/auth-authorization-split.test.mjs`

**Consumes:** `public.resolve_neon_property_context`, existing `user_accounts`, `profiles`, membership, role-assignment, trainer-scope, department path, actor assertion, and People read-audit surfaces.

**Produces:**

```sql
public.resolve_neon_login_identity(p_hostname text, p_login_id text) returns jsonb
public.read_neon_authorization_session(p_hostname text) returns jsonb
```

- [ ] **Step 1: Add failing migration/source contracts**

```js
test('canonical authorization migration declares only constrained exact entrypoints', () => {
  const result = validateCanonicalAuthAuthorizationSource(readFixture('missing-entrypoints'));
  assert.match(result.error.message, /AUTHORIZATION_ENTRYPOINT_MISSING/);
});

test('session authority rejects broad grant and raw application privilege', () => {
  assert.throws(() => validateCanonicalAuthAuthorizationSource(readFixture('public-execute')),
    /PUBLIC_EXECUTE/);
  assert.throws(() => validateCanonicalAuthAuthorizationSource(readFixture('raw-table-grant')),
    /RAW_APPLICATION_PRIVILEGE/);
});
```

- [ ] **Step 2: Run RED migration/source tests**

Run: `node --experimental-strip-types --test scripts/neon/canonical-neon-bootstrap-contract.test.mjs tests/auth-authorization-split.test.mjs`

Expected: FAIL because module 085 and the exact signatures are absent.

- [ ] **Step 3: Implement module 085**

Create one transaction-framed canonical module that:

```sql
begin;
set local role hotel_ld_migration_owner;

create function public.resolve_neon_login_identity(p_hostname text, p_login_id text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
-- resolve only active verified hostname, active account/profile and normalized login ID;
-- return auth_user_id and email only to the application role; return null when absent.
$$;

create function public.read_neon_authorization_session(p_hostname text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
-- assert hostname equals current Actor Context property; derive active account,
-- memberships, effective manager/department role, and active scope breadcrumbs;
-- append existing People read audit and return a browser-safe session projection.
$$;

revoke all on function public.resolve_neon_login_identity(text,text) from public;
revoke all on function public.read_neon_authorization_session(text) from public;
grant execute on function public.resolve_neon_login_identity(text,text) to hotel_ld_application;
grant execute on function public.read_neon_authorization_session(text) to hotel_ld_application;
commit;
```

Do not add a table, policy, raw grant, broad role, persistent GUC, or Auth-schema reference. Add both exact signatures to the canonical manifest and catalog source assertions.

- [ ] **Step 4: Make migration contracts GREEN**

Run: `node --experimental-strip-types --test scripts/neon/canonical-neon-bootstrap-contract.test.mjs tests/auth-authorization-split.test.mjs`

Expected: PASS; mutation fixtures prove fixed empty search path, explicit PUBLIC revoke, exact execute, no raw application grant, and no RLS-policy change.

- [ ] **Step 5: Commit entrypoints**

```bash
git add neon/canonical/085_auth_authorization.sql neon/canonical/canonical-neon-manifest.json scripts/neon/validate-canonical-neon-baseline.mjs scripts/neon/canonical-neon-bootstrap-contract.test.mjs tests/auth-authorization-split.test.mjs
git commit -m "feat(neon): add authorization session entrypoints"
```

### Task 3: Server-only Neon authorization repository and session bootstrap

**Files:**
- Create: `app/lib/neon/pre-auth-authorization.ts`
- Create: `app/repositories/neon/authorization-session-repository.ts`
- Modify: `app/services/authentication-service.ts`
- Modify: `app/services/request-authentication.ts`
- Modify: `app/api/auth/login/route.ts`
- Modify: `app/api/auth/session/route.ts`
- Test: `tests/auth-authorization-split.test.mjs`

**Consumes:** Exact Task 2 entrypoints, `createNeonPool`, `withNeonResolvedActorContext`, Supabase Auth `signInWithPassword`, `getUser`, and refresh.

**Produces:** `resolveNeonAuthorizationForAuthUser(authUserId, hostname, requestId)` and a login flow that does not read Supabase business data.

- [ ] **Step 1: Add failing manager, department scope, refresh, and cross-property tests**

```js
test('manager session is derived from a Neon authority projection', async () => {
  const resolved = await resolveSessionWith({ neon: fakeManagerAuthority(), auth: authOnlyClient() });
  assert.equal(resolved.session.role, 'property_ld_manager');
  assert.equal(resolved.tenantId, 'tenant-a');
});

test('department administrator receives only Neon-authorized descendant scope', async () => {
  const resolved = await resolveSessionWith({ neon: fakeDepartmentAuthority(), auth: authOnlyClient() });
  assert.deepEqual(resolved.session.departmentScopes.map(scope => scope.departmentId), ['front-office']);
});

test('refresh re-resolves Neon authority instead of retaining stale role facts', async () => {
  const result = await resolveRequestWithRefresh({ auth: authOnlyClient(), neon: fakeUnauthorizedAuthority() });
  assert.equal(result, null);
});

test('hostname property mismatch produces no authenticated business session', async () => {
  const result = await resolveSessionWith({ neon: fakeCrossPropertyAuthority(), auth: authOnlyClient() });
  assert.equal(result.session.authenticated, false);
});
```

- [ ] **Step 2: Run RED behavior tests**

Run: `node --experimental-strip-types --test tests/auth-authorization-split.test.mjs`

Expected: FAIL because login still calls Supabase `.from()` and session resolution has no Neon repository.

- [ ] **Step 3: Implement the minimal server-only repository**

`pre-auth-authorization.ts` must open a short application-role transaction, prove no actor GUC is installed before/after, invoke only `resolve_neon_login_identity`, and release the pooled client. It must not set an Actor Context or use raw SQL tables.

`authorization-session-repository.ts` must call only the two Task 2 exact signatures. For a verified Auth user, call `withNeonResolvedActorContext` with the existing hostname/property resolver, then call `read_neon_authorization_session`. Map JSON into the existing `AuthSession`; keep `tenantId` in a server-only companion result.

Replace `authentication-service.ts` code in this order:

```ts
const identity = await neon.resolveLoginIdentity(hostname, normalizedLoginId);
if (!identity) throw genericLoginError();
const auth = await supabaseAuth.signInWithPassword({ email: identity.email, password });
if (!auth.user || auth.user.id !== identity.authUserId || !auth.session) throw genericLoginError();
const authorization = await resolveNeonAuthorizationForAuthUser(auth.user.id, hostname, requestId);
```

`resolveRequestAuthIdentity()` continues to perform only Auth `getUser` and refresh. Session and login API routes preserve generic browser errors and cookie behavior.

- [ ] **Step 4: Make focused behavior tests GREEN**

Run: `node --experimental-strip-types --test tests/auth-authorization-split.test.mjs`

Expected: PASS; fakes throw if any Supabase `.from()` or `.rpc()` is reached.

- [ ] **Step 5: Commit session bootstrap**

```bash
git add app/lib/neon/pre-auth-authorization.ts app/repositories/neon/authorization-session-repository.ts app/services/authentication-service.ts app/services/request-authentication.ts app/api/auth/login/route.ts app/api/auth/session/route.ts tests/auth-authorization-split.test.mjs
git commit -m "feat(auth): resolve sessions through Neon authority"
```

### Task 4: Manager and control-plane scope migration

**Files:**
- Modify: `app/services/production-authorization.ts`
- Modify: `app/api/initialization/access/route.ts`
- Modify: `scripts/neon/validate-auth-authorization-split.mjs`
- Modify: `tests/auth-authorization-split.test.mjs`
- Modify: `tests/runtime-final-cutover-pages.test.mjs`

**Consumes:** Task 3 private `tenantId` authorization fact and browser-safe `AuthSession`.

**Produces:** Manager validation from Neon authority and a source gate that rejects Supabase business reads/RPC from active Auth/session/control-plane paths.

- [ ] **Step 1: Write failing manager and source-boundary tests**

```js
test('property manager authorization uses the tenant returned by Neon authority', async () => {
  const actor = await requireManagerWith(fakeNeonManagerRequest());
  assert.deepEqual(actor, { tenantId: 'tenant-a', propertyId: 'property-a' });
});

test('active Auth/session sources reject Supabase business calls', () => {
  assert.throws(() => validateAuthAuthorizationSource({
    authenticationService: 'client.from("user_accounts")',
  }), /SUPABASE_BUSINESS_AUTH_DRIFT/);
});
```

- [ ] **Step 2: Run RED tests**

Run: `node --experimental-strip-types --test tests/auth-authorization-split.test.mjs tests/runtime-final-cutover-pages.test.mjs`

Expected: FAIL because `requirePropertyManager` queries Supabase `properties` and the source gate is absent.

- [ ] **Step 3: Replace manager validation and add the source gate**

Remove the `createServerActorClient(...).from('properties')` check from
`requirePropertyManager`. Require the private Neon authorization fact to have
an active property manager role plus matching tenant/property IDs.

The source validator must inspect exactly:

```text
app/services/authentication-service.ts
app/services/request-authentication.ts
app/services/production-authorization.ts
app/api/auth/login/route.ts
app/api/auth/session/route.ts
```

It must reject `.from(`, business `.rpc(`, imports of legacy Supabase business
repositories, and browser Supabase client imports; it may allow only
`auth.signInWithPassword`, `auth.getUser`, `auth.refreshSession`, and the
server-only Storage gateway outside this path.

- [ ] **Step 4: Make scope and browser-boundary tests GREEN**

Run:

```bash
node --experimental-strip-types --test tests/auth-authorization-split.test.mjs tests/runtime-final-cutover-pages.test.mjs
node scripts/neon/validate-auth-authorization-split.mjs source
node scripts/neon/validate-runtime-final-cutover.mjs source
```

Expected: all commands pass; the source report proves Auth/session code has no
Supabase business reads and browser code has no business client or Neon secret.

- [ ] **Step 5: Commit manager migration**

```bash
git add app/services/production-authorization.ts app/api/initialization/access/route.ts scripts/neon/validate-auth-authorization-split.mjs tests/auth-authorization-split.test.mjs tests/runtime-final-cutover-pages.test.mjs
git commit -m "feat(auth): enforce manager scope through Neon"
```

### Task 5: Canonical validation and operations record

**Files:**
- Create: `docs/neon/auth-authorization-split-verification.md`
- Modify: `scripts/neon/validate-canonical-neon-baseline.mjs`
- Modify: `tests/auth-authorization-split.test.mjs`

**Consumes:** Tasks 2–4 source contracts and canonical module manifest.

**Produces:** Non-production validation instructions and a catalog/runtime matrix for the new exact entrypoints.

- [ ] **Step 1: Add failing catalog/runtime contract tests**

```js
test('catalog contract requires authorization entrypoint owner, fixed search path, ACL, RLS and raw denial', () => {
  const verdict = catalogVerdict(fixture({ authorizationEntrypointAcl: false }));
  assert.equal(verdict.valid, false);
});
```

- [ ] **Step 2: Run RED contract test**

Run: `node --experimental-strip-types --test tests/auth-authorization-split.test.mjs`

Expected: FAIL because the validator does not yet require the authorization entrypoint matrix.

- [ ] **Step 3: Add canonical validation and operations record**

Require both entrypoints to have migration-owner ownership, `SECURITY DEFINER`, fixed empty search path, `PUBLIC` execute revoke, and exact application execute. The runtime matrix must cover a real Supabase Auth session, manager, scoped department admin, refresh authority re-resolution, cross-property denial, raw-table denial, and pooled Actor Context cleanup.

Document the commands as staging-only and explicitly prohibit Production, Supabase business queries, user password output, and browser credentials.

- [ ] **Step 4: Run full verification**

Run:

```bash
node --experimental-strip-types --test tests/auth-authorization-split.test.mjs scripts/neon/canonical-neon-bootstrap-contract.test.mjs
node scripts/neon/validate-auth-authorization-split.mjs source
npm test
npm run build
git diff --check
```

Expected: all connection-free checks pass. Perform canonical child validation only with an explicitly approved non-production target: `source → dry-run → apply → catalog → runtime`.

- [ ] **Step 5: Commit verification assets**

```bash
git add docs/neon/auth-authorization-split-verification.md scripts/neon/validate-canonical-neon-baseline.mjs tests/auth-authorization-split.test.mjs
git commit -m "test(auth): validate Neon authorization authority"
```

## Plan self-review

- Spec coverage: Tasks 2–4 cover all four approved phases; Task 5 covers the required source, catalog, runtime, browser, test, and build evidence.
- Constraints: every task preserves the Auth adapter, Actor Context semantics, raw privilege boundary, Storage, Production, and legacy fallback repositories.
- Type consistency: `NeonPreAuthLoginIdentity`, `NeonAuthorizationFacts`, and `NeonAuthorizationRepository` are introduced in Task 1 and consumed unchanged by Tasks 2–4.
- No placeholder scan: the plan contains exact file names, signatures, tests, commands, and commit scopes.
