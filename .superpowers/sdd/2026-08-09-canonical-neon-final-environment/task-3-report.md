# Task 3 report — Independent Neon PG18 validation environment

Date: 2026-08-09

## Authorized target

- Project: `hotel-ld-os-neon-final-staging` (`jolly-dawn-48919555`)
- Branch: `main` (`br-empty-star-axdyyv60`)
- Endpoint: `ep-winter-resonance-ax340i3r`
- Database: `neondb`
- Bootstrap role: `neondb_owner`
- PostgreSQL: `18.4` (major-version gate: 18)

No valid live connection string, live host URL, or password is recorded in this
report or in Git. During the first live attempt, a temporary tool output exposed
the then-current owner credential. Both the owner and runtime passwords were
immediately rotated; the exposed value and the other pre-rotation credential
are invalid. No valid secret was persisted to Git or to this report. Subsequent
credentials were passed through one-line JSON stdin with terminal echo disabled.
Target metadata and connection shape were checked
before pool construction. The bootstrap credential was required to use the
direct endpoint and the runtime credential was required to use the pooled
endpoint as `hotel_ld_application`.

## Implementation and TDD evidence

The validator now supports `source`, `dry-run`, `apply`, `catalog`, `runtime`,
and `repeatability`. Connection-safe tests cover the exact target guard,
transaction-frame stripping and rollback proof, fail-closed catalog matrix,
parameter-only password provisioning and non-leakage, two-pass repeatability,
direct/pooled credential separation, pooled-client commit/rollback cleanup,
and raw SELECT/INSERT/UPDATE/DELETE denial probes.

Real PostgreSQL 18 RED/GREEN work found and fixed these canonical module defects:

- Default privileges were changed before assuming the migration-owner role.
  `010_roles.sql` now assumes that role locally first.
- People and Organization routines referenced relations created by later
  modules. Only those modules now use transaction-local
  `check_function_bodies=off`; two SQL helpers were minimally changed to
  PL/pgSQL so binding is deferred until invocation.
- Catalog comparison needed explicit `name` to `text` normalization and
  identity-argument types without parameter names.
- Catalog and row-count checks now reset the module-local role inside the same
  outer transaction before asserting runtime-visible security.
- Deferred People directory bodies incorrectly schema-qualified PostgreSQL
  `greatest`/`least` special forms. A seven-module static gate now rejects the
  complete class of non-schema-qualifiable special expression forms, and the
  two installed People directory bodies were refreshed transactionally from
  the corrected source before the final runtime run.

Preparation removed the connector-generated `public.show_db_tree()` helper
from this new staging branch because it was outside the exact manifest. It held
no business data and can be recreated by the connector's branch-description
operation. No deny-listed project, branch, or endpoint was connected to.

## Live dry-run verdict

The final `dry-run` passed all identity, empty-baseline, exact catalog,
ownership, privilege, RLS, definer, append-only audit, exclusion, and zero-row
assertions inside one outer transaction. It then rolled back and proved that no
canonical objects or roles persisted.

| Evidence | Count / verdict |
|---|---:|
| Schemas | 2 |
| Enum types | 6 |
| Tables | 31 |
| Routines | 83 |
| Public entrypoints | 27 |
| Policies | 31 |
| Triggers | 15 |
| ENABLE + FORCE RLS tables | 31 |
| Application rows | 0 |
| Audit rows | 0 |
| Rolled back | PASS |
| Post-rollback empty proof | PASS |

## Live apply and catalog verdict

`repeatability` completed two identical full rollback dry-runs from the empty
state, proved both restored zero objects/roles/rows, then applied the canonical
bundle atomically. The runtime role credential was provisioned through a
parameterized owner transaction. Both the bootstrap-owner and runtime-role
credentials were rotated immediately after the temporary-output incident. The
old values are invalid, and no valid credential was persisted in Git or this
report.

The persistent `catalog` result was exact and empty of business data:

| Evidence | Count / verdict |
|---|---:|
| Schemas | 2 |
| Enum types | 6 |
| Tables | 31 |
| Routines | 83 |
| Public entrypoints | 27 |
| Policies | 31 |
| Triggers | 15 |
| ENABLE + FORCE RLS tables | 31 |
| Application rows | 0 |
| Audit rows | 0 |
| Exact ownership/security/exclusion matrix | PASS |

## Real pooled runtime matrix

The final runtime run used the rotated pooled `hotel_ld_application`
credential and the actual actor-context helpers. The direct bootstrap
connection was used only for synthetic seed creation and FK-safe cleanup.

| Runtime evidence | Verdict |
|---|---|
| Actor context, commit/rollback cleanup, connection reuse | PASS |
| Resolved actor context | PASS |
| Manager People/Organization/Position reads | PASS |
| Department-admin descendant scope and cross-department denial | PASS |
| Cross-property and unknown-property denial | PASS |
| Rollback-only Department/Position/Employee writes | PASS |
| Stale version, identifier conflict, atomic rollback | PASS |
| Raw SELECT/INSERT/UPDATE/DELETE and `app_private` denial | PASS |
| Concurrent actor isolation | PASS |
| FK-safe seed and audit cleanup | PASS |
| All 27 manifest entrypoint signatures invoked | PASS |
| Final application rows | 0 |
| Final audit rows | 0 |
| `finalRowsZero` | PASS |

## Mode matrix

| Mode | Verdict | Notes |
|---|---|---|
| `source` | PASS | Exact ordered seven-module manifest and security checks. |
| `dry-run` | PASS | Live PG18 execution, exact catalog matrix, rollback, and empty proof. |
| `repeatability` | PASS | Two identical rollback installs, then canonical apply/catalog. |
| `apply` | PASS | Atomic modules, pre-commit catalog, parameterized runtime credential. |
| `catalog` | PASS | Exact persistent objects/security and zero business/audit rows. |
| `runtime` | PASS | All real pooled runtime matrix fields passed; final rows zero. |

## Connection-free review hardening

After the live matrix above, a connection-free review round tightened the final
source further. It did not connect to or modify Neon:

- The manifest now freezes all 31 policy descriptors, including command, roles,
  permissive/restrictive mode, `USING`, and `WITH CHECK`. Source descriptors use
  token-preserving canonicalization that ignores only lexical formatting while
  retaining boolean grouping, casts, operators, string values, and quoted
  identifier case. Separate catalog descriptors freeze the exact PostgreSQL 18
  `pg_get_expr` output, including server-added casts and parentheses. Source and
  catalog validation independently derive their complete inventories and fail
  closed on drift.
- All 15 trigger descriptors now freeze enabled state, timing, events, update
  columns, level, and exact trigger-function identity. Append-only audit checks
  require an enabled `BEFORE UPDATE OR DELETE FOR EACH ROW` trigger and the
  declared `app_private` rejection function.
- Entrypoint smoke now rethrows by default. Only an exact manifest signature plus
  exact SQLSTATE/message pair may classify a documented business rejection;
  SQLSTATE classes `42`, `3F`, and `XX`, `42501`, and permission-denied messages
  always fail. Scoped fixtures make every declared signature invokable without
  relying on permission errors.
- `070_security_postflight.sql` restores `check_function_bodies=on` and recreates
  every canonical `public`/`app_private` routine from `pg_get_functiondef` after
  the complete dependency graph exists. The earlier `off` setting remains local
  only to forward-reference modules.
- The PostgreSQL special-form gate now covers validator SQL as well as all seven
  modules. The first read-only descriptor-mapping query was rejected with 42883
  because its ad-hoc text schema-qualified `coalesce`; the corrected unqualified
  query returned exactly 31 catalog descriptors and performed no write.

The earlier live results therefore document the applied staging revision and
runtime behavior, while the review-hardened final source must complete the fresh
empty-environment workflow below before final environment acceptance.

## Required fresh-empty final-source workflow

Run this exact sequence on a newly created, independently targeted PG18 branch
whose preflight proves zero provider/public routines, canonical roles, schemas,
objects, application rows, and audit rows:

1. Run `source` locally and verify the ordered seven modules plus complete
   manifest/security descriptor contract.
2. Run `dry-run`; require exact identity, successful final routine-body
   recompilation, complete catalog descriptor equality, rollback, and a second
   empty-state proof.
3. Run `repeatability`; require two identical rollback installs, then the single
   authorized atomic apply and parameterized runtime-password provisioning.
4. Rotate owner and runtime credentials, retain neither in files/logs/Git, then
   run `catalog` using the direct owner connection.
5. Run `runtime` using the rotated pooled `hotel_ld_application` credential and
   the distinct direct owner credential for seed/cleanup only. Require every
   matrix field PASS, all 27 exact signatures invoked, and final application and
   audit row counts of zero.
6. Reject acceptance on any target mismatch, descriptor mismatch, `42*`, `3F*`,
   `XX*`, permission error, cleanup failure, or non-zero final row count.

Do not use `SET ROLE` on the pooled runtime connection and do not reuse any
credential from the prior staging run.

The validated runtime implementation uses the real
`withNeonActorContext` and `withNeonResolvedActorContext` helpers. It includes
all 27 manifest entrypoint signatures, manager and descendant-scoped admin
reads, cross-scope denials, rollback-only Department/Position/Employee writes,
stale and identifier conflicts, raw-access denials, pooled-client reuse,
commit/rollback context cleanup, concurrent actor isolation, FK-safe seed
cleanup, and a final zero-row catalog assertion. Runtime-pool queries never use
`SET ROLE`; the direct bootstrap connection uses a local migration-owner role
only while installing or managing synthetic seed policies.

## Exact commands and credential handling

The connection-free commands were:

```text
node --experimental-strip-types scripts/neon/validate-canonical-neon-baseline.mjs source
node --test scripts/neon/validate-canonical-neon-baseline.test.mjs
node --experimental-strip-types --test scripts/neon/canonical-neon-bootstrap-contract.test.mjs
node --test scripts/neon/validate-canonical-neon-database.test.mjs
npm test
npm run build
git diff --check
```

Final connection-free verdicts were 100/100 Task 3 tests (56 source-validator
tests plus 44 database/bootstrap contract tests), 201/201 application tests,
1/1 rendered-HTML test, a successful source gate, a successful production
build, and a clean diff check.

The live validator command shape was the following, with the exact authorized
metadata shown and credentials supplied only through redacted stdin:

```text
NEON_PROJECT_NAME=hotel-ld-os-neon-final-staging \
NEON_PROJECT_ID=jolly-dawn-48919555 \
NEON_BRANCH_NAME=main \
NEON_BRANCH_ID=br-empty-star-axdyyv60 \
NEON_ENDPOINT_ID=ep-winter-resonance-ax340i3r \
PGDATABASE=neondb \
NEON_BOOTSTRAP_ROLE=neondb_owner \
NEON_POSTGRES_MAJOR=18 \
node --experimental-strip-types scripts/neon/validate-canonical-neon-baseline.mjs <mode> --credentials-stdin
```

`dry-run`, `repeatability`, `catalog`, and `runtime` were executed successfully
in that order. An earlier `repeatability` launch was rejected before process
creation; it made no connection or write and was not bypassed. The later
authorized parent execution performed the persistent staging apply. After the
deferred-body PG18 defect was reproduced, only the two corrected People
directory function bodies were transactionally replaced before the final
catalog/runtime run.

## Final state

The independent staging database contains exactly the persistent canonical
manifest and no business or audit data. The final internal catalog assertion
after runtime cleanup passed with application and audit row counts both zero.
The staging owner and runtime passwords were rotated after the temporary-output
incident. The exposed old credential is invalid, and no valid credential was
written to Git or this report. No deny-listed project,
branch, endpoint, database, or host was connected to or modified.
