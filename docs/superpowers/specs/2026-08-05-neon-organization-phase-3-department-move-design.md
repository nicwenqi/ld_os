# Neon Organization Phase 3 Department Move and Closure Design

**Date:** 2026-08-05

**Phase:** E3 Phase 3

**Status:** Approved for implementation planning

## Goal

Add an actor-scoped Neon Department hierarchy move slice without changing the
E1 Actor Context, E2 runtime-role topology, the existing Department repository
contract, or the still-active Supabase Organization fallback.

```text
Supabase Auth
  -> verified auth user id and trusted hostname
  -> transaction-scoped Neon Actor Context
  -> hotel_ld_application
  -> constrained move preview or move commit entry point
  -> live property-manager authorization and forced RLS
  -> adjacency, depth/path_ids, closure, and audit mutation
  -> server-only repository and dark same-origin API
```

Phase 3 implements only:

- move preview;
- move commit;
- subtree `depth` and `path_ids` rebuild;
- closure rewrite for the moved subtree;
- source-node optimistic concurrency and hierarchy-writer serialization;
- resulting-hierarchy and rollback verification.

It does not implement aliases, operational units, Position, Import, Employee
write, a new runtime role, a browser registry switch, dual writes, or a change
to `DepartmentRepository.previewMove()` or `DepartmentRepository.moveNode()`.

## Fixed boundaries

- Database writes are permitted only on child branch `br-aged-river-az1gke14`,
  endpoint `ep-sparkling-shape-az9gxtuh`, database `neondb`.
- Production branch `br-twilight-leaf-azmowo1k` and endpoint
  `ep-wild-wave-azjmgdif` remain deny-listed.
- The direct `NEON_BOOTSTRAP_DATABASE_URL` is bootstrap-only and may only be
  used after an endpoint, database, and `neondb_owner` fail-closed guard.
- Runtime validation uses the pooled `DATABASE_URL` as
  `hotel_ld_application`, never a bootstrap or table-owner credential.
- `hotel_ld_application` remains `NOBYPASSRLS`, owns no objects, receives no
  raw business-table privilege, and receives only EXECUTE on exact public
  entry points.
- E1 `withNeonActorContext()` and its transaction-local settings are unchanged.
- Supabase Auth remains the sole source of verified identity. Supabase Storage
  remains unchanged.
- The Organization registry remains on Supabase and the dark API does not
  activate any browser UI path.
- Phase 2A Department create/update entry points remain available. A Phase 3
  migration may make their hierarchy-affecting paths join the same private
  property lock, but it must not change their API contract or broaden their
  grants.

## Chosen preview and commit semantics

### Non-binding preview

`DepartmentRepository.previewMove(id, newParentId)` remains unchanged.

The preview entry point:

- authenticates and authorizes the actor exactly as any Organization read;
- resolves the current property from the trusted hostname and Actor Context;
- reads the current tree and calculates the current path, proposed path, and
  affected counts;
- does not create a token, persist preview state, take a long-lived hierarchy
  lock, or act as a mutation authorization boundary.

Preview is informational only. Its response may be stale before commit.

### Authoritative commit

`DepartmentRepository.moveNode(id, newParentId, expectedVersion)` remains the
only mutation boundary.

The commit entry point acquires a transaction-scoped property hierarchy lock,
then independently:

1. verifies the exact runtime session, complete Actor Context, trusted
   hostname/property equality, active account/memberships, and live
   `property_ld_manager` role;
2. re-reads the moving root, candidate parent, source subtree, and relevant
   closure rows under the locked authoritative state;
3. validates source property visibility, source `expectedVersion`, parent
   existence and active-state rule, self-parenting, cross-property input, and
   every direct or indirect cycle;
4. rebuilds the source subtree adjacency-derived `depth` and `path_ids`;
5. removes obsolete closure edges between external old ancestors and moved
   descendants, then inserts the new external ancestor edges with exact
   distances while retaining internal subtree closure edges;
6. verifies adjacency, materialized path/depth, and closure are equivalent;
7. increments versions of the moved root and every descendant whose hierarchy
   representation changed, appends one audit event, and returns the authoritative
   moved root payload.

Any error aborts the actor transaction, including audit or post-mutation
invariant failure.

## Concurrency and HTTP outcomes

The private lock is a property-scoped transaction advisory lock derived from
the resolved property identifier. All hierarchy-affecting Phase 3 code paths
use it before taking row locks or reading closure snapshots. It is released
automatically at transaction end; no session-persistent lock or actor setting
is permitted.

The existing source-node `expectedVersion` is the optimistic lock. There is no
property hierarchy revision and no preview token. Consequently, a commit uses
the current authoritative state after acquiring the lock; it does not promise
that its result equals a previously displayed preview.

The stable result mapping is:

| Condition | Outcome |
| --- | --- |
| Source `expectedVersion` is stale | `409 Conflict` |
| Serializable/deadlock/lock-conflict database result | `409 Conflict` |
| A lock-protected key row changes before its mutation check completes | `409 Conflict` |
| Source or parent is absent/invisible in current property | `404 Not Found` |
| Actor, hostname/property, role, or RLS authorization fails | `403 Forbidden` |
| Self-parent, cycle, inactive parent, or other validly shaped hierarchy rule fails | `422 Unprocessable Entity` |
| Malformed route/body fields | `400 Bad Request` |
| Missing/invalid Supabase identity | `401 Unauthorized` |
| Runtime/topology/payload/service failure | `503 Service Unavailable` |

## Database design

### Entry points and helper ownership

The Phase 3 migration adds exact public entry points, both owned by
`hotel_ld_migration_owner`, `SECURITY DEFINER`, fully schema-qualified, and
configured with `search_path=''`:

- `public.preview_neon_organization_department_move(text, uuid, uuid)`;
- `public.move_neon_organization_department(text, uuid, uuid, bigint)`.

`PUBLIC`, `authenticated`, `neondb_owner`, `hotel_ld_people_read`, and
`hotel_ld_readonly` have EXECUTE revoked. Only `hotel_ld_application` receives
EXECUTE on these exact signatures.

Private helpers are owned by `hotel_ld_migration_owner`, use
`SECURITY INVOKER`, fix `search_path=''`, and are not executable by PUBLIC or
runtime roles. They assert complete actor context and current property scope
before any business-row access. The Phase 2A audit table stays append-only;
move audit rows record request, verified auth identity, resolved internal
actor, tenant/property, operation, root Department, prior/result versions,
and affected subtree count without field values.

### RLS and least privilege

The migration gives only `hotel_ld_migration_owner` the extra Department and
closure columns necessary to select, update, insert, and delete the exact
affected rows under forced RLS. It adds command-specific RLS policies with
both `USING` and `WITH CHECK` where UPDATE applies.

Every policy binds:

- `session_user = 'hotel_ld_application'`;
- a complete transaction-local actor context;
- the live property-manager authorization helper;
- tenant/property equality to `current_actor_property_id()`;
- all closure ancestors and descendants to that property.

No raw table or column grant is given to `hotel_ld_application`; no runtime
role becomes an owner; no role gains `BYPASSRLS`.

### Closure algorithm

For source subtree `S`, old external ancestors `A_old`, and new external
ancestors `A_new`:

1. lock the property hierarchy and source/target/subtree rows deterministically;
2. delete only closure rows where `ancestor ∈ A_old` and `descendant ∈ S`;
3. preserve closure rows whose ancestor and descendant are both in `S`;
4. insert rows from every `ancestor ∈ A_new` to every `descendant ∈ S`, with
   distance equal to the new ancestor-to-parent distance plus one plus the
   preserved source-to-descendant distance;
5. rebuild each `S` row's `path_ids` from the new parent prefix plus its
   preserved relative subtree suffix, and set `depth = cardinality(path_ids)-1`;
6. prove one self closure row per Department, no duplicate edges, and exact
   recursive adjacency equivalence before commit.

The old insert trigger remains an insert-only concern. Phase 3 never tries to
invoke it for existing rows and does not relax its Phase 2A hardening.

## Server boundary

The server-only Neon Department repository gains the existing contract methods
`previewMove()` and `moveNode()` using parameterized calls to the two exact
entry points and strict payload validation. It continues to receive only the
actor-transaction query interface and trusted hostname from the authorization
service.

Dark same-origin routes are:

- `POST /api/organization/departments/:id/move-preview` with
  `{ "newParentId": string | null }`;
- `POST /api/organization/departments/:id/move` with
  `{ "newParentId": string | null, "expectedVersion": number }`.

Route parsers reject browser-provided tenant, property, actor, role, scope,
or arbitrary additional fields. Both routes create a request id and run only
through existing `runAuthorizedNeonOrganizationRead` or
`runAuthorizedNeonOrganizationWrite`; commit redoes all authorization and
hierarchy validation independently of preview.

## Validation and rollback

The child-only validator must first reject all Production, wrong-role, wrong
database, and non-pooled runtime credentials without printing secrets. Its
catalog checks must prove fixed owner/search path/ACL, forced RLS, exact grants
and policies, zero raw runtime privilege, and unchanged Actor Context.

Runtime fixtures use only synthetic child identities and verify:

- manager preview and move success;
- cycle and self-parent rejection;
- cross-property/invisible parent denial;
- stale source version conflict;
- lock serialization and a concurrent hierarchy conflict;
- rebuilt paths/depths and closure equivalence to recursive adjacency;
- audit evidence;
- explicit transaction rollback of Department, closure, and audit effects;
- post-transaction Actor Context clearing and pooled connection reuse;
- direct application-table read/write denial.

Fixtures are deleted after validation; committed append-only audit evidence is
retained. Rollback before migration commit is ordinary transaction rollback.
After a committed child-only migration, rollback is a new, reviewed forward
migration that revokes the Phase 3 entry-point grants and removes only Phase 3
objects/policies after verifying no Phase 3 move has been committed. It never
edits E1/E2/Phase 1/Phase 2A migration history and never targets Production.

## Acceptance

- `npm test` reports exactly 201 passed and 0 failed.
- A separate `npm run build` succeeds.
- Registry remains Supabase and no People, Import, Position, alias, operational
  unit, Auth, Storage, or Actor Context source is changed.
- The client bundle contains no PostgreSQL client, Neon URL/endpoint, runtime
  role, actor-setting name, or Phase 3 SQL entry-point marker.
