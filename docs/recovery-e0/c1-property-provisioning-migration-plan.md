# Recovery E0-C1 — Property Provisioning Migration Plan

## Scope and fact-layer impact

Recovery E0-C1 changes the **platform provisioning control plane only**. It does not add, amend, or reinterpret any D0–D4 fact layer. In particular, it creates no employee, organization, Course, Requirement, Plan, Session, Attendance, or Completion fact.

The migration is intended for a reviewed non-production environment first. Production migration remains outside this change and requires separate approval.

## Additive migration

`20260729161419_recovery_e0_c1_property_provisioning_handoff.sql` replaces the existing, C0-audited `public.provision_initial_property_and_manager(uuid, jsonb, jsonb)` implementation. It does not create a new table or change table structure.

It changes only the initial handoff states produced by the narrow platform RPC:

| Surface | Previous C0 state | C1 state | Reason |
| --- | --- | --- | --- |
| `user_accounts.account_status` | `invited` | `active` | The existing hotel authentication boundary accepts only active accounts. |
| `user_accounts.must_change_password` | `true` | `true` | Preserves forced first-password-change handoff. |
| `property_domains.verification_status` | `pending` | `verified` | Makes the validated initial property hostname resolvable. |
| Provisioning audit evidence | invited / pending | active / verified / password-change-required | Records the actual handoff state. |
| RPC response | internal account reference | redacted manager display name and handoff state | Avoids exposing internal identity identifiers. |

## Affected security surfaces

- `public.provision_initial_property_and_manager(uuid, jsonb, jsonb)` only.
- Existing `app_private.assert_platform_provisioner()` remains the sole platform-plane authorization assertion.
- Existing grants remain narrow: `PUBLIC` and `anon` have no execute privilege; only `authenticated` may invoke, and the function itself rejects every non-active `platform_admin` membership.
- Existing C0 RLS policies remain unchanged. The platform actor cannot select hotel employee data, hotel accounts, organization, import, or D1–D4 facts.
- The server-side C1 route may create the initial technical Auth identity through the existing admin client only after an actor-bound, password-bound preview has been verified. It then calls the RPC using the platform actor token. On RPC failure it deletes only that newly created technical identity.

## Rollback / forward correction

No destructive rollback is appropriate after a Property handoff has been committed. If a defect is found before use, a reviewed forward-only migration must replace the RPC implementation and preserve `platform_provisioning_events` as evidence. It must never delete or rewrite a committed property handoff, manager account, or audit event in place.

## Verification plan

1. Clean local Supabase reset and replay all migrations.
2. Focused C1 pgTAP: authorized provisioning, forced password change, resolvable hostname, no D0–D4/business facts, RLS denial, and manager RPC denial.
3. Full pgTAP suite, application tests, build, rendered output, and browser authorization checks.
4. Any local test records are synthetic and disposable. No Production connection, migration, user, Property, employee, or training fact is authorized by this plan.
