# Vercel Blob Storage Replacement Design

## Goal

Replace Supabase Storage in the active Import runtime path with Vercel Blob while
leaving the canonical Neon business schema, Actor Context, E5B saga contract, and
temporary Supabase Auth provider unchanged.

## Decision

Use a private, non-production Vercel Blob store through a server-only adapter. The
adapter receives `BLOB_READ_WRITE_TOKEN` from the server environment only. It is
never imported by browser code, included in an API response, or derived from a
Supabase access token.

The existing `ImportStorageGateway` remains the boundary:

```text
Browser file
  -> same-origin Import API
  -> Supabase Auth identity verification (temporary)
  -> Neon authorization + Actor Context
  -> server-only Vercel Blob adapter
  -> private Vercel Blob object
```

Vercel Blob is selected because the application is Vercel-deployed and has no
configured Cloudflare R2 binding or S3 endpoint. The adapter keeps the application
provider-neutral, so a later storage-provider change does not affect the E5B database
or import workflow.

## Boundaries

- Object authorization happens before the adapter: `runAuthorizedNeonImportStaging`
  resolves the Auth identity, Neon property scope, and Actor Context. The adapter
  never accepts an end-user token or chooses a tenant/property/object path.
- The adapter permits only the server-owned `property-import-files` logical bucket.
  It receives the exact object path returned by the Neon staging entrypoint and
  never lists, prefixes, or expands it.
- `upload` writes with no overwrite; `download` returns one complete `Uint8Array`;
  `remove` deletes only the exact path. A Vercel Blob not-found response is an
  idempotent successful cleanup; all other provider failures remain failures.
- The existing coordinator still uploads, records the upload, performs one full
  read-back, verifies SHA-256/size/content-derived MIME, stages only read-back bytes,
  and writes durable cleanup state before any compensation attempt.
- No Import metadata change is needed. The existing fixed logical bucket and
  server-derived immutable object path are provider-neutral.

## Runtime configuration

- `BLOB_READ_WRITE_TOKEN` is a server-only secret and is rejected when exposed with
  a browser-visible prefix.
- The adapter is unavailable, fail-closed, when the token is missing, blank, or the
  active environment is Production without an explicitly approved storage rollout.
- Local and non-production validation may use only a dedicated Vercel Blob store.
  Existing Supabase Storage objects are intentionally not copied.

## Migration scope

1. Add the pinned Vercel Blob dependency and server-only adapter.
2. Replace the active Import storage gateway construction; remove the
   `createServerActorClient(accessToken)` dependency from that path.
3. Tighten the source audit so active Import authorization cannot regain Supabase
   Storage access, while leaving legacy paths untouched for their separately staged
   retirement.
4. Add focused unit and source-boundary tests plus a provider integration validator.
5. Validate a non-production Blob store with exact upload, one read-back, checksum,
   size, MIME, exact-path removal, retry, and not-found-idempotency cases.

## Non-goals

- No Auth-provider change, Supabase business-data mutation, object migration,
  Import schema change, Production rollout, RLS change, or runtime privilege change.
- No browser direct Blob API, browser token, signed upload URL, or service-token
  forwarding.

## Acceptance evidence

- The Import runtime path has no Supabase `storage`, `createServerActorClient`, or
  actor access-token dependency.
- The Vercel Blob token is server-only and absent from the client build.
- Existing E5B saga and cleanup tests remain green; added tests prove exact-path and
  read-back semantics.
- `npm test`, `npm run build`, and the source audit pass.
- A non-production Blob run proves upload, read-back, SHA-256, size, MIME, cleanup,
  retry, and idempotent not-found cleanup without exposing credentials.
