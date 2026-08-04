# Neon People Read-only Directory Implementation Plan

> **Execution:** Use `superpowers:subagent-driven-development` task by task.

**Goal:** Deliver the first complete Neon business-data slice for the manager
and department People read-only directories without changing Supabase Auth,
Supabase Storage, employee writes, or the existing UI/service contracts.

**Architecture:** The browser uses same-origin HTTP repositories. Server API
routes verify Supabase Auth, derive a trusted hostname, and execute a server-only
Neon repository inside a transaction-scoped actor context. Neon derives live
property, membership, role, and department scope facts and enforces employee
visibility through `FORCE ROW LEVEL SECURITY` under a non-owner,
`NOBYPASSRLS` application role.

**Tech stack:** Next.js/Vinext, TypeScript, Node `pg`, PostgreSQL/Neon RLS,
Supabase Auth, existing Node test runner.

**Approved design:**
`docs/superpowers/specs/2026-08-04-neon-people-readonly-directory-design.md`

## Global constraints

- Do not modify, add, delete, or skip files under `tests/` or `supabase/tests/`.
- Preserve the fresh 201/201 `npm test` baseline and successful build.
- Do not touch Production, Production data, DNS, deployment, Supabase Auth, or
  Supabase Storage.
- Before any database mutation, prove the target is an explicitly isolated
  non-Production Neon branch without printing a connection string.
- Do not expose `DATABASE_URL`, `pg`, Pool objects, actor ids, property ids,
  roles, or department scopes to the browser as authorization evidence.
- Do not use a database owner, superuser, or `BYPASSRLS` role at runtime.
- Do not use session-persistent `SET`; actor context is transaction-local.
- Do not accept browser-supplied actor, tenant, property, role, or department
  scope values.
- Do not change the Import Inspect route's `actorClient.rpc(...)` contract.
- Do not migrate employee writes, import commit, training facts, or unrelated
  repositories.
- Preserve all pre-existing dirty work unless a reviewed People boundary change
  must overlap it.
- Because persistent test files are frozen, each task uses an existing focused
  test, a disposable command-line contract check, or isolated-branch catalog
  assertions before and after implementation. This exception is explicitly
  required by the user's no-test-file rule.

## Preflight gate — controller only

Before Task 1:

1. Inspect only environment variable names to determine whether Neon project
   and branch metadata are available; never print secret values.
2. Parse the configured database URL in process memory and report only a
   redacted endpoint fingerprint.
3. Open a read-only transaction and read catalog/connection metadata only.
4. Match the endpoint to an explicitly non-default/non-Production branch using
   Neon API/CLI metadata where available.
5. If branch identity cannot be proven, stop before DDL and request the missing
   branch identifier. Do not infer safety from a hostname alone.

---

### Task 1: Establish the server-only Neon and actor-context boundary

**Files:**

- Modify: `app/lib/neon/server.ts`
- Create: `app/lib/neon/actor-context.ts`
- Create: `app/lib/neon/request-id.ts`
- Modify only if necessary: `app/lib/environment.ts`

**Interfaces:**

```ts
export type NeonQueryable = Pick<PoolClient, "query">;

export type NeonActorInput = {
  authUserId: string;
  hostname: string;
  requestId: string;
};

export async function withNeonActorContext<T>(
  input: NeonActorInput,
  action: (database: NeonQueryable, actor: {
    authUserId: string;
    tenantId: string;
    propertyId: string;
    requestId: string;
  }) => Promise<T>,
): Promise<T>;
```

`createNeonPool()` remains server-only, reads the connection string only inside
the server module, and does not disable certificate verification. Actor context
uses one checked-out client, `BEGIN`, parameterized transaction-local
`set_config`, role/ownership assertions, `COMMIT`/`ROLLBACK`, and `finally`
release.

**Steps:**

- [ ] Run a disposable import/source check and confirm that an actor-context
      module and a server-only marker do not yet exist.
- [ ] Add the server-only marker and narrow Pool/client interfaces.
- [ ] Add request-id validation/generation without trusting arbitrary-length
      input.
- [ ] Resolve the property from the trusted hostname within the transaction.
- [ ] Set auth user, property, and request id with `set_config(..., true)`.
- [ ] Fail closed unless the runtime connection is the configured application
      role, is not superuser/`BYPASSRLS`, and owns no application relation.
- [ ] Prove through a disposable fake-client check that commit, rollback, and
      release paths behave correctly and use no session-level `SET`.
- [ ] Run `npm test` and `npm run build`.
- [ ] Commit only Task 1 files.

---

### Task 2: Add Neon-only roles, actor functions, RLS, read functions, and audit

**Files:**

- Create: `neon/migrations/202608040001_people_readonly_authorization.sql`
- Create: `neon/README.md`

**Database objects:**

- role responsibilities for migration owner, application role, and readonly
  role, with password provisioning kept outside Git;
- `app_private.current_actor_auth_user_id()`;
- `app_private.current_actor_property_id()`;
- `app_private.current_actor_request_id()`;
- `app_private.assert_actor_context()`;
- Neon versions of current property-role and department-scope authorization
  helpers using live account/membership/role/scope facts;
- employee People SELECT RLS policy under `FORCE ROW LEVEL SECURITY`;
- narrow manager directory, manager detail, facets, and department directory
  functions;
- append-only People read audit table/function;
- least-privilege schema/function/table grants.

**Steps:**

- [ ] In a read-only catalog query on the isolated branch, confirm the new
      objects do not exist yet and record no row data.
- [ ] Write an idempotent Neon-only migration; do not add it to
      `supabase/migrations`.
- [ ] Preserve the current manager `EmployeeRecord` projection and the existing
      reduced department projection.
- [ ] Ensure every directory query receives no actor/property/scope arguments,
      caps limit at 100, clamps offset, parameterizes search/filter values, and
      orders by employee number.
- [ ] Ensure employee write grants/policies are absent for the application and
      readonly roles.
- [ ] Ensure audit records omit search values and employee PII and cannot be
      changed by runtime roles.
- [ ] Review the SQL statically for empty `search_path`, revokes-before-grants,
      RLS force, role attributes, and owner separation.
- [ ] Run `npm test` and `npm run build` without applying the migration yet.
- [ ] Commit only Task 2 files.

---

### Task 3: Implement the server-only Neon People repository and API boundary

**Files:**

- Create: `app/repositories/neon/employee-read-repository.ts`
- Create: `app/services/neon-people-authorization.ts`
- Create: `app/api/people/employees/route.ts`
- Create: `app/api/people/employees/[id]/route.ts`
- Create: `app/api/people/facets/route.ts`
- Modify minimally: `app/services/request-authentication.ts` only if a verified
  Auth user id cannot otherwise reach the new route dependency.

**API contract:**

- Manager directory accepts only query, department, position, position family,
  employment status, limit, and offset.
- Department directory accepts only query, limit, and offset.
- Detail accepts only a UUID path id and is manager-only.
- Facets are manager-only and come from Neon official organization facts.
- Property, tenant, actor, role, and scopes are never request parameters.
- Responses use `no-store, private`, return/request a request id, and preserve
  refreshed auth cookies.

**Steps:**

- [ ] Run a disposable module/route check and confirm the Neon People API is not
      implemented.
- [ ] Implement strict parsing for limits, offsets, UUIDs, and approved enum
      filters.
- [ ] Verify identity through the existing Supabase Auth server flow; pass only
      the verified auth id and trusted hostname into actor context.
- [ ] Let Neon live authorization determine manager versus department access;
      React session values may shape UI but are not database authority.
- [ ] Map manager rows to the full existing `EmployeeRecord` contract.
- [ ] Map department rows to the approved reduced contract.
- [ ] Translate missing identity, forbidden scope, not found, invalid input, and
      database unavailable errors to the approved generic HTTP statuses.
- [ ] Add successful-read audit calls inside the same transaction.
- [ ] Run disposable handler checks with injected fake authentication/database
      dependencies for 400/401/403/404/success and forged-scope stripping.
- [ ] Run `npm test` and `npm run build`.
- [ ] Commit only Task 3 files.

---

### Task 4: Wire the browser-safe HTTP repositories and existing UI contract

**Files:**

- Create: `app/repositories/http/employee-repository.ts`
- Create: `app/repositories/http/people-facet-repository.ts`
- Modify: `app/repositories/registry.ts`
- Modify: `app/services/people-foundation.ts`
- Modify only if needed: `app/repositories/contracts/employee-repository.ts`
- Modify only if needed: `app/people/page.tsx`

**Steps:**

- [ ] Run a source check proving Neon People currently resolves to a mock
      employee repository and the registry contains invalid Pool references.
- [ ] Add same-origin, no-store HTTP adapters with the complete repository
      methods required by existing foundation consumers.
- [ ] Never serialize the manager service's `propertyId` argument; it remains a
      local precondition only.
- [ ] Serialize only approved department search/pagination inputs.
- [ ] Route Neon manager facets through the People HTTP facet boundary without
      migrating Organization or Position repositories.
- [ ] Remove all Pool/Neon SQL repository references from the shared registry.
- [ ] Make module source reporting truthful: migrated People is Neon; unmigrated
      foundation modules neither silently claim Neon nor fall back to mock as
      real data.
- [ ] Preserve mock and Supabase behavior and all current UI object shapes.
- [ ] Scan the client dependency graph and build output for `pg`, `pg-pool`, and
      database connection-string material.
- [ ] Run `npm test` and `npm run build`.
- [ ] Commit only Task 4 files.

---

### Task 5: Apply and verify on the isolated Neon branch

**Files:**

- Create: `docs/neon/2026-08-04-people-readonly-verification.md`

**Steps:**

- [ ] Re-run the branch identity gate immediately before DDL.
- [ ] Apply the role/bootstrap and People authorization migration using the
      migration credential without printing secrets.
- [ ] Provision/use a distinct application login credential outside Git; do not
      point application runtime at the migration owner.
- [ ] Verify application role catalog attributes and zero application-object
      ownership.
- [ ] Verify actor settings disappear after both commit and rollback.
- [ ] Using only synthetic fixtures or existing authorization identities with
      count-only results, verify: no context, wrong property, inactive or wrong
      role, manager property scope, department exact scope, descendants, and
      unrelated department denial.
- [ ] Confirm direct employee INSERT/UPDATE/DELETE is denied to the application
      role.
- [ ] Confirm People read audit evidence is append-only and contains the request
      id but no search/employee values.
- [ ] Record commands, aggregate results, branch fingerprint, and limitations in
      the verification report without credentials or business rows.
- [ ] Run `npm test`, confirm exactly 201/201, and run `npm run build` again.
- [ ] Run `git diff --check` and inspect the final diff for test-file changes.
- [ ] Commit only the verification report if all gates pass.

---

### Task 6: Whole-slice security and code review

**Files:** None unless review findings require a scoped fix.

**Steps:**

- [ ] Review the complete implementation against the approved design and every
      global constraint.
- [ ] Treat any browser Neon import, owner/BYPASSRLS runtime path, browser scope
      authority, RLS bypass, mock-as-real behavior, or changed test file as a
      blocking finding.
- [ ] Dispatch one scoped fix wave for all valid findings and one re-review.
- [ ] Re-run the isolated-branch security checks, `npm test`, and build after
      fixes.
- [ ] Report modified files, architecture/data flow, security impact, database
      verification, tests, build, and any explicitly deferred non-People risk.

