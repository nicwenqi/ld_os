# Neon Organization Phase 4B: Operational Units design

## Scope

Phase 4B migrates only Operational Unit read, create, and update into the
existing Neon child branch. It retains Supabase Auth, transaction-scoped Actor
Context, the `hotel_ld_application` runtime topology, and the Supabase
Organization registry fallback. No UI or registry activation is part of this
phase.

It does not migrate Position, Import, Employee writes, Operational Unit aliases,
or unrelated organization workflows.

## Authorization and data boundaries

Every dark API request authenticates through server-side Supabase Auth and
resolves the trusted hostname. `withNeonResolvedActorContext()` supplies the
verified auth user, resolved property, and request ID only for the current
transaction.

- A property LD manager can read all current-property Operational Units and is
  the sole mutation role.
- A department training administrator can read only units whose owning
  `department_id` is readable through the existing live Department scope rule,
  including approved descendants. It cannot create or update a unit.
- The browser supplies neither actor identity nor property/Department scope.
- `hotel_ld_application` receives no raw `operational_units` table privileges,
  no ownership, no bypass-RLS capability, and no additional membership.

## Data model and hierarchy rules

Operational Units continue to use the existing adjacency hierarchy. A parent
must be active, in the same tenant/property, and attached to the same
Department as the child. A create accepts no version. An update requires the
current `expectedVersion` and increments it atomically.

The mutation entry point locks the current unit before comparing its version.
It locks a requested parent before validating it, rejects self-parenting and
recursive descendants, and updates the row plus audit event atomically.
Changing a unit's Department requires a null parent or a parent in that same
new Department. It does not rewrite descendants; an attempted Department move
with existing children is rejected in Phase 4B to avoid silently violating the
same-Department hierarchy invariant. A later dedicated subtree-move phase can
make that behavior explicit.

## Database boundary

One child-only migration creates:

- private reader and manager mutation predicates;
- a private payload helper;
- an append-only Operational Unit audit table and mutation-rejecting trigger;
- RLS policies and only the migration-owner column grants needed for the
  constrained functions;
- `public.read_neon_organization_operational_units(text)`;
- `public.create_neon_organization_operational_unit(...)`; and
- `public.update_neon_organization_operational_unit(...)`.

All public mutation/read entry points are owned by
`hotel_ld_migration_owner`, are `SECURITY DEFINER`, use `search_path=''`, revoke
PUBLIC EXECUTE, and grant only their exact signature to
`hotel_ld_application`. Each re-checks runtime, actor, hostname, property, and
role authorization before accessing data.

## Server/API boundary

A new server-only Neon repository implements only
`listOperationalUnits`, `createOperationalUnit`, and `saveOperationalUnit` from
the existing `DepartmentRepository` contract. Existing Department repository
methods and the registry remain untouched.

Dark routes are:

- `GET /api/organization/operational-units`
- `POST /api/organization/operational-units`
- `PATCH /api/organization/operational-units/:id`

Requests allow-list only the fields defined by their existing repository input
types. UUIDs and version values are canonicalized at the route boundary. Error
mapping remains 401 for absent/expired identity, 403 for role/property denial,
404 for invisible current-property objects, 409 for stale version or hierarchy
serialization/deadlock, and 422 for invalid hierarchy/business state.

## Validation

The migration validator accepts only the approved child direct bootstrap URL and
pooled application URL. It proves function owner/path/ACL, forced RLS, zero raw
runtime table privileges, no actor-context call denial, and raw table denial.

The real identity matrix, when development identities exist, covers manager
read/create/update, department-admin scoped read/mutation denial, cross-property
denial, stale version conflict, parent/cycle rejection, audit correctness,
atomic rollback, and concurrent-request isolation. It must not use an owner
connection, `SET ROLE`, fabricated claims, or browser access to Neon. Identity
cases without approved development accounts remain deferred.
