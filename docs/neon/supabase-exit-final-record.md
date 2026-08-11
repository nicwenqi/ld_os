# Supabase exit — final record

Status: **Supabase Project deleted**.

The project no longer has an active Supabase runtime or deployment dependency. Historical
Supabase migrations, SQL tests, and configuration are retained under
`docs/archive/supabase-project/legacy-project/` solely as immutable migration evidence.
They are not a deployable project, are not loaded by the application, and are excluded from
the active test and runtime paths.

## Current runtime topology

| Concern | Authority / provider |
| --- | --- |
| Identity, credentials, session lifecycle | Better Auth (`app_auth`) |
| Business data and authorization | Neon PostgreSQL |
| Roles, memberships, property and department scope | Neon Actor Context + constrained entrypoints |
| Import and property object storage | Vercel Blob, server-only adapter |
| Browser boundary | Same-origin application APIs; no database or object-provider credential |

Neon remains the sole authorization authority: verified Better Auth identity maps to
`user_accounts`, then Neon memberships, roles, scopes, and Actor Context. No role, property,
or scope is treated as token authority.

## Removal and rollback policy

There is no rollback path to Supabase. A deployment rollback may select an earlier compatible
deployment only within the Neon + Better Auth + Vercel Blob topology. It must not reinstate a
Supabase client, project environment variable, compatibility object, or data path.

`scripts/neon/validate-supabase-free-baseline.mjs` is the fail-closed source gate for this
baseline. It rejects active Supabase imports, clients, RPC-style calls, environment contracts,
fallback registries, deleted-project references, package dependencies, browser bundle paths,
and a root-level legacy Supabase configuration.

## Known non-Supabase blocker

The only remaining platform issue is tracked separately in
[`neon-pooled-runtime-platform-blocker.md`](./neon-pooled-runtime-platform-blocker.md).
It is a Neon pooled-runtime availability issue and does not restore or require Supabase.
