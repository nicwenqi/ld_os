# Supabase Exit Design

## Decision

Replace Supabase Auth with Better Auth, hosted by the application on Vercel and
persisted in an isolated Neon `app_auth` schema. Better Auth is selected because
it supports PostgreSQL in a non-default schema and exposes a same-origin
session boundary. It needs no new SaaS account, preserves the Chinese login-ID
experience through the existing deterministic internal email derivation, and
does not make token claims an authorization source.

## Security Boundary

- `app_auth` contains only Better Auth identity, password-account, session, and
  verification records. It contains no tenant, property, membership, role, or
  department-scope state.
- `hotel_ld_auth_service` is a non-production, `NOLOGIN`-by-default database
  role whose credential is used only through the server-only `AUTH_DATABASE_URL`.
  It owns or accesses only `app_auth`; it has no membership in the migration or
  application roles, no business-object privilege, no superuser or bypass-RLS
  capability, and no default privilege on business schemas.
- Better Auth validates its own session server-side and yields only a stable
  authentication subject ID. Every authenticated business request then resolves
  that ID through the existing Neon authorization entrypoint and Actor Context.
  Token metadata never carries role, property, membership, or scope authority.
- `hotel_ld_application` receives no `app_auth` privilege and remains unable to
  perform raw DML against business objects.

## Runtime Flow

```text
Browser login ID + password
  -> same-origin /api/auth/* (Better Auth)
  -> app_auth credentials and HttpOnly session cookie
  -> server-validates session subject
  -> Neon user_accounts and authorization session projection
  -> Actor Context -> constrained business entrypoints
```

The login API derives the existing internal email from login ID plus trusted
property hostname only on the server. A new initialization operator creates a
Better Auth identity, then supplies its generated subject ID to the existing
Neon-first mapping/bootstrap workflow. Existing Supabase identities, password
hashes, refresh tokens, sessions, and storage objects are not read or moved.

## Storage and Legacy Removal

Property branding moves to a second, private Vercel Blob logical bucket
(`property-brand-assets`) using the existing provider-neutral object pattern.
The Neon property repository remains the metadata authority. Upload, readback,
exact-path removal, and expired-object cleanup are server-only; browser code
never receives the Blob token.

After the new authentication and branding paths pass their non-production
matrix, remove the active Supabase browser client, server clients, Auth routes,
all Supabase domain registries and repositories, legacy Import test adapter,
Supabase package and environment parsing, plus obsolete Supabase-only tests and
migration-history references. No Supabase fallback remains.

## Validation

The source gate must reject any active `@supabase/*` import, Supabase `.from`,
`.rpc`, `.storage`, browser client, business repository, or data-mode fallback.
It must allow neither an unknown provider wrapper nor an unproven session
subject. Catalog validation checks the auth role/schema boundary separately
from the canonical business catalog.

The non-production runtime matrix proves account initialization, login,
refresh/session re-resolution, manager and department-admin access,
cross-property denial, Actor Context cleanup, pooled connection reuse, raw
business-table denial, property-brand upload/readback/delete, and Blob
not-found cleanup. It uses new disposable identities and objects only.

## External Prerequisites

The approved non-production Neon operator/bootstrap credential must be made
available only to the controlled bootstrap command so it can create the
`app_auth` schema and service role. The runtime receives only the resulting
Preview-scoped `AUTH_DATABASE_URL` and `BETTER_AUTH_SECRET`; neither is written
to Git or browser output. No Production credential or environment is used.
