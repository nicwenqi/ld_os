# Canonical Neon bootstrap operations

This runbook applies only to the canonical E1–E5A Neon business-data
baseline in [`neon/canonical`](../../neon/canonical). It is a bootstrap for a
new, empty PostgreSQL 18 database. It is not an upgrade path for an existing
database and it must not be used to carry forward Supabase, Import, Storage,
test-identity, or historical business state.

## Installation boundary

The ordered source of truth is `neon/canonical/manifest.json`. Install every
listed SQL module in manifest order; never select a subset or run a later
module first. The source gate is connection-free:

```sh
node --experimental-strip-types scripts/neon/validate-canonical-neon-baseline.mjs source
```

Before any database mode is allowed, independently confirm all of the
following:

- PostgreSQL major version is 18.
- The target is a new isolated project/database and contains no application
  objects, canonical roles, provider helper routines, or business/audit rows.
- Project, branch, endpoint, database, and bootstrap role exactly match the
  reviewed target metadata in the validator. A different environment requires
  a reviewed target-metadata change; do not bypass the target guard.
- The bootstrap connection is direct and uses only the database owner. The
  runtime connection is pooled and uses only `hotel_ld_application`.
- No bootstrap/runtime URL or password is stored in Git, a command argument,
  shell history, a report, or application configuration intended for the
  browser.

Supply connection material only through the validator's one-object JSON stdin
channel (`--credentials-stdin`) with terminal echo disabled. Environment
variables contain non-secret target identity only. Run the database gates in
this order:

1. `dry-run`: execute the complete bundle in one outer transaction, verify the
   exact catalog and security matrix, roll back, and prove the target is empty.
2. `repeatability`: perform two identical rollback installs from the empty
   state, then atomically apply the exact reviewed bundle and provision the
   runtime credential.
3. `catalog`: verify exact roles, ownership, entrypoints, policy/trigger
   descriptors, RLS/FORCE RLS, ACLs, exclusions, and zero business/audit rows.
4. `runtime`: use the real pooled application credential to verify Actor
   Context cleanup, role/property/department isolation, constrained reads and
   writes, raw-table denial, rollback behavior, connection reuse, concurrency,
   and final zero-row cleanup.

The validator rejects non-empty targets. Canonical installation does not seed
tenants, properties, users, memberships, roles, departments, positions,
employees, aliases, or test data.

## Runtime credential handling

`neondb_owner` is bootstrap-only and must never be copied to `DATABASE_URL`.
The application runtime uses a pooled URL for `hotel_ld_application`, which is
`NOINHERIT NOBYPASSRLS`, owns no business object, and has no raw business-table
privilege. Store the URL only in the server-side secret manager. Never prefix
it with `NEXT_PUBLIC_`, render it into HTML, return it from an API, or include
it in a client bundle.

The validator accepts a generated runtime password only as a parameterized
query value and does not return it. Capture/provision credentials through a
controlled secret channel, then rotate any bootstrap or runtime credential
that was exposed to terminal/tool output. Rotation invalidates the exposed
value; it does not make the original exposure disappear from audit history.

## Failure rollback

`dry-run`, `repeatability` passes, and `apply` install the modules inside one
outer transaction. If source, identity, catalog, ACL, RLS, ownership, or
credential provisioning validation fails before commit, roll back the entire
transaction. Do not keep a partially accepted schema and do not repair it with
ad hoc SQL.

After rollback, rerun the empty-state proof. Investigate the canonical source,
add a failing connection-free contract test, fix the module, and repeat the
full sequence from the empty state.

## Successful-install rebuild

There is deliberately no downward migration and no canonical reset/drop
script. After a successful commit, rebuilding means replacing the independent
non-production environment with a newly created empty PostgreSQL 18
project/database and replaying the reviewed baseline from the beginning.

Do not:

- mutate an accepted baseline in place to simulate a clean install;
- delete rows or drop objects through a reusable migration;
- reset, bridge, or import an old Supabase/Neon environment;
- copy business/test rows into the replacement environment;
- reuse owner credentials as runtime credentials.

Delete or recreate an isolated staging project only through an explicitly
authorized environment-management operation after retaining its redacted
validation evidence. Production, Supabase, historical child branches, and
failed-baseline evidence environments are outside this runbook.

## Release evidence

Retain only non-secret evidence:

- canonical Git commit and ordered module checksums;
- redacted project/branch/endpoint/database/role identifiers;
- `source`, two-pass `dry-run`, `apply`, `catalog`, and `runtime` verdicts;
- exact object/security counts and final zero-row proof;
- `npm test`, `npm run build`, canonical contract tests, and browser-artifact
  leakage validation results.

Never retain a connection string, password, private key, credential stdin
payload, or unredacted environment dump.
