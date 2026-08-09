# E5B Task 8 — Dark inspection boundary and read-only history APIs

## Delivered

- Added a server-only `inspectAndStageWorkbookInNeon` boundary. Supabase Auth,
  hostname/property resolution, manager authorization, Actor Context, and
  Storage access remain behind `runAuthorizedNeonImportStaging`; browser input
  is limited to the uploaded `File`.
- Reused the Storage saga so the parser receives bytes from the verified
  read-back, then maps only the named employee-master evidence types into the
  constrained staging repository. The response is the existing browser-safe
  aggregate summary and never includes paths, full checksums, rows, or audit
  internals.
- Added dark `GET /api/import/batches` and
  `GET /api/import/batches/[id]` endpoints. History pagination is bounded, the
  detail route hides cross-property batches as 404, and neither route exposes a
  mutation or registry switch.
- Added source validation for server-only imports, same-origin GET route
  shapes, bounded input, no browser scope/credential fields, and preservation
  of the legacy `actorClient.rpc("stage_employee_import")` contract.

## Verification

```text
Task 8 dark-boundary fixture: 4 passed, 0 failed
E5B focused offline suite: 53 passed, 0 failed
node scripts/neon/validate-e5b-import-staging.mjs source: PASS
npm test: 201/201; build and rendered HTML pass
```

No Neon, Supabase, Storage provider, Production endpoint, or business data was
accessed. Task 9 remains the separately approved child-branch source/dry-run/
apply/catalog/runtime gate.
