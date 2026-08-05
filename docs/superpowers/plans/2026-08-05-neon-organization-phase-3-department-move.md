# Neon Organization Phase 3 Department Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add child-only, actor-scoped Neon Department move preview and atomic subtree move/closure rewrite while the Supabase Organization registry remains active.

**Architecture:** Existing Supabase Auth and the unchanged Neon actor transaction establish verified identity, hostname-derived property scope, and request ID. The application role invokes exact constrained PostgreSQL entry points; a transaction advisory lock serializes each property's hierarchy writers, while forced RLS and limited migration-owner grants constrain the private adjacency/path/closure rewrite. A server-only repository and dark same-origin action routes preserve the existing Department repository contract.

**Tech Stack:** PostgreSQL 18 on Neon, `pg`, TypeScript 5.9, Next-compatible route handlers, Supabase Auth SSR, Node.js 22 test runner.

## Global Constraints

- Execute database writes only on Neon child branch `br-aged-river-az1gke14`, endpoint `ep-sparkling-shape-az9gxtuh`, database `neondb`.
- Never connect to Production branch `br-twilight-leaf-azmowo1k` or endpoint `ep-wild-wave-azjmgdif`.
- Bootstrap uses the direct `NEON_BOOTSTRAP_DATABASE_URL` as `neondb_owner`; runtime validation uses the pooled `DATABASE_URL` as `hotel_ld_application`.
- Do not print, commit, or expose either connection string; do not use the bootstrap credential at runtime.
- Do not modify `app/lib/neon/actor-context.ts`, E1/E2 migrations, E3 Phase 1/2A migrations, Supabase Auth, Supabase Storage, People, Import, Position, aliases, or operational units.
- Do not add or alter a runtime role/membership; grant `hotel_ld_application` no raw table or column privilege and do not make it an owner or `BYPASSRLS`.
- Keep `DepartmentRepository.previewMove(id, newParentId)` and `moveNode(id, newParentId, expectedVersion)` unchanged.
- Keep the Organization registry on Supabase; do not add browser activation or dual writes.
- Do not edit, delete, or add files under `tests/`; TDD scratch tests live only in `.superpowers/sdd/2026-08-05-neon-organization-phase-3/` and are never staged.
- Preserve every existing dirty-worktree B-class file; stage only the files named by a task.
- Run `npm test` and a separate `npm run build` after Phase 3 implementation.

---

## File map

- Create `neon/migrations/202608050007_e3_organization_department_move.sql`: child-only Phase 3 preflight, constrained lock/helpers/policies, preview/move entry points, catalog postflight, and rollback notes.
- Create `scripts/neon/validate-e3-phase3.mjs`: fail-closed connection guards, catalog validation, and synthetic child runtime matrix.
- Modify `app/repositories/neon/department-write-repository.ts`: implement the pre-existing `previewMove` and `moveNode` methods through exact parameterized functions.
- Modify `app/api/organization/departments/input.ts`: add strict move-preview and move input parsers.
- Create `app/api/organization/departments/[id]/move-preview/route.ts`: dark POST preview route.
- Create `app/api/organization/departments/[id]/move/route.ts`: dark POST move route.
- Modify `app/services/neon-organization-errors.ts`: classify Phase 3 source conflicts, serialization/deadlock conflicts, and hierarchy business failures.
- Create `docs/neon/2026-08-05-e3-phase-3-department-move-verification.md`: applied checksum, catalog/runtime evidence, fallback status, and rollback result.
- Modify `neon/README.md` only after the real child runtime matrix passes.

### Task 1: Lock down pure server contract with failing scratch tests

**Files:**
- Create: `.superpowers/sdd/2026-08-05-neon-organization-phase-3/department-move-contract.test.mjs`
- Modify: `app/repositories/neon/department-write-repository.ts`
- Modify: `app/api/organization/departments/input.ts`
- Modify: `app/services/neon-organization-errors.ts`

**Interfaces:**
- Consumes: `DepartmentRepository.previewMove(id, newParentId)` and `moveNode(id, newParentId, expectedVersion)`.
- Produces: strict repository calls to `preview_neon_organization_department_move` and `move_neon_organization_department`, plus request parsers that reject forged authority fields.

- [ ] **Step 1: Write failing scratch contract tests**

```js
test('move repository calls only the exact parameterized entry points', async () => {
  const calls = [];
  const repository = createNeonDepartmentWriteRepository(
    { query: async (sql, values) => { calls.push([sql, values]); return { rows: [{ payload: preview }] }; } },
    'hotel.example.test',
  );
  await repository.previewMove(sourceId, parentId);
  assert.match(calls[0][0], /preview_neon_organization_department_move/);
  assert.deepEqual(calls[0][1], ['hotel.example.test', sourceId, parentId]);
});

test('move input admits only newParentId and expectedVersion', () => {
  assert.deepEqual(parseMoveDepartmentInput(sourceId, { newParentId: null, expectedVersion: 3 }), {
    id: sourceId, newParentId: null, expectedVersion: 3,
  });
  assert.throws(() => parseMoveDepartmentInput(sourceId, { newParentId: parentId, expectedVersion: 3, propertyId: otherPropertyId }), /不接受/);
});
```

- [ ] **Step 2: Prove RED**

Run: `node --experimental-strip-types --test .superpowers/sdd/2026-08-05-neon-organization-phase-3/department-move-contract.test.mjs`

Expected: FAIL because the Neon write repository lacks `previewMove`/`moveNode` and the parsers/functions do not exist.

- [ ] **Step 3: Implement the smallest pure boundary**

Add the exact calls and parsers:

```ts
select public.preview_neon_organization_department_move($1::text,$2::uuid,$3::uuid) as payload
select public.move_neon_organization_department($1::text,$2::uuid,$3::uuid,$4::bigint) as payload
```

`parseMovePreviewDepartmentInput(id, body)` allows only `{ newParentId }` and
`parseMoveDepartmentInput(id, body)` allows only `{ newParentId, expectedVersion }`.
Both accept a nullable UUID parent; the commit parser requires a non-negative
safe integer version. Map `P2002`, `40001`, and `40P01` to 409; map cycle,
self-parent, inactive-parent, and same-parent rules to 422.

- [ ] **Step 4: Prove GREEN**

Run the scratch test again. Expected: PASS with exact parameter order and all
forged property/tenant/actor/role/scope fields rejected.

- [ ] **Step 5: Do not stage scratch tests**

Keep `.superpowers/sdd/2026-08-05-neon-organization-phase-3/` untracked. The
production files remain uncommitted until the database entry points are real.

### Task 2: Create a child-only Phase 3 validator before the migration

**Files:**
- Create: `scripts/neon/validate-e3-phase3.mjs`
- Create: `.superpowers/sdd/2026-08-05-neon-organization-phase-3/connection-guard.test.mjs`

**Interfaces:**
- Consumes: `.env.local` credentials without logging values.
- Produces: `node scripts/neon/validate-e3-phase3.mjs catalog` and `node scripts/neon/validate-e3-phase3.mjs runtime`.

- [ ] **Step 1: Write a failing guard test**

```js
test('Phase 3 rejects production and runtime owner credentials', () => {
  assert.throws(
    () => assertApprovedBootstrapUrl('postgresql://neondb_owner:x@ep-wild-wave-azjmgdif.ap-southeast-1.aws.neon.tech/neondb'),
    /E3_PHASE3_PRODUCTION_ENDPOINT_DENIED/,
  );
  assert.throws(
    () => assertApprovedRuntimeUrl('postgresql://neondb_owner:x@ep-sparkling-shape-az9gxtuh-pooler.ap-southeast-1.aws.neon.tech/neondb'),
    /E3_PHASE3_RUNTIME_ROLE_DENIED/,
  );
});
```

- [ ] **Step 2: Prove RED**

Run: `node --test .superpowers/sdd/2026-08-05-neon-organization-phase-3/connection-guard.test.mjs`

Expected: FAIL with module-not-found for `scripts/neon/validate-e3-phase3.mjs`.

- [ ] **Step 3: Implement URL guards and pre-migration catalog command**

Export `assertApprovedBootstrapUrl` and `assertApprovedRuntimeUrl`. Require the
exact development endpoint/database, direct `neondb_owner` bootstrap URL, and
pooled `hotel_ld_application` runtime URL. `catalog` begins `READ ONLY`,
asserts Phase 2A topology and privileges, then intentionally fails with
`E3_PHASE3_OBJECT_MISSING` until the two Phase 3 public functions and lock
helper exist.

- [ ] **Step 4: Prove guard GREEN and migration RED**

Run the scratch guard test. Expected: PASS. Then run:

```bash
node scripts/neon/validate-e3-phase3.mjs catalog
```

Expected before applying migration: `E3_PHASE3_OBJECT_MISSING`; no schema or
business mutation is performed by this catalog command.

### Task 3: Implement the atomic hierarchy migration and apply it only to the child

**Files:**
- Create: `neon/migrations/202608050007_e3_organization_department_move.sql`
- Modify: `scripts/neon/validate-e3-phase3.mjs`

**Interfaces:**
- Consumes: E1 actor helpers, E3 Phase 1 property resolver/read entry point, and E3 Phase 2A manager/audit helpers.
- Produces:
  - `app_private.lock_neon_organization_hierarchy(uuid) returns void`;
  - `public.preview_neon_organization_department_move(text,uuid,uuid) returns jsonb`;
  - `public.move_neon_organization_department(text,uuid,uuid,bigint) returns jsonb`.

- [ ] **Step 1: Add fail-closed migration preflight**

Begin one transaction. Assert direct child `neondb_owner`, migration-owner
`SET` authority, unchanged application topology, forced RLS on Department and
closure, exact Phase 2A entry-point ownership/ACL, zero raw application
privilege, and absence of all Phase 3 objects/policies. Reject any drift using
named `E3_PHASE3_*` errors.

- [ ] **Step 2: Add constrained grants, policies, and private lock helper**

Grant only the columns used by move to `hotel_ld_migration_owner`:

```sql
grant select (id,tenant_id,property_id,parent_id,depth,path_ids,version,is_active)
  on public.departments to hotel_ld_migration_owner;
grant update (parent_id,depth,path_ids,version,updated_by)
  on public.departments to hotel_ld_migration_owner;
grant delete on public.department_closure to hotel_ld_migration_owner;
```

Add exact forced-RLS policies for Department move UPDATE and closure DELETE,
each requiring application session, complete Actor Context, live property
manager, and actor-property equality. Create the private invoker helper:

```sql
perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'hotel_ld:organization:' || p_property_id::text, 0
  )
);
```

It first asserts current Actor Context and manager/property authority. Revoke
PUBLIC EXECUTE and grant no runtime execute on the helper.

- [ ] **Step 3: Add preview and authoritative move entry points**

Preview performs manager/hostname/property checks, reads current source and
candidate parent visibility, rejects cross-property/self/cycle/inactive
conditions, and returns this exact JSON shape:

```sql
jsonb_build_object(
  'current_path', v_current_path,
  'proposed_path', v_proposed_path,
  'child_departments_affected', v_subtree_count - 1,
  'synthetic_employee_impact', v_employee_count,
  'aliases_affected', v_alias_count,
  'operational_units_affected', v_unit_count
)
```

Commit asserts manager/hostname again, acquires the property lock before row
locks, locks source and parent ordered by UUID, locks subtree Departments by
UUID, checks source version after locking, then performs:

```sql
delete from public.department_closure closure
where closure.property_id = v_property_id
  and closure.descendant_department_id = any(v_subtree_ids)
  and closure.ancestor_department_id <> all(v_subtree_ids);
```

It inserts new external ancestor edges from the candidate parent's closure
ancestry and preserved root-to-descendant distances, updates all subtree
`parent_id`/`path_ids`/`depth` values in one deterministic CTE, increments the
moved rows' versions, verifies closure against a recursive adjacency CTE,
appends `department_move` audit evidence, and returns the root payload.

`create_neon_organization_department` is replaced only to acquire the same
property lock before its existing insert path; its signature, grants, and
observable result are unchanged. This prevents create/move closure snapshots
from racing.

- [ ] **Step 4: Add postflight assertions and apply after dry-run**

Postflight proves function owner/security/search path/ACL, private helper ACL,
forced RLS, exact migration-owner grants/policies, zero raw runtime privilege,
and no new runtime ownership. Verify syntax with a transaction rollback first,
then apply only after the child connection guard passes. Never use Production.

- [ ] **Step 5: Prove catalog GREEN**

Run `node scripts/neon/validate-e3-phase3.mjs catalog`. Expected: exact Phase
3 objects, no PUBLIC execution, `hotel_ld_application` EXECUTE only on the two
public functions, and raw business-table privileges still zero.

### Task 4: Wire dark API actions without registry activation

**Files:**
- Modify: `app/repositories/neon/department-write-repository.ts`
- Modify: `app/api/organization/departments/input.ts`
- Modify: `app/services/neon-organization-errors.ts`
- Create: `app/api/organization/departments/[id]/move-preview/route.ts`
- Create: `app/api/organization/departments/[id]/move/route.ts`

**Interfaces:**
- Consumes: `runAuthorizedNeonOrganizationRead`, `runAuthorizedNeonOrganizationWrite`, strict move parsers, and `NeonDepartmentWriteRepository`.
- Produces: dark POST endpoints while `dataSourceForModule('organization-management', 'neon')` remains `supabase`.

- [ ] **Step 1: Extend the repository type exactly to the current contract**

```ts
export type NeonDepartmentWriteRepository = Pick<
  DepartmentRepository,
  'createNode' | 'updateNode' | 'setActive' | 'previewMove' | 'moveNode'
>;
```

Map preview payload fields to `DepartmentMovePreview` with non-negative safe
integers. Map move payload through the existing strict `mapNeonDepartmentNode`.

- [ ] **Step 2: Add POST action routes**

Each route canonicalizes `context.params.id`, rejects all query parameters,
parses JSON once, and invokes only the authorization service:

```ts
const result = await runAuthorizedNeonOrganizationWrite(
  request,
  requestId,
  repository => repository.moveNode(input.id, input.newParentId, input.expectedVersion),
);
return Response.json(result.data, { headers: result.headers });
```

Preview uses `runAuthorizedNeonOrganizationRead` and `repository.previewMove`.
Both return existing no-store/request-ID headers and preserve refreshed auth
cookies through the existing service.

- [ ] **Step 3: Re-run scratch contract tests**

Run the Task 1 scratch test. Expected: repository method and parser contracts
remain green. Exercise built route imports with malformed body, forged
authority field, and missing session cases; expected `400`, `400`, and `401`.

### Task 5: Run the runtime matrix, document results, and verify the project

**Files:**
- Modify: `scripts/neon/validate-e3-phase3.mjs`
- Create: `docs/neon/2026-08-05-e3-phase-3-department-move-verification.md`
- Modify: `neon/README.md`

**Interfaces:**
- Consumes: real child bootstrap/runtime credentials through guarded local environment loading.
- Produces: documented child-only catalog/runtime evidence; no registry activation.

- [ ] **Step 1: Add runtime matrix assertions**

The runtime command creates synthetic child-only fixture trees, runs actor
transactions as the real application role, and asserts these named outcomes:

```js
assert.equal(await matrix.managerPreview(), 'PASS');
assert.equal(await matrix.managerMove(), 'PASS');
assert.equal(await matrix.cycleRejected(), 'PASS');
assert.equal(await matrix.crossPropertyDenied(), 'PASS');
assert.equal(await matrix.staleSourceConflict(), 'PASS');
assert.equal(await matrix.serializedConcurrentMoves(), 'PASS');
assert.equal(await matrix.closureEqualsRecursiveAdjacency(), 'PASS');
assert.equal(await matrix.rollbackRestoresHierarchyAndAudit(), 'PASS');
assert.equal(await matrix.actorContextClearsOnReuse(), 'PASS');
assert.equal(await matrix.rawApplicationDmlDenied(), 'PASS');
```

- [ ] **Step 2: Run real-child validation and clean synthetic fixtures**

Run `node scripts/neon/validate-e3-phase3.mjs runtime`. It must use bootstrap
only for fixture setup/count verification/cleanup and runtime only for actor
operations. It must not print connection strings, row data, passwords, or
Production identifiers. Retain only append-only audit evidence from committed
mutations.

- [ ] **Step 3: Record evidence and fallback status**

Document migration SHA-256, dry-run/apply result, catalog assertions, behavior
matrix, direct privilege denial, bundle scan, and explicit status:

```text
Organization registry activation: NOT ACTIVATED
Supabase Organization fallback: ACTIVE
```

- [ ] **Step 4: Run final project verification**

Run:

```bash
npm test
npm run build
```

Expected: `tests 201`, `pass 201`, `fail 0`, then a successful separate build.
Scan the client artifact for `DATABASE_URL`, `NEON_BOOTSTRAP_DATABASE_URL`,
the child/Production endpoint identifiers, `hotel_ld_application`, `pg`, and
the Phase 3 public function names; expected zero matches.

- [ ] **Step 5: Commit only Phase 3 assets**

Stage only the Phase 3 migration, validator, repository/API/error/parser
changes, verification record, README lineage update, and plan. Do not stage
scratch tests or any pre-existing B-class worktree file.

## Plan self-review

- Scope coverage: Tasks 1 and 4 preserve the existing repository/API contract;
  Task 3 supplies lock ordering, RLS, closure/path/depth mutation, and audit;
  Task 5 covers rollback, deadlock/serialization, actor isolation, and project
  verification.
- No unrelated module is named for modification. Registry activation, aliases,
  operational units, Position, Import, People, Auth, Storage, and Actor Context
  are excluded by the global constraints.
- All named production function signatures, routes, parser names, and expected
  status mappings are defined above; scratch test paths are deliberately
  untracked.
