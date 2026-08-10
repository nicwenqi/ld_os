# Neon-first Initialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a repeatable, operator-only Neon-first initialization flow that maps a verified Auth user and creates a ready development property without touching legacy Supabase state.

**Architecture:** A standalone Node CLI validates an explicit non-production target manifest and direct operator URL before opening a transaction. A closed fixture defines the tenant/property, manager mapping, Property/Initialization records, and minimal development data; all rows are insert-or-exact-match and audit evidence is append-only. Runtime access remains the existing Auth adapter → Actor Context → HTTP repository path.

**Tech Stack:** Node.js ESM, `pg`, PostgreSQL 18 / Neon, existing canonical SQL schema, Node test runner.

## Global Constraints

- Do not modify Production, Supabase business data, Auth provider configuration, Storage provider, legacy migration chains, or canonical schema.
- Auth adapter creates and verifies the Auth user; the CLI accepts only its UUID and never receives a password, token, refresh token, or JWT.
- The CLI is operator-only, direct-connection only, non-production only, and never enters runtime API/registry/browser code.
- Do not grant `hotel_ld_application` raw DML or initialization privileges; do not use `SET ROLE` or create a permanent bootstrap role.
- Preserve Actor Context, application-role topology, RLS/FORCE RLS, constrained entrypoints, and repository boundaries.

---

### Task 1: Closed target and seed fixture contract

**Files:**
- Create: `scripts/neon/neon-first-initialization-contract.mjs`
- Create: `scripts/neon/neon-first-initialization-contract.test.mjs`
- Create: `scripts/neon/fixtures/neon-first-development-seed.example.json`

**Interfaces:**
- Produces `validateInitializationTarget(target, environment)` and `validateInitializationFixture(fixture, authUserId)`.
- Produces `NEON_FIRST_INITIALIZATION_SEED_VERSION` and a documented example fixture without a real Auth user ID.

- [ ] **Step 1: Write the failing contract tests**

```js
assert.throws(() => validateInitializationTarget({ environment: 'production' }), /NEON_FIRST_INIT_TARGET_FORBIDDEN/);
assert.throws(() => validateInitializationFixture({ unexpected: true }, validAuthUserId), /NEON_FIRST_INIT_FIXTURE_INVALID/);
```

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test scripts/neon/neon-first-initialization-contract.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the closed schema**

Require exact fields for target (`environment`, `projectId`, `branchId`, `endpointId`, `database`, `directHostPrefix`) and fixture IDs for identity, Property/Initialization, department, family, position, assignment, employee, and external identifier. Reject `production`, `hotel_ld_application`, pooler hosts, unexpected keys, unbounded strings, and non-UUID IDs.

- [ ] **Step 4: Run the test to verify GREEN**

Run: `node --test scripts/neon/neon-first-initialization-contract.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/neon/neon-first-initialization-contract.mjs scripts/neon/neon-first-initialization-contract.test.mjs scripts/neon/fixtures/neon-first-development-seed.example.json
git commit -m "feat(neon): define neon-first initialization contract"
```

### Task 2: Transactional operator bootstrap and seed

**Files:**
- Create: `scripts/neon/neon-first-initialization-operator.mjs`
- Create: `scripts/neon/neon-first-initialization-operator.test.mjs`

**Interfaces:**
- Consumes `validateInitializationTarget` and `validateInitializationFixture`.
- Produces `initializeNeonFirstEnvironment({ connectionString, target, fixture, authUserId, client })`.
- Returns `{ status, created, requestId, tenantId, propertyId, profileId, roleAssignmentId, seedVersion }`.

- [ ] **Step 1: Write failing transaction tests**

```js
await assert.rejects(
  initializeNeonFirstEnvironment({ client: conflictingClient, target, fixture, authUserId }),
  /NEON_FIRST_INIT_ROW_CONFLICT/
);
assert.deepEqual(calls.filter(({ text }) => text === 'rollback').length, 1);
```

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test scripts/neon/neon-first-initialization-operator.test.mjs`

Expected: FAIL because the operator module does not exist.

- [ ] **Step 3: Implement static parameterized SQL in dependency order**

Use one `begin`/`commit` block and `ensure` helpers that select by every identity/unique key before an `insert ... on conflict do nothing`, reread, and exact-match. Insert tenant/property/domain; profile/account/memberships/role/assignment; settings and all eight initialization steps; department/family/position/assignment; employee/identifier; then append organization/property/initialization audit evidence. Do not delete, update, grant, revoke, dynamically construct SQL, call Auth, or issue `SET ROLE`.

- [ ] **Step 4: Run the test to verify GREEN**

Run: `node --test scripts/neon/neon-first-initialization-operator.test.mjs`

Expected: PASS, including idempotence and rollback assertions.

- [ ] **Step 5: Commit**

```bash
git add scripts/neon/neon-first-initialization-operator.mjs scripts/neon/neon-first-initialization-operator.test.mjs
git commit -m "feat(neon): add transactional initialization operator"
```

### Task 3: Operator CLI, dry run, and redacted evidence

**Files:**
- Create: `scripts/neon/initialize-neon-first-environment.mjs`
- Create: `scripts/neon/initialize-neon-first-environment.test.mjs`
- Create: `docs/neon/neon-first-initialization.md`

**Interfaces:**
- Consumes the Task 2 operator.
- Accepts `--target-file`, `--fixture`, `--auth-user-id`, `--dry-run`, and `--evidence-file`.
- Writes an evidence file only below `/private/tmp/` or `/tmp/`, mode `0600`.

- [ ] **Step 1: Write failing CLI tests**

```js
await assert.rejects(runCli({ args: ['--dry-run'], env: {} }), /NEON_FIRST_INIT_AUTH_USER_REQUIRED/);
assert.throws(() => parseArgs(['--evidence-file', 'docs/evidence.json']), /NEON_FIRST_INIT_EVIDENCE_PATH_FORBIDDEN/);
```

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test scripts/neon/initialize-neon-first-environment.test.mjs`

Expected: FAIL because the CLI module does not exist.

- [ ] **Step 3: Implement the CLI**

Read non-secret target and fixture JSON, accept the direct operator URL from protected stdin or `NEON_BOOTSTRAP_DATABASE_URL`, and call Task 2. For `--dry-run`, always issue `rollback` after the full graph succeeds. Evidence contains IDs, created object names, seed version, request ID, mode, and target metadata; reject and omit any URL, password, token, or JWT field.

- [ ] **Step 4: Run the test to verify GREEN**

Run: `node --test scripts/neon/initialize-neon-first-environment.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/neon/initialize-neon-first-environment.mjs scripts/neon/initialize-neon-first-environment.test.mjs docs/neon/neon-first-initialization.md
git commit -m "feat(neon): add neon-first initialization command"
```

### Task 4: Source gate and integration handoff

**Files:**
- Create: `scripts/neon/validate-neon-first-initialization.mjs`
- Create: `scripts/neon/validate-neon-first-initialization.test.mjs`
- Modify: `docs/neon/neon-first-initialization.md`

**Interfaces:**
- Produces `validateNeonFirstInitializationSource()` and a documented non-production invocation sequence.

- [ ] **Step 1: Write failing source-gate tests**

```js
assert.equal(await validateNeonFirstInitializationSource({ source: sourceWithSetRole }), false);
assert.equal(await validateNeonFirstInitializationSource({ source: sourceWithAuthImport }), false);
```

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test scripts/neon/validate-neon-first-initialization.test.mjs`

Expected: FAIL because the validator module does not exist.

- [ ] **Step 3: Implement the source gate and handoff documentation**

Fail closed on runtime imports, API route imports, Supabase SDK/Auth mutations, `auth.users`, `SET ROLE`, grants to `hotel_ld_application`, production target acceptance, pooler URLs, raw concatenated SQL, secrets in evidence, and seed DML outside the operator. Document: Auth creates user → operator dry-run/apply → normal Auth login → existing runtime validation.

- [ ] **Step 4: Run focused and full validation**

Run:

```bash
node --test scripts/neon/neon-first-initialization-contract.test.mjs scripts/neon/neon-first-initialization-operator.test.mjs scripts/neon/initialize-neon-first-environment.test.mjs scripts/neon/validate-neon-first-initialization.test.mjs
node scripts/neon/validate-neon-first-initialization.mjs source
npm test
npm run build
```

Expected: focused tests and source gate pass; application suite remains 201/201; build passes.

- [ ] **Step 5: Commit**

```bash
git add scripts/neon/validate-neon-first-initialization.mjs scripts/neon/validate-neon-first-initialization.test.mjs docs/neon/neon-first-initialization.md
git commit -m "test(neon): validate neon-first initialization boundary"
```
