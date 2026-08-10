# Neon Runtime Final Cutover Rehearsal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every canonical business domain through one explicit Neon runtime registry in non-production, while retaining Supabase only for Auth and Storage adapters and as an explicit repository rollback choice.

**Architecture:** A pure selector decides one source for all business domains. The read-only runtime endpoint exposes that decision and the loader dynamically imports exactly one source registry. A React hook gives every page and service the loaded `RuntimeDomainRegistry`; browser consumers never build a synchronous registry or a Supabase business-data client.

**Tech Stack:** React client components, TypeScript, same-origin `fetch`, Node test runner, existing HTTP/Supabase repository adapters, Neon server boundary.

## Global Constraints

- `APP_DATA_MODE=neon` plus `APP_RUNTIME_REHEARSAL=enabled` is the only Neon selection. Mixed, incomplete, or unsupported configuration fails closed.
- Production always rejects Neon rehearsal. Do not change Production, schema, Auth provider, Storage provider, Actor Context, RLS, or entrypoints.
- Organization, People, Position, Employee, Import, Property, and Initialization must resolve to one source for a registry instance.
- Neon errors stay Neon errors; no automatic client or server fallback exists.
- Supabase is selected only with an explicit Supabase configuration.
- Browser code receives no Neon credential, `DATABASE_URL`, PostgreSQL client, raw table client, or Supabase business-data client in Neon mode.
- No page, component, or service calls `createRepositoryRegistry()`.

---

## File Structure

- `app/lib/runtime-rehearsal-mode.ts`: pure source selection.
- `app/api/runtime/rehearsal-mode/route.ts`: read-only selection observation.
- `app/repositories/runtime/load-domain-registry.ts`: lazy one-source loader.
- `app/repositories/runtime/use-runtime-domain-registry.ts`: React hook.
- `app/repositories/runtime/{neon,supabase,mock}-domain-registry.ts`: source constructors.
- `app/page.tsx`, all listed business pages, and `app/components/initialization/InitializationStatusCard.tsx`: hook consumers.
- `app/services/{department-foundation,people-foundation,foundation-readiness}.ts`: `RuntimeDomainRegistry` type consumers.
- `scripts/neon/validate-runtime-final-cutover.{mjs,test.mjs}`: source and built-client boundary gate.
- `docs/neon/runtime-final-cutover-rehearsal.md`: configuration, rollback, and live non-production acceptance guide.

### Task 1: Single explicit selector and lazy registry contract

**Files:**
- Modify: `app/lib/runtime-rehearsal-mode.ts`
- Modify: `app/api/runtime/rehearsal-mode/route.ts`
- Modify: `app/repositories/runtime/load-domain-registry.ts`
- Create: `app/repositories/runtime/mock-domain-registry.ts`
- Create: `tests/runtime-final-cutover-selector.test.mjs`

**Consumes:** `AppEnvironment`, `createNeonDomainRegistry`, and `createSupabaseDomainRegistry`.

**Produces:** `resolveRuntimeDomainSelection()` and a loader that imports only the selected Neon, Supabase, or mock registry.

- [ ] **Step 1: Write a failing selector matrix test**

```js
test('enabled preview Neon selects all seven domains', () => {
  assert.deepEqual(resolveRuntimeDomainSelection(neonPreview, neonEnabled), {
    source: 'neon', domains: allNeonDomains,
  });
});
test('unconfirmed Neon and Production rehearsal fail closed', () => {
  assert.throws(() => resolveRuntimeDomainSelection(neonPreview, {}), /APP_RUNTIME_REHEARSAL=enabled/);
  assert.throws(() => resolveRuntimeDomainSelection(neonProduction, neonEnabled), /denied in production/);
});
test('Supabase is selected only by explicit Supabase configuration', () => {
  assert.equal(resolveRuntimeDomainSelection(supabasePreview, {}).source, 'supabase');
});
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/runtime-final-cutover-selector.test.mjs`

Expected: `resolveRuntimeDomainSelection` is absent and disabled Neon still reports Supabase.

- [ ] **Step 3: Implement the selector and loader**

```ts
if (environment.dataMode === 'neon') {
  if (input.APP_RUNTIME_REHEARSAL !== 'enabled')
    throw new Error('Neon runtime requires APP_RUNTIME_REHEARSAL=enabled');
  if (environment.appEnv === 'production' || input.VERCEL_ENV === 'production')
    throw new Error('Neon runtime rehearsal is denied in production');
  return selection('neon');
}
```

Use the full selected matrix in the route response. Reject a partial/mixed response in the loader. A loader rejection must not invoke the Supabase importer. Keep mock mode for existing local tests through a separate lazy mock registry.

- [ ] **Step 4: Verify GREEN**

Run: `node --experimental-strip-types --test tests/runtime-final-cutover-selector.test.mjs`

Expected: all explicit Neon, Supabase, mock, invalid, and Production cases pass.

- [ ] **Step 5: Commit**

```bash
git add app/lib/runtime-rehearsal-mode.ts app/api/runtime/rehearsal-mode/route.ts app/repositories/runtime/load-domain-registry.ts app/repositories/runtime/mock-domain-registry.ts tests/runtime-final-cutover-selector.test.mjs
git commit -m "feat(runtime): select one explicit business source"
```

### Task 2: Runtime hook and service boundary

**Files:**
- Create: `app/repositories/runtime/use-runtime-domain-registry.ts`
- Modify: `app/repositories/runtime/neon-domain-registry.ts`
- Modify: `app/repositories/runtime/supabase-domain-registry.ts`
- Modify: `app/services/department-foundation.ts`
- Modify: `app/services/people-foundation.ts`
- Modify: `app/services/foundation-readiness.ts`
- Create: `tests/runtime-domain-registry-hook.test.mjs`

**Consumes:** `loadRuntimeDomainRegistry(): Promise<RuntimeDomainRegistry>`.

**Produces:** `useRuntimeDomainRegistry(): { registry, loading, error, retry }`.

- [ ] **Step 1: Write failing behavior tests**

```js
test('a rejected Neon loader produces an error state without a fallback registry', async () => {
  const state = await resolveRuntimeRegistryState(rejectingLoader);
  assert.equal(state.registry, null);
  assert.match(state.error.message, /Neon unavailable/);
});
test('foundation services accept RuntimeDomainRegistry directly', async () => {
  assert.equal((await loadFoundationReadiness(neonRegistry, managerSession)).presentationState, 'real');
});
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/runtime-domain-registry-hook.test.mjs`

Expected: hook resolver and source-independent service types are unavailable.

- [ ] **Step 3: Implement hook and types**

The hook owns pending/ready/error/retry state, calls only the loader, and preserves its error. Replace service aliases based on `ReturnType<typeof createRepositoryRegistry>` with `RuntimeDomainRegistry`. Do not add test-only cleanup methods to production classes.

- [ ] **Step 4: Verify GREEN**

Run: `node --experimental-strip-types --test tests/runtime-domain-registry-hook.test.mjs`

Expected: selected registry, retry, and no-fallback rejection behavior pass.

- [ ] **Step 5: Commit**

```bash
git add app/repositories/runtime app/services/department-foundation.ts app/services/people-foundation.ts app/services/foundation-readiness.ts tests/runtime-domain-registry-hook.test.mjs
git commit -m "feat(runtime): expose one loaded domain registry"
```

### Task 3: Migrate all browser consumers

**Files:**
- Modify: `app/page.tsx`, `app/organization/page.tsx`, `app/people/page.tsx`, `app/positions/page.tsx`, `app/import/page.tsx`, `app/initialize/page.tsx`, `app/settings/hotel/page.tsx`, `app/accounts/page.tsx`, `app/data-quality/page.tsx`, `app/department/page.tsx`, `app/department/employees/page.tsx`
- Modify: `app/components/initialization/InitializationStatusCard.tsx`
- Modify: `tests/checkpoint-2c-a.test.mjs`, `tests/checkpoint-2c-d1.test.mjs`
- Create: `tests/runtime-final-cutover-pages.test.mjs`

**Consumes:** `useRuntimeDomainRegistry()`.

**Produces:** no browser consumer directly calls `createRepositoryRegistry()`.

- [ ] **Step 1: Write failing page-boundary tests**

```js
test('each business page/component uses the runtime hook', async () => {
  for (const path of runtimeConsumers) {
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /createRepositoryRegistry\(/);
    assert.match(source, /useRuntimeDomainRegistry\(/);
  }
});
test('Import, Property, and Initialization do not call a repository before the loader is ready', async () => {
  assert.equal(renderWithRejectedRegistry('/import').getByRole('alert').textContent.includes('Supabase'), false);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test tests/runtime-final-cutover-pages.test.mjs`

Expected: direct factory calls are found in Import, Property/Initialization, foundation pages, and shared initialization state.

- [ ] **Step 3: Implement migration**

Replace each synchronous factory `useMemo` with the hook. Wait for a non-null registry before invoking any repository. Preserve existing loading/error UI and retry behavior. Update old source-contract tests to assert the loader, not the old factory. Do not alter Auth sessions, Storage calls, APIs, or repository interfaces.

- [ ] **Step 4: Verify GREEN**

Run: `node --experimental-strip-types --test tests/runtime-final-cutover-pages.test.mjs tests/checkpoint-2c-a.test.mjs tests/checkpoint-2c-d1.test.mjs`

Expected: no direct factory call remains in pages/components/services.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx app/organization/page.tsx app/people/page.tsx app/positions/page.tsx app/import/page.tsx app/initialize/page.tsx app/settings/hotel/page.tsx app/accounts/page.tsx app/data-quality/page.tsx app/department/page.tsx app/department/employees/page.tsx app/components/initialization/InitializationStatusCard.tsx tests/checkpoint-2c-a.test.mjs tests/checkpoint-2c-d1.test.mjs tests/runtime-final-cutover-pages.test.mjs
git commit -m "feat(runtime): load all business pages from one registry"
```

### Task 4: Browser boundary gate and operations guide

**Files:**
- Create: `scripts/neon/validate-runtime-final-cutover.mjs`
- Create: `scripts/neon/validate-runtime-final-cutover.test.mjs`
- Create: `docs/neon/runtime-final-cutover-rehearsal.md`

**Consumes:** the loader, consumer list, and emitted client assets.

**Produces:** source/client gate and staging-only operational checklist.

- [ ] **Step 1: Write failing validator tests**

```js
test('the gate rejects a direct factory, Supabase business client, and browser Neon secret', async () => {
  await assert.rejects(() => validateFixture('factory-call'), /DIRECT_REGISTRY_DRIFT/);
  await assert.rejects(() => validateFixture('supabase-business-client'), /SUPABASE_BUSINESS_CLIENT_DRIFT/);
  await assert.rejects(() => validateFixture('database-url'), /BROWSER_NEON_SECRET_DRIFT/);
});
test('the gate accepts a seven-domain Neon matrix and explicit fallback only', async () => {
  assert.deepEqual(await validateFixture('neon-all-domains'), { source: 'neon', fallback: 'explicit' });
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/neon/validate-runtime-final-cutover.test.mjs`

Expected: validator module is missing.

- [ ] **Step 3: Implement validator and guide**

Scan browser consumers and generated client assets. Reject direct registry creation, Supabase business repositories/clients, `pg`, `DATABASE_URL`, Neon URLs, and known Neon credential variables. Allow only the Supabase Auth adapter and server-only Storage saga. Document fresh initialization, real Auth login, same-origin network matrix, RLS/Actor Context/reuse checks, full Import flow, Storage read-back/mismatch/cleanup, explicit Supabase rollback, and Production prohibition.

- [ ] **Step 4: Verify GREEN**

Run: `node --test scripts/neon/validate-runtime-final-cutover.test.mjs && node scripts/neon/validate-runtime-final-cutover.mjs source`

Expected: source report confirms one domain source, no business client, and no browser Neon credential.

- [ ] **Step 5: Commit**

```bash
git add scripts/neon/validate-runtime-final-cutover.mjs scripts/neon/validate-runtime-final-cutover.test.mjs docs/neon/runtime-final-cutover-rehearsal.md
git commit -m "test(runtime): gate final Neon cutover boundary"
```

### Task 5: Full verification

**Files:**
- Modify: `docs/neon/runtime-final-cutover-rehearsal.md` only if a verification command requires factual correction.

**Consumes:** Tasks 1–4.

**Produces:** review-ready code without a live Production, Supabase, database, or Storage mutation.

- [ ] **Step 1: Run focused tests and gate**

Run:

```bash
node --experimental-strip-types --test tests/runtime-final-cutover-selector.test.mjs tests/runtime-domain-registry-hook.test.mjs tests/runtime-final-cutover-pages.test.mjs scripts/neon/validate-runtime-final-cutover.test.mjs
node scripts/neon/validate-runtime-final-cutover.mjs source
```

Expected: all pass; one source is reported and no browser business/credential leak is found.

- [ ] **Step 2: Run project verification**

Run: `npm test && npm run build && git diff --check`

Expected: 201/201, build success, no whitespace errors.

- [ ] **Step 3: Verify rollback behavior**

Run: `node --experimental-strip-types --test tests/runtime-final-cutover-selector.test.mjs`

Expected: only explicit Supabase configuration selects Supabase; a Neon failure stays an error.

- [ ] **Step 4: Commit an operations-document correction if needed**

```bash
git add docs/neon/runtime-final-cutover-rehearsal.md
git commit -m "docs(neon): record cutover rehearsal verification"
```

- [ ] **Step 5: Report live rehearsal prerequisites**

Live acceptance needs a freshly initialized non-production Neon property and a real Auth session. Do not perform a database, Auth, Storage, Supabase, or Production mutation while implementing this branch.

## Plan self-review

Tasks 1–2 cover source selection, Production denial, no fallback, and the single registry interface. Task 3 covers every direct browser consumer. Task 4 covers source/bundle isolation plus the live matrix. Task 5 covers focused and project-wide verification. No task changes Auth, Storage, Production, schema, or repository contracts.

