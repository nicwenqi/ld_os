# E5D Import Commit / Revert

E5D adds the final Import write boundary without changing the staged evidence or the E5A employee tables directly.

## Canonical objects

- `neon/canonical/e5d/095_import_commit_schema.sql`
  - commit header and commit items
  - append-only commit audit
  - scope FKs, lifecycle/version checks, RLS/FORCE RLS, and raw privilege revokes
- `neon/canonical/e5d/096_import_commit_entrypoints.sql`
  - `commit_neon_import_batch`
  - `preview_neon_import_revert`
  - `revert_neon_import_batch`
  - private employee mutation core wrapper and audit helper

The commit entrypoint locks the authoritative batch and mapping decision version before recomputing the preview and hash. It revalidates organization and position targets, then invokes the existing E5A mutation core in the same transaction. Staged evidence is never updated or deleted. Revert is compensating-only: inserted employees are made inactive and updated employees are restored only when their current version still matches the commit item; employee rows are never deleted.

## Server boundary

- `app/repositories/contracts/import-commit-repository.ts`
- `app/repositories/neon/import-commit-repository.ts`
- `app/services/neon-import-staging-authorization.ts`
- `app/api/import/commit-input.ts`
- `app/api/import/batches/[id]/commit/route.ts`
- `app/api/import/batches/[id]/revert/route.ts`

The repository is server-only and calls only the three constrained entrypoints. Tenant, property, role, and actor values are resolved server-side; browser input is limited to approved versions, hash, confirmation, and batch id.

## Canonical live validation

Target: the approved canonical acceptance branch (IDs are recorded in the validator and redacted from runtime output).

- source gate: PASS
- dry-run: PASS; both migration statements validated, outer transaction rolled back, state restored
- apply: PASS; both E5D modules applied
- catalog: PASS; owners, SECURITY DEFINER/search path, exact execute ACL, ENABLE+FORCE RLS, append-only audit, raw privilege zero, and empty commit rows verified
- runtime: PASS; pooled `hotel_ld_application` identity, raw commit read/write denial, raw employee-write denial, and no-delete guarantee verified
- positive commit/revert fixture: deferred because the canonical acceptance environment intentionally contains no business seed rows
- Storage runtime: out of scope for E5D; E5B remains the Storage saga authority

The source and application gates also pass with `npm test` 201/201 and `npm run build`. No Production, Supabase, Auth, Storage provider, or registry activation was changed.
