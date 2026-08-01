# Review Stop C5-A — Authentication Resolution Boundary

Date: 2026-08-01

Branch: `codex/recovery-e0-pilot-readiness`

Decision: **C5-A PASS**. This decision applies only to the approved authentication-resolution boundary. C5 remains Conditional Pass and Pilot has not started.

## Implemented boundary

- `resolve_hotel_login_identity(hostname, login_id)` is the only pre-auth User ID lookup. It returns only the internal Auth email, runs as a fixed-search-path `SECURITY DEFINER`, requires the technical server role, and grants no table access.
- `resolve_hotel_application_session(hostname)` derives the actor exclusively from `auth.uid()`, then requires an active account, tenant membership, property membership, approved hotel role, exact verified property hostname, and an explicit active department scope for a department responsible person.
- `record_hotel_login_success(hostname)` changes only the authenticated actor's own login telemetry after the full hotel session resolves.
- Hotel login, request authentication and session refresh use these RPCs instead of privileged reads of authorization tables.
- The disposable local browser harness creates Auth-compatible synthetic identities only, generates a new one-time review password on every preparation, derives local keys at runtime, binds the server secret only to the local Worker runtime, and stores no reusable credential, token or environment file.

## Migration and authorization result

Migration: `20260801074717_recovery_e0_c5a_authentication_resolution_boundary.sql`.

- Added three functions and their comments/grants only.
- `resolve_hotel_login_identity`: execute only by `service_role`.
- `resolve_hotel_application_session` and `record_hotel_login_success`: execute only by `authenticated`.
- PUBLIC and all other listed roles were explicitly revoked before the narrow grants.
- Every function has an empty fixed `search_path`.
- No table grant was added to `service_role`.
- No RLS policy, Storage policy, Property, employee, import or D0-D4 fact semantic changed.
- Platform and legacy tenant memberships cannot resolve hotel application sessions.
- Department scope is returned from the active server-side assignment; no browser-supplied user, property, role or scope is trusted.

Rollback remains a forward-correction operation: revoke the three execute grants, remove application calls, then drop the three functions only after the prior application version is restored. There is no business-data rollback because the migration creates no business fact or table.

## Verification evidence

### Database

- Clean local Supabase reset: PASS; all migrations replayed in order through C5-A.
- Focused C5-A pgTAP: 1 file, 32 tests, PASS.
- Complete pgTAP: 29 files, 885 tests, PASS.
- Tests prove exact grants, no PUBLIC execution, no `service_role` table grant, platform/tenant denial, manager resolution, department scope resolution, cross-property denial and own-account-only login telemetry.

### Application and build

- Focused authentication/wiring tests: 24/24 PASS.
- Complete application tests: 296/296 PASS.
- Production build: PASS.
- Rendered HTML test: 1/1 PASS.
- Lint: 0 errors; 4 inherited warnings outside C5-A.
- Client bundle inspection: no `SUPABASE_SECRET_KEY` or `sb_secret_` marker.

### Browser

Only the disposable local Supabase instance and repository synthetic fixtures were used.

| View | Result |
| --- | --- |
| Manager, 1440 px | Login API 200; session API 200; role `property_ld_manager`; property context A1; internal Auth email absent; boundary-only console errors 0, failed requests 0, overflow 0. |
| Department, 820 px | Redirected to `/department`; only the explicit Front Office scope and breadcrumb were visible; `/settings/hotel` redirected to `/access-denied`; console errors 0, failed requests 0, overflow 0. |
| Mobile login, 390 px | Anonymous `/` redirected to `/login?returnTo=%2F`; platform identity received the generic expected 401 and no hotel session; overflow 0; minimum visible touch target 48 px. |
| Keyboard | Login controls exposed a 3 px visible focus outline and supporting focus shadow. |

The manager's normal redirect reached `/`. After authentication succeeded, the existing `/api/initialization/access` request returned 422 because that older administration summary still attempts a privileged `user_accounts` table read that C0 intentionally removed. No table grant or fourth RPC was added to hide this. It remains explicit C5 browser-evidence debt outside the approved three-RPC C5-A boundary.

## Cleanup and protection confirmation

- Browser tabs were closed.
- The local application server was stopped.
- `supabase stop --no-backup` removed the disposable local database, Auth identities and sessions.
- The randomized harness was re-run end to end after removing the fixed test password; login and session resolution both returned 200 with no console or network failure.
- No temporary `.env` file, reusable password, token or browser bypass artifact remains.
- Production Supabase, Production Auth, Production data, Vercel, DNS and deployments were untouched.
- No Plan, Session, Attendance, Completion or other training fact was created.
- Pilot was not started.
