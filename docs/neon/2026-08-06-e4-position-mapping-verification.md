# E4C Position Mapping Parity verification

## Scope

E4C makes Position source-label reads, source evidence, explicitly unavailable
impact previews, and resolution actions available through the Neon server
boundary. It does not migrate Import staging or commit, Employee writes,
Storage, Auth, the browser UI, or repository-registry activation.

## Child-only database evidence

- Target branch: `br-aged-river-az1gke14`
- Target endpoint: `ep-sparkling-shape-az9gxtuh`
- Migration: `neon/migrations/202608060014_e4_position_mapping.sql`
- Migration connection: direct bootstrap credential, used only for migration.
- Runtime connection: pooled `hotel_ld_application` credential.
- Production deny-list branch and endpoint were not used.

The validator completed source inspection, rollback-only dry run, child apply,
catalog inspection, and runtime topology validation. Connection strings and
passwords were neither logged nor committed.

## Authorization and ACL result

`resolve_neon_position_alias` is the sole mutation boundary. It is owned by
the migration owner, uses a fixed empty search path, has PUBLIC EXECUTE revoked,
and grants EXECUTE only to `hotel_ld_application`. It establishes Actor Context,
checks property-manager authority, locks the alias, validates same-property
active targets, applies one supported resolution, and appends an audit event in
one transaction.

The catalog validator confirmed:

- constrained mapping entrypoints exist;
- position-mapping audit has FORCE RLS and append-only protections;
- `hotel_ld_application` has no raw privileges on aliases, Positions, families,
  or mapping audit tables.

The runtime validator confirmed raw reads of those four tables are denied, a
call without Actor Context is denied, and actor context is cleared after
rollback and connection reuse.

Positive manager and department-admin identity cases remain **deferred**:
the child environment deliberately has no accepted non-production identity
fixtures. No owner connection or `SET ROLE` simulation was used to substitute
for those tests.

## Impact contract

The preview returns source-system, source-sheet, and source-row-count evidence.
Because Import source rows are not in Neon, employee and department impacts are
both `{ state: "unavailable", reason: "import_source_rows_not_migrated" }`.
No synthetic zero or empty collection represents unknown impact. The retained
legacy `syntheticEmployeeCount` is explicitly the source-row evidence count for
existing UI contract compatibility, never an inferred employee impact.

## Code verification

- E4C contract tests: 3 passed.
- `npm test`: 201 passed, 0 failed.
- `npm run build`: passed.

## Activation status

The Organization and Position registries remain on the Supabase fallback. The
new HTTP routes are dark server-side APIs; no UI switch or browser Neon access
was introduced. Import RPC contracts and Actor Context remain unchanged.
