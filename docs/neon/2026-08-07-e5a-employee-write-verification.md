# E5A Employee Write Foundation Verification

Date: 2026-08-07

## Scope and Isolation

- Neon child branch: `br-aged-river-az1gke14`
- Neon child endpoint: `ep-sparkling-shape-az9gxtuh`
- Database: `neondb`
- Migration connection: direct `neondb_owner`, used only by the validator for dry-run/apply/catalog
- Runtime connection: pooled `hotel_ld_application`
- Production deny-list remained active; no Production connection was made.
- Registry, Import, Supabase Auth, Supabase Storage, Actor Context, UI, and the main worktree's B-class modifications were not changed.

## Migration Result

Applied `neon/migrations/202608070015_e5a_employee_write.sql` to the confirmed child after a successful transaction rollback dry-run. Completion review then identified that the first draft had removed an existing facts trigger and used overly broad migration-owner grants. `neon/migrations/202608070016_e5a_employee_write_hardening.sql` was separately rollback-tested and applied to restore the existing boundary, narrow grants, and align the Position Family and identifier contracts. The final validator also rehearsed the corrected base and hardening migrations sequentially inside one outer rollback transaction, proving the fresh-install path without retaining rehearsal changes.

Created:

- `public.save_neon_employee_with_identifiers(...)`
- `app_private.employee_write_audit_events`
- private snapshot/audit helpers and append-only rejection trigger
- manager-scoped Employee/identifier write RLS policies for `hotel_ld_migration_owner`

The pre-existing `employees_record_fact_version` trigger is preserved. E5A does not create, redesign, or remove Employee facts/history objects; that existing downstream consumer remains outside E5A ownership.

## Catalog Assertions

All passed:

- entrypoint owner is `hotel_ld_migration_owner`
- `SECURITY DEFINER` with fixed empty search path
- PUBLIC execute denied; exact `hotel_ld_application` execute allowed
- `hotel_ld_application` is NOBYPASSRLS/non-superuser and owns none of the protected objects
- Employee, external identifier, and write-audit tables use FORCE RLS
- application raw Employee/identifier/audit privileges are zero
- Employee write audit has an active append-only trigger
- mutation body and audit schema exclude `is_new_employee`
- the pre-existing Employee-facts trigger is enabled and bound to its expected function
- the append-only audit trigger is enabled and bound to its rejection function
- E5A-added migration-owner grants are column-scoped; inherited E2 read grants remain intact

## Runtime Assertions

Using the pooled `hotel_ld_application` credential, all passed:

- raw Employee read denied
- raw external-identifier read denied
- raw audit read denied
- entrypoint without actor context denied
- transaction rollback clears actor context
- pooled connection reuse starts clean

No accepted non-production manager/admin actor UUID is configured in the validation environment. Therefore manager create/update, department-admin denial, cross-property denial, stale-version conflict, identifier ownership conflict, and mutation rollback are recorded as deferred runtime identity cases. They were not simulated with the owner credential or `SET ROLE`; they must be exercised when accepted development identities are provisioned.

## Application Verification

- Isolated RED contract: 3 failed before implementation because parser, repository, and validator were absent.
- GREEN contract: 3 passed, including strict forbidden input keys, one atomic repository call, and child/Production URL guards.
- `npm test`: tests 201, pass 201, fail 0; its nested application build and rendered HTML check passed.
- standalone `npm run build`: passed and classified `/api/people/employees/save` as an API route.

## Activation State

E5A is a dark server/database boundary only. It is not wired into Employee UI, registry activation, or Import. The Supabase Import RPC contract remains unchanged.
