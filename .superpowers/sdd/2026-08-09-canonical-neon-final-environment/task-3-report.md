# Task 3 report — Independent Neon PG18 validation environment

Date: 2026-08-09

## Authorized targets

- Initial staging: project `hotel-ld-os-neon-final-staging`
  (`jolly-dawn-48919555`), branch `main` (`br-empty-star-axdyyv60`), endpoint
  `ep-winter-resonance-ax340i3r`.
- Fresh-empty final replay: project `hotel-ld-os-neon-final-replay`
  (`wild-tree-31942896`), branch `main` (`br-frosty-forest-awu4aprl`), endpoint
  `ep-hidden-meadow-aweq2rfx`.
- Both targets use database `neondb`, bootstrap role `neondb_owner`, and the
  PostgreSQL 18 major-version gate.

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

On the replay target, the connector's describe operation created
`public.show_db_tree()`. The empty-baseline gate rejected that undeclared helper
exactly as designed. The helper was then deleted precisely, after which the
baseline again contained zero user objects. It contained no business data.
No deny-listed project, branch, or endpoint was connected to.

## Fresh-empty replay acceptance

The final replay project was created independently with an empty `main` branch;
it did not inherit the earlier staging state. Initial read-only identity and
emptiness evidence proved PostgreSQL 18, database owner `neondb_owner`, zero
user tables, and zero `auth`, `storage`, and `app_private` schemas/objects.

The complete final-source chain then produced these results:

The repeatability result reported `dryRuns=2`, `identical=true`,
`applied=true`, and runtime credential provisioning success.

| Replay gate | Verdict |
|---|---|
| `source` | PASS |
| `dry-run` | PASS; outer transaction rolled back and empty state was reproved |
| `repeatability` rollback 1 | PASS |
| `repeatability` rollback 2 | PASS; identical to rollback 1 |
| Atomic apply | PASS |
| Runtime credential provisioning | PASS; parameterized and not persisted |
| Catalog after apply | PASS; exact inventory and zero rows |
| Final pooled runtime | PASS; 10/10 matrix fields |
| Runtime cleanup | PASS; `finalRowsZero=true` |
| Final catalog | PASS; `rowsEmpty=true` |

The first replay runtime reached strict exact-signature smoke and failed closed
with `42501:NEON_PEOPLE_DEPARTMENT_REQUIRED`: the department-directory probe
was incorrectly using the manager actor. Cleanup still completed and catalog
row counts remained zero. Commit `915bc03` changed only exact-signature actor
routing so that the department-directory probe uses the seeded department
trainer while the other 26 signatures retain the manager actor. It did not add
any permission-error allowlist. The rerun passed all ten runtime matrix fields,
proved `finalRowsZero=true`, and the final catalog again proved
`rowsEmpty=true`.

## Final replay dry-run verdict

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

## Final replay apply and catalog verdict

Replay `repeatability` completed two identical full rollback dry-runs from the empty
state, proved both restored zero objects/roles/rows, then applied the canonical
bundle atomically. The runtime role credential was provisioned through a
parameterized owner transaction and was not returned by the validator. No valid
credential was persisted in Git or this report.

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

## Final replay pooled runtime matrix

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

The earlier staging results document the initial applied revision and runtime
behavior. The review-hardened final source subsequently completed the same
workflow from a newly created empty replay project and is now accepted by the
fresh-environment gate.

## Completed fresh-empty final-source workflow

The accepted replay executed this exact sequence on a newly created,
independently targeted PG18 branch whose preflight proved zero user tables and
zero `auth`, `storage`, and `app_private` surface:

1. Run `source` locally and verify the ordered seven modules plus complete
   manifest/security descriptor contract.
2. Run `dry-run`; require exact identity, successful final routine-body
   recompilation, complete catalog descriptor equality, rollback, and a second
   empty-state proof.
3. Run `repeatability`; require two identical rollback installs, then the single
   authorized atomic apply and parameterized runtime-password provisioning.
4. Run `catalog` using the direct owner connection and retain neither owner nor
   runtime credential in files, logs, or Git.
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

Final connection-free verdicts were 105/105 Task 3 tests, 201/201 application tests,
1/1 rendered-HTML test, a successful source gate, a successful production
build, and a clean diff check.

The final replay validator command shape was the following, with exact
authorized metadata shown and credentials supplied only through redacted stdin:

```text
NEON_PROJECT_NAME=hotel-ld-os-neon-final-replay \
NEON_PROJECT_ID=wild-tree-31942896 \
NEON_BRANCH_NAME=main \
NEON_BRANCH_ID=br-frosty-forest-awu4aprl \
NEON_ENDPOINT_ID=ep-hidden-meadow-aweq2rfx \
PGDATABASE=neondb \
NEON_BOOTSTRAP_ROLE=neondb_owner \
NEON_POSTGRES_MAJOR=18 \
node --experimental-strip-types scripts/neon/validate-canonical-neon-baseline.mjs <mode> --credentials-stdin
```

On replay, `dry-run`, `repeatability`/apply, `catalog`, corrected `runtime`, and
final `catalog` completed in that order. The first runtime attempt failed closed
at exact-signature actor routing and still completed zero-row cleanup; the
post-`915bc03` rerun passed. The earlier process-creation rejection,
credential-rotation incident, and transactional refresh of two corrected People
directory bodies belong to the initial staging history; none altered the fresh
replay baseline outside its validated source bundle.

## Final state

The independent replay database contains exactly 2 schemas, 6 enum types, 31
tables, 83 routines, 27 public entrypoints, 31 policies, 15 triggers, and 31
ENABLE + FORCE RLS tables. The final internal catalog assertion after runtime
cleanup passed with application and audit row counts both zero. The earlier
staging owner and runtime passwords were rotated after the temporary-output
incident; the exposed old credential is invalid. No valid credential or live
URL was written to Git or this report. No deny-listed project, branch, endpoint,
database, or host was connected to or modified.
