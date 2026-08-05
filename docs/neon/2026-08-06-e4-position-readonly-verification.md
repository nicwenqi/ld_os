# E4A Position Read-only Verification Record

**Date:** 2026-08-06
**Phase:** E4A Position read-only parity
**Fact category:** current organizational reference facts (position families, positions, and scoped department applicability); no historical learning facts are created or inferred.
**Authorization:** server-verified Supabase Auth subject → existing E1 transaction-scoped actor context → `hotel_ld_application` → constrained Neon entrypoints → RLS.
**Audit:** append-only `app_private.position_read_audit_events`; it stores only actor/property/request IDs, operation, count, and timestamp—not position or department names.

## Child-only execution boundary

The validator accepted only the reviewed child identity:

- branch: `br-aged-river-az1gke14`
- endpoint: `ep-sparkling-shape-az9gxtuh`
- database: `neondb`
- bootstrap role: `neondb_owner` (direct connection, migration only)
- runtime role: `hotel_ld_application` (pooled connection)

It rejects the production deny-list before opening a connection. No Production endpoint or credential was used. Connection strings and passwords are not recorded here.

## Assets

- Migration: `neon/migrations/202608060011_e4_position_readonly.sql`
- Read entrypoints: `public.read_neon_position_families(text)` and `public.read_neon_positions(text)`
- Server repository: `app/repositories/neon/position-read-repository.ts`
- Dark API: `GET /api/organization/position-families` and `GET /api/organization/positions`
- Validation: `scripts/neon/validate-e4-position-readonly.mjs`

The Position registry and UI remain Supabase-backed. E4A creates no Position write, alias, import-mapping, or activation path.

## Executed verification

| Check | Result |
| --- | --- |
| source contract | pass: transactional migration, two constrained entrypoints, scoped assignment projection |
| child bootstrap dry-run | pass: rolled back |
| child migration apply | pass |
| catalog | pass: SECURITY DEFINER owner/search path/execute ACL, forced audit RLS, no raw runtime table privileges, NOBYPASSRLS role |
| runtime application role | pass: raw Position read/write and raw assignment read denied; private audit schema denied; entrypoint without actor denied |
| actor cleanup / connection reuse | pass: transaction-local actor setting absent after rollback and before next transaction |
| project tests | pending final branch run |
| project build | pending final branch run |

## Department-scope parity assertions

The migration retains the established Supabase rules:

- manager: property-wide families, positions, and assignments;
- department admin: only positions with an assignment in exact/descendant active scope, plus the existing unassigned-position case;
- family: only if at least one position is visible;
- assignment projection: only department IDs in the actor's scope for a visible position.

The runtime role has no raw-table grant and can invoke only the two public entrypoints. The entries reassert actor context, verified hostname/property, active account, and reader role.

## Deferred positive identity matrix

The child environment currently has no configured, runnable Supabase session fixture for a property manager and a department administrator. The validator deliberately does not fabricate an actor with the owner or use `SET ROLE`. Before registry activation, execute the two authenticated child-session cases:

1. manager sees all current-property rows and all assignments;
2. department admin sees only scoped/descendant positions and a filtered assignment array;
3. same identity against another hostname/property receives no data/authorization failure.

This deferral does not activate the registry and does not affect the default Supabase fallback.
