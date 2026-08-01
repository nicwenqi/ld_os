# Review Stop C5-B — Initialization API Resolution

**Date:** 2026-08-01  
**Branch:** `codex/recovery-e0-pilot-readiness`  
**Status:** Conditional pass — implementation and all required verification pass; disposal of the local-only Supabase browser fixture is awaiting a functioning explicit-approval path.

## Scope completed

- `/api/initialization/access` now keeps the C5-A chain intact: HttpOnly session, Supabase Auth verification, `resolve_hotel_application_session()`, server-resolved manager context, then the initialization readiness projection.
- The route no longer creates a privileged server client and no longer reads `role_assignments`, `property_memberships`, `user_accounts`, profiles, or `trainer_scopes` directly.
- A single narrow authenticated RPC, `get_property_initialization_access_summary(uuid)`, returns the existing business projection without changing its fields or activation rules.
- The API supplies only the server-resolved `actor.propertyId`; a caller-supplied different property remains an explicit 403.
- A runtime parser rejects malformed or internally inconsistent projections rather than presenting misleading readiness.

## Migration

`20260801102950_recovery_e0_c5b_initialization_access_projection.sql`

The migration adds one `stable SECURITY DEFINER` function with `search_path = ''`. Execution is revoked from `PUBLIC`, `anon`, `service_role`, and then granted only to `authenticated`. It changes no table, trigger, RLS policy, Storage policy, initialization rule, employee fact, or D1-D4 fact.

Rollback is a forward correction: deploy the previous API consumer first, revoke the authenticated execute grant, then drop this one function. No data rollback is required.

## Authorization evidence

| Actor or condition | Result |
| --- | --- |
| Active Hotel L&D Manager, own property | Allowed; unchanged readiness projection returned |
| Department Training Responsible Person | Denied |
| Platform identity | Denied |
| Legacy tenant administrator | Denied |
| Manager requesting another property | Denied |
| Missing authenticated identity | Denied |
| `service_role` direct authorization-table reads | Still denied; no table grant added |

The database rechecks `auth.uid()` through the unified active-account, active membership, active role boundary. Browser-supplied user, role, scope, tenant, or property authority is never trusted.

## Verification

- Clean local Supabase reset and complete ordered migration replay: PASS.
- Focused C5-B pgTAP: 12/12 PASS.
- Complete pgTAP: 30 files, 897/897 PASS.
- Existing C2 activation tests: PASS.
- Application tests: 298/298 PASS.
- Production build: PASS.
- Rendered HTML test: PASS.
- ESLint: 0 errors; 4 pre-existing warnings outside C5-B.
- `git diff --check`: PASS.

## Browser verification

The browser used only local Supabase, the repository synthetic seed, disposable Auth-compatible accounts, and the local development server.

- Manager login redirected to `/initialize`; the five-section activation UI loaded and showed one active manager. Server evidence recorded `/api/initialization/access?...A1` as HTTP 200 instead of the previous 422.
- A manager request for A2 was HTTP 403.
- Department login resolved the explicit Front Office scope; direct `/initialize` navigation ended at `/access-denied`.
- Platform login remained in the provisioning plane; direct `/initialize` navigation returned to the hotel login boundary.
- Anonymous `/initialize` navigation redirected to `/login?returnTo=%2Finitialize`.
- Manager initialization UI had no framework error overlay and no horizontal overflow at normal and 390px widths.
- No unexpected application request failed. The only console messages were Chrome-extension hydration warnings identifying injected `data-new-gr-c-s-check-loaded` and `data-gr-ext-installed` body attributes; they are not emitted by the application or C5-B route.

Both hotel and platform sessions were explicitly logged out and all temporary browser tabs were finalized. The local app server was stopped. The final `supabase stop --no-backup` cleanup command was not executed because the managed approval service rejected the request with its own parameter-processing error. No bypass was attempted; the disposable local database therefore remains the sole open closure item.

## Boundary confirmation

- No C5 Plan or Session behavior changed.
- No employee, Requirement, Plan, Session, Attendance, Completion, KPI, Feedback, Reminder, Forecast, Risk, Health, or AI fact was created by the implementation.
- D0-D4 fact semantics are unchanged.
- Production Supabase, Production deployment, DNS, environment variables, real hotel data, and real employee data were untouched.
- C5-B did not continue to Pilot.
