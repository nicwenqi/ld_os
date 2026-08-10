# Neon-first Initialization Design

## Goal

Provision a clean non-production Neon environment from a verified Auth adapter user ID, then leave normal application access to the existing Auth session and Neon runtime boundaries.

## Decision

Use a standalone operator CLI. Auth remains the sole authority for user creation, passwords, refresh tokens, and identity verification. The operator supplies only a verified `authUserId`; Neon never stores a credential, token, or provider session.

The CLI is not imported by an API route, repository registry, browser bundle, or runtime process. It connects only with a direct, controlled bootstrap credential and rejects production targets, pooled URLs, runtime credentials, and `SET ROLE`.

## Inputs

- A non-production target manifest: project, branch, endpoint, database, direct-host prefix, and environment (`development` or `staging`).
- A verified Auth user UUID supplied separately from the seed fixture.
- A deterministic Neon-first seed fixture containing tenant/property identity, manager profile IDs, membership/role IDs, initialization IDs, and minimal Organization/Position/Employee IDs.
- A direct bootstrap connection string delivered through a protected environment variable or stdin. It is never written to evidence or repository files.

## Transaction

One transaction creates or exactly revalidates the following graph:

1. Tenant, property, and verified property domain.
2. Profile, `user_accounts` mapping, tenant membership, property membership, `property_ld_manager` role, and active role assignment.
3. `property_settings` plus all eight initialization-step records. The development fixture starts in `in_progress`; identity, organization, positions, and access are confirmed, while upload, mapping, and readiness remain truthful pending work.
4. A minimal active root department, position family, position, position-to-department assignment, and one employee with a local identifier.
5. Append-only organization/property/initialization audit evidence with request ID, verified Auth user ID, target IDs, created-object list, seed version, and no secrets.

Each record is inserted only when absent. A matching existing record is an idempotent success. Any duplicate, scope mismatch, immutable-field mismatch, inactive relation, or unexpected row cardinality aborts the entire transaction. The tool never deletes or overwrites existing business data.

## Security Boundary

- `hotel_ld_application` receives no raw DML, no initialization privilege, and no new grant.
- Actor Context functions, RLS, FORCE RLS, constrained entrypoints, and repository/API selection remain unchanged.
- The bootstrap connection is direct and operator-only. There is no permanent bootstrap role or public bootstrap entrypoint.
- The bootstrap audit is evidence of an operator action; it is not treated as a runtime Actor Context event.

## Runtime Handoff

After a successful commit, the Auth adapter logs in the same new user normally. The existing request authentication and Actor Context resolver then find the new `user_accounts` mapping and active property-manager assignment. Organization, Position, People, Property/Initialization, and Import use their existing HTTP repositories and database entrypoints unchanged.

## Validation

- Connection-free tests prove strict target/fixture parsing, rejection of runtime credentials and production/pooler URLs, no `SET ROLE`, no Auth calls, parameterized SQL, idempotence, conflict rollback, seed graph ordering, and redacted evidence.
- The operator CLI supports `--dry-run` as an outer transaction rollback and reports only counts/IDs.
- A non-production integration gate verifies the full graph, audit records, RLS/ACL invariants, and zero application-role raw privileges.
- Browser/session validation is intentionally a subsequent Auth-adapter step: new Auth user → normal login → existing runtime validation. It does not migrate or preserve old Auth users, sessions, passwords, Import history, or Supabase business state.

## Exclusions

- Supabase `auth.users` import, password/session continuity, Auth provider configuration, Storage provider replacement, legacy Import history, compatibility bridges, Production, and any change to the Actor Context or runtime authorization model.
