# E2 People read-only — implementation and verification record

**Date:** 2026-08-04

**Scope:** Employee directory and basic profile reads only

**Status:**

- Architecture: **COMPLETE**
- Runtime/RLS: **COMPLETE**
- Production identity acceptance: **DEFERRED**

The migration, child-only application credential, runtime role, RLS boundary,
and actor-context isolation are verified. Production identity acceptance is
intentionally deferred because the project currently has development test
accounts only and will reinitialize its account system before deployment.

## 1. Target and safety boundary

| Boundary | Identifier |
| --- | --- |
| Project | `flat-brook-43278549` |
| Development branch | `br-aged-river-az1gke14` |
| Development endpoint | `ep-sparkling-shape-az9gxtuh` |
| Database | `neondb` |
| Production branch deny-list | `br-twilight-leaf-azmowo1k` |
| Production endpoint deny-list | `ep-wild-wave-azjmgdif` |

The control plane proved the development branch ready, non-default, and
non-primary, with the expected endpoint binding and database. Every database
operation was branch-scoped to that child. Production was not connected or
modified. No connection string, password, or business row was read or printed.

## 2. Applied migration

| File | Applied SHA-256 | Outcome |
| --- | --- | --- |
| `neon/migrations/202608040003_e2_people_readonly.sql` | `bc23eb919c30d2eae98faa7c1f0b05ad6501442890238de4253c3297de1a84f7` | Committed atomically |

The migration contains 69 top-level statements, including its transaction
wrapper. The 67 statements inside that wrapper were submitted as one atomic
transaction after lossless statement-splitting verification.

Two earlier attempts changed no schema:

1. A multi-command prepared-statement call was rejected before execution.
2. The first atomic transaction failed because this child does not contain an
   `anon` role; the whole transaction rolled back. The nonexistent-role ACL
   references were removed while the fail-closed `PUBLIC` revocations and
   negative ACL assertions were retained. The revised checksum above was
   reviewed before the successful transaction.

## 3. Database objects

E2 adds one append-only actor-authorization audit table with a protection
trigger, eleven private authorization helpers, five narrow public entry-point
functions, and seventeen exact People authorization policies.

The public entry points cover:

- trusted-hostname property resolution;
- manager employee directory reads;
- manager employee detail reads;
- manager People filter facets;
- department-scoped employee directory reads.

The authorization helpers derive the actor's active property membership, live
role assignment, department scopes, and department descendants from Neon rows.
They do not use property, role, or scope claims supplied by the browser.

## 4. Ownership, grants, and RLS evidence

Catalog validation after commit proved:

- 5/5 public functions have the reviewed owner, security mode, and fixed search
  path;
- 11/11 private helpers are hardened and have the intended ACL;
- 17/17 exact E2 policies exist and are valid;
- all 17 participating business tables retain both `ENABLE RLS` and
  `FORCE RLS`;
- `hotel_ld_application` and the function-definer migration role are both
  `NOBYPASSRLS`;
- the application role has exactly the intended `hotel_ld_people_read`
  membership and no privileged membership path;
- runtime roles own zero database objects;
- application raw-table read violations: 0;
- employee table or column write grants: 0;
- audit-table runtime grants: 0;
- sensitive external identifier-value exposure grants: 0.

Every E2 policy additionally requires the session identity to be exactly
`hotel_ld_application`. The application role receives function execution only
through the `hotel_ld_people_read` permission group. It is neither an owner nor
a direct business-table reader.

## 5. Server data-access chain

The implemented path is:

1. Supabase Auth verifies the user server-side.
2. The API accepts a trusted request hostname and creates a request UUID.
3. `withNeonResolvedActorContext()` checks out one application-role client and
   opens one `REPEATABLE READ` transaction.
4. The same client validates the runtime role, resolves the hostname to a live
   property, installs transaction-local actor settings, and revalidates them.
5. The Neon People repository calls only the narrow public entry points.
6. Forced RLS evaluates live property membership, role, exact department scope,
   and department descendants.
7. The transaction commits or rolls back; actor settings are checked for leaks
   before the client returns to the pool.
8. The API returns the existing People contract to same-origin browser
   repositories and UI services.

Browser-supplied property IDs remain compatibility inputs only and are never
serialized as authorization evidence. Browser code cannot import the Neon pool,
receive `DATABASE_URL`, or submit actor role/department scope.

## 6. Application files

The E2 boundary consists of:

- server connection and actor transaction code under `app/lib/neon`;
- `app/services/neon-people-authorization.ts` for verified identity and trusted
  hostname orchestration;
- `app/repositories/neon/employee-read-repository.ts` for database calls;
- same-origin repositories under `app/repositories/http`;
- People APIs under `app/api/people`;
- existing People and Department services/pages switched to those HTTP
  repositories only in Neon mode.

Other module repositories remain on their previous paths. Supabase Auth,
Supabase Storage, People writes, import commit, and training facts were not
migrated. The Import inspect actor-client RPC contract was not changed.

## 7. Contract and regression verification

Disposable checks proved:

- the same checked-out client performs role validation, hostname resolution,
  actor-setting installation, repository action, and cleanup;
- the normal order is clear, begin at repeatable-read isolation, validate role,
  resolve property, install and match context, run action, commit, and clear;
- resolver failure rolls back without entering the repository action;
- forged browser property and department scope are not serialized;
- all four repository SQL parameter signatures match their database functions;
- API query allow-lists reject eight invalid input cases with HTTP 400;
- Department UI uses API-returned live scopes and does not fall back to stale
  session scope in Neon mode;
- the client bundle contains no database URL, Neon branch/endpoint identifier,
  PostgreSQL driver, server-only module, actor marker, or SQL function name;
- browser People access is limited to same-origin `/api/people/*` URLs.

The project regression suite remains 201/201, and a separate production build
passes. These existing tests do not substitute for the live application-role
behavior matrix described below.

## 8. Runtime activation and deferred production identity acceptance

The child-only pooled credential is configured for `hotel_ld_application` and
was verified without printing its URL or password. Direct-login checks proved
the expected database and session identity, `NOBYPASSRLS`, non-ownership, the
single constrained permission-group membership, and the absence of privileged
membership paths.

Runtime validation additionally proved:

- all 17 protected source tables retain `ENABLE RLS` and `FORCE RLS`;
- 17/17 direct raw-table reads are denied with SQLSTATE `42501`;
- direct employee insert, update, and delete probes are denied with `42501`;
- application access to private helpers, `auth.uid()`, and the audit table is
  denied;
- transaction commit and rollback both clear actor context;
- 24 sequential actors on one reused connection do not leak context;
- two concurrent actors remain isolated;
- unauthenticated and expired/invalid-session HTTP requests return `401` with
  private, no-store responses;
- the full 201-test regression suite and a separate build pass;
- emitted browser assets contain no Neon credential, endpoint, actor marker,
  SQL entry-point name, or PostgreSQL driver marker.

The current development accounts are not production identities. Manager,
department, and refresh-rotation acceptance using the future production account
set is therefore **DEFERRED**, not failed. It must be repeated after the account
system is reinitialized and before production deployment. Owner credentials or
`SET ROLE` remain forbidden for that future acceptance test.

## 9. Residual risks and rollback boundary

The older Supabase People data path remains because Import and other unmigrated
modules still depend on it. Neon mode routes the People application slice to
the new HTTP/server boundary; this is an intentional staged coexistence, not a
complete Supabase database cutover.

Supabase token-refresh cookies are attached on successful People reads. On
certain database authorization/service failures, a rotated refresh token may
not be persisted in that error response. This is a bounded follow-up risk and
does not widen database authorization.

Rollback is child-only, reverse dependency order, and separately reviewed:
first revoke function execution, then remove public entry points, exact E2
policies, private helpers, and the audit protection objects. Never disable RLS,
grant raw table access, hand ownership to the runtime role, or weaken the actor
session-user guard as a rollback shortcut. E1 actor-context and `auth.uid()`
objects remain in place unless a separate E1 rollback is authorized.
