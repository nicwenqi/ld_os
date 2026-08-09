# Task 2 report — Canonical E1–E5A bootstrap modules

## Status

Complete and connection-free. The seven ordered canonical SQL modules now form
the E1–E5A baseline declared by `neon/canonical/manifest.json`; no database or
network connection was made.

## TDD evidence

The new focused suite was written before the canonical modules and actor guard
change. Its first valid RED run was:

```text
node --experimental-strip-types --test scripts/neon/canonical-neon-bootstrap-contract.test.mjs
0 pass / 4 fail
```

The failures named the intended missing behavior:

- `CANONICAL_NEON_MISSING_MODULE` for all seven manifest modules;
- all ten final append-only audit tables missing from the manifest;
- the repository/bootstrap signature inventory not yet closed;
- legacy actor-context dependency on the hard-coded `neondb` database and old
  compatibility roles/schemas.

The final focused suite is 6/6 GREEN. In addition to the baseline/audit/signature
contracts, it now exercises transaction-local Actor Context set/commit/clear,
rollback cleanup, release behavior, and reuse of the checked client without a
real connection.

## Implementation

- `010_roles.sql` creates exactly the two application roles, gives only the
  bootstrap `session_user` SET-only membership in the NOLOGIN migration owner,
  establishes the two application schemas, and hardens default routine ACLs.
- `020_actor_context.sql` creates the five provider-neutral readers/assertion
  routines for the three approved transaction-local GUCs.
- `030_people.sql` creates the closed People/authorization authority graph, the
  People audit capability, authorization helpers, and the five exact People
  repository entrypoints. `is_new_employee` is derived in response payloads and
  is not persisted.
- `040_organization.sql` creates departments, closure/path state, aliases,
  operational units, all Organization audit capabilities, hierarchy triggers,
  and the fourteen exact Organization entrypoints. Alias evidence is
  self-contained and has no Import dependency.
- `050_position.sql` creates families, positions, department assignments,
  self-contained source aliases, Position audit capabilities, and the seven
  exact Position entrypoints. Source impact is explicitly unavailable because
  legacy Import source rows are excluded.
- `060_employee_write.sql` creates employees and external identifiers, uses
  `employees.version` as the authoritative optimistic version, preserves
  atomic identifier replacement/conflict rollback, adds before/after snapshots
  and append-only audit, and exposes the exact employee save signature.
- `070_security_postflight.sql` applies ENABLE + FORCE RLS to all 31 canonical
  tables, creates the exact property/actor/audit policy surface, and removes all
  raw runtime table, sequence, private-schema, and schema-CREATE privileges.

All 27 public entrypoints are owned through `SET LOCAL ROLE
hotel_ld_migration_owner`, are SECURITY DEFINER with `search_path = ''`, revoke
PUBLIC, and grant only their exact signatures to `hotel_ld_application`.

The application Actor Context guard now checks the exact runtime/session role,
NOINHERIT/NOBYPASSRLS and other non-admin attributes, zero memberships, zero
owned application/database/schema objects, and no membership in
`neon_superuser`, `neondb_owner`, or the migration owner. It no longer assumes
the database name, `auth`, `authenticated`, or `hotel_ld_people_read`.

The source validator's legacy-object exclusion was narrowed so declared
canonical append-only audit objects are allowed while Import, provenance,
history, compatibility, bridge, reset, and seed/test objects remain rejected.
Undeclared audit objects still fail closed through manifest inventory drift.

## Verification

Fresh final runs:

```text
node scripts/neon/validate-canonical-neon-baseline.mjs source
GREEN — 7 modules; 31 tables; 82 routines; 10 policy names; 14 triggers; 6 types

node --test scripts/neon/validate-canonical-neon-baseline.test.mjs
56/56 pass

node --experimental-strip-types --test scripts/neon/canonical-neon-bootstrap-contract.test.mjs
6/6 pass

npm test
201/201 primary tests pass; embedded build passes; rendered HTML 1/1 passes

npm run build
exit 0; all five vinext build phases pass

git diff --check
exit 0

connection-free SQL lexical/framing/exclusion checks
7/7 modules pass
```

Static counts also confirm 27 public function definitions, 27 exact runtime
grants, and 31 FORCE RLS statements. Existing dated migrations, existing tests,
packages, UI, Import routes, Auth/Storage code, and E5B were not changed.

## Task 3 concern

Task 2 deliberately did not connect to PostgreSQL. The source validator and
lexical checks prove inventory, signatures, ownership directives, RLS/ACL
surface, exclusions, and balanced module framing, but they do not execute the
PostgreSQL 18 grammar or PL/pgSQL bodies. Task 3 must make the first empty-cluster
dry run/apply authoritative, with special attention to PostgreSQL 18 role
membership-option syntax, `LIKE ... INCLUDING ALL` audit identities, trigger
behavior, FORCE RLS policy interaction, hierarchy moves, and atomic employee
identifier conflicts. No known source-level blocker remains.

## Review fix round 1/5 — scope and authority hardening

The first review identified seven connection-free gaps. Contract mutations were
added before the fixes; the aggregate RED run was 6/13 pass with one intended
failure for each review category. A further focused RED mutation (0/1 pass)
caught a pre-Actor-Context tenant-policy dependency in property resolution.

The minimal canonical SQL corrections now:

- enforce composite tenant/property foreign keys for authorization,
  organization, position, employee, alias, identifier, and hierarchy links;
- restore the historical E5A property advisory lock, stable related-row locks,
  target activity/scope checks, position-family derivation, assignment checks,
  active-target requirement, identifier count/shape/conflict checks, and atomic
  scoped identifier replacement;
- rebuild descendant department names/IDs/depth and authoritative closure after
  rename or move, including moves to a nullable root;
- reject operational-unit self/descendant cycles and rebuild descendant paths
  and depth after parent changes;
- calculate move-preview impact from the same authoritative closure subtree
  used by commit;
- require active same-scope alias targets and mutually coherent actions, derive
  the family for a mapped position, and require nonblank external code/name;
- scope tenants, profiles, tenant/property memberships, and property-null roles
  to the current actor tenant without recursive policy dependencies; the public
  property resolvers no longer read the actor-scoped tenant table before Actor
  Context exists; and
- canonicalize stored hostnames and case-insensitive uniqueness while matching
  normalized request hostnames with ports removed.

Fresh connection-free verification after the review fixes:

```text
node scripts/neon/validate-canonical-neon-baseline.mjs source
GREEN — 7 modules; 31 tables; 82 routines; 10 policy names; 14 triggers; 6 types

node --test scripts/neon/validate-canonical-neon-baseline.test.mjs
56/56 pass

node --experimental-strip-types --test scripts/neon/canonical-neon-bootstrap-contract.test.mjs
13/13 pass

npm test
201/201 primary tests pass; embedded build passes; rendered HTML 1/1 passes

npm run build
exit 0; all five vinext build phases pass

git diff --check
exit 0
```

No database or network connection was made. The remaining Task 3 concern is
runtime-only verification of PostgreSQL grammar, composite-FK creation order,
row-lock behavior, FORCE RLS interactions, and hierarchy/alias/employee
transactions on a disposable empty PostgreSQL 18 cluster.

## Review fix round 2/5 — hierarchy locks and tenant roles

Two focused contract mutations were added before implementation. The targeted
RED run was 0/2: hierarchy creation did not participate in the property lock
and existing update/move paths could lock rows before the advisory lock; role
assignments also forced every role into property scope and had no scope-aware
membership validator.

The hierarchy writers now share one ordering protocol for the actor property:
authorize and validate scalar input, acquire
`lock_neon_organization_hierarchy`, then acquire every required department or
operational-unit row lock in UUID order. Department and operational-unit
creates participate, rename locks its complete descendant set, move locks its
subtree plus proposed parent together, and operational-unit update locks its
target, descendants, and proposed parent together. No direct hierarchy writer
retains a row-lock-before-advisory path.

The authorization model now preserves tenant roles rather than treating all
roles as property roles. Tenant roles require a null property; property and
department roles require an existing same-tenant property. Role assignments
may therefore have a null property, retain a general tenant/user and
tenant/role foreign-key spine, and run an append-free constrained trigger that
locks and validates the role plus the appropriate active tenant or property
membership. Activation is revalidated because assignment status updates also
fire the trigger. Property-facing authorization helpers continue to require
`assignment.property_id = account.property_id`, so tenant assignments never
implicitly authorize a property action. RLS exposes null-property assignments
only for the actor tenant and non-null assignments only for the actor property.

The new helper and trigger are declared in the canonical manifest, bringing
the inventory to 83 routines and 15 triggers. Fresh connection-free checks:

```text
node scripts/neon/validate-canonical-neon-baseline.mjs source
GREEN — 7 modules; 31 tables; 83 routines; 10 policy names; 15 triggers; 6 types

node --test scripts/neon/validate-canonical-neon-baseline.test.mjs
56/56 pass

node --experimental-strip-types --test scripts/neon/canonical-neon-bootstrap-contract.test.mjs
15/15 pass

npm test
201/201 primary tests pass; embedded build passes; rendered HTML 1/1 passes

npm run build
exit 0; all five vinext build phases pass

git diff --check
exit 0
```

No database or network connection was made. Task 3 must runtime-check the
PostgreSQL 18 `UNIQUE NULLS NOT DISTINCT` constraints, trigger/RLS interaction,
and the advisory-plus-ordered-row-lock protocol under concurrent transactions.
