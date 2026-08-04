# Neon Organization Phase 1 Department Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a child-only, actor-scoped Neon Department read path without activating it in the browser registry or changing E1/E2.

**Architecture:** Supabase Auth remains the identity provider. A same-origin API resolves a trusted hostname, enters the unchanged `withNeonResolvedActorContext()` transaction, and calls a server-only repository backed by two constrained E3 Phase 1 database entry points. The existing Supabase DepartmentRepository remains active until all four E3 phases and the complete runtime matrix pass.

**Tech Stack:** PostgreSQL 18, Neon pooled PostgreSQL, `pg`, TypeScript, Next-compatible route handlers, Supabase Auth SSR, Node.js 22 test runner.

## Global Constraints

- Execute database writes only on Neon child branch `br-aged-river-az1gke14`, endpoint `ep-sparkling-shape-az9gxtuh`, database `neondb`.
- Never connect to Production branch `br-twilight-leaf-azmowo1k` or endpoint `ep-wild-wave-azjmgdif`.
- Do not modify `app/lib/neon/actor-context.ts` or any E1/E2 migration.
- Do not add a runtime role or alter the exact E2 application membership topology.
- Do not grant `hotel_ld_application` or `hotel_ld_people_read` raw business-table or column privileges.
- All E3 database access is through exact `SECURITY DEFINER` entry points owned by `hotel_ld_migration_owner`, with `search_path=''`, revoked PUBLIC execution, direct application execution, runtime-session checks, Actor Context assertion, and hostname/property/live authorization checks.
- Do not migrate Position, Import, Employee write, Supabase Auth, or Supabase Storage.
- Do not edit or delete existing test files.
- Do not change `dataSourceForModule()` or activate the Neon browser repository in Phase 1.
- Preserve all existing dirty-worktree changes and stage only Phase 1 files.
- Run `npm test` and a separate `npm run build` after Phase 1.

---

## File map

- Create `neon/migrations/202608040004_e3_organization_department_read.sql`: Phase 1-only private authorization helpers, read audit, exact RLS/grants, property resolver, department tree entry point, catalog assertions, rollback notes.
- Create `app/lib/neon/organization-property.ts`: child runtime property resolver using the Phase 1 public property entry point.
- Create `app/repositories/neon/department-read-repository.ts`: server-only payload validation and Department read methods.
- Create `app/services/neon-organization-authorization.ts`: Supabase Auth → trusted hostname → Actor Context → server repository orchestration and HTTP-safe error/headers behavior.
- Create `app/api/organization/departments/route.ts`: authorized tree GET.
- Create `app/api/organization/departments/[id]/route.ts`: authorized node GET.
- Create `app/api/organization/departments/[id]/ancestors/route.ts`: authorized breadcrumb GET.
- Create `app/api/organization/departments/[id]/descendants/route.ts`: authorized visible descendants GET.
- Create `app/repositories/http/department-read-repository.ts`: browser-safe read adapter; not wired into registry during Phase 1.
- Create `docs/neon/2026-08-04-e3-phase-1-department-read-verification.md`: child target, applied checksum, catalog/runtime evidence, regression evidence, fallback/activation status.
- Modify `neon/README.md`: record the Phase 1 unit and its validation status only after successful application.
- Scratch tests live only in `.superpowers/sdd/2026-08-04-neon-organization-phase-1-department-read/` and are never committed.

---

### Task 1: Phase 1 Department-read migration

**Files:**
- Create: `neon/migrations/202608040004_e3_organization_department_read.sql`
- Test scratch: `.superpowers/sdd/2026-08-04-neon-organization-phase-1-department-read/phase1-migration-contract.test.mjs`

**Interfaces:**
- Consumes: E1 `app_private.current_actor_*()` and `app_private.assert_actor_context()`; E2 roles, forced RLS, and property-scoped SELECT policies.
- Produces: `public.resolve_neon_organization_property(text)` and `public.read_neon_organization_department_tree(text)`, both callable only through the application runtime path.

- [ ] **Step 1: Write the failing static migration contract test**

Create the scratch Node test with these assertions:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const path = "neon/migrations/202608040004_e3_organization_department_read.sql";

test("E3 Phase 1 exposes only constrained Department read entrypoints", async () => {
  const sql = await readFile(path, "utf8");
  for (const token of [
    "public.resolve_neon_organization_property(p_hostname text)",
    "public.read_neon_organization_department_tree(p_hostname text)",
    "app_private.assert_neon_organization_runtime_session()",
    "app_private.assert_neon_organization_hostname(p_hostname text)",
    "app_private.neon_organization_actor_can_read_department",
    "security definer",
    "set search_path = ''",
    "to hotel_ld_application",
  ]) assert.match(sql.toLowerCase(), new RegExp(token.toLowerCase().replace(/[()]/g, "\\$&")));
  assert.match(sql, /revoke all on function[\s\S]+from public,[\s\S]+hotel_ld_people_read,[\s\S]+hotel_ld_application/i);
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete)[\s\S]+to\s+hotel_ld_application/i);
  assert.doesNotMatch(sql, /create\s+role|alter\s+role|grant\s+hotel_ld_organization/i);
  assert.doesNotMatch(sql, /create_neon_department|update_neon_department|reparent_neon_department/i);
  assert.doesNotMatch(sql, /create\s+(?:or replace\s+)?function\s+public\.[^(]*(?:alias|operational_unit)/i);
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete)[\s\S]+on\s+public\.(?:department_aliases|operational_units|operational_unit_aliases)/i);
});
```

- [ ] **Step 2: Run the test and prove RED**

Run:

```bash
node --test .superpowers/sdd/2026-08-04-neon-organization-phase-1-department-read/phase1-migration-contract.test.mjs
```

Expected: FAIL with `ENOENT` because the Phase 1 migration does not exist.

- [ ] **Step 3: Write the Phase 1 migration**

The migration is one explicit transaction. Its bootstrap identity guard starts
with this exact fail-closed check:

```sql
begin;
do $e3_phase1_preflight$ begin
  if current_database() <> 'neondb'
     or current_user <> 'neondb_owner'
     or session_user <> 'neondb_owner' then
    raise exception using errcode='42501',
      message='E3_PHASE1_BOOTSTRAP_IDENTITY_MISMATCH';
  end if;
end $e3_phase1_preflight$;
```

After preflight, create private/public objects under
`SET LOCAL ROLE hotel_ld_migration_owner`, reset to bootstrap for incremental
table grants and policy/catalog work, then set the migration role again for
function ACLs. End with a bootstrap postflight and `COMMIT`.

Use this exact incremental Department grant; E2 already supplies the remaining
read columns:

```sql
grant select (parent_id,node_type,code,depth,path_ids,version)
  on public.departments to hotel_ld_migration_owner;
```

For each public entry point, apply this exact ACL pattern with its own
signature:

```sql
revoke all on function public.resolve_neon_organization_property(text)
  from public, authenticated, neondb_owner, hotel_ld_people_read,
       hotel_ld_application, hotel_ld_readonly;
grant execute on function public.resolve_neon_organization_property(text)
  to hotel_ld_application;
```

The postflight includes this raw-privilege guard in addition to the complete
catalog assertions listed below:

```sql
if has_table_privilege(
  'hotel_ld_application', 'public.departments', 'SELECT'
) then
  raise exception using errcode='42501',
    message='E3_PHASE1_RUNTIME_RAW_PRIVILEGE_DRIFT';
end if;
```

The preflight must fail closed unless all of the following are true:

- `current_database()='neondb'`, `current_user=session_user='neondb_owner'`, and bootstrap can `SET` the migration owner;
- application and migration owner remain `NOBYPASSRLS`, application owns no object, application has exactly the existing People membership, and cannot reach owner/authenticated roles;
- all five Organization tables exist under the expected non-runtime owner with `ENABLE/FORCE RLS`;
- the Phase 1 target objects do not already exist;
- E1 actor functions have exact owner, invoker/stable/search-path configuration;
- E2 Department SELECT policies and exact People entry points still exist;
- no trigger attached to `departments` or `department_closure` is a `SECURITY DEFINER` function owned by a BYPASSRLS role.

Create these private Phase 1 objects under `hotel_ld_migration_owner`:

```sql
app_private.organization_read_audit_events
app_private.reject_organization_read_audit_mutation()
app_private.assert_neon_organization_runtime_session()
app_private.neon_organization_actor_is_active()
app_private.neon_organization_actor_has_role(text)
app_private.neon_organization_actor_has_department_scope(uuid)
app_private.neon_organization_actor_can_read_department(uuid)
app_private.neon_organization_hostname_matches(text)
app_private.assert_neon_organization_hostname(text)
app_private.assert_neon_organization_reader()
app_private.append_neon_organization_read_audit(text,integer)
```

Private helpers are `SECURITY INVOKER`, fully qualified, `search_path=''`, and
owner-only. `actor_is_active()` must derive the current internal account from
`user_accounts.auth_user_id = current_actor_auth_user_id()` plus the current
property and require active profile, tenant, property, tenant membership,
property membership, account, and unlocked/non-password-reset state.

`actor_has_role(text)` accepts only `property_ld_manager` and
`department_training_admin` and checks active assignment, role, scope level,
and current property. `actor_has_department_scope(uuid)` evaluates exact and
`include_descendants` scope through `department_closure`.

`actor_can_read_department(uuid)` returns true only for the actor property and:

```sql
manager role
or exact/descendant department scope
or the department is an ancestor of one of the actor's active scope roots
```

Create the public entry points with exact signatures:

```sql
public.resolve_neon_organization_property(p_hostname text)
  returns table (tenant_id uuid, property_id uuid)

public.read_neon_organization_department_tree(p_hostname text)
  returns jsonb
```

The resolver runs before Actor Context installation and therefore checks only
the exact runtime session plus normalized trusted hostname against active,
verified property-domain, property, and tenant rows. The tree function checks
runtime session, E1 Actor Context, hostname/current-property consistency, and
live reader authorization before reading rows.

The tree payload is:

```json
{
  "rows": [{
    "id": "uuid",
    "tenant_id": "uuid",
    "property_id": "uuid",
    "parent_id": null,
    "node_type": "department",
    "code": "front-office",
    "name_zh": "前厅部",
    "name_en": "Front Office",
    "sort_order": 10,
    "depth": 1,
    "path_ids": ["uuid"],
    "is_active": true,
    "version": 1,
    "synthetic_employee_count": 0
  }],
  "refreshed_at": "transaction timestamp"
}
```

Rows are explicitly projected; database row order is not a UI contract. The
server repository orders the authorized result by ancestor path, sibling
`sortOrder`, Chinese name, and id using the same tree semantics as the current
repository. The function appends audit operation `department_tree` with the
row count and stores no names or search values.

Add only the missing migration-owner Department SELECT columns. Reuse E2
property-scoped SELECT policies; do not add a permissive SELECT policy on an
E2-shared table. Revoke public/authenticated/owner/People/application/readonly
execution before granting the two exact public entry points directly to
`hotel_ld_application`.

Postflight proves exact function owner, `prosecdef`, `proconfig`, runtime ACL,
private-helper ACL, application topology, zero application/People raw table or
column privilege, unchanged E2 policy/function inventory, forced RLS, and zero
runtime ownership.

- [ ] **Step 4: Run the static test and migration parser checks**

Run:

```bash
node --test .superpowers/sdd/2026-08-04-neon-organization-phase-1-department-read/phase1-migration-contract.test.mjs
psql "$CHILD_BOOTSTRAP_DATABASE_URL" --set ON_ERROR_STOP=1 --file neon/migrations/202608040004_e3_organization_department_read.sql
```

The second command is permitted only after a sanitized preflight proves the
bootstrap URL resolves to the approved child endpoint, `neondb`, and
`neondb_owner`. Never echo the variable. Expected: static PASS; migration
transaction COMMIT. If the bootstrap credential is unavailable, stop before
the second command and report the child-application blocker rather than using
the runtime credential for DDL.

- [ ] **Step 5: Commit Task 1 files only**

```bash
git add neon/migrations/202608040004_e3_organization_department_read.sql
git commit -m "feat: add Neon Organization department read migration"
```

---

### Task 2: Server-only Department read repository

**Files:**
- Create: `app/lib/neon/organization-property.ts`
- Create: `app/repositories/neon/department-read-repository.ts`
- Test scratch: `.superpowers/sdd/2026-08-04-neon-organization-phase-1-department-read/phase1-server-repository.test.mjs`

**Interfaces:**
- Consumes: `NeonQueryable`, the two Task 1 public entry points, and existing `DepartmentNode` types.
- Produces: `resolveNeonOrganizationPropertyScope(hostname, database)` and `createNeonDepartmentReadRepository(database, trustedHostname)` with `listTree()`, `getNode(id)`, `getAncestors(id)`, and `getDescendants(id)`.

- [ ] **Step 1: Write the failing repository test**

The scratch test imports the two not-yet-created modules and uses a fake
`query()` implementation. It must assert:

```js
assert.deepEqual(await repository.listTree(), [expectedRoot, expectedChild]);
assert.deepEqual(await repository.getNode(childId), expectedChild);
assert.deepEqual(await repository.getAncestors(childId), [expectedRoot]);
assert.deepEqual(await repository.getDescendants(rootId), [expectedChild]);
assert.equal(await repository.getNode(missingId), null);
assert.deepEqual(recordedParameters, [[trustedHostname]]);
```

It also returns malformed rows for every required DepartmentNode field and
asserts `NEON_ORGANIZATION_PAYLOAD_INVALID` rather than partial/fabricated
objects.

- [ ] **Step 2: Run the repository test and prove RED**

Run the scratch test with `node --experimental-strip-types --test`. Expected:
module-not-found for `department-read-repository.ts`.

- [ ] **Step 3: Implement the property resolver**

Use this server-only signature:

```ts
export type NeonOrganizationPropertyScope = {
  tenantId: string;
  propertyId: string;
};

export async function resolveNeonOrganizationPropertyScope(
  hostname: string,
  database: NeonQueryable,
): Promise<NeonOrganizationPropertyScope | null>;
```

It issues one parameterized call to
`public.resolve_neon_organization_property($1::text)` and maps only
`tenant_id/property_id`.

- [ ] **Step 4: Implement the server repository**

Use this Phase 1 interface:

```ts
export type NeonDepartmentReadRepository = {
  listTree(): Promise<DepartmentNode[]>;
  getNode(id: string): Promise<DepartmentNode | null>;
  getAncestors(id: string): Promise<DepartmentNode[]>;
  getDescendants(id: string): Promise<DepartmentNode[]>;
};
```

The first call per repository instance memoizes the single authorized tree
promise. It calls only:

```sql
select public.read_neon_organization_department_tree($1::text) as payload
```

Map every payload field at runtime. Validate UUID strings, enum membership,
nullable strings, safe integers, booleans, `path_ids`, and that each node's
path ends in its own id. Validate unique ids, same tenant/property throughout,
parent/path/depth consistency. Sort roots and siblings by `sortOrder`, then
`left.nameZh.localeCompare(right.nameZh, "zh-CN")`, then id, while always emitting a parent
before its descendants. Invalid payload throws an error prefixed
`NEON_ORGANIZATION_PAYLOAD_INVALID:`.

- [ ] **Step 5: Run the repository test and strict TypeScript check**

Run:

```bash
node --experimental-strip-types --test .superpowers/sdd/2026-08-04-neon-organization-phase-1-department-read/phase1-server-repository.test.mjs
npx tsc --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2022 --lib es2022,dom app/lib/neon/organization-property.ts app/repositories/neon/department-read-repository.ts
```

Expected: all scratch tests PASS and TypeScript exits zero.

- [ ] **Step 6: Commit Task 2 files only**

```bash
git add app/lib/neon/organization-property.ts app/repositories/neon/department-read-repository.ts
git commit -m "feat: add Neon department read repository"
```

---

### Task 3: Authenticated API and inactive browser adapter

**Files:**
- Create: `app/services/neon-organization-authorization.ts`
- Create: `app/api/organization/departments/route.ts`
- Create: `app/api/organization/departments/[id]/route.ts`
- Create: `app/api/organization/departments/[id]/ancestors/route.ts`
- Create: `app/api/organization/departments/[id]/descendants/route.ts`
- Create: `app/repositories/http/department-read-repository.ts`
- Test scratch: `.superpowers/sdd/2026-08-04-neon-organization-phase-1-department-read/phase1-http-contract.test.mjs`

**Interfaces:**
- Consumes: Task 2 property resolver/repository, existing request authentication, request-id, cookies, and unchanged Actor Context wrapper.
- Produces: four same-origin read endpoints and a browser-safe `Pick<DepartmentRepository, "listTree" | "getNode" | "getAncestors" | "getDescendants">` adapter. Registry remains untouched.

- [ ] **Step 1: Write the failing HTTP adapter and source-boundary test**

The scratch test stubs global `fetch`, calls all four adapter methods, and
asserts these exact requests:

```text
GET /api/organization/departments
GET /api/organization/departments/<encoded-id>
GET /api/organization/departments/<encoded-id>/ancestors
GET /api/organization/departments/<encoded-id>/descendants
```

Every request must have `credentials:"same-origin"` and `cache:"no-store"`.
`listTree("forged-property")` must produce the same request as any other
property argument. The source scan must prove the client-reachable HTTP adapter
imports neither `pg`, `server.ts`, `DATABASE_URL`, Actor Context, nor the Neon
server repository. API routes are server boundaries and may import the
server-only authorization service.

- [ ] **Step 2: Run the HTTP test and prove RED**

Run with `node --experimental-strip-types --test`. Expected:
module-not-found for `department-read-repository.ts` in the HTTP directory.

- [ ] **Step 3: Implement Organization authorization service**

Create:

```ts
export class OrganizationApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 503,
    message: string,
    readonly headers?: Headers,
  );
}

export async function runAuthorizedNeonOrganizationRead<T>(
  request: Request,
  requestId: string,
  operation: (repository: NeonDepartmentReadRepository) => Promise<T>,
): Promise<{ data: T; headers: Headers }>;
```

Behavior:

1. require `APP_DATA_MODE=neon`;
2. call server-side `resolveRequestAuthIdentity()`;
3. on no identity return 401;
4. call unchanged `withNeonResolvedActorContext()`;
5. resolve trusted hostname through Task 2 inside the checked-out transaction;
6. set Actor Context through the existing wrapper;
7. create the Task 2 repository on that same `NeonQueryable`;
8. map database authorization code/message to a generic 403 and all unknown
   database/payload failures to 503;
9. attach `Cache-Control: private, no-store`, `X-Request-Id`, and refreshed Auth
   cookies to both success and post-refresh error headers.

Do not accept browser actor, tenant, property, role, or department-scope data.

- [ ] **Step 4: Implement the four GET routes**

All routes reject any query parameter. ID routes validate canonical UUID shape
before authentication. Ancestor and descendant routes first call the memoized
`getNode()` and return 404 when it is null, then call the matching traversal
method without issuing a second database read. `getNode()` null maps to 404,
preventing an empty-array authorization oracle. All errors use
`organizationErrorResponse()` and preserve no-store and request-id headers.

- [ ] **Step 5: Implement the inactive HTTP adapter**

Export:

```ts
export function createHttpDepartmentReadRepository(): Pick<
  DepartmentRepository,
  "listTree" | "getNode" | "getAncestors" | "getDescendants"
>;
```

The adapter ignores the legacy `propertyId` argument and never serializes it.
It returns domain payloads directly, treats node 404 as the existing
`getNode()` error contract, and converts every non-OK `{message}` response into
an `Error`. Do not import or wire this factory in `registry.ts` during Phase 1.

- [ ] **Step 6: Run focused tests and TypeScript/build boundary checks**

Run:

```bash
node --experimental-strip-types --test .superpowers/sdd/2026-08-04-neon-organization-phase-1-department-read/phase1-http-contract.test.mjs
npx tsc --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2022 --lib es2022,dom app/services/neon-organization-authorization.ts app/api/organization/departments/route.ts 'app/api/organization/departments/[id]/route.ts' 'app/api/organization/departments/[id]/ancestors/route.ts' 'app/api/organization/departments/[id]/descendants/route.ts' app/repositories/http/department-read-repository.ts
```

Expected: scratch tests PASS and TypeScript exits zero.

- [ ] **Step 7: Commit Task 3 files only**

```bash
git add app/services/neon-organization-authorization.ts app/api/organization/departments app/repositories/http/department-read-repository.ts
git commit -m "feat: add Neon department read API boundary"
```

---

### Task 4: Child runtime validation and Phase 1 closeout

**Files:**
- Create: `docs/neon/2026-08-04-e3-phase-1-department-read-verification.md`
- Modify: `neon/README.md`

**Interfaces:**
- Consumes: applied Task 1 migration, real child `hotel_ld_application` pooled credential, Tasks 2–3 code.
- Produces: Phase 1 catalog/runtime evidence and explicit `NOT ACTIVATED` registry status.

- [ ] **Step 1: Prove the runtime URL is the approved child without printing it**

Load `.env.local` in a process that prints only these sanitized facts:

```text
endpoint=ep-sparkling-shape-az9gxtuh
database=neondb
role=hotel_ld_application
pooled=true
production-deny-match=false
```

Abort on any mismatch. Do not print hostname suffix, password, or connection
string.

- [ ] **Step 2: Run catalog validation as the real application credential**

Prove only booleans/counts:

- runtime/session user exactly application and role flags remain constrained;
- application still has exactly one membership with exact options;
- application and People group own no object and have zero raw table/column
  privilege on the five Organization tables;
- application has EXECUTE on exactly the two Phase 1 entry points;
- PUBLIC/authenticated/People/readonly/bootstrap have no explicit execute
  grant;
- entrypoint owner, `SECURITY DEFINER`, and `search_path` are exact;
- all five Organization tables remain `ENABLE/FORCE RLS`;
- E2 policy/function inventory remains unchanged.

- [ ] **Step 3: Run behavior validation without reading business payloads**

Use the real application login and transaction-local synthetic contexts to
prove only status/count results:

- missing Actor Context fails;
- wrong property/hostname fails;
- inactive or unauthorized actor fails;
- manager tree read succeeds;
- department exact scope and ancestor navigation succeed;
- `include_descendants=true` includes descendants;
- `include_descendants=false` excludes descendants;
- unrelated departments are absent;
- COMMIT, ROLLBACK, reused connection, and two concurrent actors do not leak or
  cross context.

Use only existing development test accounts or transactionally inserted
synthetic fixtures that end in explicit rollback. Do not print department
names, user identifiers, or row payloads.

- [ ] **Step 4: Run unchanged regressions and production build**

Run:

```bash
npm test
npm run build
```

Expected: `tests 201`, `pass 201`, `fail 0`; separate build exits zero.

Scan emitted browser assets for `DATABASE_URL`, `NEON_ENDPOINT_ID`, `pg-pool`,
`app.actor_`, and the Phase 1 SQL function names. Expected: zero matches.

- [ ] **Step 5: Write verification record and update migration inventory**

Record the migration SHA-256, sanitized child identifiers, catalog counts,
behavior matrix, application regressions, build result, and any deferred
identity acceptance. State explicitly:

```text
Phase 1 Department read: COMPLETE only if migration and runtime matrix passed.
Registry activation: NOT ACTIVATED.
Supabase Organization fallback: ACTIVE.
```

If the bootstrap credential or real runtime matrix is unavailable, record
`IMPLEMENTED / DATABASE VALIDATION BLOCKED` and do not claim completion or
activate anything.

- [ ] **Step 6: Commit Phase 1 verification files only**

```bash
git add docs/neon/2026-08-04-e3-phase-1-department-read-verification.md neon/README.md
git commit -m "docs: verify Neon Organization department read"
```

Do not start Phase 2 in this execution.
