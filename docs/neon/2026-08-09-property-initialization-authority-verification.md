# Property / Initialization authority — canonical Neon implementation

Date: 2026-08-09

## Scope

This change adds the remaining control-plane authority to the canonical
Neon-first baseline. It covers property context and identity, property
business settings, initialization navigation and steps, completion/readiness,
and the access summary. Import, Supabase Auth, and Supabase Storage remain
outside this module.

The existing Supabase repository and the ordinary application registry remain
the fallback path. The new Neon implementation is exposed through the
explicit server-side runtime domain registry; it does not silently switch a
request to Supabase after a Neon failure.

## Canonical database objects

Migration module: `neon/canonical/080_property_initialization.sql`.

It adds:

- `property_settings` and `property_initialization_steps`, both tenant/property
  scoped and FORCE RLS protected;
- append-only property-read, property-write, and initialization audit tables;
- three audit immutability triggers;
- nine application entrypoints for public hostname context, property read and
  writes, initialization progress/navigation/step/complete, and access summary;
- three enum types for settings and initialization state.

Every entrypoint is `SECURITY DEFINER`, owned by the migration owner, uses an
empty fixed `search_path`, revokes `PUBLIC EXECUTE`, and grants only
`hotel_ld_application`. Runtime connections receive no raw table privileges.
Property authorization is recomputed from the transaction-scoped Actor
Context; browser-provided tenant, property, or role values are never trusted.

## Server boundary

The server adapters are:

- `app/repositories/neon/property-repository.ts`
- `app/repositories/neon/initialization-repository.ts`
- `app/repositories/http/property-repository.ts`
- `app/repositories/http/initialization-repository.ts`
- `app/services/neon-property-authorization.ts`

The API routes authenticate through the existing Supabase Auth verification,
resolve the request hostname on the server, establish a transaction-scoped
Neon Actor Context, and call only the constrained entrypoints. The browser
adapters use same-origin HTTP. Logo upload and cleanup intentionally remain a
Supabase Storage boundary and are not represented as Neon business tables.

## Connection-free verification

| Check | Result |
|---|---|
| Canonical source validator | PASS — 8 ordered modules; 36 tables; 102 routines; 9 types; 18 triggers |
| Property authority validator | PASS — 5 tables; 9 entrypoints; no Import/Auth/Storage objects |
| Bootstrap/source/contract suites | PASS — 32/32 focused assertions |
| Database validator unit suite | PASS — 25/25 |
| Application tests | PASS — 201/201; rendered HTML 1/1 |
| `npm run build` | PASS |
| Final-artifacts inventory | PASS — 4 domains; 7 repositories; 42 methods; 28 routes |
| `git diff --check` | PASS |

No database or network connection was made for this change. The live gate is
still required against a newly empty, non-production PostgreSQL 18 target:

```text
source → dry-run/rollback → repeatability/apply → catalog → runtime matrix
```

The live gate must confirm the new property policies, entrypoint ACLs,
initialization version conflicts, manager-only completion, Actor Context
cleanup/connection reuse, and zero final business/audit rows after cleanup.

## Deliberate exclusions

- no legacy migration-chain replay or compatibility bridge;
- no Import staging/commit/revert objects;
- no Auth or Storage schema;
- no business seed rows or test identities;
- no change to the old Supabase environment or Production.
