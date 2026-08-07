# E5A Employee Write Foundation Design

## Goal

Establish the single Neon mutation boundary required by future Import commit work without implementing Import, employee facts/history, revert, Auth, Storage, Training, payroll, or CTC.

The only mutation contract is `saveEmployeeWithIdentifiers`. It creates or updates one authoritative Employee row and replaces its active external-identifier set atomically.

## Authoritative Contract

The command accepts an optional Employee ID, `expectedVersion`, employee number, names, Organization/Position references, employment dates/status, active state, and the complete desired external-identifier set. Tenant, property, actor, role, request ID, source batch, and audit identity are trusted server/database context and are never accepted from the browser.

Create requires no ID and `expectedVersion = 0`. Update requires an ID and the exact current version. A successful create returns version `1`; a successful update increments exactly once. A stale update fails with a conflict and mutates neither Employee, identifiers, nor audit.

Identifiers are normalized and validated before mutation. Each item has `sourceSystem`, `identifierType`, `identifierValue`, `isPrimary`, and `isActive`. The desired list is replacement semantics, not patch semantics. Duplicate natural keys in one request are rejected. Existing `(property, source system, identifier value)` ownership by another Employee is a conflict. The result returns identifiers in a deterministic natural-key order and includes the authoritative new version.

## `is_new_employee`

E5A does not accept, calculate, write, return as an authoritative write fact, or include `is_new_employee` in the employee-write audit snapshot. Property settings are not yet Neon authority, so E5A cannot truthfully derive it.

The cloned schema and E2 read contract still contain a transitional legacy column. E5A leaves that read compatibility surface untouched; the E5A entrypoint never names or updates the column. It will be removed or replaced by a derived read model when Property/Initialization becomes Neon authority. A browser-supplied `isNewEmployee` or `is_new_employee` key is rejected.

E5A also leaves the pre-existing `employees_record_fact_version` trigger unchanged. Preserving an existing downstream history consumer is not an E5A facts migration; changing or removing that boundary requires a separately approved Employee-facts slice.

## Authorization and Database Boundary

Supabase Auth proves identity on the server. Existing `withNeonResolvedActorContext` establishes transaction-local actor and request context. Trusted hostname resolution establishes tenant/property. Only an active `property_ld_manager` may execute Employee writes.

`public.save_neon_employee_with_identifiers(...)` is a constrained `SECURITY DEFINER` entrypoint owned by `hotel_ld_migration_owner`, with `search_path = ''`, PUBLIC execute revoked, and an exact execute grant to `hotel_ld_application`. The runtime role remains `NOBYPASSRLS`, owns no objects, and has no raw privileges on Employee, identifier, or audit tables.

The migration owner receives only the raw columns/commands needed by the entrypoint, protected by FORCE RLS policies requiring the application session, current actor property, and manager role. No runtime code uses an owner credential or `SET ROLE`.

## Referential and Business Validation

The entrypoint validates tenant/property against trusted hostname/context and verifies all non-null Organization references are active and in the same tenant/property:

- active Employees require an active Department and Position;
- Operational Unit, when present, belongs to the selected Department;
- Position Family, when present, matches the selected Position family;
- employee number is nonblank and unique in the property;
- external identifiers are nonblank, request-unique, and property-unique.

The database re-reads all referenced rows; browser labels or scope values are not authorization evidence.

## Atomicity and Lock Order

One database transaction performs validation and mutation. The entrypoint locks in a stable order:

1. property-scoped advisory transaction lock;
2. optional target Employee row;
3. referenced Department, Operational Unit, Position Family, and Position in UUID order;
4. existing external identifiers for the Employee ordered by natural key;
5. conflicting identifier candidates ordered by natural key.

Only after validation does it insert/update Employee, replace identifiers, and append audit. Any error rolls back all effects. The advisory lock serializes Employee-number and identifier uniqueness decisions inside one property; unique constraints remain the final guard.

## Audit

`app_private.employee_write_audit_events` is append-only and FORCE RLS. Each event records request ID, pseudonymous actor UUID, tenant/property, Employee ID, operation, prior/new version, and before/after JSON snapshots of E5A authoritative Employee facts and identifiers. It excludes credentials, `is_new_employee`, source rows, and imported file data. Update/delete are rejected by trigger, and runtime roles cannot read or mutate audit rows.

## Server/API Boundary

A server-only Neon repository calls only the constrained entrypoint with parameterized values. A dark same-origin command route uses Supabase Auth only for verified identity, resolves hostname/property on the server, injects actor context, and never exposes Neon credentials.

The route is `POST /api/people/employees/save` for both create and update. This avoids breaking the existing `POST /api/people/employees` department-directory read contract. There is no second identifier mutation endpoint.

## Error Semantics

- `400`: malformed or unsupported browser fields, including authorization scope and `is_new_employee`.
- `401`: missing/expired identity.
- `403`: inactive actor, non-manager, hostname/property authorization failure.
- `404`: update target or referenced same-property object is not visible.
- `409`: stale Employee version, employee-number conflict, identifier ownership conflict, serialization/deadlock conflict.
- `422`: current-state business rule failure.
- `503`: unexpected dependency/database failure.

## Validation Gates

Source, dry-run rollback, child apply, catalog, and runtime validation must all hard-deny the Production branch/endpoint. Catalog validation proves owner/search path/ACL, FORCE RLS, zero raw application privileges, append-only audit, and absence of `is_new_employee` from the mutation signature/body/audit snapshots. Runtime validation covers manager success where a configured development identity exists, department-admin denial, cross-property denial, create/update/version conflicts, identifier conflicts, rollback, raw-table denial, actor cleanup, and pooled connection reuse.
