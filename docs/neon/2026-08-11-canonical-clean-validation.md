# Canonical Clean Validation Target — Execution Record

Date: 2026-08-11

## Target

- Project: `withered-bar-40598816` (`hotel-ld-os-neon-canonical-validation`)
- Branch: `br-wispy-flower-avd4hssa` (`main`)
- Endpoint: `ep-lingering-pine-avbdti90`
- Database: `neondb`
- PostgreSQL: 18.4
- Bootstrap identity: `neondb_owner`

The project was created empty for this validation. It is separate from Production, Supabase, and the prior drifted acceptance target.

## Completed gates

| Gate | Result |
| --- | --- |
| Source | PASS — 9 canonical modules, including 080 Property/Initialization and 085 Auth/Authorization |
| Dry-run | PASS — outer transaction rolled back; 2 schemas, 9 types, 36 tables, 103 routines, 37 entrypoints, 15 policies, 18 triggers, zero rows |
| Apply | PASS — same catalog counts; runtime credential provisioned without logging it |
| Catalog | PASS — owner, definer/search path, ACL, RLS/FORCE RLS, and raw-privilege matrix passed; rows were zero |

The catalog validator now normalizes PostgreSQL's `timestamp with time zone` representation when comparing the exact `timestamptz` source signature. The clean target is also an exact allowlisted validation tuple.

## Runtime status

Not complete. The compute reports `pooler_enabled=false`; the required pooled `hotel_ld_application` runtime connection did not establish within the runtime guard and was interrupted. The runtime bootstrap phase had already created only its two `validation-a` / `validation-b` fixtures, which remain pending cleanup. No Product, Supabase, Storage, or prior acceptance target was touched.

Do not use this target for application traffic. Resume only after the pooled endpoint is enabled and the existing approved runtime-seed cleanup path is authorized to remove those exact fixtures. Then rerun the complete runtime matrix, including real Auth adapter session, manager and department scope, refresh re-resolution, cross-property denial, raw-table denial, Actor Context cleanup, and pooled reuse.
