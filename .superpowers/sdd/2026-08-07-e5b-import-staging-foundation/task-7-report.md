# E5B Task 7 — Storage saga coordinator and cleanup executor

## Delivered

- Added the server-only Neon/Auth authorization boundary. Supabase Auth proves
  identity, Neon resolves the live hostname/property scope, and Storage uses
  the actor access token; request bodies cannot choose tenant, property, role,
  or object ownership.
- Added a repository facade whose individual operations each use a fresh,
  transaction-scoped Neon Actor Context. Storage upload, read-back, parsing,
  and removal occur between those database transactions.
- Added the Storage/Neon saga coordinator with the required ordering:
  intent → upload → uploaded observation → read-back verification → verified
  observation → parse verified bytes → atomic staging.
- Failed verification records `verification_failed` with null verified
  evidence before persisting `cleanup_pending`; every compensation path records
  the durable obligation before attempting deletion.
- Added exact-object cleanup execution using manager-scoped claims,
  operation/claim IDs, exact bucket/path removal, and bounded retry delays of
  30 seconds, 2 minutes, 10 minutes, 1 hour, and 6 hours (capped).
- Added fail-closed source assertions for the authorization boundary, saga
  ordering, cleanup path, and no service-role/database/Storage-table access.

## Verification

```text
E5B focused offline suite: 80 passed, 0 failed
node scripts/neon/validate-e5b-import-staging.mjs source
  expected RED: E5B_IMPORT_STAGING_DARK_BOUNDARY_MISSING
npm test: 201/201; build and rendered HTML pass
git diff --check: pass
```

No Neon, Supabase, Storage provider, Production endpoint, or business data was
accessed. Task 8 must add the dark HTTP boundary before live validation.
