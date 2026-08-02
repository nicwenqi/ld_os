# Platform Property Account Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure Platform Admin Console for existing-Property Hotel L&D Manager account lifecycle management without exposing hotel business data or changing D0-D4 fact semantics.

**Architecture:** Keep `/platform/properties/new` as the new-Property provisioning flow. Add a Property index and Property account detail flow backed by narrow platform-only RPC projections and mutations. Auth identities are created/reset only server-side; the browser sees User ID and business-safe account health, never internal Auth email or Auth UUID.

**Tech Stack:** Next/Vinext App Router, TypeScript/React, Supabase PostgreSQL migrations/RPCs/RLS, Node built-in test runner, pgTAP.

## Global Constraints

- Only active `platform_admin` may use the new platform account-management APIs.
- Platform Admin can manage only Hotel L&D Manager accounts; Department Training Responsible Person and department scope remain hotel-plane responsibilities.
- The browser must not directly read or write authorization, Auth, employee, Storage, or training tables.
- `SUPABASE_SECRET_KEY` and Auth Admin API calls remain server-only.
- Internal Auth email is never returned to browser or used as the business contact email.
- Manager `normalized_login_id` is globally unique across `user_accounts`.
- The final active Hotel L&D Manager is protected.
- No D0-D4 table semantics, facts, employees, training facts, Production schema or Production data may change.
- Existing `/platform/properties/new` provisioning behavior remains separate and unchanged.

---

### Task 1: Add failing domain/security tests

**Files:**
- Create: `tests/recovery-e0-platform-property-account-management.test.mjs`
- Test: `tests/recovery-e0-platform-property-account-management.test.mjs`

**Interfaces:**
- Consumes: existing platform auth, provisioning route, account role code and migration conventions.
- Produces: executable source-contract and security expectations for all later tasks.

- [ ] **Step 1: Write the failing tests**

Assert the migration and source must provide:

```js
assert.match(sql, /platform_account_management_events/);
assert.match(sql, /platform_list_properties\(\)/);
assert.match(sql, /platform_list_property_manager_accounts\(p_property_id uuid\)/);
assert.match(sql, /platform_create_property_manager_account/);
assert.match(sql, /platform_replace_property_manager/);
assert.match(sql, /platform_set_property_manager_status/);
assert.match(sql, /platform_prepare_manager_password_reset/);
assert.match(sql, /assert_platform_provisioner/);
assert.match(sql, /create unique index .*user_accounts.*normalized_login_id/i);
assert.match(sql, /before update or delete.*append/i);
assert.doesNotMatch(sql, /grant\s+.*on\s+table[\s\S]*to\s+service_role/i);
```

Assert routes/pages use platform session and RPC boundaries and do not expose forbidden data:

```js
assert.match(indexRoute, /requirePlatformProvisioner/);
assert.match(accountsRoute, /requirePlatformProvisioner/);
assert.match(accountsRoute, /actorClient\.rpc/);
assert.doesNotMatch(accountsRoute, /from\("employees"\)|from\("departments"\)/);
assert.doesNotMatch(platformPages, /internalEmail|authUserId|service_role|SUPABASE_SECRET_KEY/);
assert.match(newPage, /创建 Pilot Property/);
```

Assert manager validation rejects unsupported roles, contact/Auth email input, duplicate scopes and short passwords, while accepting a valid User ID.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --experimental-strip-types --test tests/recovery-e0-platform-property-account-management.test.mjs`

Expected: FAIL because the migration, routes and platform pages do not yet exist.

---

### Task 2: Create the additive local migration and pgTAP boundary

**Files:**
- Create via CLI: `supabase/migrations/<generated>_platform_property_account_management.sql`
- Create: `supabase/tests/recovery_e0_platform_property_account_management.sql`

**Interfaces:**
- Consumes: `app_private.assert_platform_provisioner()`, `app_private.count_active_property_managers()`, existing `properties`, `property_domains`, `profiles`, memberships, role assignments and `user_accounts`.
- Produces: narrow RPCs consumed by the server routes.

- [ ] **Step 1: Create the migration filename through Supabase CLI**

Run: `npx supabase migration new platform_property_account_management`

Use the generated filename; do not invent a timestamp. Edit the generated file only with `apply_patch`.

- [ ] **Step 2: Add global Manager User ID uniqueness**

Create a unique index on `public.user_accounts(normalized_login_id)`. Preserve the existing per-Property unique constraint; the new index prevents login ambiguity across Properties. Do not alter Employee Fact, Requirement, Plan, Session, Attendance or Completion tables.

- [ ] **Step 3: Add append-only audit table and trigger**

Create `public.platform_account_management_events` with:

```sql
id uuid primary key default extensions.gen_random_uuid(),
tenant_id uuid not null references public.tenants(id),
property_id uuid not null references public.properties(id),
account_id uuid references public.user_accounts(id),
target_auth_user_id uuid references auth.users(id),
performed_by uuid not null references auth.users(id),
event_type text not null,
outcome text not null check (outcome in ('requested','succeeded','failed')),
request_id text not null,
request_hash text not null,
before_state jsonb not null default '{}'::jsonb,
after_state jsonb not null default '{}'::jsonb,
error_code text,
occurred_at timestamptz not null default now()
```

Enable and force RLS, revoke all direct grants from `public`, `anon`, `authenticated` and `service_role`, and add an append-only trigger rejecting update/delete. The RPCs write events as their definer; no direct event reads are exposed to hotel roles.

- [ ] **Step 4: Add platform-safe read RPCs**

Implement `public.platform_list_properties()` and `public.platform_list_property_manager_accounts(p_property_id uuid)` with fixed search path and `app_private.assert_platform_provisioner()`. Return only business-safe JSON projections: Property identity/readiness and Manager account health. Never return employee, department, scope, internal email or Auth UUID fields.

- [ ] **Step 5: Add platform Manager lifecycle RPCs**

Implement these exact capabilities:

```text
platform_create_property_manager_account(
  p_property_id uuid, p_auth_user_id uuid, p_internal_email text,
  p_login_id text, p_display_name text, p_request_id text
)

platform_prepare_manager_password_reset(
  p_property_id uuid, p_account_id uuid, p_expected_version bigint,
  p_request_id text
)

platform_set_property_manager_status(
  p_property_id uuid, p_account_id uuid, p_expected_version bigint,
  p_account_status text, p_request_id text
)

platform_replace_property_manager(
  p_property_id uuid, p_old_account_id uuid, p_new_auth_user_id uuid,
  p_new_internal_email text, p_new_login_id text, p_new_display_name text,
  p_request_id text
)
```

Each function must:

- require the active platform provisioner;
- validate the Property and target role as `property_ld_manager`;
- enforce global User ID uniqueness;
- lock the Property/account advisory key;
- preserve final active Manager protection;
- create/update only account linkage metadata and audit events;
- never create employees, scopes or training facts;
- avoid returning internal Auth identifiers or email.

The reset preparation RPC returns an internal Auth identity only to the server route; the route never serializes that value. The replace RPC inserts the new account before disabling the old account in the same transaction.

- [ ] **Step 6: Restrict RPC execution and add pgTAP assertions**

Revoke all function execution from `public`, `anon` and `service_role`; grant only to `authenticated`. Add pgTAP tests for:

- active platform admin can call reads and lifecycle RPCs through an authenticated actor context;
- anonymous and hotel-role contexts are denied;
- property IDs from another tenant are denied;
- platform membership alone never grants hotel workspace authorization;
- RPC projections contain no employee, department scope, training fact, internal email or Auth UUID fields;
- duplicate global User ID is rejected;
- final Manager disable/replace is rejected without an active successor;
- audit rows are append-only;
- no D0-D4 tables are touched by the migration/RPCs.

- [ ] **Step 7: Run the local focused pgTAP test and verify GREEN**

Run: `supabase db reset --local --no-seed` then `supabase test db --local` with the focused file selected according to the repository's test command. Expected: focused assertions pass.

---

### Task 3: Add server-side platform account service and API routes

**Files:**
- Create: `app/services/platform-property-accounts.ts`
- Create: `app/api/platform/properties/index/route.ts`
- Create: `app/api/platform/properties/[propertyId]/accounts/route.ts`
- Modify: `app/services/platform-authorization.ts` only if a shared platform actor helper is needed; preserve existing C1 behavior.
- Test: `tests/recovery-e0-platform-property-account-management.test.mjs`

**Interfaces:**
- Consumes: `PlatformActor`, `requirePlatformProvisioner`, RPC signatures from Task 2, `createServerAdminClient`, existing password validator conventions.
- Produces: platform-only HTTP projections and lifecycle actions for the client.

- [ ] **Step 1: Add business-safe types and validation**

Define `PlatformPropertySummary`, `PlatformManagerAccountSummary` and `PlatformAccountOperation` types. Validate:

- User ID: 3–80 characters `[A-Za-z0-9._-]`;
- display name required;
- temporary password at least 12 characters with letters and digits;
- role fixed internally to `property_ld_manager`;
- no browser-supplied email, Auth ID, tenant ID or role code accepted;
- request ID generated server-side if absent, bounded to prevent log abuse.

- [ ] **Step 2: Implement Property overview GET**

Call `requirePlatformProvisioner`, then `actorClient.rpc("platform_list_properties")`. Return `source: "real"` and the projection with no direct table reads. Return 401/403 without leaking Property existence for unauthenticated/non-platform actors.

- [ ] **Step 3: Implement account list and lifecycle POST/PATCH/PUT**

Use the selected Property ID only as a route identifier passed to the RPC; all ownership and role checks remain server-side. Implement:

- GET account metadata through `platform_list_property_manager_accounts`;
- POST `create` using server-created internal email/Auth identity plus create RPC and compensation delete;
- POST `replace` using a newly created Auth identity plus replace RPC and compensation delete;
- PATCH status using expected version and status RPC;
- PUT reset using reset preparation RPC, server Admin Auth password update, and append success/failure event RPC if required by the migration.

Never return `internalEmail`, `auth_user_id`, raw Supabase errors or passwords.

- [ ] **Step 4: Run focused route/security tests and verify GREEN**

Run: `node --experimental-strip-types --test tests/recovery-e0-platform-property-account-management.test.mjs`

Expected: PASS, including no direct employee/scope/business-fact table access and no browser exposure of internal Auth identity.

---

### Task 4: Build the existing-Property Platform Console UI

**Files:**
- Create: `app/platform/properties/page.tsx`
- Create: `app/platform/properties/[propertyId]/page.tsx`
- Modify: `app/platform/platform.css`
- Modify: `app/platform/properties/new/page.tsx` only for navigation copy/return link separation if tests identify a necessary correction.
- Test: `tests/recovery-e0-platform-property-account-management.test.mjs`

**Interfaces:**
- Consumes: Task 3 GET/mutation endpoints and business-safe types.
- Produces: mobile-safe Property index and Manager lifecycle console.

- [ ] **Step 1: Add failing UI assertions**

Assert the pages include:

- `已有 Property` / `Property 管理` context;
- Manager status, last-login and password-change indicators;
- actions for 创建、重置密码、禁用、启用、更换管理员;
- no Department scope editor or employee/training navigation;
- return links to `/platform/properties` and logout;
- disabled/loading/error states and 44px controls.

- [ ] **Step 2: Implement Property index**

Load `/api/platform/properties`, show real/unavailable/error states without demo fallback, and link each Property to its detail route. Keep `/platform/properties/new` as a visibly separate “新酒店接入” action.

- [ ] **Step 3: Implement Property account detail**

Load the selected Property account projection. Show Manager health in plain Chinese, allow only permitted lifecycle actions, require confirmation for status changes and replacement, and show one-time temporary password input without retaining or rendering it after submission.

- [ ] **Step 4: Implement responsive/premium interaction states**

Reuse existing platform colors and spacing, ensure keyboard focus, 44px touch targets, no horizontal overflow, and concise audit-success/conflict/error messaging. No toast-only action may remain.

- [ ] **Step 5: Run focused UI tests and verify GREEN**

Run: `node --experimental-strip-types --test tests/recovery-e0-platform-property-account-management.test.mjs tests/recovery-e0-c1-platform-ui.test.mjs`

Expected: PASS.

---

### Task 5: Register focused tests and run regression verification

**Files:**
- Modify: `package.json`
- Test: `tests/recovery-e0-platform-property-account-management.test.mjs`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces: repeatable focused and full application verification.

- [ ] **Step 1: Add the focused test file to the application test script**

Append `tests/recovery-e0-platform-property-account-management.test.mjs` without removing any existing test.

- [ ] **Step 2: Run full application tests**

Run: `npm test`

Expected: all existing and focused tests pass.

- [ ] **Step 3: Run a clean local Supabase reset and full pgTAP**

Run: `supabase db reset --local --no-seed` then the repository's full local pgTAP command. Expected: all migration and security assertions pass.

- [ ] **Step 4: Run production build and rendered-page verification**

Run: `npm run build` and `node --test tests/rendered-html.test.mjs`.

Expected: build succeeds with no new runtime secret exposure and platform pages render.

- [ ] **Step 5: Confirm no Production change**

Verify no Production migration, data write, Auth operation, deployment, DNS or environment-variable mutation occurred during this implementation.

- [ ] **Step 6: Commit the implementation**

Stage only implementation migration, pgTAP, application code, focused tests, package script and any UI stylesheet changes. Do not stage existing user documentation edits. Commit message:

```bash
git add supabase/migrations/<generated>_platform_property_account_management.sql supabase/tests/recovery_e0_platform_property_account_management.sql app/api/platform/properties app/services/platform-property-accounts.ts app/platform/properties app/platform/platform.css tests/recovery-e0-platform-property-account-management.test.mjs package.json
git commit -m "feat(platform): manage existing property manager accounts"
```

---

## Review Stop

Stop after local verification and commit. Report:

- routes and UI;
- RPCs and migration impact;
- authorization and data isolation evidence;
- account lifecycle behavior;
- tests, pgTAP and build;
- Production untouched confirmation;
- whether a separate migration/deployment approval is required.

Do not apply the migration to Production or create/modify any Production account until explicitly approved.
