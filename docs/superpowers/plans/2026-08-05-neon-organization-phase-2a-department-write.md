# Neon Organization Phase 2A Department Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add child-only, actor-scoped Neon Department create and version-checked detail/active-state updates while keeping the Supabase Organization registry active.

**Architecture:** The unchanged Supabase Auth and Neon Actor Context path supplies a verified auth user, trusted hostname, property, and request id. A constrained `hotel_ld_migration_owner` entry point executes under forced RLS, while the application role keeps zero raw table privileges. Create-time path/closure triggers run as constrained invokers, and a server-only repository exposes dark POST/PATCH APIs without activating the browser registry.

**Tech Stack:** PostgreSQL 18, Neon pooled PostgreSQL, `pg`, TypeScript 5.9, Next-compatible route handlers, Supabase Auth SSR, Node.js 22+ test runner.

## Global Constraints

- Execute database writes only on Neon child branch `br-aged-river-az1gke14`, endpoint `ep-sparkling-shape-az9gxtuh`, database `neondb`.
- Never connect to Production branch `br-twilight-leaf-azmowo1k` or endpoint `ep-wild-wave-azjmgdif`.
- Migration uses only direct `NEON_BOOTSTRAP_DATABASE_URL` as `neondb_owner`; runtime validation uses only pooled `DATABASE_URL` as `hotel_ld_application`.
- Never echo, persist, or pass either connection string to browser code.
- Do not modify `app/lib/neon/actor-context.ts`, E1/E2 migrations, E3 Phase 1 migration, Supabase Auth, Supabase Storage, People, Import, Position, Employee write, aliases, operational units, hierarchy move, or closure rewrite.
- Do not add a runtime role or alter the exact E2 application membership topology.
- Do not grant `hotel_ld_application` or `hotel_ld_people_read` any raw table or column privilege.
- All new public write entry points are owned by `hotel_ld_migration_owner`, use `SECURITY DEFINER`, fix `search_path=''`, revoke PUBLIC execution, and explicitly verify runtime session, Actor Context, hostname/property, live manager authority, and requested scope.
- Create-time Department trigger helpers use `SECURITY INVOKER`, are owned by `hotel_ld_migration_owner`, fix `search_path=''`, and expose no ambient execute grant.
- Do not edit, delete, or add files under `tests/`; keep `npm test` at exactly 201/201.
- TDD scratch tests live only under `.superpowers/sdd/2026-08-05-neon-organization-phase-2a/` and are never staged.
- Preserve every unrelated dirty-worktree change and stage only the files named by each task.
- Keep `dataSourceForModule("organization-management", "neon") === "supabase"`; no browser activation or dual write.
- Run full `npm test` and a separate `npm run build` after implementation.

---

## File map

- Create `neon/migrations/202608050005_e3_organization_department_write.sql`: child-only trigger hardening, exact grants/RLS, private writer/audit helpers, create/update entry points, catalog preflight/postflight, rollback notes.
- Create `scripts/neon/validate-e3-phase2a.mjs`: fail-closed child connection guard and real catalog/runtime validation using the true bootstrap/runtime credentials.
- Create `app/repositories/neon/department-write-repository.ts`: server-only parameterized calls and strict mutation payload mapping.
- Modify `app/repositories/neon/department-read-repository.ts`: export the existing single-node payload mapper for the write repository without changing read behavior.
- Create `app/api/organization/departments/input.ts`: pure strict parsers for create and update request bodies.
- Create `app/services/neon-organization-errors.ts`: pure database-error-to-HTTP mapping used by the Organization authorization service.
- Modify `app/services/neon-organization-authorization.ts`: add actor-transaction write orchestration and support 409/422 mappings without changing reads.
- Modify `app/api/organization/departments/route.ts`: add POST create while preserving GET.
- Modify `app/api/organization/departments/[id]/route.ts`: add PATCH update while preserving GET.
- Create `docs/neon/2026-08-05-e3-phase-2a-department-write-verification.md`: applied checksum, catalog evidence, behavior matrix, regression evidence, fallback status.
- Modify `neon/README.md`: record Phase 2A only after child application and validation succeed.

---

### Task 1: Write a failing real-child validation harness

**Files:**
- Create: `scripts/neon/validate-e3-phase2a.mjs`
- Test scratch: `.superpowers/sdd/2026-08-05-neon-organization-phase-2a/validation-harness.test.mjs`

**Interfaces:**
- Consumes: `.env.local` names `NEON_BOOTSTRAP_DATABASE_URL` and `DATABASE_URL` without printing their values.
- Produces: `node scripts/neon/validate-e3-phase2a.mjs catalog` and `node scripts/neon/validate-e3-phase2a.mjs runtime`.

- [ ] **Step 1: Write the failing harness contract test**

Create a scratch test that imports pure exports from the not-yet-created script and checks literal sanitized results:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertApprovedBootstrapUrl,
  assertApprovedRuntimeUrl,
} from "../../../scripts/neon/validate-e3-phase2a.mjs";

test("validation rejects every non-child or wrong-role connection", () => {
  assert.deepEqual(
    assertApprovedBootstrapUrl(
      "postgresql://neondb_owner:x@ep-sparkling-shape-az9gxtuh.ap-southeast-1.aws.neon.tech/neondb",
    ),
    { endpoint: "ep-sparkling-shape-az9gxtuh", database: "neondb", role: "neondb_owner", pooled: false },
  );
  assert.throws(
    () => assertApprovedBootstrapUrl(
      "postgresql://neondb_owner:x@ep-wild-wave-azjmgdif.ap-southeast-1.aws.neon.tech/neondb",
    ),
    /E3_PHASE2A_PRODUCTION_ENDPOINT_DENIED/,
  );
  assert.deepEqual(
    assertApprovedRuntimeUrl(
      "postgresql://hotel_ld_application:x@ep-sparkling-shape-az9gxtuh-pooler.ap-southeast-1.aws.neon.tech/neondb",
    ),
    { endpoint: "ep-sparkling-shape-az9gxtuh", database: "neondb", role: "hotel_ld_application", pooled: true },
  );
  assert.throws(
    () => assertApprovedRuntimeUrl(
      "postgresql://neondb_owner:x@ep-sparkling-shape-az9gxtuh-pooler.ap-southeast-1.aws.neon.tech/neondb",
    ),
    /E3_PHASE2A_RUNTIME_ROLE_DENIED/,
  );
});
```

The production mutation that makes this test fail is accepting a Production endpoint, bootstrap role on the pooled runtime URL, or a non-pooled runtime URL.

- [ ] **Step 2: Run the scratch test and prove RED**

Run:

```bash
node --test .superpowers/sdd/2026-08-05-neon-organization-phase-2a/validation-harness.test.mjs
```

Expected: FAIL with module-not-found for `scripts/neon/validate-e3-phase2a.mjs`.

- [ ] **Step 3: Implement only the connection guards and catalog command**

The script exports both guard functions, executes CLI code only when
`import.meta.url === pathToFileURL(process.argv[1]).href`, loads `.env.local`
without logging values, and uses `pg.Client`.

The `catalog` command:

```js
await bootstrap.query("begin read only");
// assert current_database/current_user/session_user and exact child catalog
await bootstrap.query("rollback");
```

It must assert that the two target entry points and Phase 2A audit relation
exist, trigger helpers are constrained invokers, application raw privileges
remain zero, legacy public write functions have no PUBLIC/runtime execution,
and migration owner lacks closure UPDATE/DELETE. Before migration it exits
non-zero with `E3_PHASE2A_OBJECT_MISSING`.

- [ ] **Step 4: Verify GREEN for guards and RED against the unmodified child**

Run the scratch test; expected PASS. Then run:

```bash
node scripts/neon/validate-e3-phase2a.mjs catalog
```

Expected: FAIL with `E3_PHASE2A_OBJECT_MISSING`, proving the real child does
not already satisfy the new behavior.

- [ ] **Step 5: Do not commit yet**

Task 1 stays uncommitted until the migration makes the real-child catalog test
green in Task 2.

---

### Task 2: Implement and apply the Phase 2A database migration

**Files:**
- Create: `neon/migrations/202608050005_e3_organization_department_write.sql`
- Modify: `scripts/neon/validate-e3-phase2a.mjs`

**Interfaces:**
- Consumes: E1 `app_private.current_actor_*()` and `assert_actor_context()`; E2/E3 Phase 1 runtime and Organization helpers; existing Department tables and triggers.
- Produces:
  - `public.create_neon_organization_department(text,uuid,uuid,uuid,text,text,text,text,integer) returns jsonb`
  - `public.update_neon_organization_department(text,uuid,bigint,text,text,integer,boolean) returns jsonb`

- [ ] **Step 1: Add the fail-closed migration preflight**

Begin one explicit transaction and reject every identity except direct child
bootstrap:

```sql
begin;
do $e3_phase2a_preflight$ begin
  if current_database() <> 'neondb'
     or current_user <> 'neondb_owner'
     or session_user <> 'neondb_owner' then
    raise exception using errcode = '42501',
      message = 'E3_PHASE2A_BOOTSTRAP_IDENTITY_MISMATCH';
  end if;
end $e3_phase2a_preflight$;
```

Preflight must pin the child role topology, E1 actor functions, E2/E3 Phase 1
functions/policies, forced RLS, exact trigger shapes, the current legacy
owner/BYPASSRLS closure helper, absence of Phase 2A objects, zero raw runtime
privileges, and the discovered legacy PUBLIC EXECUTE drift that this migration
will remove.

- [ ] **Step 2: Harden legacy ACLs and create-time trigger helpers**

As bootstrap, revoke PUBLIC/runtime execution from the legacy
`public.create_department`, `public.update_department_details`,
`app_private.prepare_department_insert`, and
`app_private.insert_department_closure` signatures. Transfer both trigger
helpers to `hotel_ld_migration_owner`.

Under `SET LOCAL ROLE hotel_ld_migration_owner`, replace both helpers as
`SECURITY INVOKER`, `search_path=''`. `prepare_department_insert()` keeps the
existing normalization/depth/path behavior. `insert_department_closure()`
requires the exact INSERT trigger variables, runtime session, Actor Context,
manager authority, actor property, and same-property parent before inserting:

```sql
insert into public.department_closure (...)
values (new.tenant_id, new.property_id, new.id, new.id, 0);

insert into public.department_closure (...)
select new.tenant_id, new.property_id,
       closure.ancestor_department_id, new.id, closure.distance + 1
from public.department_closure closure
where closure.tenant_id = new.tenant_id
  and closure.property_id = new.property_id
  and closure.descendant_department_id = new.parent_id;
```

- [ ] **Step 3: Add exact grants and command-specific RLS**

Grant only required columns to `hotel_ld_migration_owner`: Department
SELECT/INSERT/UPDATE, closure SELECT/INSERT, active-blocker reads, and audit
INSERT. Do not grant application or People roles any table or column access.

Create exact policies:

```sql
e3_phase2a_departments_insert
e3_phase2a_departments_update
e3_phase2a_department_closure_insert
e3_phase2a_position_assignments_blocker_read
e3_phase2a_organization_write_audit_insert
```

Every policy binds `session_user='hotel_ld_application'`, live manager
authorization, tenant/property to `current_actor_property_id()`, and closure
ancestor/descendant scope. Add no closure UPDATE or DELETE policy.

- [ ] **Step 4: Add private writer and append-only audit objects**

Under `hotel_ld_migration_owner`, create:

```sql
app_private.organization_write_audit_events
app_private.reject_organization_write_audit_mutation()
app_private.current_neon_organization_actor_user_id()
app_private.assert_neon_organization_manager()
app_private.neon_organization_department_payload(uuid)
app_private.append_neon_organization_write_audit(
  text,uuid,bigint,bigint,boolean,boolean,text[]
)
```

Audit rows contain request/auth/internal-user/tenant/property, operation,
Department id, previous/result version, previous/result active state, changed
field names, and transaction timestamp. No name values are stored. UPDATE and
DELETE are rejected. Failure to append propagates and rolls back the business
write.

- [ ] **Step 5: Add the two constrained public entry points**

Create entry point validates runtime, Actor Context, hostname, manager role,
requested tenant/property, node type, names, code, sort order, and parent. One
Department INSERT fires both constrained triggers, then the function verifies
path and closure counts, appends audit, and returns the projected node JSON.

Update entry point locks the target row, hides cross-property rows, checks the
expected version, preserves hierarchy fields, enforces the four active-state
blockers, updates details/active state once, increments version once, appends
audit with literal changed-field names, and returns projected node JSON.

Apply this ACL to each exact signature:

```sql
revoke all on function public.<signature>
  from public, authenticated, neondb_owner, hotel_ld_people_read,
       hotel_ld_application, hotel_ld_readonly;
grant execute on function public.<signature> to hotel_ld_application;
```

- [ ] **Step 6: Add exhaustive postflight and rollback notes**

Postflight proves exact owners, `prosecdef`, `search_path`, ACLs, unchanged
runtime topology, trigger shape, invoker helpers, forced RLS, exact write
policies, audit append-only trigger, zero application/People raw privilege and
ownership, and zero migration-owner closure UPDATE/DELETE authority. End with
`commit;` and a non-executable child-only rollback procedure in comments.

- [ ] **Step 7: Verify target and apply exactly once**

First rerun the sanitized URL guards. Apply with the direct bootstrap URL
without echoing it, using the project `pg` dependency and `ON_ERROR_STOP`
semantics. Abort before connection unless endpoint, database, and role match
the approved child. Expected: one transaction COMMIT.

- [ ] **Step 8: Run the real catalog validator and prove GREEN**

Run:

```bash
node scripts/neon/validate-e3-phase2a.mjs catalog
```

Expected: PASS with only sanitized branch/endpoint/database/role and assertion
counts.

- [ ] **Step 9: Commit Task 1–2 files only**

```bash
git add scripts/neon/validate-e3-phase2a.mjs neon/migrations/202608050005_e3_organization_department_write.sql
git commit -m "feat: add Neon department write boundary"
```

---

### Task 3: Implement the server-only Department write repository

**Files:**
- Create: `app/repositories/neon/department-write-repository.ts`
- Modify: `app/repositories/neon/department-read-repository.ts`
- Test scratch: `.superpowers/sdd/2026-08-05-neon-organization-phase-2a/department-write-repository.test.mjs`

**Interfaces:**
- Consumes: `NeonQueryable`, trusted hostname, `CreateDepartmentInput`, `UpdateDepartmentInput`, and the two Task 2 entry points.
- Produces:

```ts
export type NeonDepartmentWriteRepository = Pick<
  DepartmentRepository,
  "createNode" | "updateNode" | "setActive"
>;

export function createNeonDepartmentWriteRepository(
  database: NeonQueryable,
  trustedHostname: string,
): NeonDepartmentWriteRepository;
```

- [ ] **Step 1: Write the failing repository behavior test**

Use a real in-memory fake `NeonQueryable` that records SQL/parameters and
returns complete literal database payloads. Assert create and update return
the exact hand-built `DepartmentNode`; SQL is parameterized; trusted hostname
is parameter 1; expected version and booleans retain their types; malformed,
cross-property, or duplicate payload ids throw
`NEON_ORGANIZATION_PAYLOAD_INVALID`. Assert `setActive` first reads the
authorized current node and then calls the same version-checked update with
unchanged details.

The production mutations caught are wrong entry-point selection, interpolated
SQL, dropped expected version, fabricated payload defaults, or active updates
that overwrite details.

- [ ] **Step 2: Run the scratch test and prove RED**

Expected: module-not-found for `department-write-repository.ts`.

- [ ] **Step 3: Export the existing strict single-node mapper**

Rename/export the existing mapper without changing its checks:

```ts
export function mapNeonDepartmentNode(value: unknown): DepartmentNode;
```

Keep tree validation, sorting, and Phase 1 read SQL unchanged.

- [ ] **Step 4: Implement the write repository minimally**

Issue only these parameterized statements:

```sql
select public.create_neon_organization_department(
  $1::text,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::text,$9::integer
) as payload

select public.update_neon_organization_department(
  $1::text,$2::uuid,$3::bigint,$4::text,$5::text,$6::integer,$7::boolean
) as payload
```

Map `rows[0].payload` through `mapNeonDepartmentNode()` and reject an absent
row. Do not import a pool or read environment variables.

- [ ] **Step 5: Verify GREEN and type/build safety**

Run the scratch test and then `npm run build`. Expected: PASS; `pg` remains in
server output only.

- [ ] **Step 6: Commit Task 3 files only**

```bash
git add app/repositories/neon/department-read-repository.ts app/repositories/neon/department-write-repository.ts
git commit -m "feat: add Neon department write repository"
```

---

### Task 4: Implement strict API input and error contracts

**Files:**
- Create: `app/api/organization/departments/input.ts`
- Create: `app/services/neon-organization-errors.ts`
- Test scratch: `.superpowers/sdd/2026-08-05-neon-organization-phase-2a/department-write-input-errors.test.mjs`

**Interfaces:**
- Produces `parseCreateDepartmentInput(unknown)`, `parseUpdateDepartmentInput(id, unknown)`, and `mapOrganizationDatabaseError(unknown)`.

- [ ] **Step 1: Write failing table-driven tests**

Use literal expected objects and cover valid create/update, unknown keys,
invalid UUID/node type/version/boolean/integer, blank/oversized names, invalid
code, and forged identity/role/scope fields. Cover database codes/messages:

```text
42501 + NEON_ORGANIZATION_*_FORBIDDEN -> 403
P2000 or NEON_ORGANIZATION_DEPARTMENT_NOT_FOUND -> 404
P2002 or 23505 -> 409
P5401..P5404 or P2006 -> 422
everything else -> 503
```

The production mutations caught are accepting browser authorization fields,
coercing malformed values, leaking cross-property existence, or returning 503
for a stale version.

- [ ] **Step 2: Run and prove RED**

Expected: module-not-found for both pure modules.

- [ ] **Step 3: Implement minimal pure parsers and mapper**

Create input accepts exactly:

```ts
{ tenantId, propertyId, parentId, nodeType, code, nameZh, nameEn, sortOrder }
```

Update accepts exactly:

```ts
{ expectedVersion, nameZh, nameEn, sortOrder, isActive }
```

Both reject unknown fields. UUIDs are canonicalized to lowercase; strings are
trimmed; `nameZh` is required; `nameEn` and code may normalize to empty only as
allowed by the existing repository contract. Error mapping returns only
status/message pairs and never raw SQL or ids.

- [ ] **Step 4: Run and prove GREEN**

Run the scratch test; expected all cases PASS.

- [ ] **Step 5: Commit Task 4 files only**

```bash
git add app/api/organization/departments/input.ts app/services/neon-organization-errors.ts
git commit -m "feat: define Department write API contracts"
```

---

### Task 5: Wire dark POST/PATCH server APIs

**Files:**
- Modify: `app/services/neon-organization-authorization.ts`
- Modify: `app/api/organization/departments/route.ts`
- Modify: `app/api/organization/departments/[id]/route.ts`
- Test scratch: `.superpowers/sdd/2026-08-05-neon-organization-phase-2a/department-write-api-boundary.test.mjs`

**Interfaces:**
- Consumes: Task 3 repository, Task 4 parsers/errors, existing Supabase request authentication and unchanged actor transaction.
- Produces POST/PATCH route handlers. Registry remains untouched.

- [ ] **Step 1: Write the failing API boundary test**

Exercise the pure parser/error modules and built route contract rather than a
mock assertion. Prove malformed bodies return 400 before database work,
requests cannot submit auth/role/scope, POST/PATCH responses are private
no-store with request ids, and source/client output contains no pool,
connection URL, SQL, or actor-setting leakage.

- [ ] **Step 2: Run and prove RED**

Expected: POST/PATCH are absent or return unsupported behavior.

- [ ] **Step 3: Add write orchestration**

Add:

```ts
export async function runAuthorizedNeonOrganizationWrite<T>(
  request: Request,
  requestId: string,
  operation: (repository: NeonDepartmentWriteRepository) => Promise<T>,
): Promise<{ data: T; headers: Headers }>;
```

It must reuse `resolveRequestAuthIdentity()`, refreshed-cookie handling,
`resolveNeonOrganizationPropertyScope()`, and
`withNeonResolvedActorContext()` exactly as Phase 1 read does. The write
repository receives the checked-out queryable and trusted hostname only.

- [ ] **Step 4: Add POST and PATCH handlers**

POST parses the body, calls `repository.createNode()`, and returns 201. PATCH
validates the path id and body, calls `repository.updateNode()`, and returns
200. Both use the existing request-id/error response helpers and never accept
property, actor, or role from headers/cookies beyond the trusted server auth
flow.

- [ ] **Step 5: Verify GREEN, full regression, and registry fallback**

Run scratch tests, `npm test`, and verify exactly 201 tests pass. Confirm
`app/repositories/registry.ts` is unchanged from the Phase 1 fallback mapping.

- [ ] **Step 6: Commit Task 5 files only**

```bash
git add app/services/neon-organization-authorization.ts app/api/organization/departments/route.ts app/api/organization/departments/[id]/route.ts
git commit -m "feat: add dark Neon Department write APIs"
```

---

### Task 6: Run the true application-role behavior matrix

**Files:**
- Modify: `scripts/neon/validate-e3-phase2a.mjs`
- Create: `docs/neon/2026-08-05-e3-phase-2a-department-write-verification.md`
- Modify: `neon/README.md`

**Interfaces:**
- Consumes: true direct bootstrap and pooled application credentials, existing child-only active development identities, Task 2 entry points.
- Produces: sanitized, reproducible catalog/behavior evidence and Phase 2A activation status.

- [ ] **Step 1: Extend the validator with transactional runtime behavior**

Using the pooled application connection—not `SET ROLE`—the runtime command
must set actor values with transaction-local `set_config(..., true)` and prove:

- active manager creates a root and child with correct depth/path/self and
  ancestor closure;
- manager updates details and active state once per expected version;
- department admin mutation is denied;
- random/requested other property is denied;
- stale version changes no Department or audit fact;
- each active-state blocker preserves row/version;
- forced statement failure rolls back Department, closure, and audit;
- explicit rollback clears actor settings on pooled connection reuse;
- concurrent actor transactions do not cross.

Runtime fixture discovery reads only ids/status/scope facts from the approved
child and prints no user, property, or Department identifiers. If a required
manager or department-admin development identity is absent, record that exact
case as `DEFERRED_IDENTITY_FIXTURE_MISSING` while all catalog, negative, RLS,
rollback, and isolation checks remain mandatory.

- [ ] **Step 2: Prove audit correctness with bootstrap read-only evidence**

Perform one uniquely coded child validation mutation with the true runtime,
commit it, then use a bootstrap `READ ONLY` transaction to verify request,
auth/internal actor, property, operation, object, versions, active states, and
changed-field names. Do not print those values. Leave the append-only audit
evidence intact; do not disable triggers or use owner DML to erase it.

- [ ] **Step 3: Run catalog and runtime validation**

```bash
node scripts/neon/validate-e3-phase2a.mjs catalog
node scripts/neon/validate-e3-phase2a.mjs runtime
```

Expected: all available behavior checks PASS; no owner-as-runtime or `SET ROLE`.

- [ ] **Step 4: Record sanitized evidence and fallback status**

The verification document records migration checksum, child branch/endpoint,
database/roles without credentials, catalog assertions, behavior matrix,
deferred fixture cases if any, Actor Context isolation, audit/rollback results,
and `Registry activation: NOT ACTIVATED / Supabase fallback: ACTIVE`.

- [ ] **Step 5: Commit validator and evidence only**

```bash
git add scripts/neon/validate-e3-phase2a.mjs docs/neon/2026-08-05-e3-phase-2a-department-write-verification.md neon/README.md
git commit -m "docs: verify E3 Department write on child"
```

---

### Task 7: Final regression and security handoff

**Files:**
- Verify only; modify earlier Phase 2A files only if a failing test first reproduces a discovered bug.

**Interfaces:**
- Produces final E3 Phase 2A acceptance report and readiness decision for Phase 2B/Phase 3.

- [ ] **Step 1: Run complete tests**

```bash
npm test
```

Expected: `tests 201`, `pass 201`, `fail 0`, followed by successful embedded
build and rendered HTML test.

- [ ] **Step 2: Run a separate production build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 3: Scan built client artifacts**

Search client outputs for `DATABASE_URL`, both Neon endpoints,
`app.actor_auth_user_id`, `set_config`, `create_neon_organization_department`,
`update_neon_organization_department`, and `from \"pg\"`. Expected: zero
client matches; server output may contain server-only symbols.

- [ ] **Step 4: Re-run child catalog validation**

Expected: application role remains `NOBYPASSRLS`, exact membership unchanged,
raw table privileges zero, runtime ownership zero, trigger helper invoker,
entrypoint ACL exact, migration owner closure UPDATE/DELETE absent, E1/E2/E3
Phase 1 objects unchanged.

- [ ] **Step 5: Review final diff and report**

Confirm no `tests/`, Actor Context, registry, Import, Supabase Auth/Storage,
People, Position, aliases, operational-units, move, or closure-rewrite file was
changed. Report migration, database objects, repository/API changes, RLS and
role validation, behavior matrix, test/build result, fallback status, and
whether Phase 2A is complete.
