# Review Stop 2C-E.1 — Authentication and Application Entry Recovery

## Outcome

The hotel hostname selects the property context. A person signs in with a hotel-facing User ID and password. The server resolves that User ID to a private Supabase Auth identity, Supabase Auth verifies the password, and persisted memberships plus role assignments determine the destination and navigation. The initialization wizard remains an administrator tool and never replaces the normal application root.

## Chosen authentication approach

Three approaches were considered:

1. Construct an internal email in the browser. This is simple but exposes the identifier convention and trusts browser-supplied property context, so it is rejected.
2. Expose a public database resolver. This avoids browser construction but creates an account-enumeration surface and cannot safely verify passwords itself, so it is rejected.
3. Resolve User ID inside a restricted server route, then call Supabase Auth password verification. This keeps the mapping private and allows hostname, account status, membership, and role checks in one trusted boundary. This is the selected approach.

For hosted real-data modes, the resolver uses a separate server-only Supabase client initialized with `SUPABASE_SECRET_KEY`. The client is never imported into client components, does not persist sessions, and is used only to resolve the private login mapping and load authorization facts. Password verification uses a separate publishable-key Auth client. Local mock login is available only when `APP_ENV=local` and `APP_DATA_MODE=mock`.

## Account model

Add `public.user_accounts` with:

- `id`, `user_id`, `auth_user_id`, `tenant_id`, `property_id`, optional `employee_id`
- immutable `login_id` and `normalized_login_id`
- `account_status`: `invited`, `active`, `suspended`, or `disabled`
- `must_change_password`, `failed_login_count`, `locked_until`, `last_login_at`
- audit timestamps and optimistic `version`

The uniqueness rule is explicit: `normalized_login_id` is unique within one property. The same visible User ID may exist at two different properties because hostname resolution selects the property first. The normalization rule is trim plus lowercase; employee numbers remain text and leading zeroes are preserved.

Account responsibilities remain separate:

- account: login identity and account state
- membership: tenant/property belonging
- role assignment: allowed capabilities
- trainer scope: department branches

No role code is stored on `user_accounts`.

## Server boundaries and session

Routes:

- `POST /api/auth/login`: validate User ID/password, resolve property hostname, verify Supabase password, reject inactive account or membership, load effective role, establish an HttpOnly session, and return the server-selected destination.
- `GET /api/auth/session`: validate the current server session and re-read effective authorization facts.
- `POST /api/auth/logout`: revoke or clear the session and return `/login`.

Unknown User ID and wrong password return the same generic message. A disabled status is shown only after successful password verification. A client-provided role is ignored. Hosted sessions are backed by Supabase Auth tokens and server verification; the local synthetic session uses an HttpOnly development cookie and cannot be enabled in Preview or Production.

The supported effective roles and destinations are:

| Effective role | Destination |
| --- | --- |
| platform administrator | `/platform` |
| tenant administrator or property L&D manager | `/` |
| department training administrator | `/department` |
| employee participant | `/my-training` |
| authenticated without valid property access | `/access-denied` |

## Application entry and authorization

`/` checks the server session. Anonymous visitors go to `/login`. A manager stays on the hotel operations dashboard even when setup is incomplete. Department administrators, employees, and unauthorized accounts are redirected to their server-selected homes.

Every protected shell load revalidates the session through the server boundary. Role-aware navigation is presentation only; the server/database authorization remains authoritative. Direct access to an unauthorized module results in the correct role home or `/access-denied`.

The prototype role switcher is removed from ordinary application navigation. No Preview or Production build can expose a synthetic role selector.

## Initialization and readiness

`/initialize` remains a standalone administrator experience. It permits Platform Admin, Tenant Admin, and Property L&D Manager editing. It gains a visible `返回运营首页` action while keeping save status, save-and-continue-later, dirty-change confirmation, and last-step resume.

Readiness has two layers:

- minimum hotel-ready: valid identity, required business rules, at least one active official department, and at least one active Property L&D Manager account
- operational-ready: all eight setup steps and dependent import/mapping facts are complete

Minimum readiness unlocks normal operations. Missing operational setup restricts only dependent modules. The manager dashboard shows a non-blocking setup card with completion, minimum/operational status, blockers, warnings, next action, and links to initialization, settings, organization, and import. The card can collapse only after minimum readiness.

## Save-state contract

Settings and wizard steps use one state machine:

- `pristine`: 未修改
- `dirty`: 有未保存更改
- `saving`: 保存中
- `saved`: 已保存 · HH:mm
- `error`: 保存失败，点击重试

`确认并继续` validates, persists through a repository, re-reads the latest version, then advances. A failed save stays on the current step and never marks it complete. Refresh uses persisted facts and progress as the source of truth.

## UI structure

- `/login`: standalone branded Chinese-first login, readable at desktop/tablet/mobile sizes
- `/`: existing premium executive dashboard plus compact setup card and mock-data disclosure
- `/department`: scoped department administrator landing page
- `/my-training`: employee landing page with no administration navigation
- `/platform`: minimal platform administrator landing page
- `/access-denied`: authenticated access explanation and logout
- `/initialize`: existing wizard with administrator guard and return action

The manager sidebar is reorganized around operations plus a `系统设置` group. Dense organization, mapping, account, and data-management functions are expressed as separate destinations or grouped settings links rather than one monolithic permissions page.

## RLS and database safety

`user_accounts` has forced RLS. Anonymous has no grants. An authenticated user may read only their own account row. Platform administrators and tenant administrators may manage accounts inside their authorized scope. Property L&D Managers receive restricted property account-management policies but cannot assign tenant/platform roles. Department administrators and employees cannot manage account mappings.

Identity/scope columns are immutable through table-safe triggers. Role assignment policies remain the source of role truth. No policy uses `user_metadata`, `using (true)`, or `with check (true)`. The server-side login resolver is not exposed as a public Data API function.

## Verification and exclusions

Verification covers local reset, all pgTAP suites, application tests, rendered HTML, production build, role-path browser tests, login/logout, persistence, responsive login checks, console inspection, and secret/real-data scans.

This checkpoint does not create production users, initialize a real hotel, import employees or training facts, migrate KPI data, deploy, publish, modify DNS, apply cloud migrations, merge, or start a later review stop.
