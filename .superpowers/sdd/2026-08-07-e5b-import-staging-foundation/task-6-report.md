# E5B Task 6 — Storage read-back object verification

## Delivered

- Added a server-only, dependency-injected `StorageObjectReader` verifier. It
  downloads the persisted object after upload and returns only server-internal
  checksum, byte-size, and content-derived MIME evidence.
- Recomputes SHA-256 over downloaded bytes and uses `timingSafeEqual` only
  after both checksum values satisfy the exact lower-case SHA-256 format.
- Enforces declared SHA-256, byte-size, MIME, filename, and upload-limit
  constraints before parser handoff. It rechecks the actual byte size before
  parsing and rejects checksum, content/filename, and content/MIME mismatch.
- Classifies XLS by OLE signature plus SheetJS parse, XLSX by ZIP signature
  plus SheetJS parse, and CSV by valid UTF-8/no NUL bytes plus the existing
  workbook inspection parser. Storage metadata and client MIME never establish
  the verified MIME.
- Converts Storage read failures and parser failures into stable safe error
  codes. Errors never contain object paths, bytes, provider messages, or full
  hashes. The returned value contains neither bytes nor object path.
- Extended the E5B source validator with a canonical read-back source audit
  and deterministic, in-memory CSV/XLSX/XLS fixture execution. It now reaches
  the expected next RED gate:
  `E5B_IMPORT_STAGING_SAGA_COORDINATOR_MISSING`.

## Saga boundary

`storage-object-verification.ts` does not import a Neon client, execute SQL,
or hold a transaction. The Task 7 coordinator must call it after the upload
observation transaction and then record its server-only result through the
091 constrained entrypoint. This deliberately avoids claiming cross-system
atomicity between Storage and Neon.

## Verification

```text
node --experimental-strip-types --test scripts/neon/validate-e5b-storage-object-verification.test.mjs
# 16 passed, 0 failed

node scripts/neon/validate-e5b-import-staging.mjs source
# expected RED: E5B_IMPORT_STAGING_SAGA_COORDINATOR_MISSING
```

No database, Neon endpoint, Supabase endpoint, or Storage provider was opened.
