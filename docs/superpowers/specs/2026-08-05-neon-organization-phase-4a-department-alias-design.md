# Neon Organization Phase 4A: Department Alias design

## Status and scope

Phase 4A migrates only the Department Alias read and resolution boundary to
the existing Neon child branch. It keeps Supabase Auth, Actor Context,
`hotel_ld_application`, the Organization Supabase registry fallback, and the
existing `DepartmentRepository.approveMapping()` contract.

It does not migrate operational-unit actions, Operational Units, Position,
Import, Employee writes, registry selection, or any production configuration.

## Authorization model

Every endpoint starts with server-side Supabase Auth and the trusted hostname
resolver. `withNeonResolvedActorContext()` then installs auth user, resolved
property, and request ID as transaction-local settings on the existing pooled
`hotel_ld_application` connection.

Alias read is available to an active property LD manager or an active
department training administrator with an active Department scope. Unlike the
Department tree, aliases are returned property-wide for an authorized
department administrator. This is intentional: an unresolved alias cannot be
reliably assigned to a Department scope, and hiding it would make the approved
read-only configuration view incomplete. It does not grant mutation authority.

Alias resolution is property-manager-only. The database repeats actor,
hostname, property, active-account, and manager-role checks. Browser input is
never used as identity, property, role, or Department-scope evidence.

## Public database entry points

The migration creates exactly two public `SECURITY DEFINER` functions, both
owned by `hotel_ld_migration_owner`, with `search_path=''`, PUBLIC EXECUTE
revoked, and EXECUTE granted only to `hotel_ld_application`:

- `public.read_neon_organization_department_aliases(text)` returns the current
  property's allowed alias payload.
- `public.resolve_neon_organization_department_alias(text,uuid,text,uuid)`
  resolves one alias with action `department`, `ignore`, or `defer` and returns
  its authoritative payload.

The resolver accepts a nullable target UUID. It accepts only these states:

| Action | Target Department | Stored resolution |
| --- | --- | --- |
| `department` | required; current property and active | `mapped` |
| `ignore` | must be null | `ignored` |
| `defer` | must be null | `deferred` |

`operational_unit`, `merge`, direct resolution-type input, mismatched target
arguments, cross-property IDs, inactive targets, and unknown actions are
rejected with a stable 422 domain error. Phase 4A does not create a Department;
therefore `created_top_level` and `created_child` are not accepted values.

## RLS, grants, and private helpers

`hotel_ld_application` receives no raw `department_aliases` privileges and no
new role, membership, ownership, or bypass-RLS capability. The constrained
function owner receives only the required Department Alias select/update
columns, target Department select columns, and private audit insert privilege.
All involved public and private tables remain ENABLE/FORCE RLS.

The migration adds private invoker-security helpers for the alias-reader and
manager-only resolver predicates, and adds matching migration-owner SELECT and
UPDATE policies. Their predicates require `session_user=hotel_ld_application`,
current actor property equality, live account/role resolution, and the relevant
manager or reader rule. The public functions also assert the same facts before
reading or writing.

## Atomic resolution and audit

The resolver first obtains the alias in the current property with `FOR UPDATE`.
For a Department mapping it locks and rechecks the target Department in that
same property, requiring `is_active=true`. It updates target, resolution,
approval identity/time, and active state in the same transaction, then inserts
one append-only audit record. Any error—including target validation, RLS,
constraint, or audit failure—aborts the entire transaction and leaves the
alias unchanged.

Phase 4A introduces a private append-only alias-resolution audit relation. It
records request ID, auth user, resolved actor account, tenant/property, alias
ID, previous/result resolution state, previous/result target ID, and action;
it stores no source value. UPDATE/DELETE is rejected by a private trigger.

## Server boundary and contracts

A new server-only Neon alias repository implements the existing narrow
`Pick<DepartmentRepository, "listAliases" | "approveMapping">` contract. It
uses parameterized calls only, rejects unsupported operational-unit inputs
before the database call, and strictly validates returned payloads.

Dark same-origin routes are:

- `GET /api/organization/departments/aliases`
- `POST /api/organization/departments/aliases/:id/resolution`

The read route uses the reader boundary; the resolution route uses the
manager-write boundary. Their inputs are allow-listed: a resolution request has
only `action` and (for `department`) `targetDepartmentId`. Responses preserve
the existing 400/401/403/404/409/422/503 mapping. No UI or registry switch is
made in Phase 4A.

## Verification plan

TDD begins with scratch-only contract tests: absent Neon functions/routes fail,
unsupported action is rejected, and repository calls are parameterized. The
migration is run once in a child-only rollback transaction before application.
Post-apply checks prove function owner/path/ACLs, RLS policies, no raw runtime
table privileges, no actor-context call, and direct raw read/write denial.

Where normal development identities exist, the runtime matrix verifies manager
read/resolve success, department-admin property-wide read with resolution
denial, cross-property rejection, inactive target rejection, rollback
atomicity, and append-only audit correctness. If no matching development
identity exists, those positive identity cases are documented as deferred and
are not simulated with owner credentials, `SET ROLE`, or fabricated claims.
