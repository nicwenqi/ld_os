# Recovery E0-C Property Initialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Initialize one Pilot property with a secure platform-created container, an active Hotel L&D Manager, a confirmed organization and department-scope foundation, and a committed classified employee baseline.

**Architecture:** Keep platform provisioning and hotel business operation as separate authorization planes. Super Admin creates only the property container and initial manager invitation; the manager uses the existing Recovery B administration and D0 employee-import paths to confirm business data. E0-C records no new fact type and does not execute D1–D4 training operations.

**Tech Stack:** Next.js/Vinext, React 19, TypeScript, Supabase Auth/Postgres/RLS/RPC/Storage, Node test runner, pgTAP.

## Global Constraints

- E0-C is the current phase; E0-C ends after employee-baseline readiness.
- The separate Pilot Training Cycle is not part of this plan.
- Current execution gate remains `No Go` until Task 3’s security migration is separately approved.
- Do not create the migration named in Task 3 until that approval is explicit.
- Do not connect to Production or apply a Production migration.
- Use synthetic local fixtures only; do not import real employees or create real property/account data.
- Super Admin creates only a Property container and initial Hotel L&D Manager invitation.
- Hotel L&D Manager confirms hotel business profile, organization, scopes, and employee baseline.
- Platform membership alone grants no hotel business access.
- The hotel application continues to expose only Hotel L&D Manager and Department Training Responsible Person workspaces.
- Employees and trainers are not automatically backend users.
- Preserve Preview → Approval → Commit → Audit for employee facts.
- Do not add a new readiness, Pilot, employee, or training fact table.
- Baseline classification uses existing `import_commits.approval_evidence`.
- Do not create Course, Requirement, Plan, Session, Attendance, QR, Completion, or Feedback records.
- Do not add D5, KPI, Forecast, AI, Feedback, automation, Health, Risk, reminder, or notification behavior.
- Preserve D0–D4 historical meaning and immutable references.
- Missing evidence must not become zero, inactive, `Not Applicable`, completed, or ready.
- Every protected capability requires RLS + server RPC + authorization check + audit evidence.

---

## File structure

### Product contract and deterministic readiness

- Modify: `docs/recovery-e0/e0-c-entry-decision-lock.md`
- Delete: `docs/recovery-e0/e0-c-human-approval-record.md`
- Delete: `docs/recovery-e0/e0-c-business-input-package.md`
- Modify: `tests/recovery-e0-readiness.test.mjs`
- Create: `app/services/e0-c-initialization.ts`
- Create: `tests/recovery-e0-c-domain.test.mjs`

### Security and platform provisioning

- Create only after separate approval: `supabase/migrations/20260729193000_recovery_e0_c_property_initialization_boundary.sql`
- Create: `supabase/tests/recovery_e0_c_property_initialization_test.sql`
- Create: `app/services/platform-authorization.ts`
- Create: `app/services/platform-property-provisioning.ts`
- Create: `app/api/platform/auth/login/route.ts`
- Create: `app/api/platform/auth/session/route.ts`
- Create: `app/api/platform/auth/logout/route.ts`
- Create: `app/api/platform/properties/route.ts`
- Create: `app/platform/login/page.tsx`
- Create: `app/platform/properties/new/page.tsx`
- Create: `app/platform/platform.css`
- Create: `tests/recovery-e0-c-platform-auth.test.mjs`
- Create: `tests/recovery-e0-c-property-provisioning.test.mjs`
- Create: `tests/recovery-e0-c-platform-ui.test.mjs`

### Manager, organization, and employee baseline

- Modify: `app/initialize/page.tsx`
- Create: `app/components/initialization/E0CReadinessPanel.tsx`
- Modify: `app/repositories/contracts/initialization-repository.ts`
- Modify: `app/repositories/supabase/initialization-repository.ts`
- Create: `app/components/import/BaselineClassificationPanel.tsx`
- Modify: `app/components/import/EmployeeUpdatePreviewStep.tsx`
- Modify: `app/import/page.tsx`
- Modify: `app/repositories/contracts/import-repository.ts`
- Modify: `app/repositories/supabase/import-repository.ts`
- Modify: `app/services/import-service.ts`
- Modify: `app/people/page.tsx`
- Create: `tests/recovery-e0-c-manager-readiness.test.mjs`
- Create: `tests/recovery-e0-c-baseline.test.mjs`
- Create: `tests/recovery-e0-c-ui.test.mjs`
- Create: `docs/recovery-e0/e0-c-review-stop-report.md`

---

### Task 1: Replace the external-owner gate with the final E0-C product contract

**Files:**
- Modify: `tests/recovery-e0-readiness.test.mjs`
- Modify: `docs/recovery-e0/e0-c-entry-decision-lock.md`
- Delete: `docs/recovery-e0/e0-c-human-approval-record.md`
- Delete: `docs/recovery-e0/e0-c-business-input-package.md`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-07-29-recovery-e0-c-pilot-initialization-design.md`
- Produces: one active E0-C gate record that ends at employee-baseline readiness

- [ ] **Step 1: Write the failing product-contract test**

Replace the obsolete E0-C assertion in `tests/recovery-e0-readiness.test.mjs` with:

```js
const e0cDesignPath = new URL(
  "../docs/superpowers/specs/2026-07-29-recovery-e0-c-pilot-initialization-design.md",
  import.meta.url,
);
const obsoleteApprovalRecordPath = new URL(
  "../docs/recovery-e0/e0-c-human-approval-record.md",
  import.meta.url,
);
const obsoleteBusinessInputPath = new URL(
  "../docs/recovery-e0/e0-c-business-input-package.md",
  import.meta.url,
);

test("E0-C ends at property and employee-baseline readiness", async () => {
  const [entryLock, design] = await Promise.all([
    readFile(e0cEntryDecisionPath, "utf8"),
    readFile(e0cDesignPath, "utf8"),
  ]);
  assert.match(entryLock, /Current gate: \\*\\*No Go — C0 security boundary not approved\\*\\*/);
  assert.match(design, /Super Admin creates only the Property container and initial manager invitation/);
  assert.match(design, /Hotel L&D Manager confirms business property, organization, scopes, and employee baseline/);
  for (const state of ["Full", "Restricted", "Pilot Limited"]) {
    assert.equal(design.includes(`**${state}**`), true);
  }
  for (const criterion of [
    "Property ready",
    "Manager ready",
    "Organization ready",
    "Employee baseline ready",
  ]) {
    assert.equal(design.includes(criterion), true);
  }
  assert.match(design, /separate \\*\\*Pilot Training Cycle\\*\\*/);
  assert.match(design, /E0-C neither implements nor verifies this cycle/);
  assert.equal(existsSync(obsoleteApprovalRecordPath), false);
  assert.equal(existsSync(obsoleteBusinessInputPath), false);
  assert.match(entryLock, /No Production connection or mutation is authorized/);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

```bash
node --test tests/recovery-e0-readiness.test.mjs
```

Expected: FAIL because the entry lock still uses external named-owner gates and the obsolete templates still exist.

- [ ] **Step 3: Replace the entry lock**

Rewrite `docs/recovery-e0/e0-c-entry-decision-lock.md` exactly as:

```markdown
# Recovery E0-C — Entry Decision Lock

**Current gate: No Go — C0 security boundary not approved**

E0-A and E0-B are complete. The final E0-C Property Initialization Design is approved for implementation planning only.

E0-C execution is blocked until:

1. platform provisioning is separated from hotel business authorization;
2. the additive C0 migration is reviewed and explicitly approved;
3. local C0 RLS/RPC/audit tests pass;
4. synthetic property-container and manager-invitation handoff passes.

E0-C ends after property, manager, organization/scope, and employee-baseline readiness. Requirement, Plan, Session, Attendance, and Completion belong to a separately approved Pilot Training Cycle.

No Production connection or mutation is authorized. No real property, account, employee, or training fact may be created.

The external Human Approval Record and Business Input Package are superseded. Authorized product transitions provide the approval evidence.
```

Delete:

```text
docs/recovery-e0/e0-c-human-approval-record.md
docs/recovery-e0/e0-c-business-input-package.md
```

- [ ] **Step 4: Re-run the focused test**

```bash
node --test tests/recovery-e0-readiness.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/recovery-e0-readiness.test.mjs docs/recovery-e0/e0-c-entry-decision-lock.md docs/recovery-e0/e0-c-human-approval-record.md docs/recovery-e0/e0-c-business-input-package.md
git commit -m "docs: lock E0-C property initialization scope"
```

### Task 2: Implement deterministic initialization and baseline-readiness rules

**Files:**
- Create: `app/services/e0-c-initialization.ts`
- Create: `tests/recovery-e0-c-domain.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces:

```ts
export type EmployeeBaselineState = "full" | "restricted" | "pilot_limited";
export type E0CInitializationState = "not_started" | "blocked" | "ready";
export type BaselineClassificationDraft = {
  state: EmployeeBaselineState;
  limitations: string;
  departmentId: string | null;
  includeDescendants: boolean;
};
export type E0CInitializationEvidence = {
  propertyReady: boolean;
  managerReady: boolean;
  organizationReady: boolean;
  employeeBaselineReady: boolean;
};
export function validateBaselineClassification(
  draft: BaselineClassificationDraft,
): BaselineClassificationDraft;
export function e0cInitializationState(
  evidence: E0CInitializationEvidence,
): E0CInitializationState;
```

- [ ] **Step 1: Write the failing domain tests**

Create `tests/recovery-e0-c-domain.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  e0cInitializationState,
  validateBaselineClassification,
} from "../app/services/e0-c-initialization.ts";

test("Full baseline cannot carry a limited department scope", () => {
  assert.throws(() => validateBaselineClassification({
    state: "full",
    limitations: "",
    departmentId: "department-a",
    includeDescendants: true,
  }), /Full 基线不能限定部门范围/);
});

test("Restricted baseline requires visible limitations", () => {
  assert.throws(() => validateBaselineClassification({
    state: "restricted",
    limitations: " ",
    departmentId: null,
    includeDescendants: false,
  }), /Restricted 基线必须说明限制/);
});

test("Pilot Limited baseline requires an official department and limitation", () => {
  assert.throws(() => validateBaselineClassification({
    state: "pilot_limited",
    limitations: "仅验证试运行员工",
    departmentId: null,
    includeDescendants: true,
  }), /Pilot Limited 基线必须选择正式部门/);
});

test("E0-C is ready only when all four initialization criteria are true", () => {
  assert.equal(e0cInitializationState({
    propertyReady: true,
    managerReady: true,
    organizationReady: true,
    employeeBaselineReady: false,
  }), "blocked");
  assert.equal(e0cInitializationState({
    propertyReady: true,
    managerReady: true,
    organizationReady: true,
    employeeBaselineReady: true,
  }), "ready");
});
```

- [ ] **Step 2: Register the test and verify failure**

Add `tests/recovery-e0-c-domain.test.mjs` immediately after `tests/recovery-e0-readiness.test.mjs` in `package.json`.

```bash
node --experimental-strip-types --test tests/recovery-e0-c-domain.test.mjs
```

Expected: FAIL because `e0-c-initialization.ts` does not exist.

- [ ] **Step 3: Implement the pure rules**

Create `app/services/e0-c-initialization.ts` with no repository, browser, or date dependency.

Rules:

- `full`: `departmentId` must be null, `includeDescendants` false, and `limitations` empty;
- `restricted`: non-empty limitations are required; department scope is optional;
- `pilot_limited`: official `departmentId` and non-empty limitations are required;
- all text is trimmed;
- readiness is `not_started` when all four evidence values are false, `ready` when all are true, and `blocked` otherwise.

Export:

```ts
export const baselineStateLabels: Record<EmployeeBaselineState, string> = {
  full: "Full · 酒店完整基线",
  restricted: "Restricted · 有声明限制",
  pilot_limited: "Pilot Limited · 仅限试运行范围",
};
```

- [ ] **Step 4: Run the focused test**

```bash
node --experimental-strip-types --test tests/recovery-e0-c-domain.test.mjs
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/e0-c-initialization.ts tests/recovery-e0-c-domain.test.mjs package.json
git commit -m "feat: add E0-C initialization readiness rules"
```

### Task 3: C0 security migration — isolate Property provisioning from hotel business authority

**Review gate:** Do not start this task until the user separately approves creation of the E0-C migration.

**Files:**
- Create after approval: `supabase/migrations/20260729193000_recovery_e0_c_property_initialization_boundary.sql`
- Create: `supabase/tests/recovery_e0_c_property_initialization_test.sql`

**Interfaces:**
- Produces:

```sql
app_private.is_active_platform_provisioner() returns boolean
app_private.assert_active_platform_provisioner() returns void
public.provision_pilot_property_container(jsonb,uuid) returns jsonb
public.commit_employee_import(uuid,bigint,text,boolean,text,uuid,boolean,text) returns uuid
public.read_e0_c_initialization_readiness(uuid) returns jsonb
```

- Creates no table, enum, employee fact type, readiness fact, or training fact.

- [ ] **Step 1: Write the failing pgTAP contract**

Create `supabase/tests/recovery_e0_c_property_initialization_test.sql` and prove:

1. active, non-revoked platform membership satisfies `is_active_platform_provisioner`;
2. inactive or anonymous identity does not;
3. platform membership alone never satisfies `is_authorized_property_role`;
4. platform identity cannot directly select or mutate hotel settings, organization, accounts, employees, imports, or D1–D4 tables;
5. platform identity cannot call hotel settings, organization, account, import, D1, D2, D3, or D4 mutation RPCs;
6. Hotel L&D Manager cannot call `provision_pilot_property_container`;
7. provisioning creates only tenant/property container, domain/settings foundation, manager profile/memberships/role/account invitation, and no employee or training row;
8. manager account has `must_change_password = true` and no employee link;
9. provisioning actor/time/target are traceable through existing `created_by`, `granted_by`, `created_at`, and membership/account records;
10. the eight-argument import commit stores baseline classification inside existing `approval_evidence`;
11. invalid baseline classification or cross-property department scope rolls back the entire import commit;
12. `read_e0_c_initialization_readiness` requires an active property manager and returns only four initialization conditions and business-readable missing reasons;
13. no Requirement, Plan, Session, Attendance, Completion, KPI, Feedback, or analytics row is created.

Use at least 44 assertions, with explicit allow and deny cases for anonymous, platform-only, manager, and department-role identities.

- [ ] **Step 2: Run the focused test and verify failure**

```bash
supabase db reset --local --no-seed
supabase test db --local supabase/tests/recovery_e0_c_property_initialization_test.sql
```

Expected: FAIL because the functions do not exist and earlier platform access is broader than the approved boundary.

- [ ] **Step 3: Implement the platform authorization separation**

In the approved migration:

- define `is_active_platform_provisioner` from active, non-revoked `platform_memberships`;
- define `assert_active_platform_provisioner` with `42501` denial;
- redefine hotel business helpers so platform membership and tenant administration do not imply hotel management:

```sql
app_private.can_manage_property(p_property_id)
  = app_private.is_authorized_property_role(
      p_property_id,
      'property_ld_manager'
    )

app_private.can_manage_user_account(p_tenant_id, p_property_id)
  = app_private.is_authorized_property_role(
      p_property_id,
      'property_ld_manager'
    )
```

- redefine organization reads to property managers and authorized department roles only;
- remove platform membership from direct table policies for properties, property settings/domains, profiles other than self, memberships, role assignments, user accounts, organization, employee/import, and D1–D4 data;
- keep only the platform operator’s own profile/membership access and the narrow provisioning RPC;
- retain all manager and department-role permissions already approved by Recovery B–D4.

- [ ] **Step 4: Implement the narrow Property-container RPC**

`provision_pilot_property_container` must:

- require `assert_active_platform_provisioner`;
- accept normalized tenant/property technical values and an existing Auth user ID;
- reject duplicate tenant code, property code, hostname, manager login ID, or Auth identity;
- create or select the intended tenant container;
- create one active technical property container with initialization state `not_started`;
- create primary verified hostname context;
- create default property settings without marking manager confirmation;
- create the manager profile, tenant/property memberships, active manager role assignment, and backend account with `must_change_password = true`;
- create no department, position, employee, Course, Requirement, Plan, Session, Attendance, or Completion record;
- return only property ID, hostname, manager display name, and `password_change_required`;
- rely on existing created/granted actor and timestamp columns for the provisioning audit chain.

The function is the only platform mutation path. No new provisioning-event table is allowed.

- [ ] **Step 5: Extend existing import approval evidence**

Add the eight-argument `commit_employee_import` signature:

```sql
(
  p_batch_id uuid,
  p_expected_version bigint,
  p_preview_hash text,
  p_confirmed boolean,
  p_baseline_state text,
  p_baseline_department_id uuid,
  p_include_descendants boolean,
  p_baseline_limitations text
)
```

It must:

- validate `full`, `restricted`, and `pilot_limited`;
- verify any department belongs to the batch property;
- execute the existing D0 commit;
- append `baselineState`, `baselineDepartmentId`, `includeDescendants`, and `baselineLimitations` to the existing `import_commits.approval_evidence`;
- fail the whole transaction if classification is invalid;
- retain the previous four-argument signature only as a revoked compatibility failure.

No new baseline table is allowed.

- [ ] **Step 6: Implement the read-only readiness RPC**

`read_e0_c_initialization_readiness` must derive:

- property ready from authoritative property identity, business-rule validity, and the existing identity/rules confirmation facts; do not use the overall initialization-ready flag as its own prerequisite;
- manager ready from active account, memberships, role, and completed password change;
- organization ready from active official departments and valid explicit department scopes where present;
- employee baseline ready from committed import, approved version/hash, baseline metadata, and zero blocking issues inside the declared ready scope.

Return:

```json
{
  "propertyReady": false,
  "managerReady": false,
  "organizationReady": false,
  "employeeBaselineReady": false,
  "baselineState": null,
  "missingReasons": [],
  "refreshedAt": ""
}
```

The RPC is read-only, manager-scoped, and creates no row.

- [ ] **Step 7: Run focused and regression pgTAP**

```bash
supabase db reset --local --no-seed
supabase test db --local supabase/tests/recovery_e0_c_property_initialization_test.sql
supabase test db --local supabase/tests/recovery_d0_foundation_gate_test.sql
supabase test db --local supabase/tests/recovery_d1_learning_requirement_foundation_test.sql
supabase test db --local supabase/tests/recovery_d2_training_operations_foundation_test.sql
supabase test db --local supabase/tests/recovery_d3_attendance_facts_test.sql
supabase test db --local supabase/tests/recovery_d4_completion_evidence_test.sql
```

Expected: all PASS.

- [ ] **Step 8: Review Stop C0**

Record:

- exact platform-only operations;
- direct and RPC hotel-business denials for platform-only identity;
- manager and department-role regression results;
- confirmation that no table or fact type was added;
- migration checksum and local-only status;
- confirmation that Production was not connected.

Do not begin Task 4 until C0 is accepted.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260729193000_recovery_e0_c_property_initialization_boundary.sql supabase/tests/recovery_e0_c_property_initialization_test.sql
git commit -m "feat: isolate E0-C property provisioning"
```

### Task 4: Add isolated Super Admin authentication and redacted preview

**Files:**
- Create: `app/services/platform-authorization.ts`
- Create: `app/services/platform-property-provisioning.ts`
- Create: `app/api/platform/auth/login/route.ts`
- Create: `app/api/platform/auth/session/route.ts`
- Create: `app/api/platform/auth/logout/route.ts`
- Create: `tests/recovery-e0-c-platform-auth.test.mjs`
- Create: `tests/recovery-e0-c-property-provisioning.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces:

```ts
export type PlatformActor = {
  authUserId: string;
  displayName: string;
  accessToken: string;
  refreshedCookies: string[];
};

export type PropertyContainerDraft = {
  tenantCode: string;
  tenantName: string;
  propertyCode: string;
  preliminaryNameZh: string;
  preliminaryNameEn: string;
  hostname: string;
  timezone: string;
  defaultLanguage: string;
  managerLoginId: string;
  managerDisplayName: string;
  temporaryPassword: string;
};

export type PropertyContainerPreview = {
  previewToken: string;
  expiresAt: string;
  normalized: Omit<PropertyContainerDraft, "temporaryPassword">;
};

export async function requirePlatformProvisioner(
  request: Request,
): Promise<PlatformActor>;
export function preparePropertyContainerPreview(
  draft: PropertyContainerDraft,
): PropertyContainerPreview;
export function verifyPropertyContainerPreview(
  token: string,
  draft: PropertyContainerDraft,
): Omit<PropertyContainerDraft, "temporaryPassword">;
```

- [ ] **Step 1: Write failing authentication and preview tests**

Tests must prove:

- platform authentication does not resolve a property hostname;
- active platform membership is required;
- platform session is not accepted by hotel `resolveAuthenticatedRequest`;
- hotel manager is not accepted by `requirePlatformProvisioner`;
- Production never uses a mock platform identity;
- preview validates codes, hostname, names, timezone, language, User ID, and existing 12-character password rule;
- preview output excludes password, Auth ID, internal email, database secret, and session token;
- preview token is server-signed, expires after 15 minutes, and rejects changed payload or password;
- no database or Auth mutation occurs during preview.

- [ ] **Step 2: Run the focused tests**

```bash
node --experimental-strip-types --test \
  tests/recovery-e0-c-platform-auth.test.mjs \
  tests/recovery-e0-c-property-provisioning.test.mjs
```

Expected: FAIL because the platform services and routes do not exist.

- [ ] **Step 3: Implement platform authentication**

Use the existing HttpOnly authentication-cookie protections, but resolve platform identity without `resolve_property_context`. Authenticate the internal platform operator through Supabase Auth and verify `is_active_platform_provisioner`.

Do not add `platform_admin` to:

- `EffectiveRole`;
- hotel `AuthSession`;
- hotel role navigation;
- `/api/auth/access-token`;
- manager or department workspace routing.

- [ ] **Step 4: Implement stateless preview**

Normalize the draft and produce a 15-minute signed token using Node `crypto.createHmac("sha256", serverSecret)`. The signed payload contains:

- normalized non-secret fields;
- SHA-256 hash of the temporary password;
- expiry timestamp.

Use the existing server-only Supabase secret as the HMAC input; never expose it or add an environment variable. Commit re-submission must exactly match the signed payload.

- [ ] **Step 5: Run focused and Recovery A authentication tests**

```bash
node --experimental-strip-types --test \
  tests/recovery-e0-c-platform-auth.test.mjs \
  tests/recovery-e0-c-property-provisioning.test.mjs \
  tests/authentication-entry.test.mjs \
  tests/recovery-a-routing.test.mjs \
  tests/production-activation-wiring.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/services/platform-authorization.ts app/services/platform-property-provisioning.ts app/api/platform/auth tests/recovery-e0-c-platform-auth.test.mjs tests/recovery-e0-c-property-provisioning.test.mjs package.json
git commit -m "feat: add isolated platform provisioning session"
```

### Task 5: Implement Property container and initial manager invitation

**Files:**
- Create: `app/api/platform/properties/route.ts`
- Create: `app/platform/login/page.tsx`
- Create: `app/platform/properties/new/page.tsx`
- Create: `app/platform/platform.css`
- Create: `tests/recovery-e0-c-platform-ui.test.mjs`
- Modify: `tests/recovery-e0-c-property-provisioning.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 4 platform actor and signed preview
- Produces:

```ts
export type PropertyContainerHandoff = {
  propertyId: string;
  hostname: string;
  managerDisplayName: string;
  passwordChangeRequired: true;
};
```

- [ ] **Step 1: Write failing route and UI tests**

Cover:

- `operation: "preview"` returns only redacted preview;
- `operation: "commit"` requires the same signed preview token and temporary password;
- route calls `requirePlatformProvisioner`;
- server creates the Auth user only after confirmation;
- RPC failure deletes the newly created Auth user;
- success returns the handoff and does not expose internal Auth email or ID;
- Super Admin cannot edit hotel business rules, organization, scope, employees, or training facts from the platform UI;
- all enabled actions navigate, preview, commit, retry, or logout;
- duplicate property/hostname errors are business-readable.

- [ ] **Step 2: Run focused tests**

```bash
node --experimental-strip-types --test \
  tests/recovery-e0-c-property-provisioning.test.mjs \
  tests/recovery-e0-c-platform-ui.test.mjs
```

Expected: FAIL because the route and pages do not exist.

- [ ] **Step 3: Implement the route**

POST bodies:

```json
{ "operation": "preview", "draft": {} }
{ "operation": "commit", "draft": {}, "previewToken": "signed-token" }
```

Commit order:

1. require active platform actor;
2. verify signed preview and expiry;
3. create a random internal Auth email and Auth user through the server admin client;
4. call `provision_pilot_property_container` through the actor-scoped client;
5. delete the new Auth user if the RPC fails;
6. return only `PropertyContainerHandoff`.

The route must never use the server admin client to write hotel database tables.

- [ ] **Step 4: Implement the minimal platform UI**

The UI is labeled **平台开通 · Property Provisioning** and includes only:

- Property container details;
- initial Hotel L&D Manager invitation;
- validation;
- read-only confirmation preview;
- explicit **创建容器并发出经理邀请** action;
- saving, saved, conflict, failed, and retry states;
- logout.

It has no property list dashboard, organization editor, employee page, or training module.

- [ ] **Step 5: Run tests and build**

```bash
node --experimental-strip-types --test \
  tests/recovery-e0-c-property-provisioning.test.mjs \
  tests/recovery-e0-c-platform-ui.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 6: Review Stop C1**

With synthetic local data, prove:

- preview creates zero rows and zero Auth users;
- commit creates one container and one password-change-required manager account;
- failed RPC removes the new Auth identity;
- the hotel-branded login resolves the provisioned hostname;
- Super Admin has no hotel workspace or business-data access.

- [ ] **Step 7: Commit**

```bash
git add app/api/platform/properties app/platform tests/recovery-e0-c-property-provisioning.test.mjs tests/recovery-e0-c-platform-ui.test.mjs package.json
git commit -m "feat: provision Property container and manager invitation"
```

### Task 6: Complete manager, organization, and department-scope readiness

**Files:**
- Modify: `app/initialize/page.tsx`
- Modify: `app/repositories/contracts/initialization-repository.ts`
- Modify: `app/repositories/supabase/initialization-repository.ts`
- Create: `app/components/initialization/E0CReadinessPanel.tsx`
- Create: `tests/recovery-e0-c-manager-readiness.test.mjs`
- Create: `tests/recovery-e0-c-ui.test.mjs`
- Modify: `tests/recovery-b-settings-activation.test.mjs`
- Modify: `tests/recovery-b-administration.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Extends:

```ts
export type E0CReadinessSnapshot = E0CInitializationEvidence & {
  baselineState: EmployeeBaselineState | null;
  missingReasons: string[];
  refreshedAt: string;
};

export interface InitializationRepository {
  getE0CReadiness(propertyId: string): Promise<E0CReadinessSnapshot>;
}
```

- [ ] **Step 1: Write failing manager and organization readiness tests**

Assert:

- initial manager cannot reach the manager workspace until password-change rules are satisfied;
- manager confirms business property profile and rules, not Super Admin;
- saves use existing dirty/saving/saved/failed/conflict states and authoritative re-read;
- manager can return to `/` at any time;
- organization readiness requires at least one active official department;
- a department role, when present, requires active account/membership/role and explicit scope;
- manager-only Pilot does not fabricate a department-role account;
- department user cannot self-widen or reach settings, organization mutation, accounts, or imports;
- platform-only identity cannot load `/initialize`;
- readiness panel contains only Property, Manager, Organization, and Employee Baseline.

- [ ] **Step 2: Run focused tests**

```bash
node --experimental-strip-types --test \
  tests/recovery-e0-c-manager-readiness.test.mjs \
  tests/recovery-e0-c-ui.test.mjs \
  tests/recovery-b-settings-activation.test.mjs \
  tests/recovery-b-administration.test.mjs
```

Expected: FAIL for missing E0-C readiness repository and panel.

- [ ] **Step 3: Extend the initialization repository**

Call only `read_e0_c_initialization_readiness` and map absent facts to false plus server-provided missing reasons. Do not infer readiness in the page component.

- [ ] **Step 4: Add the manager handoff and readiness panel**

At the final activation section, show:

```text
Property 基础已由平台创建
酒店业务资料由当前学习与发展经理确认
```

Then show exactly four progressive rows:

1. 酒店资料；
2. 经理账号；
3. 组织与权限范围；
4. 员工基线。

Each row displays `已就绪`, `尚未完成`, or `无法确认`, one reason, and one real return path:

- hotel profile → `/settings/hotel`;
- manager/account → `/accounts`;
- organization/scope → `/organization`;
- employee baseline → `/import`.

Do not show Requirement, Session, Attendance, Completion, KPI, score, or percentage.

- [ ] **Step 5: Run tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 6: Review Stops C2 and C3**

Verify with synthetic manager and department-role accounts:

- password-change and active-manager behavior;
- business profile save/re-read;
- official department creation and confirmation;
- optional department role with explicit descendant rule;
- direct-route and server denials;
- no Super Admin business operation.

- [ ] **Step 7: Commit**

```bash
git add app/initialize/page.tsx app/repositories/contracts/initialization-repository.ts app/repositories/supabase/initialization-repository.ts app/components/initialization/E0CReadinessPanel.tsx tests/recovery-e0-c-manager-readiness.test.mjs tests/recovery-e0-c-ui.test.mjs tests/recovery-b-settings-activation.test.mjs tests/recovery-b-administration.test.mjs package.json
git commit -m "feat: verify manager and organization readiness"
```

### Task 7: Add baseline classification to existing import approval evidence

**Files:**
- Create: `app/components/import/BaselineClassificationPanel.tsx`
- Modify: `app/components/import/EmployeeUpdatePreviewStep.tsx`
- Modify: `app/import/page.tsx`
- Modify: `app/repositories/contracts/import-repository.ts`
- Modify: `app/repositories/supabase/import-repository.ts`
- Modify: `app/services/import-service.ts`
- Modify: `app/initialize/page.tsx`
- Modify: `app/people/page.tsx`
- Create: `tests/recovery-e0-c-baseline.test.mjs`
- Modify: `tests/recovery-c-import-service.test.mjs`
- Modify: `tests/recovery-d0-preview-approval.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Extends:

```ts
export type EmployeeUpdateApproval = {
  acknowledged: boolean;
  previewHash: string;
  baseline: BaselineClassificationDraft;
};

export type ImportBatchBaselineEvidence = {
  state: EmployeeBaselineState;
  limitations: string;
  departmentId: string | null;
  includeDescendants: boolean;
  approvedAt: string;
};
```

- [ ] **Step 1: Write failing baseline tests**

Cover:

- classification is mandatory before commit;
- all three states use Task 2 validation;
- classification changes no preview count or Employee Fact Version content;
- commit sends exact preview hash and classification in one RPC call;
- classification is stored only in existing `approval_evidence`;
- stale preview or cross-property department returns conflict/failure without employee writes;
- department role cannot inspect the workbook or approve the baseline;
- People Center and readiness panel show the authoritative classification;
- no employee Auth or account API is called;
- training-history and CTC/GTC exclusions remain enforced.

- [ ] **Step 2: Run focused tests**

```bash
node --experimental-strip-types --test \
  tests/recovery-e0-c-baseline.test.mjs \
  tests/recovery-c-import-service.test.mjs \
  tests/recovery-d0-preview-approval.test.mjs
```

Expected: FAIL because classification is absent from the approval contract.

- [ ] **Step 3: Implement the contract and repository changes**

`commitBatch` remains the only employee write path. It calls the approved eight-argument RPC once. Employee commit and baseline metadata succeed or fail in one transaction.

Map baseline evidence from `import_commits.approval_evidence`; do not create a separate repository table or local fallback.

- [ ] **Step 4: Implement the baseline classification UI**

Place `BaselineClassificationPanel` inside the existing zero-write preview:

- **Full** — no scope or limitation input;
- **Restricted** — required visible limitations and optional official department boundary;
- **Pilot Limited** — required official department branch, descendant setting, and limitations.

The final confirmation shows:

- classification;
- preview hash prefix;
- additions;
- updates;
- unchanged;
- exclusions;
- blocked;
- unresolved.

- [ ] **Step 5: Re-read authoritative state**

After commit:

- re-read import history and approval evidence;
- show classification in People Center and E0-C readiness;
- show `数据范围受限` for Restricted;
- show `仅限试运行范围` for Pilot Limited;
- never imply hotel-wide completeness from a limited state.

- [ ] **Step 6: Run Recovery C/D0 regressions**

```bash
node --experimental-strip-types --test \
  tests/recovery-e0-c-baseline.test.mjs \
  tests/recovery-c-import-route.test.mjs \
  tests/recovery-c-import-service.test.mjs \
  tests/recovery-c-people-ui.test.mjs \
  tests/recovery-d0-import-integrity.test.mjs \
  tests/recovery-d0-preview-approval.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Review Stop C4**

With a synthetic workbook, prove:

- zero employee writes before confirmation;
- exact preview version/hash commit;
- baseline metadata in existing approval evidence;
- Employee Fact Version and audit preservation;
- People Center authoritative re-read;
- zero employee Auth users or backend accounts;
- no training fact.

- [ ] **Step 8: Commit**

```bash
git add app/components/import/BaselineClassificationPanel.tsx app/components/import/EmployeeUpdatePreviewStep.tsx app/import/page.tsx app/repositories/contracts/import-repository.ts app/repositories/supabase/import-repository.ts app/services/import-service.ts app/initialize/page.tsx app/people/page.tsx tests/recovery-e0-c-baseline.test.mjs tests/recovery-c-import-service.test.mjs tests/recovery-d0-preview-approval.test.mjs package.json
git commit -m "feat: classify committed employee baseline"
```

### Task 8: Full E0-C verification and Review Stop

**Files:**
- Create: `docs/recovery-e0/e0-c-review-stop-report.md`

**Interfaces:**
- Consumes: Tasks 1–7
- Produces: evidence-backed E0-C `Go`, `Conditional Go`, or `No Go`; does not authorize the Pilot Training Cycle or Production

- [ ] **Step 1: Run clean local migration replay**

```bash
supabase db reset --local --no-seed
supabase migration list --local
```

Expected: all ordered migrations through `20260729193000` apply once with no seed data.

- [ ] **Step 2: Run focused and full pgTAP**

```bash
supabase test db --local supabase/tests/recovery_e0_c_property_initialization_test.sql
supabase test db --local
```

Expected: all assertions PASS.

- [ ] **Step 3: Prove no training facts exist in the E0-C fixture**

Run a local aggregate-only check after the synthetic initialization journey:

```text
courses=0
training_requirements=0
training_plans=0
training_sessions=0
attendance_registers=0
completion_records=0
```

Any non-zero value is a failure and requires resetting the disposable local database before continuing.

- [ ] **Step 4: Run application tests and build**

```bash
npm test
```

Expected: all Node tests, production build, and rendered HTML test PASS.

- [ ] **Step 5: Run browser verification**

Verify at:

- desktop `1440 × 1000`;
- tablet `1024 × 1366`;
- mobile `390 × 844`.

Cover:

- platform login;
- property-container preview and confirmation;
- initial manager invitation and password-change path;
- manager business-profile confirmation;
- organization and department scope;
- employee baseline classification, validation, conflict, and saved state;
- People Center authoritative employee state;
- four-row E0-C readiness panel;
- platform and department-role direct-route denials;
- keyboard focus;
- normal-zoom readability;
- 44px mobile touch targets;
- no horizontal overflow;
- no console errors;
- no unexplained failed requests.

Remove local credentials, cookies, screenshots containing temporary passwords, and reusable preview tokens after verification.

- [ ] **Step 6: Write the Review Stop report**

`docs/recovery-e0/e0-c-review-stop-report.md` must report:

1. Property readiness;
2. Hotel L&D Manager readiness;
3. organization and department-scope readiness;
4. employee-baseline readiness and classification;
5. platform-versus-hotel authorization proof;
6. migration and pgTAP results;
7. application/build/browser results;
8. aggregate evidence that no training fact exists;
9. open risks;
10. branch and commit;
11. confirmation that Production, DNS, environment variables, real employees, and real hotel data were untouched;
12. confirmation that the Pilot Training Cycle, D5, KPI, Forecast, AI, Feedback, automation, Health, and Risk were not started.

- [ ] **Step 7: Review Stop C5**

Return `Go` only if Property, Manager, Organization, and Employee Baseline are all authoritative and ready. `Go` means E0-C initialization passed; it does not authorize the Pilot Training Cycle.

- [ ] **Step 8: Final commit**

```bash
git add docs/recovery-e0/e0-c-review-stop-report.md
git commit -m "docs: record Review Stop E0-C initialization"
```

## Separate Pilot Training Cycle — not implemented by this plan

After E0-C receives `Go` and the user separately approves a Pilot Training Cycle, a new design/plan may verify:

1. Requirement created;
2. training delivered;
3. Attendance recorded;
4. Completion verified.

That future phase must use existing D1–D4 capabilities and must not be silently started by any E0-C task.

## Plan self-review

- E0-C ends at committed, classified employee baseline.
- Super Admin creates only Property container and initial manager invitation.
- Hotel L&D Manager confirms all hotel business data and scope.
- The four initialization success criteria map to Tasks 5–8.
- The four Pilot Training Cycle criteria are documented but have no implementation task.
- No readiness or training fact table is added.
- Baseline classification remains inside existing import approval evidence.
- The only migration is blocked behind separate C0 approval.
- Production and real data remain excluded.
