# Neon People Read-only Directory Design

**Date:** 2026-08-04  
**Phase:** Supabase to Neon business migration — first read-only vertical slice  
**Status:** Approved  

## Goal

Move the People read-only directory to Neon while preserving the existing
application contract and authorization model:

```text
Supabase Auth
  -> verified auth user id
  -> trusted request hostname
  -> Neon property, account, membership, role, and department scope facts
  -> transaction-scoped actor context
  -> Neon RLS
  -> server-only repository
  -> same-origin People API
  -> existing People UI contract
```

The slice covers manager directory reads, manager employee detail refresh,
manager directory facets, and the department-scoped directory. It does not
cover employee writes, import commit, training facts, or complex workflows.

## Non-negotiable boundaries

- Supabase Auth remains the identity proof provider.
- Supabase Storage remains unchanged.
- Browsers never connect to Neon and never receive `DATABASE_URL`.
- The `pg` Pool is reachable only from server-only modules.
- Property, role, and department scope are never accepted from browser input as
  authorization evidence and are never stored in long-lived JWT claims.
- Neon authorization is derived from current database facts on every request.
- Actor context is local to one database transaction. Session-persistent `SET`
  is forbidden.
- The application connection role is neither a table owner nor a role with
  `BYPASSRLS`.
- Existing tests are not edited or deleted. The 201-test baseline remains the
  acceptance baseline.
- Existing Property Context, Admin Accounts, and Import Inspect route contracts
  remain out of scope unless a minimal client/server-boundary correction is
  required to prevent People from importing `pg` into a browser bundle.
- No Production connection or migration is permitted. Database verification
  uses an explicitly confirmed isolated non-Production Neon branch.

## Current-state defects this slice must close

1. `APP_DATA_MODE=neon` labels People as Neon, but the registry silently builds
   the mock employee repository. The UI then labels those records as real.
2. The client-reachable registry references an incomplete Pool-based Neon
   property repository. Adding Pool imports there would place a server database
   dependency in the browser graph.
3. The current Neon Pool has no transaction-scoped actor context and no runtime
   role assertion.
4. Existing People authorization SQL depends on Supabase `auth.uid()` and the
   `authenticated` role. Neon needs an explicit compatibility layer without
   simulating browser JWT authorization claims.
5. Manager facets still depend on organization repositories; a Neon People
   slice must not substitute mock departments or positions.

## Chosen architecture

### 1. Browser boundary

The browser registry constructs an HTTP employee repository when People uses
Neon. It never imports a Pool, a Neon SQL repository, or a server configuration
module.

The existing `EmployeeRepository` and service methods remain stable. The HTTP
adapter preserves:

- `listEmployeesPage(propertyId, options)`
- `listDepartmentEmployees(options)`
- `getEmployee(id)`
- the complete repository shape required by existing foundation consumers

The `propertyId` argument remains a UI/service consistency precondition but is
not transmitted as authority. Department requests transmit only search and
pagination values.

Manager facets use a People-specific HTTP read boundary backed by Neon. They
are not inferred from one employee page and do not fall back to mock data.

### 2. API boundary

Same-origin, no-store endpoints provide the new data path:

- manager directory
- manager employee detail
- manager directory facets
- department-scoped directory

Every endpoint:

1. validates the Supabase Auth access token server-side;
2. refreshes the Auth cookies when the existing refresh flow succeeds;
3. resolves the trusted hostname with the existing request-hostname rules;
4. creates a request id from a valid inbound correlation id or a new UUID;
5. enters `withNeonActorContext()`;
6. invokes a server-only Neon People repository;
7. returns `Cache-Control: no-store, private` and the request id.

The API accepts only filter, employee-id, and pagination inputs. It does not
accept actor id, property id, role, tenant id, or department scope.

### 3. Actor context

`withNeonActorContext()` checks out exactly one Pool client and performs:

1. `BEGIN`;
2. resolve the active property from the trusted hostname inside that
   transaction;
3. use parameterized `set_config(..., true)` calls for auth user id, property
   id, and request id;
4. verify the connection role is the approved runtime role and is not
   superuser, `BYPASSRLS`, or an application-table owner;
5. execute the supplied callback through the checked-out client;
6. `COMMIT`, or `ROLLBACK` on every error;
7. release the client in `finally`.

The callback receives a narrow query interface, not the Pool. No query may be
issued through `pool.query()` between context setup and the authorized read.

The database context functions are:

- `app_private.current_actor_auth_user_id()`
- `app_private.current_actor_property_id()`
- `app_private.current_actor_request_id()`
- `app_private.assert_actor_context()`

They read only the transaction-local application settings. The design does not
simulate `request.jwt.claim.sub` and does not change Supabase's `auth.uid()`.

### 4. Live authorization and RLS

Neon-only authorization helpers use the context functions to derive current
facts from:

- `user_accounts`
- `profiles`
- `tenants` and `properties`
- `tenant_memberships` and `property_memberships`
- `role_assignments` and `roles`
- `trainer_scopes`
- `departments` and `department_closure`

The manager path requires the database role code `property_ld_manager`.

The department path requires the database role code
`department_training_admin`, then evaluates exact scope or descendants through
`department_closure`. The UI role name
`department_training_responsible` remains an application presentation mapping
and is not written into Neon authorization facts.

`employees` remains `ENABLE ROW LEVEL SECURITY` plus
`FORCE ROW LEVEL SECURITY`. The People SELECT policy requires the current
property and either:

- an active property L&D manager authorization; or
- an active department authorization covering the employee department.

No People INSERT, UPDATE, or DELETE grants or policies are introduced.

Directory database functions are narrow, parameterized read functions. The
manager function returns the existing full `EmployeeRecord` projection. The
department function preserves its reduced projection and never returns employee
UUID, tenant/property identifiers, grade/band, external identifiers, or row
version.

### 5. Database roles

The role bootstrap defines three distinct responsibilities:

- migration owner: owns schemas/functions/tables and applies reviewed DDL; it
  is not a runtime credential and has `NOBYPASSRLS`;
- application role: login/runtime role with `NOBYPASSRLS`, no create-role,
  create-database, replication, or object ownership privileges; it receives
  only the grants needed for the People read boundary;
- readonly role: non-owner and `NOBYPASSRLS`; it receives no broad raw-table
  visibility and must use an explicitly authorized read path.

Runtime startup/transaction checks fail closed when the connected role is
superuser, has `BYPASSRLS`, owns an application table, or is not the configured
application role.

### 6. Audit evidence

The transaction context carries the request id into Neon. Each successful
People read records append-only access evidence containing:

- request id;
- verified auth user id;
- resolved property id;
- operation name;
- result-row count;
- timestamp.

Search text and employee names are not written to the audit record. The
application role cannot update or delete audit evidence.

Denied requests retain the same request id in the server response/log path;
they must not expose authorization internals to the browser.

## API and UI contract

The manager directory preserves all current filters, server pagination,
employee-number ordering, exact total count, and ISO `refreshedAt`.

Manager employee detail is selected by employee id under RLS and the resolved
property. A missing or cross-property employee returns not found.

The department directory accepts only query, limit, and offset. Its row mapping
continues to use:

- synthetic `department:<employee-number>` id;
- empty tenant/property ids;
- null grade/band;
- empty external-identifier types;
- version zero.

The existing People and Department People pages remain consumers of the same
service-level objects. Database failures never fall back to mock records or
fabricated zero counts.

## Error behavior

- `400`: invalid filter, enum, employee id, or pagination input.
- `401`: missing, expired, or unverifiable Supabase identity.
- `403`: no active Neon account/membership/role/scope for the resolved property.
- `404`: employee absent or outside the authorized row set.
- `503`: Neon unavailable or actor context/runtime role invalid.

Responses are generic and do not reveal whether a different property contains
the requested record.

## Verification gates

Before applying any DDL, a read-only probe must confirm the target is an
isolated non-Production Neon branch. Connection strings and credentials are
never printed.

The non-Production verification must prove:

- unauthenticated/no-context queries return no employee rows or fail closed;
- wrong property context returns no rows;
- an unauthorized or inactive role cannot read;
- department exact/descendant scope works and unrelated departments are hidden;
- the application role reports `rolsuper=false` and `rolbypassrls=false`;
- the application role owns no application relations;
- transaction-local actor settings are absent after commit and rollback;
- browser build artifacts contain neither `pg` nor `DATABASE_URL` values;
- the unchanged application suite remains 201/201 and the production build
  succeeds.

No verification reads or reports real business row contents; tests use only
aggregate counts or synthetic rows on the isolated branch.

