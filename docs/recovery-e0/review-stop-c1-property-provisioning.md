# Review Stop C1 — Property Provisioning

**Recovery phase:** E0-C1 — Property Provisioning
**Data classification:** disposable local database fixtures and local-review browser mode only
**Production status:** not connected, not migrated, and not changed

## Implemented scope

C1 establishes a narrow platform-plane handoff:

1. An active `platform_admin` may invoke the audited provisioning RPC.
2. The RPC creates exactly one Property container, verified initial hostname context, default `not_started` property settings, one active Hotel L&D Manager account with forced password change, active memberships, one manager role assignment, and one append-only provisioning event.
3. The separate `/platform` control-plane UI requires a platform session, performs an actor-bound, 15-minute, password-bound zero-write preview, and only then calls the controlled commit endpoint.
4. In local mock review, the commit endpoint returns a conspicuous `local_review` handoff and creates no Property, Auth user, employee, or hotel/training business fact.

The platform operator has no navigation into the hotel workspace. The initial manager must complete the existing password-change boundary before ordinary hotel work.

## Fact, history, and audit impact

No D0–D4 fact semantics changed. C1 creates no employee, organization, Course, Requirement, Plan, Session, Attendance, or Completion fact.

The only new/changed control-plane evidence is the existing append-only `platform_provisioning_events` record. It retains the platform actor, time, exact request hash, Property, initial manager account, verified hostname, active-account state, and forced-password-change handoff state. The C1 RPC response is redacted and contains no manager Auth ID, internal email, or account ID.

## Authorization result

- `platform_admin` is allowed only through `provision_initial_property_and_manager`.
- It cannot query newly provisioned hotel employees or manager-account surfaces, cannot use hotel management helpers, and cannot access D1–D4 facts.
- A Hotel L&D Manager cannot call the provisioning RPC.
- The browser commits no hotel-table DML. The server creates the technical Auth identity through the existing admin boundary, invokes the RPC as the platform actor, and compensates by deleting only that newly created identity if the RPC fails.

## Verification evidence

- Clean local Supabase reset replayed all migrations, including C0 and C1.
- Focused C1 pgTAP: **19 / 19 pass**.
- Complete pgTAP: **781 / 781 pass** across 24 files.
- Application tests: **282 / 282 pass**.
- Production build and rendered HTML test: pass.
- Local browser verification: platform login, preview, local-review handoff, platform-to-hotel workspace isolation, desktop and 390px mobile rendering, keyboard focus, 44px buttons, no horizontal overflow, no console errors, and no failed requests: pass.
- Local database lint reports one pre-existing Recovery C type-cast warning in `app_private.prepare_employee_import_preview_base`; no C1 warning was added.

## Review decision

**C1 implementation is ready for Review Stop C1.** C2 has not started. No Production or real hotel data action is authorized or performed by this review.
