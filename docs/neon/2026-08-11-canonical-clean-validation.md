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

**CODE COMPLETE · CATALOG VALIDATED · LIVE POOLED RUNTIME = PLATFORM BLOCKED**

The control plane generated a syntactically valid SSL pooled runtime connection for
`hotel_ld_application` and `neondb`. Its hostname contains `-pooler` and resolves
to the exact endpoint tuple above. The runtime validator used that pooled connection
only: it did not substitute the direct bootstrap connection for runtime work.

The endpoint continued to report `pooler_enabled=false`. A bounded pooled runtime
attempt produced no successful query or matrix result and was cancelled. This is an
endpoint-side Neon pooling-availability blocker, not a schema, RLS, privilege, or
runtime-topology failure.

The interrupted attempt created its two deterministic fixtures a second time. Both
fixture graphs were removed immediately by a one-time operator transaction using
the direct bootstrap identity. The transaction was limited to the verified
`validation-a` and `validation-b` tenant IDs and their dependent records; it made no
policy, privilege, RLS, or role changes and used no `SET ROLE`. Final verification
returned zero remaining fixture tenants. No Production, Supabase, Storage, or prior
acceptance target was touched.

Do not use this target for application traffic. When Neon pooling is available for
this endpoint, rerun **only** the final pooled runtime matrix: real Auth adapter
boundary, Neon authorization session, manager and department scope, refresh
re-resolution, cross-property denial, raw-table denial, Actor Context cleanup, and
pooled connection reuse. Do not rerun architectural, migration, dry-run, apply, or
catalog work solely to clear this platform blocker.
