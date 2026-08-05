# E3 Phase 4B — Operational Units verification

## Child-only application

Migration `neon/migrations/202608050009_e3_organization_operational_units.sql`
was rehearsed in a rollback transaction and applied only to
`br-aged-river-az1gke14` / `ep-sparkling-shape-az9gxtuh`. Production was not
connected. Bootstrap used the direct owner guard; runtime verification used the
pooled `hotel_ld_application` guard without emitting either connection string.

## Catalog and RLS results

The validator confirmed all three exact public entrypoints, migration-owner
ownership, fixed search paths, revoked PUBLIC execute, exact application execute
grants, FORCE RLS, append-only audit, and zero raw `operational_units`
privileges for the application role.

The application-role negative matrix passed:

- NOBYPASSRLS is true.
- direct Operational Unit read and write are denied;
- an entrypoint without transaction-local Actor Context is denied;
- no owner connection or `SET ROLE` was used for runtime validation.

## Deferred identity matrix

No reviewed development identity set exists for positive application behavior.
The following remain deferred and must later run through Supabase Auth → trusted
hostname → Actor Context → pooled application role: manager read/create/update;
department-admin scoped read and mutation denial; cross-property rejection;
stale version conflict; parent/self/descendant cycle rejection; atomic rollback;
audit accuracy; and concurrent actor isolation. They must not be substituted by
owner credentials, fabricated claims, direct table access, or browser Neon.

## Rollback

On the child branch only, stop dark API traffic, revoke the three entrypoint
grants, drop Phase 4B functions/policies/audit trigger/table, revoke the added
migration-owner column grants, then rerun Phase 4A catalog/runtime validation.
This is not a Production procedure.

## Compatibility

The Organization registry remains Supabase fallback, UI remains unchanged, and
Import retains `actorClient.rpc("stage_employee_import")`. Phase 4B excludes
Operational Unit aliases, Position, Import, and Employee writes.
