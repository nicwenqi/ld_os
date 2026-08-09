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

## Review round 1 evidence

RED: after adding the review mutations, `node --test
scripts/neon/validate-canonical-neon-baseline.test.mjs` reported 12 passing
and 15 failing tests. The failures demonstrated that the prior validator
accepted default PUBLIC EXECUTE exposure, a `BYPASSRLS` role alteration,
application ownership, `set_config(..., false)`, commented-out RLS/path
directives, undeclared schemas and entrypoint drift, raw schema-wide grants,
unqualified seed DML, and an Import view.

GREEN: the focused command now reports 28/28 passed. The validator now:

- requires an explicit PUBLIC execution revocation for every manifest routine
  (or a safe default-privilege revocation);
- validates runtime `NOINHERIT`/`NOBYPASSRLS`, rejects application ownership,
  direct raw grants, and schema-wide raw grants;
- requires all three Actor Context GUCs to use `set_config(..., true)`;
- strips SQL comments before executable security checks;
- validates exact non-default schema inventory, entrypoint-to-routine
  relationships, and exact application execution grants;
- rejects legacy Import views and qualified or unqualified top-level business
  DML.

Fresh verification: `node --check
scripts/neon/validate-canonical-neon-baseline.mjs` and `git diff --check`
passed. `source` continues to return only the expected missing-module
contract, and `runtime` remains fail-closed without attempting a connection.

## Review round 2 evidence

RED: after adding the second review set, the focused test command reported 27
passing and 9 failing assertions. The failures covered a wrong-owner default
PUBLIC revoke, later `INHERIT` and `SUPERUSER` role alterations, schema
authorization, schema-wide multi-privilege grants, nested comments retaining a
commented FORCE RLS directive, and an execute grant changed to the wrong
overload.

GREEN: `node --test scripts/neon/validate-canonical-neon-baseline.test.mjs`
now reports 36/36 passed. The validator additionally requires a pre-creation
default-function revoke scoped to `hotel_ld_migration_owner` when per-routine
revokes are absent; rejects later `INHERIT`, SUPERUSER/CREATEDB/CREATEROLE/
REPLICATION, and schema authorization/ownership for the runtime role; handles
nested PostgreSQL block comments; rejects schema-wide multi-privilege grants;
and compares granted public entrypoint signatures exactly against the manifest.

Fresh `node --check` and `git diff --check` passed. No database connection was
attempted.
