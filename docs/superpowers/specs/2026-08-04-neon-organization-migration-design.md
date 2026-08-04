# Neon Organization Migration Design

**Date:** 2026-08-04

**Phase:** E3 Organization migration

**Status:** Approved

## Goal

Move the existing Organization management contract to Neon without changing
the E1 Actor Context or weakening the current authorization model:

```text
Supabase Auth
  -> verified auth user id and trusted hostname
  -> transaction-scoped Neon Actor Context
  -> hotel_ld_application
  -> constrained Organization entry point
  -> live property, account, role, and department authorization
  -> Neon RLS
  -> server-only repository
  -> same-origin Organization API
  -> existing DepartmentRepository and UI contract
```

E3 covers departments, hierarchy and closure, department aliases,
operational units, and operational-unit aliases. It preserves the full current
Organization read/write contract. It does not migrate Position, Import,
Employee write, Supabase Auth, or Supabase Storage.

## Approved boundaries

- Production branch `br-twilight-leaf-azmowo1k` and endpoint
  `ep-wild-wave-azjmgdif` remain deny-listed.
- Database work is permitted only on child branch
  `br-aged-river-az1gke14`, endpoint
  `ep-sparkling-shape-az9gxtuh`.
- E1 Actor Context functions and TypeScript transaction wrapper are unchanged.
- No runtime role or permission-group role is added.
- `hotel_ld_application` retains its exact one-membership topology and remains
  `NOBYPASSRLS`, non-owner, and without raw business-table privileges.
- The application role receives only `EXECUTE` on the exact E3 public entry
  points. It receives no table or column `SELECT`, `INSERT`, `UPDATE`, or
  `DELETE` grant.
- Every E3 database operation goes through a constrained entry point owned by
  `hotel_ld_migration_owner`.
- Every public entry point is `SECURITY DEFINER`, fixes `search_path` to the
  empty path, fully qualifies every object, revokes `PUBLIC EXECUTE`, and
  explicitly checks runtime session, Actor Context, hostname, property, live
  account, and role or department scope.
- Browsers never connect to Neon and never receive `DATABASE_URL`, endpoint
  details, actor settings, SQL, or function names.
- Existing test files are not edited or deleted.
- Supabase Organization remains the fallback until the Neon child runtime
  matrix passes. There is no dual-write period.

## Why E3 uses new constrained entry points

The legacy Supabase Organization RPCs are not safe to expose directly to the
Neon runtime. They were created in an earlier ownership context and use
Supabase-era authorization helpers. E3 does not grant them to the application
role and does not invoke them from new functions.

Organization audit columns such as `created_by`, `updated_by`, and
`approved_by` refer to the internal application user identity. E1 Actor
Context intentionally stores the verified Supabase `auth_user_id`. E3
therefore resolves the active, property-scoped `user_accounts.user_id` inside
Neon before writing audit foreign keys. It never assumes that `user_id` equals
`auth_user_id`, and it never accepts either identity from browser input.

## Chosen permission design

E3 grants exact public-function execution directly to
`hotel_ld_application`.

This is intentionally not granted through `hotel_ld_people_read`: doing so
would mix Organization write authority into a People read permission group.
It also does not add an Organization role because the approved E1/E2 runtime
assertion requires exactly one application membership, specifically the
existing People membership.

The direct grant does not create ambient access. Post-migration catalog checks
must prove that:

- the only runtime grantee on the E3 public entry points is
  `hotel_ld_application`; the function owner's implicit privilege remains, but
  the entry-point runtime-session assertion rejects every non-application
  session;
- `PUBLIC`, `authenticated`, `hotel_ld_people_read`, `hotel_ld_readonly`,
  `neondb_owner`, and other runtime roles cannot execute them;
- application and People roles own no database objects;
- application and People roles have no raw table or column privileges;
- the entry points are owned by the constrained, `NOBYPASSRLS` migration
  owner and have `search_path=""`.

## Authorization semantics

### Property manager

An active `property_ld_manager` with active account, profile, tenant,
property, tenant membership, property membership, role assignment, and role
can:

- read the complete department tree and closure projection for the resolved
  property;
- read department aliases, operational units, and operational-unit aliases;
- create and update departments;
- preview and commit hierarchy moves;
- resolve department aliases, including an atomic conversion to an
  operational-unit alias;
- create and update operational units.

### Department administrator

An active `department_training_admin` can only use read entry points. The
visible department tree contains:

- exact authorized departments;
- descendants only when the live trainer scope has
  `include_descendants=true`;
- ancestors required to render a truthful breadcrumb.

Operational units are visible only when their official department is within
the authorized exact or descendant scope. Department aliases and all mutation
entry points remain manager-only.

### Denials

The database fails closed for missing Actor Context, wrong runtime role,
hostname/property mismatch, inactive authorization facts, unauthorized role,
cross-property identifiers, or records outside the current actor property.
Object-not-found responses do not reveal whether another property owns the
identifier.

## Database migration

The reviewed migration target is:

`neon/migrations/202608040004_e3_organization.sql`

It does not recreate the existing Organization tables. Its preflight first
validates the final child schema for:

- `departments`;
- `department_closure`;
- `department_aliases`;
- `operational_units`;
- `operational_unit_aliases`;
- expected composite keys, checks, indexes, hierarchy triggers, immutable
  scope/source triggers, owners, and `ENABLE/FORCE ROW LEVEL SECURITY`;
- the exact legacy `departments_insert_closure` trigger remains the only
  target-table trigger whose function is both `SECURITY DEFINER` and owned by
  a role capable of bypassing RLS; Phase 1 pins this known, read-path-inert
  exception instead of changing write infrastructure;
- no E3 Phase 1 entry point can invoke that trigger because application and
  People roles retain zero Department DML and the public read call graph is
  SELECT-only;
- exact E1/E2 runtime role and Actor Context baseline.

The migration adds Organization-private helpers for:

- runtime-session assertion;
- live active actor and internal user-id resolution;
- live manager-role assertion;
- live department-scope evaluation;
- hostname/current-property consistency;
- append-only Organization audit evidence;
- guarded hierarchy mutation.

The planned public entry points are:

- trusted-hostname property resolution;
- department tree read;
- department create;
- department detail/active-state update;
- department move preview;
- department move commit;
- department-alias read;
- atomic department-alias resolution;
- operational-unit read;
- operational-unit create/update.

Server repository methods may derive `getNode`, ancestors, and descendants
from the authorized tree result rather than add redundant public database
functions. `setActive` delegates to the version-checked department update, and
`createOperationalUnit` delegates to the operational-unit save entry point.

All entry points return a narrow database payload. The server repository
validates and maps every field into the existing camelCase domain objects;
invalid payload shapes fail closed.

## RLS design and E2 coexistence

E2 policies and People entry points are not dropped, renamed, or broadened.
PostgreSQL permissive policies combine with OR semantics, so E3 does not add a
new permissive SELECT policy on E2-shared `departments`,
`department_closure`, or `operational_units` merely to express a narrower
department role. It reuses the current actor-property SELECT defense and
explicitly enforces manager or department scope inside each Organization read
entry point.

E3 adds only the exact missing migration-owner column grants. It does not grant
those columns to a runtime role.

For Organization writes, E3 adds command-specific policies to
`hotel_ld_migration_owner`:

- department `INSERT` and `UPDATE`;
- closure `INSERT`, `UPDATE`, and `DELETE` required by guarded moves;
- department-alias `SELECT`, `INSERT`, and `UPDATE`;
- operational-unit `INSERT` and `UPDATE`;
- operational-unit-alias `SELECT`, `INSERT`, and `UPDATE`.

Every mutation policy binds `session_user` to the application role, binds
tenant/property to the transaction-local actor property, and requires live
manager authority. UPDATE policies use both `USING` and `WITH CHECK`.

## Department hierarchy invariants

The following representations remain transactionally consistent:

- adjacency through `parent_id`;
- materialized `depth` and `path_ids`;
- transitive `department_closure`, including one distance-zero self row per
  node and every ancestor/descendant distance.

Create and move operations reject:

- a parent outside the current tenant/property;
- self-parenting;
- moving beneath a descendant;
- stale expected versions;
- invalid or inactive target parents according to the existing contract.

A move locks the moving root and target, validates the current version, updates
the complete subtree paths and depths, removes obsolete external closure rows,
adds the new external ancestry, and increments the version of every affected
department in the same transaction. The implementation uses a property-scoped
transaction advisory lock to serialize hierarchy writers and avoid concurrent
closure snapshots racing.

Department detail and active-state updates preserve the existing blockers for
active child departments, trainer scopes, position assignments, and
operational units. E3 does not add unrelated product rules during migration.

## Alias and operational-unit invariants

Alias source evidence and tenant/property scope remain immutable. Normalized
active source values remain unique within a property and source system.

Alias actions retain the current contract:

- `department`;
- `operational_unit`;
- `ignore`;
- `defer`;
- `merge`.

The entry point validates action-specific targets against the current
property. Converting a department alias to an operational-unit alias disables
the old active department alias and creates or updates the unit alias in one
transaction. A failure in either step rolls back both changes. Approval time
and approver come only from the database transaction and the resolved internal
actor identity.

Operational-unit saves preserve:

- current property and tenant scope;
- an active official department in the same property;
- parent unit in the same property and official department;
- self/descendant cycle rejection;
- expected-version conflict handling;
- audit identity and version increment.

## Server repository and API

The existing `DepartmentRepository` interface and UI consumers remain
unchanged. E3 adds:

- a server-only Neon Organization repository bound to the transaction's narrow
  query interface;
- a browser-safe HTTP DepartmentRepository adapter;
- an Organization authorization service parallel to, but independent from,
  the People service;
- a trusted-hostname Organization property resolver;
- same-origin API route handlers.

The HTTP adapter retains the current property/tenant arguments for dependency
injection compatibility but never serializes them as authorization evidence.
API parsers reject browser-submitted actor, property, tenant, role, or scope
fields.

The planned HTTP resources are:

- `GET/POST /api/organization/departments`;
- `GET/PATCH /api/organization/departments/[id]`;
- department ancestors, descendants, move-preview, and move subroutes;
- `GET /api/organization/aliases` and an alias mapping subroute;
- `GET/POST /api/organization/operational-units`;
- `PATCH /api/organization/operational-units/[id]`.

Every route allow-lists query/body fields and validates UUIDs, enums, booleans,
integers, names, and action-specific targets. The browser adapter uses
same-origin credentials and no-store requests.

Responses use:

- `400` for malformed or unsupported input;
- `401` for missing or invalid Supabase identity;
- `403` for authorization or property-context denial;
- `404` for an invisible/missing current-property object;
- `409` for stale versions, serialization/deadlock retry, or unique conflict;
- `422` for hierarchy and other validly shaped business-rule violations;
- `503` for unavailable Neon service, runtime-role mismatch, or invalid
  database payload.

All success and error responses include `Cache-Control: private, no-store` and
`X-Request-Id`. When server-side Supabase Auth refresh succeeds, both success
and later business-error responses preserve the refreshed cookies.

## Registry activation and fallback

Implementation is staged without dual writes:

1. add the migration and server/API implementation while Neon mode still uses
   the Supabase Organization repository;
2. validate each database phase on the isolated child with the real
   application credential;
3. only after the full E3 runtime matrix passes, map
   `organization-management` to the Neon HTTP repository in Neon mode;
4. leave mock, hybrid, and Supabase modes unchanged.

If validation fails before activation, the existing Supabase path continues to
serve Organization. After activation, fallback requires first freezing
Organization writes and reconciling any Neon-only changes; the system never
writes the same Organization mutation to both databases.

## Phased implementation

### Phase 1 — Department read

- migration preflight and private authorization helpers;
- property resolver and department-tree read entry point;
- server repository read mapping;
- department read API and HTTP adapter methods;
- manager and department-scope runtime validation.

### Phase 2 — Department write

- before exposing any Neon Department mutation, change
  `app_private.insert_department_closure()` to a constrained
  `SECURITY INVOKER` path and prove both E3 RLS enforcement and the still-active
  Supabase fallback remain correct;
- create and version-checked detail/active update entry points;
- exact write grants and RLS policies;
- internal actor user-id audit fields;
- manager-only, cross-property, stale-version, and blocker validation.

### Phase 3 — Move and closure

- move preview and commit entry points;
- guarded hierarchy mutation and property advisory lock;
- closure/path/depth consistency and concurrency validation.

### Phase 4 — Aliases and operational units

- alias and unit read entry points;
- atomic alias resolution;
- operational-unit create/update;
- target, parent, cycle, stale-version, and rollback validation;
- final registry activation after the complete matrix passes.

After every phase, run the unchanged application suite and a separate
production build before proceeding.

## Audit evidence

E3 records append-only evidence containing only:

- request id;
- verified Supabase auth user id;
- resolved internal user id;
- property id;
- operation and object type;
- object id when applicable;
- prior/result version when applicable;
- result count for reads;
- transaction timestamp.

It does not store names, alias source values, request bodies, or other business
payloads. Audit insertion is part of the same transaction as the successful
operation, so an audit failure rolls back the business change. Denied requests
retain the request id in the HTTP/server log path without exposing database
authorization details.

## Validation gates

No committed test file is edited. Validation combines migration preflight and
postflight assertions, disposable child-branch probes, the unchanged 201-test
suite, and a production build.

The real `hotel_ld_application` credential must prove:

- no context, unauthenticated, inactive account/membership/role, wrong
  hostname/property, cross-property identifier, and department-scope escape
  all fail closed;
- manager full-tree read and department exact/descendant/ancestor projection
  are correct;
- aliases and every mutation reject department administrators;
- application and People roles have no direct table/column privileges and no
  object ownership;
- every E3 function has exact owner, `SECURITY DEFINER`, fixed search path, and
  ACL;
- legacy owner/BYPASSRLS definer RPCs are unreachable from the E3 call graph;
- the pinned legacy closure trigger remains unreachable from Phase 1 reads and
  is the first mandatory Phase 2 hardening gate;
- create/update/move/unit operations preserve versions and all current
  business blockers;
- closure equals the recursive adjacency result after create and move;
- alias-to-unit failure rolls back both sides;
- concurrent moves, writes, and alias conflicts fail or serialize safely;
- commit, rollback, connection reuse, and concurrent actors do not leak or
  cross Actor Context;
- browser build artifacts contain no `pg`, `DATABASE_URL`, Neon endpoint,
  actor marker, SQL function name, or server-only secret;
- `npm test` reports 201/201 and `npm run build` succeeds.

Production identity acceptance remains deferred consistently with the approved
E2 status; child-branch architecture and runtime/RLS verification are the E3
development gate.

## Rollback

E3 rollback is semantic and non-destructive:

1. freeze E3 activation and map Neon mode Organization back to the existing
   Supabase repository before accepting another write;
2. revoke application execution on every E3 entry point;
3. drop E3 public functions, private helpers, audit trigger/table, and E3-only
   policies in dependency order;
4. revoke only the incremental migration-owner column privileges introduced by
   E3;
5. preserve E1/E2 functions, policies, roles, Actor Context, base tables, RLS,
   and all business rows.

E2 must not be rolled back while E3 remains installed because both phases rely
on some migration-owner Organization SELECT grants. E3 rolls back first.
Rollback never disables RLS, grants runtime raw DML, uses `CASCADE`, deletes
business rows, or changes object ownership to the application role.
