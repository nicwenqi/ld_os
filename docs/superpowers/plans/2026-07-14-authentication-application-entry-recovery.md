# Authentication and Application Entry Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure User ID/password entry flow, server-backed role routing, and non-blocking hotel initialization status without touching production systems or real data.

**Architecture:** A new account table maps property-scoped login IDs to private Supabase Auth users while memberships and role assignments remain authoritative. Client pages call a narrow authentication repository backed by local synthetic accounts only in local mock mode and server routes in hosted modes. A shared session guard and role-aware shell enforce entry/navigation, while initialization readiness is derived from persisted facts.

**Tech Stack:** Vinext/Next App Router, React 19, TypeScript, Supabase Auth/Postgres/RLS, pgTAP, Node test runner.

## Global Constraints

- Base branch is `e9e5cbda274627e1f249dedfb41ec4a1081773ad`; implementation branch is `codex/checkpoint-2c-e1`.
- User-facing authentication is User ID plus password only; no email, OTP, Magic Link, MFA, SSO, social, phone, or role selector.
- `normalized_login_id` is unique within one property; role truth is never duplicated on the account row.
- Mock login is allowed only for `APP_ENV=local` and `APP_DATA_MODE=mock`.
- Preview and Production must not expose synthetic role controls or local mock account APIs.
- No production Supabase changes, production users, real hotel/employee data, deployment, DNS, publication, merge, or later review stop.

---

### Task 1: Account schema and RLS foundation

**Files:**
- Create: `supabase/migrations/20260714025646_user_accounts_and_auth_security.sql`
- Create: `supabase/tests/authentication_entry_test.sql`
- Modify: `supabase/config.toml`

**Interfaces:**
- Produces: `public.user_accounts`, `public.account_status`, immutable identity trigger, own-account select policy, administrator management policies.
- Consumes: existing `profiles`, `tenants`, `properties`, `employees`, memberships, role assignments, and `app_private` authorization helpers.

- [ ] **Step 1: Create the migration shell with Supabase CLI**

```bash
supabase migration new user_accounts_and_auth_security
```

- [ ] **Step 2: Write failing pgTAP coverage**

```sql
select has_table('public', 'user_accounts');
select throws_ok($$ select * from public.user_accounts $$, '42501');
select throws_ok($$ update public.user_accounts set tenant_id = gen_random_uuid() $$, '23514');
```

- [ ] **Step 3: Verify the new database tests fail**

```bash
supabase db reset --local
supabase test db --local supabase/tests
```

Expected: authentication-entry assertions fail because `user_accounts` does not exist.

- [ ] **Step 4: Implement the constrained table and policies**

```sql
create type public.account_status as enum ('invited','active','suspended','disabled');
create table public.user_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  auth_user_id uuid not null references auth.users(id),
  tenant_id uuid not null references public.tenants(id),
  property_id uuid not null,
  employee_id uuid,
  login_id text not null,
  normalized_login_id text generated always as (lower(btrim(login_id))) stored,
  account_status public.account_status not null default 'invited',
  must_change_password boolean not null default true,
  failed_login_count integer not null default 0 check (failed_login_count >= 0),
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (property_id, normalized_login_id),
  unique (property_id, auth_user_id)
);
```

Add composite ownership foreign keys, forced RLS, explicit Data API grants, table-safe immutability trigger, and least-privilege policies without public lookup access.

- [ ] **Step 5: Re-run local database verification**

```bash
supabase db reset --local
supabase test db --local supabase/tests
```

Expected: all existing and new pgTAP assertions pass.

### Task 2: Authentication contracts and deterministic role routing

**Files:**
- Create: `app/repositories/contracts/auth-repository.ts`
- Create: `app/services/auth-routing.ts`
- Create: `app/repositories/mock/auth-repository.ts`
- Create: `tests/authentication-entry.test.mjs`
- Modify: `app/repositories/registry.ts`

**Interfaces:**
- Produces: `AuthSession`, `EffectiveRole`, `AuthRepository`, `homeForRole(role)`, and a local-only mock adapter.
- Consumes: parsed application environment and property context.

- [ ] **Step 1: Write failing unit tests for routing and login outcomes**

```ts
assert.equal(homeForRole('platform_admin'), '/platform');
assert.equal(homeForRole('property_ld_manager'), '/');
assert.equal(homeForRole('department_training_admin'), '/department');
assert.equal(homeForRole('employee'), '/my-training');
assert.equal(homeForRole('unauthorized'), '/access-denied');
```

Test missing fields, generic invalid credentials, disabled accounts, successful login, logout, and rejection outside local mock mode.

- [ ] **Step 2: Verify unit tests fail for missing modules**

```bash
node --experimental-strip-types --test tests/authentication-entry.test.mjs
```

Expected: module-not-found or missing export failure.

- [ ] **Step 3: Implement the contracts**

```ts
export type EffectiveRole = 'platform_admin'|'tenant_admin'|'property_ld_manager'|'department_training_admin'|'employee'|'unauthorized';
export type AuthSession = { authenticated:boolean; userId:string|null; displayName:string|null; propertyId:string|null; role:EffectiveRole; mustChangePassword:boolean };
export interface AuthRepository {
  login(input:{loginId:string;password:string;hostname:string}):Promise<AuthSession>;
  getSession():Promise<AuthSession>;
  logout():Promise<void>;
}
```

The mock adapter contains only synthetic local accounts and uses a local HttpOnly route rather than local storage.

- [ ] **Step 4: Implement role routing and register the adapter**

```ts
export function homeForRole(role: EffectiveRole) {
  return ({platform_admin:'/platform',tenant_admin:'/',property_ld_manager:'/',department_training_admin:'/department',employee:'/my-training',unauthorized:'/access-denied'})[role];
}
```

- [ ] **Step 5: Run the focused tests**

```bash
node --experimental-strip-types --test tests/authentication-entry.test.mjs
```

Expected: all authentication contract tests pass.

### Task 3: Restricted login/session server routes

**Files:**
- Create: `app/lib/supabase/server-admin.ts`
- Create: `app/services/authentication-service.ts`
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/auth/session/route.ts`
- Create: `app/api/auth/logout/route.ts`
- Create: `app/api/auth/mock-session-store.ts`
- Modify: `app/lib/environment.ts`
- Modify: `tests/authentication-entry.test.mjs`

**Interfaces:**
- Produces: JSON login/session/logout endpoints and a server-only identity resolver.
- Consumes: `SUPABASE_SECRET_KEY`, publishable Supabase configuration, hostname property resolution, `AuthRepository` models.

- [ ] **Step 1: Add failing source-boundary and behavior tests**

```ts
assert.doesNotMatch(loginPageSource,/SUPABASE_SECRET_KEY|service_role/);
assert.match(serverAdminSource,/persistSession:\s*false/);
assert.match(loginRouteSource,/resolve.*login/i);
assert.match(loginRouteSource,/generic|账号或密码错误/);
```

- [ ] **Step 2: Verify the tests fail**

Run the focused Node test and confirm failure because the routes and server client do not exist.

- [ ] **Step 3: Implement server-only Supabase clients**

```ts
createClient(url, secretKey, { auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false} });
```

Use a second publishable-key client for `signInWithPassword`; never construct or return the internal email in browser code.

- [ ] **Step 4: Implement login and session lifecycle**

Validate password length, resolve hostname/property/login account, verify password, then load active memberships and role assignments. Set HttpOnly, Secure in hosted environments, SameSite=Lax cookies. Clear sessions on logout and on inactive account/membership.

- [ ] **Step 5: Verify endpoint tests pass**

Run the focused test and inspect that unknown User ID and wrong password have the same response shape.

### Task 4: Branded login page and session provider

**Files:**
- Create: `app/login/page.tsx`
- Create: `app/login/login.css`
- Create: `app/state/auth-session.tsx`
- Create: `app/components/auth/SessionGate.tsx`
- Modify: `app/providers.tsx`
- Modify: `app/layout.tsx`
- Modify: `tests/authentication-entry.test.mjs`

**Interfaces:**
- Produces: `useAuthSession()`, branded login form, loading/error/logout states, and protected-route checks.
- Consumes: `AuthRepository` and `homeForRole`.

- [ ] **Step 1: Add failing login UI tests**

Assert Chinese labels, absence of email/role/hotel selectors, required fields, loading copy, error copy, and 8-character password validation.

- [ ] **Step 2: Verify the tests fail**

Run the focused test and confirm `/login` is missing.

- [ ] **Step 3: Implement `AuthSessionProvider` and login form**

```tsx
<label><span>用户 ID</span><input name="loginId" autoComplete="username" required /></label>
<label><span>密码</span><input name="password" type="password" autoComplete="current-password" minLength={8} required /></label>
```

Submit through the repository, follow only the server-returned role destination, and show generic errors without existence disclosure.

- [ ] **Step 4: Implement responsive premium styling**

Keep form controls at least 44px high, first action above the fold, ivory/ink/champagne palette, visible focus, and no decorative oversized hero.

- [ ] **Step 5: Run login UI tests**

Expected: login and provider tests pass.

### Task 5: Root recovery, role homes, and access denial

**Files:**
- Create: `app/department/page.tsx`
- Create: `app/my-training/page.tsx`
- Create: `app/platform/page.tsx`
- Create: `app/access-denied/page.tsx`
- Create: `app/role-entry.css`
- Modify: `app/page.tsx`
- Modify: `app/components/shell/InitializationGuard.tsx`
- Modify: `tests/authentication-entry.test.mjs`

**Interfaces:**
- Produces: server-derived entry behavior and four role-specific landing pages.
- Consumes: `useAuthSession`, `homeForRole`, and `AppShell`.

- [ ] **Step 1: Add failing tests for every role path**

Test unauthenticated root to login, manager dashboard access, department and employee redirects, unauthorized access denial, and ignored client role spoofing.

- [ ] **Step 2: Verify the role tests fail**

Expected: missing role pages and initialization guard redirect behavior cause failures.

- [ ] **Step 3: Replace initialization hijacking with session entry guarding**

The root no longer reads wizard completion before allowing a manager. `InitializationGuard` becomes a compatibility wrapper around session authorization or is removed from `AppShell`.

- [ ] **Step 4: Implement role landing pages and logout**

Department and employee pages use limited navigation and synthetic scope-appropriate content only. Access denied shows logged-in status, contact guidance, and logout.

- [ ] **Step 5: Run focused role tests**

Expected: all role destinations and direct-route denials pass.

### Task 6: Role-aware navigation and settings restructuring

**Files:**
- Create: `app/components/shell/navigation.ts`
- Modify: `app/components/shell/AppShell.tsx`
- Modify: `app/components/shell/RoleSwitcher.tsx`
- Modify: `app/state/mock-role.tsx`
- Modify: `tests/authentication-entry.test.mjs`

**Interfaces:**
- Produces: `navigationForRole(role)` and grouped manager settings navigation.
- Consumes: authenticated role session; no client-selected role.

- [ ] **Step 1: Write failing navigation tests**

Assert manager operations/settings groups, employee absence of admin links, department absence of settings/import, and no hosted role switcher.

- [ ] **Step 2: Verify tests fail against the current global navigation**

- [ ] **Step 3: Extract the navigation policy**

```ts
export function navigationForRole(role: EffectiveRole): NavigationGroup[] {
  if (role === 'property_ld_manager' || role === 'tenant_admin' || role === 'platform_admin') return managerNavigation;
  if (role === 'department_training_admin') return departmentNavigation;
  if (role === 'employee') return employeeNavigation;
  return [];
}
```

Remove the role switcher from the normal shell. The local mock accounts demonstrate roles through actual login rather than a selector.

- [ ] **Step 4: Render grouped settings links and account/logout controls**

Use Chinese-first labels and retain quiet English secondary copy.

- [ ] **Step 5: Run navigation tests**

Expected: all visibility rules pass.

### Task 7: Initialization relationship, readiness card, and save state

**Files:**
- Create: `app/components/initialization/InitializationStatusCard.tsx`
- Create: `app/services/save-state.ts`
- Modify: `app/services/initialization-wizard-service.ts`
- Modify: `app/initialize/page.tsx`
- Modify: `app/executive.css`
- Modify: `tests/checkpoint-2c-e.test.mjs`
- Modify: `tests/authentication-entry.test.mjs`

**Interfaces:**
- Produces: `minimumReady`, `operationalReady`, shared save-state labels, compact dashboard setup card, wizard return action.
- Consumes: property facts, organization facts, active manager account fact, and persisted wizard progress.

- [ ] **Step 1: Write failing readiness and save-state tests**

```ts
assert.equal(state.minimumReady,true);
assert.equal(state.operationalReady,false);
assert.equal(saveStateLabel({status:'saved',savedAt:'09:35'}),'已保存 · 09:35');
```

Test that incomplete operational setup does not redirect the manager, failed save does not advance, and resume survives repository reload.

- [ ] **Step 2: Verify the tests fail**

- [ ] **Step 3: Implement two-layer readiness and dashboard card**

The card lists minimum blockers separately from operational warnings and links to `/initialize`, `/settings/hotel`, `/organization`, and `/import`. It may collapse only when `minimumReady` is true.

- [ ] **Step 4: Recover wizard save behavior**

Every continue action validates, saves, re-reads current progress, updates save status, and only then advances. Add `返回运营首页` without clearing progress.

- [ ] **Step 5: Run readiness tests**

Expected: minimum/operational readiness, save failure, resume, and card actions pass.

### Task 8: Complete verification and handoff

**Files:**
- Modify: `package.json`
- Modify: tests only as required to register the new suite

**Interfaces:**
- Produces: verified Review Stop 2C-E.1 branch and report evidence.
- Consumes: all previous tasks.

- [ ] **Step 1: Register the new application test suite**

Add `tests/authentication-entry.test.mjs` to `npm test`.

- [ ] **Step 2: Reset and test the local database**

```bash
supabase db reset --local
supabase test db --local supabase/tests
```

- [ ] **Step 3: Run application and build verification**

```bash
npm test
npm run build
```

- [ ] **Step 4: Browser-check all role paths and responsive login**

Verify login/logout, manager, wizard return, department, employee, access-denied, desktop/tablet/mobile login, console, save/reload, and no hosted role switcher.

- [ ] **Step 5: Run safety scans**

```bash
git diff --check
git grep -n -i -E 'service[_-]?role|sb_secret|postgres(ql)?://|PRIVATE KEY' -- ':!tests/**' ':!docs/**'
git ls-files | rg -i '\.(xls|xlsx|csv)$|Hotel Training Record|KIP Suzhou'
git status --short --branch
```

- [ ] **Step 6: Commit the verified implementation**

```bash
git add app docs/superpowers/plans/2026-07-14-authentication-application-entry-recovery.md supabase tests package.json
git commit -m "feat: recover authenticated application entry"
```
