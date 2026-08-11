# Vercel Blob Import Storage Operations

The active Import runtime uses the server-only Vercel Blob gateway. It accepts
only the logical `property-import-files` bucket and persists private objects at
the exact E5B object path supplied by the Neon saga.

## Configuration

`BLOB_READ_WRITE_TOKEN` is a server-only environment variable. It must never
be exposed to the browser, written to repository files, or converted to a
client upload token. The validation store is private and attached only to the
Vercel Preview environment; it is not attached to Production.

The active Import authorization root resolves Supabase Auth and Neon scope,
then creates the Blob gateway without forwarding an Auth access token to the
storage provider. Supabase Storage is not an active Import fallback.

## Non-production validation

Run only with an injected protected token and explicit non-production marker:

```sh
BLOB_VALIDATION_NON_PRODUCTION=1 VERCEL_ENV=preview \
  node --experimental-strip-types scripts/neon/validate-vercel-blob-storage-live.mjs
```

The command uses random validation paths and does not print the token, Blob
URL, or object path. It verifies private upload, one uncached full read-back,
SHA-256, byte size, content-derived MIME, exact-path deletion, a bounded
cleanup retry, and idempotent not-found cleanup. Its `finally` block attempts
to remove only the three random validation objects it created.

Do not use this command against Production. The command fails closed unless
`BLOB_VALIDATION_NON_PRODUCTION=1`, `VERCEL_ENV=preview`, and the injected
token identifies the allowlisted Preview Blob store. A Production token cannot
pass this check.

## Validation record

On 2026-08-11, the private Preview-only `hotel-ld-os-import-validation` Blob
store passed this matrix through Vercel's ephemeral Preview environment runner:
private upload, uncached full read-back, checksum, size, content MIME,
exact-path deletion, cleanup retry, and idempotent not-found cleanup. The
retry probe deliberately injects one transient local failure before the first
provider deletion, then proves the existing cleanup executor retries against
the real Blob gateway; it is not a claimed provider outage. No Blob token,
URL, or object path was recorded. The temporary local Vercel directory
used for that run, including its local credential material, was removed after
the command completed.
