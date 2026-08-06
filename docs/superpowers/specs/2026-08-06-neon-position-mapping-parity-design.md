# Neon Position Mapping Parity Design

## Goal

Close the Position-domain mapping contract on Neon without migrating Import, employee writes, Auth, Storage, the registry, or the browser UI data source.

## Scope

E4C owns existing `public.position_aliases` records and their resolution. The Position domain reads source-label evidence, previews information it can authoritatively establish, and resolves a label through one privileged database entrypoint. Import remains the future producer of source labels; it is not called, staged, or committed by E4C.

## Contract

`PositionSourceLabel` exposes persisted source system, sheet, label, normalised label, and `sourceRowCount`. The pre-existing `syntheticEmployeeCount` remains a temporary UI-compatibility mirror of `sourceRowCount`; it must never be interpreted as a current employee query.

`previewSourceImpact()` returns a `PositionSourceImpact` object. In E4C it returns real source evidence together with:

```ts
{
  employeeImpact: { state: "unavailable", reason: "import_source_rows_not_migrated" },
  departmentImpact: { state: "unavailable", reason: "import_source_rows_not_migrated" }
}
```

It does not return `0`, an empty department-name array, or a made-up employee calculation for an unknown value. The mock repository may return `available` evidence because its synthetic rows are its authoritative data source.

## Authorization and Resolution

Position source-label administration preserves Supabase parity: only `property_ld_manager` may list labels, preview a label, or resolve it. Department administrators have no mapping-administration visibility. Public Neon entrypoints verify runtime session, actor context, trusted hostname, current property, and manager authorization.

`resolve_neon_position_alias(...)` is the only mutation boundary. It locks the property-scoped alias, validates the action, validates any target as active and in the actor property, clears inapplicable fields, updates the alias, and appends immutable audit evidence in the same transaction.

| Action | Required authoritative target | Stored status |
| --- | --- | --- |
| `position` | active Position in current property | `mapped` |
| `family` | active Position Family in current property | `family_only` |
| `external` | nonblank external code and name | `external_only` |
| `ignore` | none | `ignored` |
| `defer` | none | `deferred` |

For `position`, the entrypoint derives Family from the selected Position; a caller cannot create an inconsistent Position/Family pair. For `defer`, approval values are cleared. Other actions record the verified actor and transaction timestamp.

## Database and Server Boundaries

The migration adds a private append-only mapping audit table, its rejection trigger, narrowly scoped `hotel_ld_migration_owner` policies, and constrained `SECURITY DEFINER` entrypoints. Every definer function has `search_path = ''`, is owned by `hotel_ld_migration_owner`, is revoked from `PUBLIC`, and receives an exact `hotel_ld_application` EXECUTE grant. The application role has no raw privileges on `position_aliases`, target tables, or audit tables.

A server-only Neon mapping repository calls entrypoints through existing `withNeonResolvedActorContext`. Dark HTTP routes resolve Supabase identity on the server, resolve property from the trusted hostname, and never accept tenant or property identifiers from the browser. The registry remains on Supabase.

## Validation

The child-only validator checks catalog ownership, fixed search paths, EXECUTE ACLs, forced RLS, zero raw application privileges, append-only audit, manager success, department-admin denial, cross-property denial, action/target validation, unavailable impact semantics, rollback, and actor cleanup with connection reuse. Production is never contacted.
