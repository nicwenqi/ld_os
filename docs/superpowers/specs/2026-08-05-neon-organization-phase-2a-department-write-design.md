# Neon Organization Phase 2A Department Write Design

**Date:** 2026-08-05

**Phase:** E3 Phase 2A

**Status:** Approved

## Goal

Add the first Neon Organization mutation slice without changing the E1 Actor
Context, E2 runtime topology, browser contract, or Supabase fallback:

```text
Supabase Auth
  -> verified auth user id and trusted hostname
  -> transaction-scoped Neon Actor Context
  -> hotel_ld_application
  -> constrained Department write entry point
  -> live manager and property authorization
  -> Neon RLS
  -> atomic Department, closure, and audit mutation
  -> server-only repository
  -> same-origin API
```

Phase 2A implements only:

- department creation;
- department detail updates;
- department active-state updates.

It does not implement hierarchy moves, existing closure rewrites, path rebuilds,
descendant recalculation, aliases, operational units, Position, Import, or
Employee write.

## Approved boundaries

- Database writes are allowed only on child branch
  `br-aged-river-az1gke14`, endpoint `ep-sparkling-shape-az9gxtuh`.
- Production branch `br-twilight-leaf-azmowo1k` and endpoint
  `ep-wild-wave-azjmgdif` remain deny-listed.
- Migration uses the direct `NEON_BOOTSTRAP_DATABASE_URL` only after the host,
  database, and `neondb_owner` bootstrap identity pass a fail-closed check.
- Runtime validation uses the pooled `DATABASE_URL` as
  `hotel_ld_application`; bootstrap credentials are never used by runtime.
- No runtime role or membership is added or changed.
- `hotel_ld_application` remains `NOBYPASSRLS`, owns no objects, and receives no
  raw table or column privilege.
- The application role receives only `EXECUTE` on the exact new Department
  entry points.
- E1 Actor Context functions and the TypeScript actor transaction wrapper are
  unchanged.
- Existing E2 People functions, policies, grants, repository, and API are
  unchanged.
- Existing test files are not edited or deleted.
- The Organization registry remains on Supabase until the complete E3 runtime
  matrix passes. Phase 2A introduces no dual write.

## Verified legacy state

The approved child branch was inspected through a read-only catalog
transaction before this design was finalized.

The current create-time hierarchy path is:

```text
legacy public.create_department()
  -> INSERT public.departments
  -> BEFORE INSERT app_private.prepare_department_insert()
       computes depth and path_ids from the parent
  -> AFTER INSERT app_private.insert_department_closure()
       inserts the self row and inherited ancestor rows
```

Catalog and migration-lineage checks proved that:

- `departments_insert_closure` is the only caller of
  `app_private.insert_department_closure()`;
- it is an enabled row-level `AFTER INSERT` trigger on `public.departments`;
- the function inserts the distance-zero self row and reads/inserts ancestor
  closure rows;
- the function is currently `SECURITY DEFINER`, owned by `neondb_owner`, whose
  role has `BYPASSRLS`;
- the function has no Actor Context or manager assertion;
- `hotel_ld_migration_owner` currently has no table-level Department or
  closure write privilege and no write RLS policy;
- both tables have `ENABLE ROW LEVEL SECURITY` and
  `FORCE ROW LEVEL SECURITY`;
- `hotel_ld_application` has no raw Department or closure DML privilege.

The catalog inspection also found security drift: legacy trigger helpers and
the old `public.create_department()` and
`public.update_department_details()` functions expose `PUBLIC EXECUTE` in the
child branch. Because the legacy public functions are owner-definer functions,
Phase 2A must revoke their execution from `PUBLIC` and every runtime-facing
role before granting the new constrained entry points. This child-only
hardening does not affect the separate Supabase database used by the retained
fallback.

## Chosen trigger and entry-point design

### Internal create-time closure helper

`app_private.insert_department_closure()` remains bound to the existing
`departments_insert_closure` trigger, but is changed to:

- `SECURITY INVOKER`;
- owner `hotel_ld_migration_owner`;
- `search_path=""`;
- no direct execute grant to `PUBLIC`, `authenticated`, `neondb_owner`,
  `hotel_ld_people_read`, `hotel_ld_application`, or `hotel_ld_readonly`.

The helper explicitly validates:

- it is running from the expected INSERT trigger path;
- `session_user` is exactly `hotel_ld_application`;
- `current_user` is exactly `hotel_ld_migration_owner`;
- Actor Context is complete;
- the actor is an active property manager;
- the inserted tenant/property equals the transaction-local actor property;
- the optional parent belongs to the same tenant/property.

The invoker helper is viable because the invoking public entry point is owned
by the constrained, `NOBYPASSRLS` migration owner. Exact migration-owner
column privileges and write policies provide the required Department and
closure access. RLS therefore remains an independent enforcement boundary;
no function in this path executes as a table owner or `BYPASSRLS` role.

`app_private.prepare_department_insert()` remains a trigger helper. Phase 2A
pins its trigger shape, sets its owner to `hotel_ld_migration_owner`, fixes its
search path, revokes ambient execution, and relies on the same constrained
invoker identity and SELECT policy when it reads the parent.

### Public Department write entry points

Phase 2A adds distinct Neon-named public entry points rather than calling or
regranting the legacy Supabase RPCs:

- create Department;
- version-checked Department detail/active-state update.

The update input preserves the existing `DepartmentRepository` contract:
name, optional English name, sort order, active state, and expected version
are written atomically. `setActive` continues to delegate through the same
version-checked update contract.

Each entry point is:

- `SECURITY DEFINER`;
- owned by `hotel_ld_migration_owner`;
- configured with `search_path=""`;
- fully schema-qualified;
- denied to `PUBLIC`, `authenticated`, `neondb_owner`,
  `hotel_ld_people_read`, and `hotel_ld_readonly`;
- granted directly and exactly to `hotel_ld_application`.

Every entry point asserts the exact runtime session, complete Actor Context,
trusted hostname/current-property equality, active account and memberships,
and live `property_ld_manager` authority. Browser-supplied tenant or property
identifiers are never authorization evidence. When retained for contract
compatibility they must equal the trusted property resolved from the hostname
and Actor Context.

## Atomic create behavior

One create call performs the following in one actor transaction:

1. validate input, runtime identity, actor, hostname, tenant, property, and
   optional parent;
2. insert the Department row;
3. let the constrained BEFORE INSERT trigger compute `depth` and `path_ids`;
4. let the constrained AFTER INSERT trigger insert the closure self row and
   all ancestor rows;
5. verify the new adjacency, path, and closure representation agree;
6. append write-audit evidence;
7. return the authoritative created Department payload.

Any failed validation, trigger, closure insert, invariant check, audit insert,
or payload generation aborts the whole transaction. Phase 2A never repairs or
rewrites closure rows for an existing node.

## Version-checked update behavior

The update entry point locks the target Department row and fails closed when
the row is not visible in the current actor property. It compares
`expectedVersion` before changing any field and returns a conflict on mismatch.

Detail and active-state updates do not modify `parent_id`, `depth`, `path_ids`,
tenant, property, node type, code, or closure rows. Version increases exactly
once for a successful call.

An active-to-inactive transition retains the existing business blockers:

- active descendant departments;
- active trainer scopes;
- active position assignments;
- active operational units.

The blockers use exact migration-owner column grants, property-bound RLS, and
fully qualified property predicates. They do not add raw runtime access.

## RLS and privilege design

Phase 2A adds only the minimum grants to `hotel_ld_migration_owner`:

- exact Department columns required to select a parent or target;
- exact Department insert columns;
- exact mutable Department update columns;
- exact closure select and insert columns;
- exact read columns needed for active-state blockers;
- append-only audit insert columns.

It adds command-specific policies for `hotel_ld_migration_owner`:

- Department INSERT `WITH CHECK`;
- Department UPDATE `USING` and `WITH CHECK`;
- closure INSERT `WITH CHECK`.

Every write policy requires:

- `session_user = 'hotel_ld_application'`;
- complete transaction-local Actor Context;
- live property-manager authority;
- row tenant/property equal to the actor property;
- closure ancestor and descendant rows belong to the same authorized property.

No closure UPDATE or DELETE grant or policy is added in Phase 2A. Those belong
to Phase 3 move/closure rewrite.

Postflight checks prove that application and People roles still own no objects
and hold no raw table or column privileges across the protected business and
audit relations.

## Audit design

Phase 2A adds an append-only private Organization write-audit relation owned by
`hotel_ld_migration_owner`. Each successful mutation records:

- request id;
- verified Supabase auth user id;
- resolved internal `user_accounts.user_id`;
- tenant and property id;
- operation;
- Department id;
- previous and resulting version;
- previous and resulting active state;
- changed field names, without field values;
- transaction timestamp.

The legacy `departments.created_by` and `updated_by` columns retain their
existing `auth.users` foreign-key semantics and therefore receive the verified
auth user id. The new audit relation separately records the resolved internal
user id; it never assumes `user_id = auth_user_id`.

The audit relation exposes no runtime SELECT or DML privilege. UPDATE and
DELETE are rejected by an append-only trigger. Audit failure rolls back the
business mutation.

## Server repository and API boundary

The server-only Neon Department write repository receives only the checked-out
`NeonQueryable` from `withNeonResolvedActorContext()`. It cannot create its own
pool and cannot run outside the actor transaction.

It invokes only the exact new write entry points and strictly validates their
JSON payload before mapping it to `DepartmentNode`.

The existing same-origin Organization routes gain:

- `POST /api/organization/departments` for create;
- `PATCH /api/organization/departments/[id]` for version-checked detail and
  active-state update.

The routes reuse server-side Supabase Auth verification, trusted hostname
resolution, refreshed-cookie handling, request ids, and the existing Neon
actor transaction. They do not accept identity, role, or department scope from
the browser.

Input parsing is strict and rejects unknown or malformed fields. Error mapping
is:

- `400` malformed request;
- `401` missing or expired Supabase identity;
- `403` invalid actor, role, hostname, or requested property;
- `404` target not visible or absent, without cross-property disclosure;
- `409` stale version or uniqueness conflict;
- `422` active-state business blocker or other valid-domain rejection;
- `503` runtime, database, or payload-integrity failure.

The browser registry remains on the Supabase Department repository in Phase
2A. New Neon routes and repositories are dark until the full runtime matrix is
approved; no existing UI contract is switched in this phase.

## Validation requirements

### Catalog and privilege validation

- approved child endpoint, database, and bootstrap identity pass preflight;
- migration owner and application roles remain `NOBYPASSRLS` and non-owner of
  protected business tables;
- application membership topology is unchanged;
- Department and closure tables remain `ENABLE/FORCE RLS`;
- legacy owner-definer write entry points and trigger helpers have no PUBLIC or
  runtime execution path;
- new public entry points are owned by `hotel_ld_migration_owner`, are
  `SECURITY DEFINER`, have `search_path=""`, and are executable only by
  `hotel_ld_application` plus their owner;
- create-time trigger helpers are `SECURITY INVOKER`, owned by
  `hotel_ld_migration_owner`, and expose no ambient execution;
- application and People roles have zero raw table/column privileges and own
  zero objects;
- migration owner has no closure UPDATE or DELETE authority.

### Runtime behavior matrix

Validation uses the true pooled application credential, never `SET ROLE`:

- active property manager can create a root and child Department;
- created rows have correct depth, path, self closure, and ancestor closure;
- active property manager can update details and active state;
- department administrator is denied every mutation;
- actor/property mismatch and cross-property identifiers are denied without
  disclosure;
- stale expected version returns conflict without data or audit changes;
- active-state blockers preserve the Department and version;
- successful audit evidence contains the correct actor, request, property,
  object, operation, and versions;
- forced audit failure rolls back Department and closure changes;
- transaction rollback clears Actor Context;
- pooled connection reuse and concurrent actors do not leak or cross context;
- direct application table reads and writes remain denied.

### Project verification

- existing `npm test` remains exactly 201/201 passing;
- `npm run build` succeeds separately;
- client-output scans contain no `pg`, `DATABASE_URL`, Neon endpoint, SQL, or
  actor-setting leakage;
- Supabase registry fallback remains active.

## Rollback

Rollback is child-only and is reviewed before execution. It:

1. revokes the new public entry-point grants;
2. drops the new public entry points and Phase 2A private audit objects;
3. drops only Phase 2A write policies;
4. revokes only Phase 2A migration-owner write and blocker-read grants;
5. restores the pinned pre-Phase-2A trigger function definitions, owners, and
   ACLs only if rollback explicitly requires returning to that reviewed child
   baseline;
6. verifies application raw privileges remain zero and E1/E2/E3 Phase 1 reads
   remain intact.

Rollback never reenables a Neon Organization runtime write path and never
changes the Supabase fallback or Production.
