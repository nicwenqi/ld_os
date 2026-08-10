# Neon-first Initialization

This operator flow provisions a clean development or staging Neon environment. It does not import Supabase users, passwords, sessions, Import history, or business data.

## Boundary

1. The configured Auth adapter creates and verifies a new user.
2. The operator obtains only that user's UUID.
3. The Neon initialization command creates the business mapping and deterministic development seed.
4. The user signs in normally through the existing Auth adapter.
5. Existing HTTP repositories establish Actor Context and use canonical Neon entrypoints.

The command does not create Auth users, receive a password/token/JWT, call Supabase, modify runtime registry code, or grant privileges to `hotel_ld_application`.

## Inputs

Create a non-secret target file outside the repository, for example `/private/tmp/neon-first-target.json`:

```json
{
  "environment": "development",
  "projectId": "your-neon-project-id",
  "branchId": "your-neon-branch-id",
  "endpointId": "your-direct-endpoint-id",
  "database": "neondb",
  "directHostPrefix": "your-direct-endpoint-id."
}
```

Copy [neon-first-development-seed.example.json](/Users/hewenqi/Documents/Hotel%20L%26D%20OS/.worktrees/canonical-neon-baseline/scripts/neon/fixtures/neon-first-development-seed.example.json) outside the repository and replace its profile email with the newly created Auth user's email. Keep the Auth user UUID separate from the fixture.

Provide the direct `neondb_owner` bootstrap URL only through the protected local `NEON_BOOTSTRAP_DATABASE_URL` environment variable. The command rejects pooled URLs, runtime role URLs, production targets, and evidence paths outside `/private/tmp/` or `/tmp/`.

## Run

First make a rollback-only proof:

```bash
APP_ENV=development \
NEON_BOOTSTRAP_DATABASE_URL='<protected-direct-bootstrap-url>' \
node scripts/neon/initialize-neon-first-environment.mjs \
  --target-file /private/tmp/neon-first-target.json \
  --fixture /private/tmp/neon-first-development-seed.json \
  --auth-user-id '<verified-auth-user-uuid>' \
  --dry-run \
  --evidence-file /private/tmp/neon-first-initialization-dry-run.json
```

Then apply once with the same target and fixture, omitting `--dry-run`:

```bash
APP_ENV=development \
NEON_BOOTSTRAP_DATABASE_URL='<protected-direct-bootstrap-url>' \
node scripts/neon/initialize-neon-first-environment.mjs \
  --target-file /private/tmp/neon-first-target.json \
  --fixture /private/tmp/neon-first-development-seed.json \
  --auth-user-id '<verified-auth-user-uuid>' \
  --evidence-file /private/tmp/neon-first-initialization-apply.json
```

The command is idempotent only for the exact same fixture. Mismatched records fail closed and roll back; it never updates or deletes existing business rows.

## Result

The transaction establishes an active tenant/property/domain, a property-manager mapping, property settings, eight initialization steps, a root department, a position family and position, a position assignment, and one active development employee with an external identifier. It appends organization/property/initialization audit evidence and writes a redacted operator evidence file with IDs and created-object names only.

After apply, perform a normal Auth login with the new user. No special claims, `SET ROLE`, raw table privilege, or bootstrap route is used at runtime.
