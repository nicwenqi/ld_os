# Neon Position Mapping Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Position source-label evidence, explicitly unavailable impact previews, and atomic mapping resolution available through Neon-only server boundaries.

**Architecture:** A constrained migration gives `hotel_ld_application` only three Position mapping entrypoints and no raw business-table privileges. A server-only repository runs inside existing actor context and dark HTTP routes use it without changing the registry or browser access pattern.

**Tech Stack:** PostgreSQL/Neon, Node `pg`, TypeScript, Vinext route handlers, and existing Supabase server identity verification.

## Global Constraints

- Work only in the Neon child branch; never connect to Production.
- Keep Actor Context, runtime role topology, Auth, Storage, Import, Employee write, registry activation, and browser Neon access unchanged.
- `hotel_ld_application` stays NOBYPASSRLS and receives no raw Position, alias, or audit table privilege.
- Definer entrypoints require fixed `search_path`, owner validation, PUBLIC EXECUTE revocation, exact application EXECUTE grants, actor/property authorization, and append-only audit.
- Unknown impact is `unavailable` with reason `import_source_rows_not_migrated`; never encode it as zero or an empty array.
- Do not modify existing test files. Use ignored E4C RED artifacts plus the committed validator and verification record.

---

### Task 1: Contract and RED coverage

**Files:**
- Modify: `app/repositories/contracts/organization-models.ts`
- Modify: `app/repositories/contracts/position-repository.ts`
- Modify: `app/repositories/mock/position-repository.ts`
- Modify: `app/repositories/supabase/position-repository.ts`
- Create: `.superpowers/sdd/2026-08-06-e4c-position-mapping/position-mapping-contract.test.mjs`

**Interfaces:** Produces `PositionSourceImpact` with source evidence and independently explicit employee/department availability states; updates `PositionRepository.previewSourceImpact()` consistently.

- [ ] **Step 1: Write the failing test**

```js
assert.match(contract, /employeeImpact: PositionImpactAvailability/);
assert.match(contract, /import_source_rows_not_migrated/);
assert.match(supabaseRepository, /state: "unavailable"/);
assert.doesNotMatch(supabaseRepository, /syntheticEmployeeCount: 0/);
```

- [ ] **Step 2: Run RED**

Run: `node --test .superpowers/sdd/2026-08-06-e4c-position-mapping/position-mapping-contract.test.mjs`

Expected: failure because the fallback preview fabricates zero and empty arrays.

- [ ] **Step 3: Write minimal implementation**

```ts
export type PositionSourceImpact = {
  sourceEvidence: { sourceRowCount: number; sourceSystem: string; sourceSheet: string };
  employeeImpact: { state: "available"; employeeCount: number } | { state: "unavailable"; reason: "import_source_rows_not_migrated" };
  departmentImpact: { state: "available"; departmentNames: string[] } | { state: "unavailable"; reason: "import_source_rows_not_migrated" };
};
```

- [ ] **Step 4: Run GREEN**

Run: `node --test .superpowers/sdd/2026-08-06-e4c-position-mapping/position-mapping-contract.test.mjs`

Expected: pass.

### Task 2: Neon migration and validator

**Files:**
- Create: `neon/migrations/202608060014_e4_position_mapping.sql`
- Create: `scripts/neon/validate-e4-position-mapping.mjs`

**Interfaces:** Produces `public.read_neon_position_source_labels(text)`, `public.preview_neon_position_source_impact(text,uuid)`, and `public.resolve_neon_position_alias(text,uuid,text,uuid,text,text)`.

- [ ] **Step 1: Extend the RED test and run it**

```js
assert.match(migration, /security definer/);
assert.match(migration, /set search_path = ''/);
assert.match(migration, /revoke all on function[\s\S]*from public/);
assert.match(migration, /grant execute[\s\S]*to hotel_ld_application/);
```

Run: `node --test .superpowers/sdd/2026-08-06-e4c-position-mapping/position-mapping-contract.test.mjs`

Expected: failure because E4C migration does not exist.

- [ ] **Step 2: Write migration and validator**

```sql
select * into v_alias
from public.position_aliases
where id = p_alias_id
  and property_id = app_private.current_actor_property_id()
for update;
```

The resolver validates action-specific targets, derives Family from a Position target, updates the alias and audit atomically. The validator supports source guard, dry-run rollback, child apply, catalog checks, and runtime checks without `SET ROLE`.

- [ ] **Step 3: Run GREEN and child validation**

Run: RED test, `node scripts/neon/validate-e4-position-mapping.mjs --dry-run`, then configured child-only validation.

Expected: contract pass and catalog ACL/RLS pass.

### Task 3: Server repository and dark API

**Files:**
- Create: `app/repositories/neon/position-mapping-repository.ts`
- Modify: `app/services/neon-position-authorization.ts`
- Create: `app/api/organization/position-source-labels/route.ts`
- Create: `app/api/organization/position-source-labels/[id]/impact/route.ts`
- Create: `app/api/organization/position-source-labels/[id]/resolution/route.ts`

**Interfaces:** Produces a server-only `NeonPositionMappingRepository` and routes accepting no property or tenant identifier.

- [ ] **Step 1: Extend and run RED**

```js
assert.match(mappingRepository, /read_neon_position_source_labels/);
assert.match(mappingRepository, /preview_neon_position_source_impact/);
assert.match(mappingRepository, /resolve_neon_position_alias/);
assert.doesNotMatch(route, /propertyId|tenantId/);
```

Run: `node --test .superpowers/sdd/2026-08-06-e4c-position-mapping/position-mapping-contract.test.mjs`

Expected: failure because repository and dark routes are absent.

- [ ] **Step 2: Write minimal server implementation**

```ts
return database.query<Row>(
  "select public.resolve_neon_position_alias($1::text,$2::uuid,$3::text,$4::uuid,$5::text,$6::text) as payload",
  [hostname, aliasId, action, targetId, externalCode, externalName],
);
```

Reuse `withNeonResolvedActorContext`; do not expose a pool, connection string, or query object to a client module. Routes reject query parameters and unrecognised actions, and map malformed IDs to 400, authorization failures to 401/403, invisible labels to 404, and invalid action/target shape to 422.

- [ ] **Step 3: Run GREEN**

Run: `node --test .superpowers/sdd/2026-08-06-e4c-position-mapping/position-mapping-contract.test.mjs`

Expected: pass.

### Task 4: Evidence and handoff

**Files:**
- Create: `docs/neon/2026-08-06-e4-position-mapping-verification.md`

- [ ] **Step 1: Record child validation matrix**

Record manager success; department-admin/cross-property denial; every action; inactive/wrong-property target rejection; unavailable impact; raw-table denial; append-only audit; rollback; actor cleanup; and connection reuse. Mark missing real identities deferred rather than using owner or `SET ROLE` simulation.

- [ ] **Step 2: Full verification**

Run: `npm test` and `npm run build` in the E4C worktree.

Expected: 201 tests pass and build succeeds.

- [ ] **Step 3: Commit only E4C assets**

Stage migration, validator, repositories/routes, contracts, and verification docs. Exclude `.superpowers/`, scratch, and main-worktree B files.
