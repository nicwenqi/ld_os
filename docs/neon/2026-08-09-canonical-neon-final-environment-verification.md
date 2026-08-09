# Canonical Neon final environment — Task 4 verification

Date: 2026-08-09

## Scope

This record covers connection-free finalization of the canonical E1–E5A
baseline: application contract inventory, browser boundary leakage checks,
operational documentation, repository regression tests, and production build.
Task 4 made no database or network connection. Live PostgreSQL 18 validation
is recorded separately in the Task 3 report and must be rerun against the exact
final reviewed source before environment acceptance.

## TDD evidence

The new final-artifacts contract suite was first run before its validator
existed and failed 0/5 with the expected missing-validator cause. The minimal
implementation then passed 5/5. The tests prove observable fail-closed
behavior for:

- repository-interface growth not represented in the manifest;
- undeclared HTTP methods on a manifest route;
- a browser import graph reaching `pg`;
- a database URL/credential appearing in the compiled client bundle.

## Application boundary inventory

`neon/canonical/manifest.json` now pins the application surface for the three
canonical business domains.

| Evidence | Count |
|---|---:|
| Domains | 3 |
| Repository interfaces | 5 |
| Repository methods | 31 |
| Same-origin API routes | 21 |
| Browser-reachable source files inspected | 87 |
| Built client files inspected | 54 |

The validator compares repository methods and exported route HTTP methods as
exact sets. A new method or route verb requires an intentional manifest
change. Browser adapters remain same-origin; property, tenant, role, and Actor
Context authority remain server-derived.

## Browser security verdict

The source import-graph and fresh `dist/client` scan passed:

- no `DATABASE_URL` or bootstrap/runtime database credential marker;
- no PostgreSQL connection URI or private key;
- no `pg`, `pg-pool`, `pg-protocol`, node-postgres, or Neon database client
  bundle;
- no client path from the HTTP repository boundary to the server database
  pool.

The negative fixture contains a deliberately fake `example.test` URI solely
to prove the scanner rejects it. It is not application configuration or a
credential.

## Final connection-free results

| Command | Verdict |
|---|---|
| `npm test` | PASS — 201/201, embedded build PASS, rendered HTML 1/1 |
| `npm run build` | PASS |
| canonical source validator tests | PASS — 56/56 |
| canonical bootstrap/runtime contract tests | PASS — 26/26 |
| canonical database-validator unit tests | PASS — 21/21 |
| Task 4 final-artifacts tests | PASS — 5/5 |
| canonical `source` mode | PASS — 7 ordered modules |
| final-artifacts CLI | PASS — exact inventory above |
| `git diff --check` | PASS |

The source gate reports 83 routines, 31 tables, 10 policy names, 15 triggers,
and 6 enum types. Full policy/trigger security descriptors remain pinned by
the Task 3 hardening; Task 4 adds application contracts without changing those
descriptors.

## Install, rollback, and rebuild

The operational procedure is documented in
[`canonical-neon-bootstrap-operations.md`](canonical-neon-bootstrap-operations.md).
The decisive constraints are:

- install only into a new empty PostgreSQL 18 environment;
- run full source/dry-run/repeatability/apply/catalog/runtime gates;
- let any pre-commit failure roll back the outer transaction;
- do not ship a down migration, reset script, compatibility bridge, or data
  deletion migration;
- after a successful staging install, rebuild by replacing the independently
  authorized staging environment and replaying from empty;
- use the owner only for bootstrap and keep the pooled
  `hotel_ld_application` credential server-only in a secret manager.

## Acceptance boundary

This Task 4 result proves the repository/build/browser side of the final
baseline. It does not substitute for the fresh-empty live gate. Final
environment acceptance requires the exact final Git source to complete:

```text
source → dry-run → repeatability/apply → catalog → runtime
```

with final business/audit row counts at zero and no post-apply hand patching.
