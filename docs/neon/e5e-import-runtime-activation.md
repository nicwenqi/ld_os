# E5E Import Runtime Activation

E5E activates Import only when `APP_DATA_MODE=neon`. The browser receives a
same-origin HTTP repository; it never receives `DATABASE_URL`, a Neon pooled
URL, a PostgreSQL client, or a Storage service credential.

## Runtime boundary

`createRepositoryRegistry()` selects the HTTP Import repository in Neon mode.
The runtime rehearsal loader also requires the Import domain source to match
the reported source for Organization, People, and Position. A Neon inspect
request enters `inspectAndStageWorkbookInNeon`, which resolves Supabase Auth,
the Neon Actor Context/property scope, and the server Storage saga. The legacy
`stage_employee_import` RPC remains available only through the non-Neon
fallback branch; a Neon error is returned to the caller and never retries via
Supabase.

## Seed strategy

`scripts/neon/e5e-development-seed.mjs` is a deterministic fixture manifest.
It contains no SQL, no old Supabase rows, and no Auth mutation. A staging-only
seeder may consume the IDs after the manager Auth identity is provisioned by the
existing Auth adapter. The fixture covers insert, expected-version update,
external-identifier conflict, and guarded revert scenarios.

## Browser gate

For an authenticated manager in rehearsal:

1. `GET /api/runtime/rehearsal-mode` reports `import: neon`.
2. Import history and batch/mapping/label/issue/preview/commit/revert calls use
   `/api/import/**` with `credentials: same-origin`.
3. Upload uses `/api/import/inspect`; the server performs Storage upload,
   read-back SHA-256/size/MIME verification, and the cleanup saga.
4. No browser request targets Supabase REST/Storage for Import business data.

The existing Supabase inspect and repository path remains the explicit
non-Neon fallback. It is not used when Neon is selected and does not participate
in the E5E commit/revert transaction.

## Current validation status

- Source and HTTP boundary fixtures: PASS.
- Existing application suite: `npm test` 201/201.
- Build: PASS.
- Live canonical positive workflow remains an environment gate: it requires
  the deterministic fixture to be seeded in a staging property with an Auth
  manager identity and the existing Storage provider adapter. No Production,
  old child, or historical Supabase data is used.
