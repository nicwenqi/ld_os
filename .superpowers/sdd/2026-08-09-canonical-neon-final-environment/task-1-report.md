# Task 1 report — Canonical manifest and fail-closed source validator

## Scope completed

- Added `neon/canonical/manifest.json`, the machine-readable final E1–E5A
  surface inventory. It classifies ordered bootstrap modules, schemas, roles,
  types, business tables, helper routines, public entrypoints, policies,
  triggers, and the excluded Supabase/import/provenance/test/compatibility/
  bridge/reset surfaces.
- Added `scripts/neon/validate-canonical-neon-baseline.mjs` with `source`,
  `dry-run`, `apply`, `catalog`, `runtime`, and `repeatability` modes.
- Implemented connection-free source validation for ordered module inventory,
  manifest/object drift, forbidden Supabase and legacy surface, persistent
  `SET`, broad roles, raw application table grants, missing FORCE RLS,
  unpinned SECURITY DEFINER paths, PUBLIC EXECUTE, and top-level business DML.
- Added a connection-free fixture and 13 focused validator tests. No database
  client is imported or invoked.

## TDD evidence

RED: `node --test scripts/neon/validate-canonical-neon-baseline.test.mjs`
initially failed with `ERR_MODULE_NOT_FOUND` for the absent validator. The
additional boundary tests then failed before their corresponding fail-closed
checks were implemented.

GREEN: the same focused test command reports 13 passed and 0 failed.

The production source command intentionally remains RED until Task 2 supplies
the canonical module inventory:

```
CANONICAL_NEON_MISSING_MODULE: canonical module inventory is incomplete:
010_roles.sql, 020_actor_context.sql, 030_people.sql, 040_organization.sql,
050_position.sql, 060_employee_write.sql, 070_security_postflight.sql
```

Every database-oriented mode intentionally fails closed with
`CANONICAL_NEON_DATABASE_VALIDATION_UNAVAILABLE` pending Task 3. No database
connection was attempted.

## Verification

- `node --test scripts/neon/validate-canonical-neon-baseline.test.mjs` — 13/13
  passed.
- `node --check scripts/neon/validate-canonical-neon-baseline.mjs` — passed.
- `git diff --check` — passed.
- Confirmed `source` reports only the expected missing-module contract and all
  five database modes reject before any connection logic.

## Handoff

Task 2 must create exactly the seven ordered SQL files named by
`neon/canonical/manifest.json` and keep the declared object inventory in sync.
Task 3 is the first authorized database-validation task.
