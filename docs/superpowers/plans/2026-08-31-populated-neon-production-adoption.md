# Populated Neon Production Adoption ExecPlan

> **Approval state:** PROPOSED. Do not execute any SQL, credential, Blob, Vercel Production, domain, or deployment mutation from this plan without explicit human approval after review.

## Goal

Adopt the already migrated Training App data into a new canonical Neon + Better Auth Production runtime without recreating Supabase, copying Preview credentials, or migrating business rows again.

## Current facts

- The data origin is Neon project `flat-brook-43278549`, primary branch `br-twilight-leaf-azmowo1k`, endpoint `ep-wild-wave-azjmgdif`, database `neondb`.
- The historical branch contains the Training App rows but is deliberately denied by the canonical runtime.
- It lacks `hotel_ld_application`, `hotel_ld_migration_owner`, `hotel_ld_auth_service`, `app_auth`, and the final constrained entrypoints.
- The empty-baseline canonical installer is not safe for this populated schema.
- Vercel Production lacks all five required runtime variables and no Production Blob authority is proven.

## Non-negotiable safety constraints

- Never run the empty-baseline installer on the populated primary branch.
- Never update or delete business rows as part of schema adoption.
- Never copy Preview database, auth, secret, or Blob credentials into Production by name alone.
- Never expose connection strings, passwords, tokens, cookies, or Better Auth secrets in logs or Git.
- Keep the historical primary branch untouched and recoverable until Production acceptance and an explicit retirement decision.

## Proposed sequence

1. Create a named child branch from `br-twilight-leaf-azmowo1k`; record its immutable project/branch/endpoint/database identity.
2. Inventory and diff the child schema against every runtime contract actually used by the canonical application, including the separate E5B/E5C/E5D Import extensions. Do not assume the empty canonical manifest alone is complete.
3. Write an idempotent adoption migration that preserves business rows while creating least-privileged roles, replacing provider-specific functions/policies with canonical entrypoints, isolating Better Auth in `app_auth`, and retaining only runtime-required tables. Any proposed drop must be separately enumerated and excluded from the first cutover migration.
4. Apply only to the child branch. Run catalog, Actor Context, property/organization/people/position/employee/import, raw-denial, concurrency, and cleanup matrices against it.
5. Establish a Production Better Auth identity using an explicitly approved login and one-time password/reset procedure. Preserve the UUID mapping expected by `public.user_accounts`; never synthesize or reset a real operator credential without approval.
6. Verify or create a Production-only private Vercel Blob store and perform disposable upload/read-back/delete validation.
7. Generate independent application and auth database role credentials plus a Better Auth secret. Store them directly as Vercel Production-sensitive values; never materialize them in repository files or task output.
8. Deploy the reviewed canonical commit to an unaliased Production candidate, run authenticated read/write/scope/admin/Blob smoke checks, inspect logs and network requests, and clean fixtures.
9. Move Production aliases only after all acceptance checks pass. Preserve the old deployment and historical Neon branch as rollback targets for an explicitly bounded observation window.
10. Update the Vercel Production branch/source of truth without force-pushing or rewriting unrelated history.

## Required human inputs before execution

- Approval to create and mutate a Neon child branch cloned from the populated Production data origin.
- Approval of the exact adoption SQL after its child-branch diff and lock/ownership impact review.
- The intended initial Production Better Auth operator identity and an approved credential/reset channel.
- Approval to create or attach a Production Vercel Blob store if none exists.
- Final approval to change Production environment variables, deploy, and move aliases after rehearsal evidence is presented.

## Rollback

- Before alias movement: delete the candidate deployment/temporary Blob fixtures and retain the historical Production unchanged.
- After alias movement: restore aliases to the prior READY deployment and remove the candidate variables only under a separately reviewed rollback action. Do not reset or delete either Neon branch during the observation window.
