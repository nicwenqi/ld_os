# E1-A Neon People Authorization Migration Review Package

> Historical pre-execution review artifact. E1 Authorization Foundation was
> subsequently authorized, applied, and validated only on child branch
> `br-aged-river-az1gke14`. See
> [`2026-08-04-e1-implementation-record.md`](./2026-08-04-e1-implementation-record.md)
> for the exact applied checksums and execution evidence. The STOP statements
> below describe this package's earlier approval state and are retained for
> audit history; they are not the current implementation status.

> **DRAFT ONLY — ZERO SQL OR DATABASE CHANGES — AWAITING HUMAN APPROVAL**
>
> This package is review material, not execution authorization. No SQL has
> been executed, no database has been connected, and no role, schema, policy,
> function, RLS setting, or Production resource has been changed by E1-A.

**Package date:** 2026-08-04

**Package classification:** E1-A actor/role and catalog-discovery review
package; incomplete and non-executable

**Draft execution units:**

- `neon/migrations/202608040000_e1_role_bootstrap.sql`
- `neon/migrations/202608040001_people_readonly_authorization.sql`

**Future child target (must be re-proved):** project
`flat-brook-43278549`, branch `br-aged-river-az1gke14`, endpoint
`ep-sparkling-shape-az9gxtuh`

**Production deny-list:** branch `br-twilight-leaf-azmowo1k`, endpoint
`ep-wild-wave-azjmgdif`

Any Production match, target ambiguity, catalog drift, missing baseline, or
unreviewed change to this package is a hard stop. This document contains no
connection URL, credential, user identifier, employee row, or business data.

## 1. Scope and disposition

E1-A prepares the actor/role contract and the catalog-discovery plan for the
first read-only People slice. It covers role topology, transaction-local actor
readers, ownership rules, a proposed forced-RLS compatibility model,
function-only People contracts, append-only access-evidence requirements,
rollback, and validation. It is not the completed People authorization
migration.

It does not authorize or implement application routing, browser repositories,
employee writes, import commit, training facts, Production deployment, or a
runtime credential switch. Supabase Auth remains the identity proof provider;
Supabase Storage is unchanged.

Each SQL draft is a separate execution unit and carries its own deliberate STOP
gate. The bootstrap draft is intended for a child bootstrap connection; the
main draft is intended for a later, separately authenticated direct connection
as `hotel_ld_migration_owner`. They cannot be one transaction: the bootstrap
unit must commit before a new connection can authenticate as the role it
created. The files must not be concatenated, partially resumed, or assigned one
combined checksum.

Current review approval can authorize at most the child-only, read-only catalog
evidence request in Section 11.1. It cannot authorize role creation, ownership
transfer, schema/function/policy changes, or any other DDL. Execution remains
blocked until the exact catalog gates in Section 7 are closed; all reserved
policy, helper, resolver, audit, and directory definitions are completed; each
unit receives a new checksum and independent review; and a human separately
approves each exact execution unit under Section 11.2.

## 2. Selected authorization model

```text
server-verified Supabase Auth UUID
  + trusted request hostname
  + request UUID
  -> one checked-out Neon connection and one transaction
  -> trusted hostname resolves one active property
  -> transaction-local app.actor_* settings
  -> live Neon account, membership, role, and department-scope facts
  -> FORCE RLS under a constrained NOBYPASSRLS function owner
  -> hardened SECURITY DEFINER People entry point
  -> reduced or manager projection + append-only audit evidence
  -> commit/rollback, context leakage check, connection release
```

The design does not emulate `auth.uid()`, `request.jwt.claim.sub`, or a
long-lived authorization JWT. The browser cannot supply actor, tenant,
property, role, or department scope as authority.

The selected database boundary is a narrow `SECURITY DEFINER` API owned by
`hotel_ld_migration_owner`, not raw-table access by the runtime login. The
owner is explicitly `NOSUPERUSER NOBYPASSRLS`; every in-scope table remains
`ENABLE ROW LEVEL SECURITY` plus `FORCE ROW LEVEL SECURITY`. Minimal,
context-aware policies targeted to the function's effective role provide only
the fact rows needed to prove the current actor's authorization. `USING
(true)`, owner bypass, `BYPASSRLS`, superuser, and broad runtime table grants
are prohibited.

This model is selected but not yet executable: exact policies depend on the
child catalog and ownership snapshot. The draft correctly leaves those DDL
definitions behind a STOP gate instead of fabricating catalog facts.

## 3. Object inventory and dependency order

| Order | Object or responsibility | Draft state | Dependencies / gate |
| ---: | --- | --- | --- |
| 0 | External child identity and baseline snapshot | Not SQL; required | Control-plane match and Production deny-list; catalog names only, no rows |
| 1 | Bootstrap draft execution unit | STOP-gated role/ownership plan | Separate child bootstrap connection, checksum, transaction, review, and approval |
| 2 | `hotel_ld_migration_owner` | Role draft | Role-name absence; no `neon_superuser` membership; direct child credential provisioned outside Git |
| 3 | `hotel_ld_people_read` | `NOLOGIN` permission-group draft | Role-name absence |
| 4 | `hotel_ld_application` | Runtime login draft | Role-name absence; member of People-read group with inheritance but no `SET ROLE` capability |
| 5 | `hotel_ld_readonly` | `NOLOGIN` draft | Stays non-login until a separately approved operational use exists |
| 6 | Exact in-scope ownership handoff | Intentionally absent | Current owners and dependent objects must be catalog-proven and individually enumerated in bootstrap unit |
| 7 | Main authorization draft execution unit | STOP-gated contract/templates | New direct connection as constrained migration owner; independent checksum/review/approval |
| 8 | Default privileges for actual creating role | Drafted | Migration-owner schema authority and exact creating role must be proven |
| 9 | `app_private.actor_uuid_setting_or_null(text)` | Drafted private parser | `app_private` ownership and ACL inventory |
| 10 | `app_private.current_actor_auth_user_id()` | Drafted | Transaction-local `app.actor_auth_user_id` |
| 11 | `app_private.current_actor_property_id()` | Drafted | Transaction-local `app.actor_property_id` |
| 12 | `app_private.current_actor_request_id()` | Drafted | Transaction-local `app.actor_request_id` |
| 13 | `app_private.assert_actor_context()` | Drafted | All three reader functions |
| 14 | Narrow hostname/property resolver | Signature reserved only | Actual `property_domains`/property schema, table owners, policy definitions, normalized-host behavior |
| 15 | Context-aware authorization-fact policies/helpers | Model and order reserved only | Exact child columns, table owners, constraints, policy role/command/permissiveness/predicates, RLS flags |
| 16 | People-read audit relation and immutable controls | Contract reserved only | Retention/owner/dependency evidence; sequence identity if used |
| 17 | Manager directory/detail/facets entry points | Signatures reserved only | Exact projection dependencies and forced-RLS path |
| 18 | Department directory entry point | Signature reserved only | Active assignment/scope/closure path and reduced projection |
| 19 | `employees` People SELECT policy | Semantics reserved only | Complete pre-E1 policy snapshot and exact replacement decision |
| 20 | Exact revokes then exact grants | Partial draft | Completed function signatures and child ACL snapshot |
| 21 | Post-apply catalog assertions | Checklist reserved only | Final exact object set and approved revision |

The identity join is fixed even while the catalog is being verified:

```text
actor auth UUID = user_accounts.auth_user_id
membership / assignment UUID = that account row's user_id
```

No database constraint currently proves `user_accounts.user_id =
user_accounts.auth_user_id`, so authorization must never assume that equality.
Every query also requires exact equality between the queried property and
`current_actor_property_id()`.

## 4. Actor-context contract

### Database readers

| Function | Contract | Security properties |
| --- | --- | --- |
| `app_private.current_actor_auth_user_id()` | Reads only `app.actor_auth_user_id`; returns UUID; missing, blank, or malformed input raises a generic authorization error | `STABLE`, `SECURITY INVOKER`, empty fixed `search_path`, no `PUBLIC` execute |
| `app_private.current_actor_property_id()` | Reads only `app.actor_property_id`; same fail-closed behavior | Same |
| `app_private.current_actor_request_id()` | Reads only `app.actor_request_id`; request id is audit/correlation metadata and never authorization | Same |
| `app_private.assert_actor_context()` | Evaluates all three readers before a protected operation and returns no caller-supplied actor facts | Same |

The SQL draft's private parser accepts only the three allow-listed setting
names. The public readers raise for absence or malformed UUIDs. No actor
setting can be established by these functions; the future server wrapper alone
sets them after trusted verification.

### Future `withNeonActorContext()` sequence

The later server implementation must use exactly one checked-out client:

1. Before `BEGIN`, confirm all three actor settings are absent on the pooled
   session. A pre-existing session-level value is contamination and closes the
   connection path; it is not overwritten and reused.
2. `BEGIN` without `READ ONLY`, because a successful People read must append an
   audit event.
3. Resolve the normalized trusted hostname to one active property inside this
   transaction, before setting actor property context.
4. Call parameterized `set_config(name, value, true)` for verified Auth UUID,
   resolved property UUID, and request UUID. Session `SET`, `ALTER ROLE SET`,
   and `set_config(..., false)` are prohibited.
5. Assert `current_user` is exactly the configured application login and is
   not superuser, `BYPASSRLS`, an owner of application objects, or directly or
   transitively a member of `neon_superuser`/an owner role.
6. Invoke only the callback on the same client. Do not use `pool.query()` and
   do not change role.
7. `COMMIT` on success or `ROLLBACK` on every error.
8. Confirm all actor settings are absent on that same client after both commit
   and rollback. Any leakage quarantines the connection and fails the request.
9. Release the client in `finally`.

### Pre-context property resolution

The planned boundary is a hardened, narrow `SECURITY DEFINER` resolver with
the reserved signature `public.resolve_neon_property_context(text)`. It will:

- normalize only the server-derived hostname according to the existing trusted
  hostname rules;
- return one active property context only when an active domain/property match
  exists;
- reveal no directory or arbitrary property listing;
- return a generic not-recognized result/error without disclosing which
  property or domain exists;
- use a fixed empty `search_path`, constrained `NOBYPASSRLS` owner, exact
  signature revoke from `PUBLIC`, and the smallest execute grant needed by the
  runtime boundary.

Its precise SQL is blocked because the child `property_domains` schema,
constraints, table owner, RLS flags, policy definitions, and the legacy
resolver definition have not been catalog-proven. The existing Supabase
resolver must not be reused implicitly.

## 5. Roles, ownership, grants, and revokes

### Role matrix

| Role | Login / inheritance | May own | Intended use | Must never have |
| --- | --- | --- | --- | --- |
| Child bootstrap owner | Existing privileged principal; exact identity catalog-gated | Bootstrap-only existing objects | One approved role-creation and exact ownership-handoff phase | Runtime or routine migration configuration |
| `hotel_ld_migration_owner` | `LOGIN NOINHERIT` | Only reviewed E1 objects and explicitly handed-off in-scope dependencies | Direct child migration connection; never runtime | superuser, `BYPASSRLS`, role/database creation, replication, `neon_superuser` membership, runtime group membership |
| `hotel_ld_people_read` | `NOLOGIN NOINHERIT` | Nothing | Permission bundle: exact People function execute and schema usage only | Table access, object creation, ownership, owner membership |
| `hotel_ld_application` | `LOGIN NOINHERIT`; receives inherited People-read membership with no `SET ROLE` or admin option | Nothing | Server-only pooled runtime; `current_user` stays this exact login | Raw business/auth/audit table access, writes, schema create, owner/bootstrap membership |
| `hotel_ld_readonly` | `NOLOGIN NOINHERIT` in E1-A | Nothing | Reserved separately scoped diagnostics role; no operational login yet | Raw employee/auth/audit visibility, audit mutation, runtime owner membership |

All four proposed roles explicitly declare `NOSUPERUSER NOBYPASSRLS
NOCREATEDB NOCREATEROLE NOREPLICATION`. Credentials are provisioned outside
Git. `hotel_ld_readonly` becomes a login only through a separate approved
operational change.

### Ownership strategy

The bootstrap owner is a temporary exception only because a constrained new
owner cannot alter tables it does not own. Before any handoff, capture exact
owners and dependencies for each in-scope relation, sequence, type, schema,
function, and policy. A human-reviewed revision may transfer only individually
enumerated objects required by E1. It must not transfer an entire schema,
invoke `DROP OWNED`, use `CASCADE`, or infer dependencies.

The migration owner may own E1 functions, audit objects, and the specifically
approved pre-existing tables needed to administer their RLS. PostgreSQL
policies have no independent owner: the owning table's owner administers them,
and their security contract is defined by target role, command,
permissive/restrictive mode, `USING`, and `WITH CHECK`. The migration owner
remains `NOBYPASSRLS`, and every owned source/audit table remains forced-RLS.
Ownership is DDL authority, so that credential remains outside application
configuration. Application, People-read, and readonly roles must own zero
schemas, relations, sequences, types, functions, tables, or triggers and must
own no table whose policies they could administer.

### Privilege order

1. Prove role-name absence and create roles with all negative attributes.
2. Grant only `hotel_ld_people_read` membership to
   `hotel_ld_application`, with privilege inheritance enabled and `SET ROLE`
   and admin rights disabled.
3. Revoke `PUBLIC` defaults for functions/tables for the actual creating role,
   per schema. Default privileges do not repair existing ACLs.
4. Revoke existing broad schema/function/table rights from proposed runtime
   roles before targeted grants. Do not alter legacy `anon` or `authenticated`
   grants unless a catalog-proven collision is separately reviewed.
5. After each callable function is created, revoke its exact signature from
   `PUBLIC` and any proven legacy callers; grant exact execute only to
   `hotel_ld_people_read`.
6. Grant the permission group only schema `USAGE` needed to resolve those
   entry points. Do not grant schema `CREATE`.
7. Explicitly revoke all direct source/audit table access and all People writes
   from application, readonly, and permission-group roles. There are no E1
   employee write grants or write policies.
8. Catalog-assert exact ACLs, memberships, object owners, default ACLs, RLS
   flags, and absence of privilege paths before runtime is configured.

No `GRANT ALL`, blanket grant/revoke over cloned schemas, owner runtime path,
or password material is part of this plan.

## 6. RLS compatibility and People contracts

### Compatibility matrix

| Supabase dependency | Neon E1 equivalent | Effective role / RLS path | Status |
| --- | --- | --- | --- |
| `auth.uid()` | `current_actor_auth_user_id()` after server-side Supabase Auth verification | Context reader called by constrained definer path | Actor reader drafted; fact policies gated |
| Supabase `authenticated` policy role | `hotel_ld_application` inheriting function execute from `hotel_ld_people_read` | Runtime has no raw table access; function runs as migration owner | Role draft present; ACL inventory gated |
| Hostname/property resolver | `resolve_neon_property_context(text)` before property GUC | Narrow definer resolver with separate pre-context policy | Signature/model reserved; catalog blocker |
| Account identity | Actor matches `user_accounts.auth_user_id`; joins continue via `account.user_id` | Minimal current-actor/current-property fact policy | Join contract fixed; exact policy gated |
| Tenant/property membership | Active tenant, property, tenant membership, and property membership | Current account/property only | Exact columns/constraints/owners gated |
| Manager authorization | Active role assignment and role code `property_ld_manager` | Current property only | Semantics fixed; helper/policy gated |
| Department authorization | Active `department_training_admin` assignment, active scope, exact or approved descendant closure | Current property; non-null employee department only | Semantics fixed; helper/policy gated |
| Employee visibility | Current property and manager authorization, or covered department scope | `employees` remains enabled/forced RLS; policy targets the constrained definer effective role with exact command/permissiveness/`USING`/`WITH CHECK` semantics | Existing policy baseline and replacement gated |
| People functions | Hardened definer entry points | Exact execute-only boundary; no raw runtime SELECT | Signatures reserved; definitions gated |
| Audit evidence | Same-transaction insert after authorized result is known | Private/definer write; audit relation forced-RLS and append-only | Contract fixed; DDL/retention gated |

### Non-recursive forced-RLS policy order

The final policy revision must expose only current-context facts to the
`hotel_ld_migration_owner` effective role, in dependency order:

1. account row by verified Auth UUID and current property;
2. profile by the visible account's `user_id`;
3. current tenant/property and a separate pre-context resolver path;
4. tenant/property memberships by account `user_id`;
5. role assignments by account `user_id` and current property;
6. roles referenced by visible assignments;
7. trainer scopes referenced by visible assignments;
8. active departments and same-property closure rows needed for exact or
   descendant scope;
9. organization projection facts in the current property;
10. employee rows in current property under manager or department predicate;
11. manager-only external-identifier projection facts;
12. audit insert whose actor/property/request values equal asserted context.

No policy may query itself through a helper or form a cycle through another
policy. Optional private setting readers may be needed inside early policy
predicates so the resolver does not raise before actor property exists; public
context interfaces must still fail closed.

### Callable contracts

The review reserves these entry points:

- `resolve_neon_property_context(text)`;
- `list_neon_manager_employee_directory(text, uuid, uuid, uuid, text,
  boolean, integer, integer)`;
- `get_neon_manager_employee(uuid)`;
- `list_neon_manager_people_facets()`;
- `list_neon_department_employee_directory(text, integer, integer)`.

Inputs are filters, search, employee id, and pagination only. They never carry
actor, tenant, property, role, or department scope. Limits clamp to 1–100,
offsets to at least zero, search remains parameterized, and directory ordering
is `employee_number ASC, id ASC` (the UUID is a deterministic private
tie-breaker and is not added to the department projection).

Manager and department projections remain separate. The manager path returns
the reviewed `EmployeeRecord` fields and exact count. The department path
excludes employee UUID, tenant/property UUIDs, grade/band, external identifier
types, and version; it never exposes employees with a null department. Facets
use official organization facts from the current property, not mock or
page-derived values.

Every successful callable People read is `VOLATILE` because it writes exactly
one audit event in the same transaction. The event contains only request UUID,
verified Auth UUID, property UUID, operation, aggregate result count, and
timestamp. Search/filter text and employee data are excluded. Audit failure
fails the read. Runtime roles cannot insert, update, delete, truncate, or
select raw audit evidence. Immutable/append-only enforcement and retention are
catalog-gated design details that must be approved before execution.

## 7. Exact open catalog and design gates

Each unchecked item blocks removal of the SQL STOP exception and blocks every
database write:

- [ ] Re-prove through control-plane metadata that project, child branch, and
      endpoint match the approved target and do not match either Production
      deny-list identifier.
- [ ] Confirm the direct migration connection's project, branch, endpoint,
      database, and login role without printing the connection URL or
      credential.
- [ ] Capture name-only catalog evidence for every proposed role, its
      attributes and membership graph; prove no proposed role-name collision.
- [ ] Prove the bootstrap owner's exact capabilities and document that it is
      absent from runtime and routine migration configuration.
- [ ] Capture owners and dependency graphs for every in-scope schema,
      relation, sequence, type, function, trigger, and extension; separately
      capture each policy's table, target roles, command,
      permissive/restrictive mode, `USING`, and `WITH CHECK`;
      replace the draft's ownership-handoff placeholder with an exact reviewed
      list.
- [ ] Confirm PostgreSQL/Neon version support for the proposed role-membership
      options and decide a fail-closed equivalent if unsupported.
- [ ] Inventory `app_private` and `public` schema ACLs and default privileges
      for the bootstrap and intended creating roles.
- [ ] Confirm the actual child columns, keys, constraints, indexes, owners,
      RLS flags, policies, and ACLs for every authorization, organization,
      employee, external-identifier, and projection dependency listed in
      Section 3.
- [ ] Specifically resolve the Neon compatibility of source constraints that
      reference Supabase `auth.users`; do not invent an `auth` schema or copy
      an unenforceable foreign key.
- [ ] Confirm that `user_accounts.auth_user_id` is the actor lookup and that
      membership/assignment joins use `user_accounts.user_id`; test the valid
      non-equal identity case or statically prove every join.
- [ ] Capture the exact pre-E1 `employees` table owner, RLS flags, policy
      names, target roles, commands, permissive/restrictive mode, `USING`,
      `WITH CHECK`, and all write policies. Decide whether E1 adds or replaces
      one exact SELECT policy without disturbing writes.
- [ ] Inventory all existing `PUBLIC`, `anon`, `authenticated`, application,
      and readonly schema/table/function privileges that could overlap E1.
- [ ] Prove the hostname normalization, `property_domains` mapping, active
      property/domain semantics, duplicate-host behavior, resolver owner, and
      resolver's pre-context forced-RLS path.
- [ ] Complete and independently review every context-aware authorization-fact
      policy; prove the dependency graph is acyclic and contains no
      `USING (true)` shortcut.
- [ ] Complete and independently review the manager/detail/facet/department
      function definitions, exact return types, projection dependencies,
      deterministic pagination, parameter handling, and exact function ACLs.
- [ ] Define and review the audit table keys/sequence, forced-RLS insert path,
      append-only enforcement, owner, ACLs, retention, and dependency ordering.
- [ ] Replace every reserved post-apply assertion with exact catalog checks
      for the completed object set.
- [ ] Capture the rollback baseline described in Section 8 and attach its
      immutable reference/checksum to the execution record.
- [ ] Re-run static review on the completed exact SQL, record its checksum,
      and obtain a new human approval. Approval of this STOP-gated draft alone
      does not approve the later completed revision.

## 8. Non-destructive rollback procedure

Rollback is a separate reviewed child-only runbook. It never disables RLS,
uses owner/runtime bypass, guesses prior grants, drops through `CASCADE`, uses
`DROP OWNED`, deletes audit evidence, or touches Production.

### Baseline required before apply

Capture catalog-only definitions and checksums for the target identifiers,
roles/memberships, object owners/dependencies, schema/default ACLs, exact
function definitions/ACLs, policy definitions/roles/commands, all in-scope RLS
flags, and E1 object absence/presence. Capture no business rows or credentials.

### Ordered procedure

1. Revalidate the child target and Production deny-list. Feature-gate or remove
   the child application route/credential before database privilege removal;
   never point runtime to an owner.
2. Confirm there are no active child application calls to E1 entry points.
3. Revoke exact E1 function execute and schema usage from the permission group
   and any direct runtime grant. This makes the new boundary fail closed first.
4. Restore only the exact pre-E1 employee policy definitions, grants, RLS flags,
   and ownership recorded in the approved baseline. Keep `ENABLE ROW LEVEL
   SECURITY` and `FORCE ROW LEVEL SECURITY` continuously effective; if the
   baseline is incomplete, stop after revoking E1 access and request review.
5. Remove only E1-created directory entry points, followed by private
   authorization/context helpers after catalog proof that no remaining policy,
   function, trigger, or application code references them. Use explicit,
   non-cascading object statements.
6. Preserve the audit relation and all evidence by default. Removing it from a
   continuing branch requires separate retention approval and dependency
   proof. Discarding the isolated branch may be safer, but also requires human
   approval.
7. Reverse E1-only default privileges only after proving they are not shared by
   a later migration.
8. Revoke role memberships and remove runtime/readonly/group roles only after
   proving they own no objects, have no dependents, and have no active
   sessions. Do not remove the migration owner while it owns any current or
   later object.
9. If ownership was handed off during bootstrap, reverse it only through a
   separately enumerated and reviewed object-by-object procedure. It is never
   an automatic rollback step.
10. Run the complete catalog and authorization validation again and retain the
    rollback result record without row data.

## 9. Validation checklists for later authorized execution

All database checks below are child-only and must use catalog, aggregate, or
synthetic evidence. Never print credentials or real People rows.

### Pre-apply

- [ ] Control-plane project/branch/endpoint match the approved child; any
      Production deny-list match stops the run.
- [ ] Migration uses the direct child credential; runtime remains unconfigured
      or uses a separate pooled non-owner child credential.
- [ ] Exact SQL checksum, catalog baseline checksum, reviewer approval, and
      rollback revision match the execution request.
- [ ] Every gate in Section 7 is closed with attached evidence.
- [ ] Application deploy does not yet depend on E1 functions.

### Post-apply catalog

- [ ] Each independently approved execution unit committed exactly once on the
      child using its approved connection role; no Production resource changed.
- [ ] Every expected object, signature, object/table owner, ACL, policy target
      role/command/permissiveness/predicates, and default ACL equals the
      approved inventory; no additional object exists.
- [ ] All source/audit tables remain RLS-enabled and forced.
- [ ] No employee INSERT/UPDATE/DELETE policy or runtime write grant was added.

### Negative authorization

- [ ] Absent, blank, and malformed actor settings fail closed.
- [ ] Unauthenticated identity and unrecognized hostname fail generically.
- [ ] Wrong property, inactive account/profile/tenant/property, suspended or
      revoked membership, inactive assignment/role/scope/department, and an
      unrelated department return no People rows and reveal no internal fact.
- [ ] Department actors cannot see null-department employees.
- [ ] Cross-property detail is indistinguishable from absent to the API layer.

### Positive scope (synthetic or aggregate only)

- [ ] A current-property manager receives only that property's rows and
      manager projection.
- [ ] A department admin receives exact scope and descendants only when
      `include_descendants` is active; overlapping scopes do not duplicate
      rows.
- [ ] Result counts are exact; limits clamp to 1–100; offsets clamp to zero;
      order is stable by employee number then private UUID tie-breaker.

### Context leakage and application role

- [ ] A fresh pooled session has no actor settings before `BEGIN`.
- [ ] Settings exist only in the callback transaction and are absent on the
      same client after both commit and rollback.
- [ ] No application path uses session `SET`, persistent configuration, or
      runtime `SET ROLE`.
- [ ] `hotel_ld_application` has the approved exact login/current-role identity
      and no direct or inherited path to bootstrap, migration owner,
      `neon_superuser`, superuser, or `BYPASSRLS`.

### Role and ownership

- [ ] Migration, application, readonly, and permission-group attributes match
      the approved matrix; all are `NOSUPERUSER NOBYPASSRLS NOCREATEDB
      NOCREATEROLE NOREPLICATION`.
- [ ] Application, readonly, and permission-group roles own zero application
      schemas, relations, sequences, types, functions, tables, and triggers;
      consequently they administer no table policy.
- [ ] Runtime roles have no schema `CREATE` and no raw source/audit table
      privileges.
- [ ] The bootstrap owner is absent from runtime and routine migration config.

### Function privilege and projection

- [ ] Every definer function has the exact approved owner, explicit
      volatility, fixed empty `search_path`, exact-signature `PUBLIC` revoke,
      and only intended execute grants.
- [ ] `PUBLIC`, legacy `anon`, and legacy `authenticated` cannot execute E1
      entry points unless an exact reviewed reason exists.
- [ ] Callable inputs contain no actor, property, tenant, role, or scope
      authority.
- [ ] Manager projection matches the reviewed `EmployeeRecord`; department
      projection excludes employee/property/tenant UUIDs, grade/band, external
      identifiers, and version.
- [ ] Direct employee and audit DML is denied to application and readonly roles.

### Audit

- [ ] Each successful People operation emits exactly one same-transaction
      audit event with only request UUID, verified Auth UUID, property UUID,
      operation, aggregate row count, and timestamp.
- [ ] Search/filter text and employee data are absent; update/delete/truncate
      is denied; audit insertion failure aborts the read.
- [ ] Rollback testing does not delete existing audit evidence.

### Regression and application boundary

- [ ] `npm test` reports exactly 201 passed and 0 failed; `npm run build`
      succeeds; `git diff --check` is clean; no file in `tests/` or
      `supabase/tests/` changed.
- [ ] Browser source/build contains no `pg`, Pool, or database credential
      material; browser requests provide no authorization authority fields.
- [ ] Supabase Auth refresh, Supabase Storage, Property Context, Admin Accounts,
      and Import Inspect `actorClient.rpc("stage_employee_import")` contracts
      remain unchanged.
- [ ] No failure path substitutes mock People rows or fabricated counts.

### Production deny-list

- [ ] Immediately before every connection and write phase, both branch and
      endpoint are compared with the deny-list.
- [ ] A match, missing value, or ambiguous control-plane result aborts before
      connection/DDL.
- [ ] Execution evidence records only approved identifiers and redacted role/
      database metadata, never credentials or business rows.

## 10. Risk register

| Risk | Level | Required control |
| --- | --- | --- |
| Wrong branch or endpoint | Critical | Control-plane re-verification and deny-list check before connection and again before DDL |
| Function owner cannot read forced-RLS facts, or gains bypass | Critical | Exact context-aware policies for constrained effective role; synthetic negative/positive tests; no owner/runtime bypass |
| Existing owner/policy/catalog differs from local migration history | Critical | Name-only child catalog snapshot and object-by-object handoff; halt on drift |
| Actor property is accepted from browser or leaks across pooled requests | Critical | Trusted resolver, local `set_config(..., true)`, pre/post contamination checks, same-client transaction |
| Wrong identity join assumes equal UUID columns | High | Match actor to `auth_user_id`; join memberships/roles via `account.user_id`; test compatible non-equal case |
| Definer function is publicly executable | High | Secure defaults, exact revokes before exact group grant, ACL assertions |
| Department projection/scope widens | High | Separate reduced type, non-null covered department predicate, exact/descendant and unrelated-scope checks |
| Rollback removes protection or evidence | High | Revoke access first, restore exact baseline, keep forced RLS continuous, preserve audit evidence |
| Successful read lacks audit evidence | High | Same-transaction audit insert; failure aborts response; runtime execute only |
| Search performance is insufficient | Medium | Measure on child before adding any index; no unreviewed broad/trigram index in E1-A |

## 11. Required approval formats

### 11.1 Next permitted approval: child-only catalog discovery

This is the only operation the current package is mature enough to request.
It permits a catalog/control-plane evidence pass, not DDL and not business-row
access:

```text
Authorize E1-A child-only read-only catalog discovery
project: flat-brook-43278549
branch: br-aged-river-az1gke14
endpoint: ep-sparkling-shape-az9gxtuh
connection_mode: direct child connection; explicit READ ONLY transaction
allowed_sources: control-plane metadata, pg_catalog, information_schema
allowed_evidence: database/role metadata, object names, columns, constraints,
  owners, dependencies, ACLs, default ACLs, role memberships, RLS flags,
  policy target roles/commands/permissiveness/USING/WITH CHECK, function
  signatures/attributes/definitions
business_rows: prohibited
ddl_and_mutation: prohibited
role_creation_or_change: prohibited
schema_policy_rls_change: prohibited
production_connection: prohibited
credential_output: prohibited
production_deny_list_confirmed: yes
approval: collect only the named redacted catalog evidence on this child
```

Any needed source outside that list, any row query, or any mutation requires a
new approval. The evidence record must identify the child and login role but
must not contain a connection URL or credential.

### 11.2 Future DDL approvals after completion and re-review

Catalog discovery is followed by completing exact policy, helper, resolver,
audit, directory, ownership-handoff, grant/revoke, and assertion SQL. Both
drafts then need new checksums and independent review. The current files and
current human review cannot be promoted implicitly into execution approval.

Bootstrap and main are two independently authorized execution units. The
bootstrap transaction must finish before a new direct connection is opened as
the constrained migration owner. They must never share one transaction,
session, checksum, or approval.

Future bootstrap approval format:

```text
Authorize E1-A bootstrap execution unit
project: flat-brook-43278549
branch: br-aged-river-az1gke14
endpoint: ep-sparkling-shape-az9gxtuh
file: neon/migrations/202608040000_e1_role_bootstrap.sql
sql_sha256: <approved completed bootstrap-file checksum>
connection_role: <catalog-verified child bootstrap principal>
catalog_baseline_sha256: <approved catalog-only snapshot checksum>
ownership_handoff_revision: <approved exact object-by-object list/checksum>
rollback_revision: <approved non-cascading bootstrap rollback checksum>
validation_revision: <approved bootstrap validation checksum>
production_deny_list_confirmed: yes
approval: execute only this exact bootstrap unit on the named child, then stop
```

After bootstrap commit, credential provisioning, a new direct connection, and
bootstrap validation have independently succeeded, the main unit needs its own
approval:

```text
Authorize E1-A main authorization execution unit
project: flat-brook-43278549
branch: br-aged-river-az1gke14
endpoint: ep-sparkling-shape-az9gxtuh
file: neon/migrations/202608040001_people_readonly_authorization.sql
sql_sha256: <approved completed main-file checksum>
connection_role: hotel_ld_migration_owner
bootstrap_result_sha256: <approved bootstrap result record checksum>
catalog_baseline_sha256: <approved post-bootstrap catalog snapshot checksum>
rollback_revision: <approved non-cascading main rollback checksum>
validation_revision: <approved main validation checksum>
application_role: hotel_ld_application
production_deny_list_confirmed: yes
approval: execute only this exact main unit on the named child, then stop
```

Approval must be renewed if any checksum, target identifier, connection role,
ownership statement, policy/function definition, rollback procedure, or
validation runbook changes. Neither approval includes Production, application
rollout, the other execution unit, or a future migration.

## 12. Current conclusion

The E1-A package is suitable for static architecture/security review only. It
records the selected actor-context, role, ownership, forced-RLS, function,
audit, rollback, and validation design without pretending that unknown child
catalog facts are known.

It is **not ready to execute**. Both SQL drafts are deliberately STOP-gated;
ownership handoff statements, exact context-aware policies, property resolver,
authorization helpers, People functions, audit objects, employee policy, and
post-apply assertions remain blocked on the Section 7 evidence and subsequent
independent review. The next possible authorization is only the Section 11.1
child-only read-only catalog discovery. No DDL is authorized.
