# E1 Neon Authorization Foundation — implementation record

**Date:** 2026-08-04

**Scope:** Authorization foundation only; no business-data migration

**Result:** Applied and catalog-validated on the isolated development child

## 1. Target and safety boundary

Every database execution used a branch-scoped Neon operation after an immediate
control-plane preflight.

| Boundary | Identifier |
| --- | --- |
| Project | `flat-brook-43278549` |
| Development branch | `br-aged-river-az1gke14` |
| Development endpoint | `ep-sparkling-shape-az9gxtuh` |
| Database | `neondb` |
| Production branch deny-list | `br-twilight-leaf-azmowo1k` |
| Production endpoint deny-list | `ep-wild-wave-azjmgdif` |

The development branch was proven ready, non-default, and non-primary, and its
endpoint binding matched exactly. Production was not connected. No credential,
connection string, or business row was read or printed.

## 2. Applied migration units

| Order | File | Applied SHA-256 | Outcome |
| --- | --- | --- | --- |
| 1 | `neon/migrations/202608040000_e1_role_bootstrap.sql` | `0e317e74b81a4f99c42e3332f78cc4233295b62954cf00e6645dc83f98638792` | Committed |
| 2 | `neon/migrations/202608040001_e1_actor_context.sql` | `27e75682e629f0b86e06e127bc295b6bb5d130074b8a9657b2b5246cc188a3d1` | Committed |
| 3 | `neon/migrations/202608040002_e1_auth_uid_compatibility.sql` | `e3d22e956e0b718c6917139a03db132d8ed0e552b00ed25955bf8d4e8766797f` | Committed |

The first bootstrap attempt used an earlier checksum and failed while updating
an existing PostgreSQL 18 role-membership edge. Its transaction rolled back
fully: target roles remained absent, schema ACLs and object ownership were
unchanged, and all 17 protected tables retained `ENABLE` plus `FORCE RLS`. The
grant was corrected to request only the required `SET` membership option; the
reviewed checksum above was then applied successfully.

## 3. Database objects and ownership

Created roles:

- `hotel_ld_migration_owner`: `LOGIN`, `NOINHERIT`, `NOBYPASSRLS`, connection
  limit 2, no role/database creation, no replication, password `NULL`.
- `hotel_ld_application`: `LOGIN`, `NOINHERIT`, `NOBYPASSRLS`, connection
  limit 30, no role/database creation, no replication, password `NULL`.
- `hotel_ld_people_read`: `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` permission
  group.
- `hotel_ld_readonly`: dormant `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` group.

Created private functions, all owned by `hotel_ld_migration_owner`,
`SECURITY INVOKER`, `STABLE`, and `search_path=''`:

- `app_private.actor_uuid_setting_or_null(text)`
- `app_private.current_actor_auth_user_id()`
- `app_private.current_actor_property_id()`
- `app_private.current_actor_request_id()`
- `app_private.assert_actor_context()`

Changed compatibility function without replacing its OID:

- `auth.uid()` remains OID `28795`; it is owned by
  `hotel_ld_migration_owner`, is `SECURITY INVOKER`, `STABLE`, and has
  `search_path=''`.

Runtime and permission-group roles own zero objects. Existing business tables
remain under their existing owner; no ownership was handed to the application
role. The application role is a member only of `hotel_ld_people_read`, with
`INHERIT TRUE`, `SET FALSE`, and `ADMIN FALSE`.

The bootstrap owner retains `SET ROLE` capability into
`hotel_ld_migration_owner`. The capability is persistent; only its use is local
to each reviewed migration transaction. It exists for constrained DDL and
rollback, gives no capability to the runtime role, and must not be described or
used as a runtime membership path.

## 4. Actor-context behavior

`app/lib/neon/actor-context.ts` provides the server-side
`withNeonActorContext()` boundary. It:

1. checks out exactly one `PoolClient`;
2. proves the three actor GUCs are clear;
3. opens one transaction;
4. proves `current_user` and `session_user` are exactly
   `hotel_ld_application`, the role remains `NOBYPASSRLS`, and its only
   membership is the non-SET/non-ADMIN `hotel_ld_people_read` edge; it also
   proves neither runtime role owns the database or an application-schema,
   relation, routine, or type;
5. sets the verified auth-user UUID, server-resolved property UUID, and request
   UUID using parameterized `set_config(..., true)` calls;
6. validates the values on the same client;
7. runs the repository callback on that client only;
8. commits or rolls back and proves the GUCs are clear again;
9. discards the connection if role validation, transaction cleanup, or leak
   checking fails.

The wrapper compares the three GUCs directly because the application role has
no `app_private` schema access. It intentionally does not widen that ACL merely
to call `assert_actor_context()`. Future constrained People repository entry
points execute as their `NOBYPASSRLS` definer owner and call the private
assertion inside the database boundary.

Same-backend behavior checks proved all three values are visible inside the
transaction and are `NULL` after both `COMMIT` and `ROLLBACK`. No actor setting
was stored in a role configuration.

## 5. `auth.uid()` compatibility evidence

The bridge reads only `app.actor_auth_user_id`; it does not simulate
`request.jwt.claim.sub` or trust a browser JWT payload.

- Missing context returns `NULL`.
- A valid synthetic UUID returns the same UUID under the constrained migration
  owner path used by future repository definer entry points.
- A malformed value fails closed with SQLSTATE `42501` and the generic message
  `ACTOR_CONTEXT_INVALID`.
- `neondb_owner` receives `NULL` even when a synthetic actor GUC is present.
- `authenticated` and `neondb_owner` retain compatibility `EXECUTE`; PUBLIC,
  application, People-read, and readonly roles cannot execute the function.
- The application role is not a member of `authenticated`.

The function OID remained stable. Its five RLS-policy dependencies and 36
column-default dependencies remained attached, and every inspected default
definition remained `auth.uid()` with zero drift.

## 6. RLS and privilege validation

- All 17 E1 baseline tables remain `ENABLE RLS` and `FORCE RLS`.
- All four E1 roles are `NOBYPASSRLS`; application/permission roles are not
  table owners.
- The application role has no raw privilege on the 17 baseline tables.
- The application role has no `CREATE` on `public`, `auth`, or `app_private`,
  and no `USAGE` on `auth` or `app_private`.
- The application role cannot reach `neon_superuser`, `neondb_owner`,
  `hotel_ld_migration_owner`, or `authenticated` through membership.
- The role and database catalogs contain no persistent
  `app.actor_auth_user_id`, `app.actor_property_id`, or
  `app.actor_request_id` setting.

A disposable behavior probe was run in a transaction that ended with an
explicit `ROLLBACK`. The probe table contained one synthetic row, had both
`ENABLE RLS` and `FORCE RLS`, had no policy, and granted `SELECT` to
`hotel_ld_application`. As the application role, the query succeeded but
returned a visible row count of zero, proving RLS—not missing table privilege—
blocked the row. A fresh catalog session then proved the temporary membership
option, table, row, and grant were gone; the original membership options and all
17 baseline RLS states were unchanged.

## 7. Runtime activation boundary

E1 intentionally did not provision role passwords, create connection strings,
or update `DATABASE_URL`. Existing repositories therefore remain on their
current configured paths. Before runtime activation, secrets management must
provision a child-only `hotel_ld_application` credential and independently
verify its branch, endpoint, database, and role. The bootstrap and migration
owner credentials are forbidden at runtime. The wrapper also revalidates the
actual role on every checked-out client and fails closed if the connection is
an owner, a role-changing owner session, a `BYPASSRLS` role, or has unexpected
memberships or application-object ownership.

## 8. Rollback boundary

The actor-context and compatibility migration files document their
object-specific semantic rollback. Role teardown is a separately reviewed,
child-bootstrap procedure. Important rules:

- never disable RLS as a rollback technique;
- revoke application/permission-group entry-point grants before removing
  objects;
- remove the actor functions in reverse dependency order;
- restore `auth.uid()` semantically in place and never drop it, because five
  policies and 36 defaults depend on its OID;
- restore exact ownership/ACL only through a separately reviewed bootstrap
  operation;
- restore only schema ACLs that the recorded preflight proves existed; never
  introduce a broad PUBLIC grant as a shortcut;
- revoke the exact application-to-People membership and bootstrap-to-migration
  membership only after their dependent grants are gone;
- drop `hotel_ld_application`, `hotel_ld_readonly`,
  `hotel_ld_people_read`, and finally `hotel_ld_migration_owner` only after
  catalog checks prove each role owns no object and has no remaining
  memberships or grants.

Rollback is child-only and requires separate authorization; it was not run
after successful E1 validation.

## 9. Code and regression verification

- The focused strict TypeScript check for `actor-context.ts` and `server.ts`
  passed.
- An injected-pool behavior check proved the authorized path commits and
  releases normally, while a failed role assertion rolls back and calls
  `release(error)` without entering the callback.
- The exact runtime-role assertion SQL was executed in the child bootstrap
  session and returned `authorized=false`, proving an owner connection is
  rejected. Separate catalog checks proved the intended application role
  satisfies the constrained attributes/membership/zero-ownership conditions;
  no direct-login credential was provisioned or used.
- `npm test`: 201 tests passed, 0 failed; its rendered-HTML test also passed.
- A separate `npm run build` completed successfully.

## 10. Exit decision

The authorization foundation is ready for the next reviewed slice: People
read-only. That slice must add exact server repository entry points, real-time
property membership/role/department authorization, RLS policies, and only the
minimum grants to `hotel_ld_people_read`. People writes, import commit, and
training facts remain out of scope.
