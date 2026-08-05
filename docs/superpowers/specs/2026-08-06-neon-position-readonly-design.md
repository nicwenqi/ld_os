# E4A Neon Position Read-only Design

**Date:** 2026-08-06
**Status:** Approved for implementation
**Scope:** Position families, positions, and the actor-visible projection of position-to-department assignments.

## Goals

E4A adds a child-Neon, server-only read path without changing the default registry. Supabase Auth continues to establish the authenticated subject; the existing E1 transaction-scoped actor context, property resolution, application role, and RLS model remain unchanged.

The slice exposes only:

- `position_families` readable to the current actor;
- `positions` readable to the current actor;
- assignment IDs visible within the actor's department scope.

It does not add position writes, aliases, import mapping, UI switching, or registry activation.

## Supabase parity contract

The existing `app_private.can_read_scoped_position` / `can_read_scoped_position_family` policies are authoritative:

- A property manager sees all position families, positions, and assignments in the resolved property.
- A department administrator sees a position only when it has an assignment inside the administrator's active department scope (including descendants), or when it is unassigned and the existing Supabase rule makes it readable.
- A department administrator sees a family only when it has at least one visible position.
- For an otherwise visible position, its assignment projection contains only department IDs inside the actor's active scope. It must never disclose assignments outside that scope.
- Objects in another property are indistinguishable from absent objects at the entrypoint boundary.

## Database boundary

Migration `202608060011_e4_position_readonly.sql` will add two constrained read entrypoints:

- `public.read_neon_position_families(text)`;
- `public.read_neon_positions(text)`.

The functions are `SECURITY DEFINER`, owned by the migration owner, use a fixed empty `search_path`, revoke `PUBLIC EXECUTE`, accept execution only from `hotel_ld_application`, and call the existing E1 actor-context assertion before reading.

They derive authorization in Neon from current actor, property, role, and active department scope. `read_neon_positions` returns an aggregated `department_ids` projection filtered at the assignment-row level. Neither function receives actor identity or property from the browser/request parameters.

`hotel_ld_application` remains `NOBYPASSRLS`; it receives no raw privileges on position tables. Existing table RLS remains enabled and forced. A private append-only read-audit table is readable only through a migration-owner verification surface, never by the runtime role.

## Application boundary

`NeonPositionReadRepository` runs through the existing `withNeonResolvedActorContext` transaction wrapper. It is server-only and maps the constrained JSON payloads to the existing `PositionRepository` read shapes. Dark GET routes use normal server-side Supabase Auth verification and property resolution, then invoke this repository. No browser code receives a PostgreSQL credential.

The registry continues to construct the Supabase position repository by default. The dark routes are an activation rehearsal only, so rollback is removing `APP_DATA_MODE=neon`/calling the existing Supabase path; no persistent data is mutated.

## Validation

The E4 validator must reject the production deny-list before opening a connection and separately verify bootstrap versus application URLs. It covers static/migration checks, catalog ACLs, actor context cleanup after rollback, connection reuse, and the runtime matrix:

- manager property-wide read;
- department-admin scoped read and filtered assignment projection;
- cross-property rejection/no leakage;
- application raw-table denial;
- audit ACL denial for application role.

Identity-dependent positive cases are recorded as deferred only when the child branch lacks corresponding non-production identities; they are never simulated with the owner or `SET ROLE`.
