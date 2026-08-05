# Neon Organization Activation Completion Design

## Status and objective

E3 has migrated Department read, Department write, hierarchy move and closure,
Department aliases, and Operational Units behind server-only Neon boundaries.
The browser registry still selects the Supabase Organization repository.

Activation Completion closes the two remaining methods in the existing
`DepartmentRepository.approveMapping()` contract and rehearses replacing the
Supabase repository in a non-production environment. It adds no new
Organization domain capability.

The only added alias completion behavior is:

- `merge`, which resolves a Department alias to an existing Department with
  resolution type `merged`;
- `operational_unit`, which atomically converts an active Department alias into
  an Operational Unit alias.
- `department` resolutions `created_top_level` and `created_child`, which use a
  separate entrypoint to create the Department and resolve the alias in one
  database transaction.

Position, Import, Employee writes, Actor Context, Supabase Auth, Supabase
Storage, and the Neon runtime-role topology are out of scope.

## Invariants

- The migration and runtime validation may target only Neon child branch
  `br-aged-river-az1gke14`, endpoint `ep-sparkling-shape-az9gxtuh`.
- Production branch `br-twilight-leaf-azmowo1k` and endpoint
  `ep-wild-wave-azjmgdif` remain denied.
- Bootstrap uses `NEON_BOOTSTRAP_DATABASE_URL`; runtime uses pooled
  `DATABASE_URL` as `hotel_ld_application`.
- `hotel_ld_application` remains `NOBYPASSRLS`, owns no runtime objects, and
  receives no raw business-table privileges.
- Browser code never imports `pg`, reads `DATABASE_URL`, or connects to Neon.
- Existing Phase 4A actions `department`, `ignore`, and `defer` keep their
  existing function, payload, authorization, and audit semantics.
- There is no dual write and no read-through fallback. One Organization
  repository is selected for a browser session.

## Alias completion database boundary

A forward-only child migration adds three constrained entrypoints. It does not
rewrite the Phase 4A migration or broaden the existing resolver.

### Created Department resolution entrypoint

`public.create_neon_organization_department_from_alias(text, uuid, text, uuid,
text, text, text, text, integer)` accepts the trusted hostname, alias ID,
resolution type, parent ID, node type, code, Chinese and English names, and sort
order. It accepts only `created_top_level` or `created_child`.

The entrypoint locks the current-property alias, validates that top-level
creation has no parent and child creation has an active same-property parent,
then calls the existing constrained
`public.create_neon_organization_department(...)` entrypoint. It does not copy
Department insertion, hierarchy initialization, closure, or Department audit
logic. The nested entrypoint creates the Department row, depth, path, closure
rows, and Department audit event in the same transaction. The outer entrypoint
then resolves the alias to the new Department, appends alias activation audit,
and returns the authoritative alias payload.

The browser sends a Department creation draft without tenant, property, actor,
or role values. Tenant/property derive from the locked alias. Failure in any
creation, hierarchy, alias, or audit step rolls back the complete operation.

### Merge entrypoint

`public.merge_neon_organization_department_alias(text, uuid, uuid)` accepts the
trusted hostname, alias ID, and target Department ID.

The function:

1. asserts the Neon runtime session and transaction-scoped Actor Context;
2. verifies the trusted hostname against the actor property;
3. requires an active `property_ld_manager` account;
4. locks and rereads the alias inside the current property;
5. locks and validates an active target Department in the same tenant/property;
6. updates only the alias target, `merged` resolution, approval fields, and
   active state;
7. appends an activation-completion audit event;
8. returns the authoritative Department alias payload.

The operation does not merge, move, deactivate, or delete Department rows.

### Operational Unit resolution entrypoint

`public.resolve_neon_organization_department_alias_to_operational_unit(text,
uuid, uuid)` accepts the trusted hostname, alias ID, and target Operational Unit
ID.

The function:

1. repeats the runtime, Actor Context, hostname, property, and manager checks;
2. locks and rereads the alias inside the current property;
3. locks and validates an active Operational Unit in the same tenant/property;
4. inserts the corresponding Operational Unit alias using the Department
   alias's source identity;
5. deactivates the Department alias without changing its historical source
   identity;
6. appends an activation-completion audit event;
7. returns an alias-shaped payload containing the resolved Operational Unit ID.

The unique source constraint on Operational Unit aliases remains authoritative.
A duplicate or conflicting resolution returns a stable conflict and rolls back
the alias update, Operational Unit alias insert, and audit insert together.

### Ownership, RLS, and grants

All three entrypoints are owned by `hotel_ld_migration_owner`, use
`SECURITY DEFINER`, and set `search_path = ''`. `PUBLIC EXECUTE` is revoked and
only exact `EXECUTE` is granted to `hotel_ld_application`.

The migration owner receives only the column grants required by these two
entrypoints. Target-table policies require `session_user =
'hotel_ld_application'`, the current actor property, and the existing manager
authorization helper. No policy is granted directly to the application role.

The migration adds an append-only, forced-RLS
`app_private.organization_alias_activation_audit_events` relation for
`merge`, `operational_unit`, `created_top_level`, and `created_child`. Phase 4A
audit rows and constraints remain unchanged. Audit rows contain request ID,
auth user ID, actor account ID, tenant/property, alias ID, action, target
Department or Operational Unit ID, and timestamp. They contain no
browser-supplied identity or hostname.

## Server repository and API

`createNeonDepartmentAliasRepository()` keeps its current code path for
`department`, `ignore`, and `defer`. It dispatches `merge` and
`operational_unit` to the new exact entrypoints. A `department` action with
`created_top_level` or `created_child` plus a creation draft dispatches to the
separate atomic entrypoint; ordinary Department mapping remains on Phase 4A.

The existing alias resolution API route expands its allowlist as follows:

- `merge` accepts only `action` and `targetDepartmentId`;
- `operational_unit` accepts only `action` and `operationalUnitId`;
- created Department resolutions accept only `action`, `resolutionType`, and a
  Department creation draft without tenant/property fields;
- `department`, `ignore`, and `defer` keep the Phase 4A request shapes.

All identity, hostname, property, and role decisions remain in the server
authorization runner and the database entrypoint. Browser-provided property,
tenant, role, or actor fields are rejected.

## Complete HTTP DepartmentRepository

A browser-safe HTTP repository implements every existing
`DepartmentRepository` method using same-origin, no-store requests:

- Department tree, detail, ancestors, and descendants;
- Department create, update, active-state update, move preview, and move commit;
- Department alias read and all five approved resolution actions;
- Operational Unit read, create, and update.

Property and tenant arguments in the browser contract are compatibility-only;
they are never sent as authorization inputs. The API resolves property scope
from the authenticated request and hostname.

The adapter converts non-success responses into stable business errors and
does not import server-only Neon modules.

## Rehearsal activation and fallback

Environment parsing adds an explicit Organization repository mode with values
`supabase` and `neon`; the default is `supabase`.

Selecting `neon` is valid only when:

- `APP_DATA_MODE=neon`; and
- `APP_ENV` is `local` or `preview`; and
- the deployment is not Vercel Production.

Any production attempt fails environment validation before the application
starts. The repository registry selects the HTTP Department repository only
when all rehearsal conditions pass. Property, People, Position, Import, and
Initialization repository selection is otherwise unchanged.

Fallback is an explicit mode switch from `neon` to `supabase`, followed by a
fresh build/deployment or local restart. The same UI contract is then served by
the existing Supabase Department repository. No database rollback, data copy,
or source-code revert is required.

## Validation

### Source and catalog validation

- new functions have the exact owner, `SECURITY DEFINER`, empty search path,
  revoked `PUBLIC EXECUTE`, and exact application-role grants;
- the application role remains non-owner, `NOBYPASSRLS`, and has zero raw
  privileges on Department aliases, Operational Unit aliases, Operational
  Units, Departments, and audit relations;
- all participating tables retain enabled and forced RLS;
- migration guards reject Production branch/endpoint connection strings.

### Runtime matrix

- unauthenticated and expired sessions are rejected; refreshed sessions work;
- property manager can run `merge` and `operational_unit` for the current
  property;
- Department administrator can read aliases but cannot resolve them;
- cross-property, inactive target, missing target, invalid action, and invalid
  payload requests are rejected without partial writes;
- duplicate resolution and concurrent resolution serialize or return conflict;
- audit rows are correct and append-only;
- transaction rollback removes the actor context and connection reuse does not
  leak actors.

### Activation rehearsal

1. Start the local/preview application with Neon Organization mode and the
   pooled child runtime credential.
2. Exercise `/organization` read/create/update/move and Operational Unit flows.
3. Exercise `/initialize` Department alias actions: department, ignore, defer,
   merge, and operational-unit resolution.
4. Verify request error states, refresh behavior, and page reloads.
5. Switch Organization repository mode to Supabase and restart/redeploy.
6. Repeat representative Department read/write, alias read/resolution, and
   Operational Unit read paths to prove fallback recovery.
7. Run `npm test` with 201 passing tests and `npm run build` successfully.

## Rollback

Before migration acceptance, the migration validator performs a transactional
dry run and rolls back. After applying to the child branch, application
rollback means selecting the Supabase Organization repository. The new
entrypoints and audit relation may remain dark because they expose no raw table
access and are unreachable from the Supabase repository.

If schema rollback is explicitly required on the child branch, revoke the
three application-role execute grants, drop the three public entrypoints, drop
their private policies/helpers and the activation audit relation, and revoke
the newly added migration-owner column grants. Phase 4A objects and records are
not changed.
