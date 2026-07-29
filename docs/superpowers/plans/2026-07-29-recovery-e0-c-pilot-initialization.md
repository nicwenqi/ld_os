# Recovery E0-C Pilot Initialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure, finite first-property Pilot initialization journey in which a platform Super Admin provisions the property and first manager, then the Hotel L&D Manager commits a classified employee baseline and deliberately completes one trusted D1–D4 training lineage.

**Architecture:** Keep platform provisioning and hotel business operation as separate authorization planes. Add a narrow server-authorized provisioning boundary and a manager-owned baseline/readiness layer while reusing the existing D0 Employee Fact Version, D1 Requirement Version, D2 Session Revision, D3 Attendance Fact, and D4 Completion Evidence workflows without changing their meaning.

**Tech Stack:** Next.js/Vinext, React 19, TypeScript, Supabase Auth/Postgres/RLS/RPC/Storage, Node test runner, pgTAP.

## Global Constraints

- E0-C is the current phase; D0–D4 Review Stops remain accepted and immutable in meaning.
- Current execution gate remains `No Go` until Task 3’s security migration is separately approved.
- Do not connect to Production or apply a Production migration.
- Do not import real employees or create real accounts, properties, Requirements, Plans, Sessions, Attendance, or Completion facts during implementation verification.
- Use synthetic local fixtures only.
- Super Admin is platform provisioning only and receives no hotel business authority from platform membership.
- Hotel L&D Manager is the primary property administrator and business owner.
- The hotel administration application continues to expose only Hotel L&D Manager and Department Training Responsible Person workspaces.
- Employees and trainers are not automatically backend users.
- Preserve Preview → Approval → Commit → Audit for employee facts.
- Preserve `Eligibility ≠ Assignment`, `Published Session ≠ Delivered Session`, `QR Observation ≠ Attendance Determination`, and `Attendance ≠ Completion`.
- Do not add D5, KPI, Forecast, AI, Feedback, Health, Risk, reminder, notification, or operational automation.
- Do not silently convert missing evidence into zero, inactive, `Not Applicable`, or completed.
- Every protected capability requires RLS + server RPC + authorization check + audit.
- Do not create the migration named in Task 3 until the user separately approves the C0 migration proposal.

---

## File structure

### Product and domain boundary

- Modify: `docs/recovery-e0/e0-c-entry-decision-lock.md` — replace the external-owner gate with the approved product gate and current C0 security blocker.
- Delete: `docs/recovery-e0/e0-c-human-approval-record.md` — obsolete enterprise-style approval matrix.
- Delete: `docs/recovery-e0/e0-c-business-input-package.md` — obsolete external-owner input package.
- Modify: `tests/recovery-e0-readiness.test.mjs` — enforce the revised design, roles, baseline states, success criteria, and No-Go boundary.
- Create: `app/services/pilot-initialization.ts` — pure baseline and Pilot-readiness rules with no database access.
- Create: `tests/recovery-e0-c-domain.test.mjs` — deterministic domain tests.

### C0 platform/hotel security boundary

- Create only after separate approval: `supabase/migrations/20260729193000_recovery_e0_c_platform_provisioning.sql`
- Create: `supabase/tests/recovery_e0_c_platform_provisioning_test.sql`
- Create: `app/services/platform-authorization.ts`
- Create: `app/api/platform/auth/login/route.ts`
- Create: `app/api/platform/auth/session/route.ts`
- Create: `app/api/platform/auth/logout/route.ts`
- Create: `tests/recovery-e0-c-platform-auth.test.mjs`

### Property provisioning

- Create: `app/services/platform-provisioning.ts`
- Create: `app/api/platform/properties/route.ts`
- Create: `app/platform/login/page.tsx`
- Create: `app/platform/properties/new/page.tsx`
- Create: `app/platform/platform.css`
- Create: `tests/recovery-e0-c-platform-provisioning.test.mjs`
- Create: `tests/recovery-e0-c-platform-ui.test.mjs`

### Manager handoff and employee baseline

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

### Pilot lineage verification

- Create: `app/repositories/contracts/pilot-readiness-repository.ts`
- Create: `app/repositories/supabase/pilot-readiness-repository.ts`
- Modify: `app/repositories/registry.ts`
- Create: `app/components/initialization/PilotReadinessPanel.tsx`
- Modify: `app/initialize/page.tsx`
- Create: `tests/recovery-e0-c-pilot-lineage.test.mjs`
- Create: `tests/recovery-e0-c-ui.test.mjs`
- Create: `docs/recovery-e0/e0-c-review-stop-report.md`

---

### Task 1: Replace the external-governance gate with the SaaS product contract

**Files:**
- Modify: `tests/recovery-e0-readiness.test.mjs`
- Modify: `docs/recovery-e0/e0-c-entry-decision-lock.md`
- Delete: `docs/recovery-e0/e0-c-human-approval-record.md`
- Delete: `docs/recovery-e0/e0-c-business-input-package.md`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-07-29-recovery-e0-c-pilot-initialization-design.md`
- Produces: one active E0-C gate record with no external-owner signature dependency

- [ ] **Step 1: Replace the obsolete E0-C document assertion with a failing product-contract test**

Add these paths and assertions to `tests/recovery-e0-readiness.test.mjs`:

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

test("E0-C is a product initialization gate rather than an external owner-signing workflow", async () => {
  const [entryLock, design] = await Promise.all([
    readFile(e0cEntryDecisionPath, "utf8"),
    readFile(e0cDesignPath, "utf8"),
  ]);
  assert.match(entryLock, /Current gate: \\*\\*No Go — C0 security boundary not approved\\*\\*/);
  assert.match(design, /Super Admin is an internal platform-provisioning role/);
  assert.match(design, /Hotel L&D Manager is the primary hotel administrator/);
  for (const state of ["Full", "Restricted", "Pilot Limited"]) {
    assert.equal(design.includes(`**${state}**`), true);
  }
  for (const criterion of [
    "One property initialized",
    "Employee baseline committed",
    "One Requirement created",
    "One training delivered",
    "Attendance recorded",
    "Completion verified",
  ]) {
    assert.equal(design.includes(criterion), true);
  }
  assert.equal(existsSync(obsoleteApprovalRecordPath), false);
  assert.equal(existsSync(obsoleteBusinessInputPath), false);
  assert.match(entryLock, /No Production connection or mutation is authorized/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/recovery-e0-readiness.test.mjs
```

Expected: FAIL because the entry lock still contains the external-owner gate and both obsolete templates still exist.

- [ ] **Step 3: Replace the entry lock and remove the two obsolete templates**

Rewrite `docs/recovery-e0/e0-c-entry-decision-lock.md` to contain:

```markdown
# Recovery E0-C — Entry Decision Lock

**Current gate: No Go — C0 security boundary not approved**

E0-A and E0-B are complete. The revised E0-C Pilot Initialization Design is approved for implementation planning only.

E0-C is blocked from execution until:

1. the Super Admin provisioning boundary is separated from hotel business authorization;
2. the required additive migration is reviewed and explicitly approved;
3. local C0 RLS/RPC/audit tests pass;
4. the first property handoff is exercised with synthetic local data.

No Production connection or mutation is authorized. No real property, account, employee, Requirement, Plan, Session, Attendance, or Completion fact may be created.

The external Human Approval Record and Business Input Package are superseded. Product authorization is recorded by the authorized user at each governed transition.
```

Delete:

```text
docs/recovery-e0/e0-c-human-approval-record.md
docs/recovery-e0/e0-c-business-input-package.md
```

- [ ] **Step 4: Re-run the focused test**

Run:

```bash
node --test tests/recovery-e0-readiness.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/recovery-e0-readiness.test.mjs docs/recovery-e0/e0-c-entry-decision-lock.md docs/recovery-e0/e0-c-human-approval-record.md docs/recovery-e0/e0-c-business-input-package.md
git commit -m "docs: replace E0-C governance gate with product gate"
```

### Task 2: Implement deterministic baseline and Pilot-readiness rules

**Files:**
- Create: `app/services/pilot-initialization.ts`
- Create: `tests/recovery-e0-c-domain.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces:

```ts
export type EmployeeBaselineState = "full" | "restricted" | "pilot_limited";
export type PilotGateState = "not_started" | "blocked" | "ready" | "verified";
export type BaselineClassificationDraft = {
  state: EmployeeBaselineState;
  limitations: string;
  departmentId: string | null;
  includeDescendants: boolean;
};
export type PilotSuccessEvidence = {
  propertyInitialized: boolean;
  baselineCommitted: boolean;
  requirementEffective: boolean;
  trainingDelivered: boolean;
  attendanceRecorded: boolean;
  completionVerified: boolean;
};
export function validateBaselineClassification(
  draft: BaselineClassificationDraft,
): BaselineClassificationDraft;
export function pilotGateState(evidence: PilotSuccessEvidence): PilotGateState;
```

- [ ] **Step 1: Write the failing domain tests**

Create `tests/recovery-e0-c-domain.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  pilotGateState,
  validateBaselineClassification,
} from "../app/services/pilot-initialization.ts";

test("Full baseline rejects a department boundary or hidden limitation", () => {
  assert.throws(() => validateBaselineClassification({
    state: "full",
    limitations: "Some employees were not reviewed",
    departmentId: null,
    includeDescendants: false,
  }), /Full 基线不能保留未声明范围/);
});

test("Restricted baseline requires a business-readable limitation", () => {
  assert.throws(() => validateBaselineClassification({
    state: "restricted",
    limitations: " ",
    departmentId: null,
    includeDescendants: false,
  }), /Restricted 基线必须说明限制/);
});

test("Pilot Limited baseline requires one official department scope", () => {
  assert.throws(() => validateBaselineClassification({
    state: "pilot_limited",
    limitations: "仅验证前厅部当前员工",
    departmentId: null,
    includeDescendants: true,
  }), /Pilot Limited 基线必须选择正式部门/);
});

test("pilot success remains blocked until every D0-D4 criterion is verified", () => {
  assert.equal(pilotGateState({
    propertyInitialized: true,
    baselineCommitted: true,
    requirementEffective: true,
    trainingDelivered: true,
    attendanceRecorded: true,
    completionVerified: false,
  }), "blocked");
  assert.equal(pilotGateState({
    propertyInitialized: true,
    baselineCommitted: true,
    requirementEffective: true,
    trainingDelivered: true,
    attendanceRecorded: true,
    completionVerified: true,
  }), "verified");
});
```

- [ ] **Step 2: Register the new test and verify failure**

Add `tests/recovery-e0-c-domain.test.mjs` immediately after `tests/recovery-e0-readiness.test.mjs` in the `test` script in `package.json`.

Run:

```bash
node --experimental-strip-types --test tests/recovery-e0-c-domain.test.mjs
```

Expected: FAIL because `pilot-initialization.ts` does not exist.

- [ ] **Step 3: Implement the pure rules**

Create `app/services/pilot-initialization.ts` with no repository or browser dependency. Normalize whitespace, reject hidden limitations for `full`, require limitation text for `restricted`, and require both a department and limitation text for `pilot_limited`. `pilotGateState` returns `verified` only when all six booleans are true, `not_started` when all are false, and `blocked` otherwise.

Use these exact labels for UI consumers:

```ts
export const baselineStateLabels: Record<EmployeeBaselineState, string> = {
  full: "Full · 酒店完整基线",
  restricted: "Restricted · 有声明限制",
  pilot_limited: "Pilot Limited · 仅限试运行范围",
};
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
node --experimental-strip-types --test tests/recovery-e0-c-domain.test.mjs
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/pilot-initialization.ts tests/recovery-e0-c-domain.test.mjs package.json
git commit -m "feat: add deterministic E0-C readiness rules"
```

### Task 3: C0 security migration — separate platform provisioning from hotel business authority

**Review gate:** Do not start this task until the user explicitly approves creation of the E0-C migration.

**Files:**
- Create after approval: `supabase/migrations/20260729193000_recovery_e0_c_platform_provisioning.sql`
- Create: `supabase/tests/recovery_e0_c_platform_provisioning_test.sql`

**Interfaces:**
- Produces:

```sql
app_private.is_active_platform_provisioner() returns boolean
app_private.assert_active_platform_provisioner() returns void
public.prepare_pilot_property_provisioning(jsonb) returns jsonb
public.commit_pilot_property_provisioning(uuid,text,uuid) returns jsonb
public.commit_employee_import(uuid,bigint,text,boolean,text,uuid,boolean,text) returns uuid
public.verify_pilot_lineage(uuid,uuid) returns jsonb
```

- Persists only E0 readiness evidence:
  - `public.platform_provisioning_events`
  - `public.pilot_employee_baselines`
  - short-lived preview state under `app_private`

- [ ] **Step 1: Write a failing pgTAP security contract**

Create `supabase/tests/recovery_e0_c_platform_provisioning_test.sql` with assertions that prove:

1. active platform membership satisfies `is_active_platform_provisioner`;
2. platform membership alone does not satisfy `is_authorized_property_role`;
3. platform membership alone cannot call hotel settings, organization, employee import, D1, D2, D3, or D4 mutation RPCs;
4. a property manager cannot call either platform provisioning RPC;
5. anonymous and inactive platform users cannot read or mutate provisioning evidence;
6. direct authenticated inserts/updates into `tenants`, `properties`, `property_domains`, `property_settings`, memberships, role assignments, and `user_accounts` cannot substitute for the provisioning RPC;
7. prepare creates no tenant, property, account, employee, or training fact;
8. commit rejects an expired or mismatched preview hash;
9. commit creates one property foundation and one manager foundation, never an employee account;
10. baseline declaration requires an existing committed import preview/hash and an active property manager;
11. `pilot_limited` requires an official department in the same property;
12. `verify_pilot_lineage` is read-only and rejects cross-property evidence.

Use `tests.create_supabase_user`, `tests.authenticate_as`, and the established D0–D4 fixture helpers already used by the focused pgTAP files. Plan at least 48 assertions so every read and write denial is explicit.

- [ ] **Step 2: Run the focused pgTAP test and verify failure**

Run:

```bash
supabase db reset --local --no-seed
supabase test db --local supabase/tests/recovery_e0_c_platform_provisioning_test.sql
```

Expected: FAIL because the E0-C functions and readiness evidence do not exist and platform authorization is still too broad.

- [ ] **Step 3: Implement platform-only assertions and remove implicit hotel authority**

In the migration:

- define `is_active_platform_provisioner` from active, non-revoked `platform_memberships`;
- define `assert_active_platform_provisioner` with `42501` denial;
- redefine hotel business-management helpers so platform membership and `tenant_admin` do not satisfy them:

```sql
app_private.can_manage_property(p_property_id)
  = app_private.is_authorized_property_role(p_property_id, 'property_ld_manager')

app_private.can_manage_user_account(p_tenant_id, p_property_id)
  = app_private.is_authorized_property_role(p_property_id, 'property_ld_manager')
```

- redefine organization read access to property managers and authorized department roles only;
- remove direct platform DML policies for property settings, organization, backend accounts, and hotel business data;
- retain only self/platform-membership reads needed to authenticate the platform operator;
- do not grant the platform role any D0–D4 business RPC.

- [ ] **Step 4: Implement preview, commit, baseline, audit, and lineage functions**

`prepare_pilot_property_provisioning` must:

- validate normalized tenant/property codes, names, timezone, language, hostname, manager login ID, and display name;
- detect duplicate tenant code, property code, hostname, and manager login identity;
- write only a short-lived private preview containing actor, normalized payload hash, expiry, and redacted summary;
- return no internal Auth identifier or secret.

`commit_pilot_property_provisioning` must:

- lock and consume exactly one unexpired preview;
- accept an Auth user ID already created by the server route;
- create tenant, property, verified primary domain, default property settings, profile, tenant/property memberships, manager role assignment, and `user_accounts` foundation in one database transaction;
- create one append-only provisioning audit event;
- return property ID, hostname, manager display name, and handoff state;
- create no employee, trainer, Course, Requirement, Plan, Session, Attendance, or Completion row.

The approved eight-argument `commit_employee_import` signature must:

- require the batch ID, exact approved preview version/hash, explicit confirmation, classification, department scope, descendant rule, limitations, and manager actor;
- validate `full`, `restricted`, or `pilot_limited` using database constraints matching Task 2;
- execute the existing D0 employee commit and the new baseline declaration in the same database transaction;
- persist limitations and official department scope when required;
- leave the meaning and append-only behavior of Employee Fact Versions and import evidence unchanged;
- return the existing import commit ID;
- retain the old four-argument signature only as an explicitly revoked compatibility failure so a caller cannot create an unclassified Pilot baseline.

`verify_pilot_lineage` must:

- accept one baseline declaration ID and one Completion Record ID;
- trace exact property-scoped evidence through import commit/Employee Fact Version, Requirement Version/Accepted Learning Method, Session Revision/Participant Snapshot, closed Attendance Register/Determination, and reviewed Completion Evidence;
- return six booleans plus redacted evidence IDs and missing-evidence reasons;
- create or change no row.

- [ ] **Step 5: Run focused and regression pgTAP**

Run:

```bash
supabase db reset --local --no-seed
supabase test db --local supabase/tests/recovery_e0_c_platform_provisioning_test.sql
supabase test db --local supabase/tests/recovery_d0_foundation_gate_test.sql
supabase test db --local supabase/tests/recovery_d1_learning_requirement_foundation_test.sql
supabase test db --local supabase/tests/recovery_d2_training_operations_foundation_test.sql
supabase test db --local supabase/tests/recovery_d3_attendance_facts_test.sql
supabase test db --local supabase/tests/recovery_d4_completion_evidence_test.sql
```

Expected: all PASS.

- [ ] **Step 6: Review Stop C0**

Record:

- platform-only allowed operations;
- hotel business denials for platform-only identity;
- manager and department-role regression results;
- migration checksum and local-only status;
- explicit confirmation that Production was not connected.

Do not begin Task 4 until C0 is accepted.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260729193000_recovery_e0_c_platform_provisioning.sql supabase/tests/recovery_e0_c_platform_provisioning_test.sql
git commit -m "feat: isolate E0-C platform provisioning authority"
```

### Task 4: Add the isolated Super Admin authentication boundary

**Files:**
- Create: `app/services/platform-authorization.ts`
- Create: `app/api/platform/auth/login/route.ts`
- Create: `app/api/platform/auth/session/route.ts`
- Create: `app/api/platform/auth/logout/route.ts`
- Create: `tests/recovery-e0-c-platform-auth.test.mjs`
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
export async function requirePlatformProvisioner(
  request: Request,
): Promise<PlatformActor>;
```

- [ ] **Step 1: Write failing route-source and authorization tests**

Test that:

- platform authentication does not call `resolvePropertyContext`;
- it verifies the Supabase user and `is_active_platform_provisioner`;
- it uses the existing HttpOnly auth-cookie protections;
- it never releases an access token to hotel repositories;
- a platform-only user remains rejected by `resolveAuthenticatedRequest`;
- a hotel manager remains rejected by `requirePlatformProvisioner`;
- Production never falls back to mock platform identity.

- [ ] **Step 2: Run the focused test**

```bash
node --experimental-strip-types --test tests/recovery-e0-c-platform-auth.test.mjs
```

Expected: FAIL because platform routes and service do not exist.

- [ ] **Step 3: Implement the boundary**

Use the existing Supabase Auth session cookie format, but resolve platform identity without a hotel hostname. The internal platform login accepts an internal Supabase Auth email and password; that field is never shown on the hotel-branded login. After Auth verification, call `is_active_platform_provisioner`.

Do not add `platform_admin` to `EffectiveRole`, `AuthSession`, hotel navigation, `resolveAuthenticatedRequest`, or `/api/auth/access-token`.

- [ ] **Step 4: Run focused and Recovery A auth regressions**

```bash
node --experimental-strip-types --test \
  tests/recovery-e0-c-platform-auth.test.mjs \
  tests/authentication-entry.test.mjs \
  tests/recovery-a-routing.test.mjs \
  tests/production-activation-wiring.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/platform-authorization.ts app/api/platform/auth tests/recovery-e0-c-platform-auth.test.mjs package.json
git commit -m "feat: add isolated platform provisioning authentication"
```

### Task 5: Implement property preview, commit, and first-manager handoff

**Files:**
- Create: `app/services/platform-provisioning.ts`
- Create: `app/api/platform/properties/route.ts`
- Create: `app/platform/login/page.tsx`
- Create: `app/platform/properties/new/page.tsx`
- Create: `app/platform/platform.css`
- Create: `tests/recovery-e0-c-platform-provisioning.test.mjs`
- Create: `tests/recovery-e0-c-platform-ui.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces:

```ts
export type PilotPropertyProvisioningDraft = {
  tenantCode: string;
  tenantName: string;
  propertyCode: string;
  propertyNameZh: string;
  propertyNameEn: string;
  timezone: string;
  defaultLanguage: string;
  hostname: string;
  managerLoginId: string;
  managerDisplayName: string;
  temporaryPassword: string;
};
export type PilotPropertyProvisioningPreview = {
  previewId: string;
  previewHash: string;
  expiresAt: string;
  normalized: Omit<PilotPropertyProvisioningDraft, "temporaryPassword">;
};
export type PilotPropertyHandoff = {
  propertyId: string;
  hostname: string;
  managerDisplayName: string;
  handoffState: "ready_for_manager_login";
};
```

- [ ] **Step 1: Write failing service and route tests**

Cover:

- validation of codes, hostname, language, timezone, manager User ID, and 12-character password;
- preview response excludes password, Auth ID, tokens, and database identifiers other than preview ID;
- commit requires matching preview ID/hash;
- route calls `requirePlatformProvisioner`;
- server creates the Auth user only after preview confirmation;
- RPC failure deletes the newly created Auth user;
- successful commit does not delete the user and returns the handoff;
- duplicate property/hostname is business-readable;
- no request accepts a tenant/property ID as authorization evidence.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
node --experimental-strip-types --test \
  tests/recovery-e0-c-platform-provisioning.test.mjs \
  tests/recovery-e0-c-platform-ui.test.mjs
```

Expected: FAIL because the service, route, and pages do not exist.

- [ ] **Step 3: Implement the server service and route**

The POST route supports two explicit operations:

```json
{ "operation": "preview", "draft": {} }
{ "operation": "commit", "previewId": "...", "previewHash": "...", "temporaryPassword": "..." }
```

For commit:

1. require platform actor;
2. create the Supabase Auth identity with the secret-key server client;
3. call `commit_pilot_property_provisioning` with the actor-scoped client;
4. delete the Auth identity if the RPC fails;
5. return only the redacted handoff.

Never place the secret client, Auth user ID, internal email, or preview token in the browser payload.

- [ ] **Step 4: Implement the minimal internal platform UI**

The platform UI is visually related to the Luxury Hotel Operations Console but clearly labeled **平台开通**. It contains:

- property and hostname section;
- initial Hotel L&D Manager section;
- server validation;
- a read-only confirmation preview;
- explicit **确认创建并交接** action;
- saving, saved, failure, and conflict states;
- logout and return paths.

It contains no employee, organization, Course, Requirement, Session, Attendance, Completion, KPI, or multi-hotel business dashboard.

- [ ] **Step 5: Run focused tests and build**

```bash
node --experimental-strip-types --test \
  tests/recovery-e0-c-platform-provisioning.test.mjs \
  tests/recovery-e0-c-platform-ui.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 6: Review Stop C1**

Using synthetic local data, verify preview → commit → hotel-branded manager login → `/initialize`. Confirm a failed commit leaves neither a visible partial property nor a reusable temporary credential.

- [ ] **Step 7: Commit**

```bash
git add app/services/platform-provisioning.ts app/api/platform/properties app/platform tests/recovery-e0-c-platform-provisioning.test.mjs tests/recovery-e0-c-platform-ui.test.mjs package.json
git commit -m "feat: add first property provisioning and handoff"
```

### Task 6: Verify manager activation and department-scope handoff

**Files:**
- Modify: `app/initialize/page.tsx`
- Modify: `tests/recovery-b-settings-activation.test.mjs`
- Modify: `tests/recovery-b-administration.test.mjs`
- Create: `tests/recovery-e0-c-manager-handoff.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing hotel settings, organization, positions, accounts, and initialization repositories
- Produces: finite activation confirmation tied to the provisioned property and first manager

- [ ] **Step 1: Write failing handoff tests**

Assert that:

- first manager sees the property identity created by the platform preview;
- activation remains five sections and can return to `/`;
- the manager, not Super Admin, confirms business rules and organization;
- manager can create a Department Training Responsible Person only through the existing account flow;
- department scope requires explicit official branch and descendant choice;
- department user is denied settings, organization mutation, account administration, imports, and unrelated direct routes;
- platform-only identity cannot load `/initialize`.

- [ ] **Step 2: Run focused tests**

```bash
node --experimental-strip-types --test \
  tests/recovery-e0-c-manager-handoff.test.mjs \
  tests/recovery-b-settings-activation.test.mjs \
  tests/recovery-b-administration.test.mjs
```

Expected: FAIL only for the missing handoff presentation/guard assertions.

- [ ] **Step 3: Add the handoff state without changing Recovery B architecture**

At the top of the manager’s activation review, show a compact real-state notice:

```text
酒店已由平台完成基础开通
当前业务负责人：<current manager display name>
下一步：确认酒店规则、正式组织及员工基线
```

Do not add a Super Admin control, owner-signing form, permanent initialization percentage, or new organization editor.

- [ ] **Step 4: Run tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Review Stop C2 and commit**

Verify manager and department direct-route behavior with synthetic accounts, then:

```bash
git add app/initialize/page.tsx tests/recovery-e0-c-manager-handoff.test.mjs tests/recovery-b-settings-activation.test.mjs tests/recovery-b-administration.test.mjs package.json
git commit -m "feat: complete E0-C manager handoff"
```

### Task 7: Add manager-owned baseline classification to the trusted commit

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

**Interfaces:**
- Extends:

```ts
export type EmployeeUpdateApproval = {
  acknowledged: boolean;
  previewHash: string;
  baseline: BaselineClassificationDraft;
};
```

- Produces:

```ts
export type PilotEmployeeBaseline = {
  id: string;
  importCommitId: string;
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
- `full`, `restricted`, and `pilot_limited` validations match Task 2;
- baseline selection changes no preview counts or Employee Fact Version content;
- commit sends exact preview hash and baseline declaration to the server;
- stale preview or baseline scope conflict returns the existing conflict state;
- a department role cannot read the workbook or record a baseline;
- People Center displays the authoritative baseline state and limitations;
- no employee Auth/user account API is called.

- [ ] **Step 2: Run focused tests**

```bash
node --experimental-strip-types --test \
  tests/recovery-e0-c-baseline.test.mjs \
  tests/recovery-c-import-service.test.mjs \
  tests/recovery-d0-preview-approval.test.mjs
```

Expected: FAIL because baseline classification is not part of the approval contract.

- [ ] **Step 3: Implement contract, repository, and service changes**

Keep `commitBatch` as the only employee write path. Its single RPC call uses the approved eight-argument `commit_employee_import` signature so the existing D0 employee commit and the baseline declaration succeed or fail in one database transaction. A baseline validation failure must leave both the employee commit and baseline declaration unwritten.

Do not derive a baseline from row counts alone.

- [ ] **Step 4: Implement the classification UI**

Place `BaselineClassificationPanel` inside the existing zero-write preview step, before the acknowledgement checkbox:

- **Full** — no limitation field or department scope;
- **Restricted** — required visible limitation text;
- **Pilot Limited** — required official department branch, descendant setting, and limitation text.

The confirmation sentence must include the state, preview hash prefix, additions, updates, unchanged rows, exclusions, blocked rows, and unresolved rows.

- [ ] **Step 5: Re-read and display authoritative state**

After commit:

- re-read import history and the baseline declaration;
- show the classification in People Center and the activation review;
- show `数据范围受限` for Restricted and `仅限试运行范围` for Pilot Limited;
- never imply property-wide completeness from either limited state.

- [ ] **Step 6: Run focused tests and Recovery C/D0 regressions**

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

- [ ] **Step 7: Review Stop C3 and commit**

Use a synthetic workbook to prove zero writes before confirmation, exact preview/hash commit, classification persistence, authoritative re-read, and zero Auth users created.

```bash
git add app/components/import/BaselineClassificationPanel.tsx app/components/import/EmployeeUpdatePreviewStep.tsx app/import/page.tsx app/repositories/contracts/import-repository.ts app/repositories/supabase/import-repository.ts app/services/import-service.ts app/initialize/page.tsx app/people/page.tsx tests/recovery-e0-c-baseline.test.mjs tests/recovery-c-import-service.test.mjs tests/recovery-d0-preview-approval.test.mjs
git commit -m "feat: classify trusted pilot employee baselines"
```

### Task 8: Add a read-only first-loop readiness and lineage panel

**Files:**
- Create: `app/repositories/contracts/pilot-readiness-repository.ts`
- Create: `app/repositories/supabase/pilot-readiness-repository.ts`
- Modify: `app/repositories/registry.ts`
- Create: `app/components/initialization/PilotReadinessPanel.tsx`
- Modify: `app/initialize/page.tsx`
- Create: `tests/recovery-e0-c-pilot-lineage.test.mjs`
- Create: `tests/recovery-e0-c-ui.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces:

```ts
export type PilotLineageEvidence = {
  baselineId: string;
  completionRecordId: string;
};
export type PilotReadinessSnapshot = PilotSuccessEvidence & {
  source: "real";
  refreshedAt: string;
  evidence: {
    propertyId: string | null;
    importCommitId: string | null;
    requirementVersionId: string | null;
    sessionRevisionId: string | null;
    attendanceRegisterId: string | null;
    completionRecordId: string | null;
  };
  missingReasons: string[];
};
export interface PilotReadinessRepository {
  verifyLineage(input: PilotLineageEvidence): Promise<PilotReadinessSnapshot>;
}
```

- [ ] **Step 1: Write failing repository and UI tests**

Assert that:

- the repository calls only `verify_pilot_lineage`;
- property ID is not accepted from the browser as authorization evidence;
- each of the six criteria displays `已验证`, `尚未完成`, or `无法验证`;
- the panel never shows a percentage, score, KPI, Health, Forecast, Risk, or AI recommendation;
- every incomplete stage links to the existing real module;
- selecting evidence creates no Requirement, Session, Attendance, or Completion row;
- department role cannot access the manager verification panel;
- cross-property Completion evidence is denied.

- [ ] **Step 2: Run focused tests**

```bash
node --experimental-strip-types --test \
  tests/recovery-e0-c-pilot-lineage.test.mjs \
  tests/recovery-e0-c-ui.test.mjs
```

Expected: FAIL because the repository and panel do not exist.

- [ ] **Step 3: Implement the repository**

Map the RPC response without inventing defaults. A null or failed critical source maps to `false` plus a business-readable missing reason, not to a zero count or healthy result.

- [ ] **Step 4: Implement the manager panel**

Add the panel to the final activation/readiness section. The manager explicitly selects:

- one committed baseline declaration;
- one reviewed Completion Record.

The system then performs read-only lineage verification and displays:

```text
酒店初始化
员工基线
培训要求
培训交付
出勤记录
完成验证
```

Links:

- property/activation → `/initialize`;
- baseline → `/import`;
- Requirement → `/requirements`;
- training delivery → `/sessions`;
- Attendance → `/attendance-feedback`;
- Completion → `/completions`.

No button creates or advances a business fact. The manager performs each action in the existing governed module.

- [ ] **Step 5: Run focused and D1–D4 regression tests**

```bash
node --experimental-strip-types --test \
  tests/recovery-e0-c-pilot-lineage.test.mjs \
  tests/recovery-e0-c-ui.test.mjs \
  tests/recovery-d1-domain.test.mjs \
  tests/recovery-d2-domain.test.mjs \
  tests/recovery-d3-domain.test.mjs \
  tests/recovery-d4-domain.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Review Stops C4–C6 with synthetic facts**

In a disposable local database only:

1. create one effective synthetic Requirement through D1;
2. create one synthetic Plan/Session and Participant Snapshot through D2;
3. record and close one Attendance register through D3;
4. review one Completion through D4;
5. select the baseline and completion in the panel;
6. verify all six criteria and exact immutable lineage.

Do not seed Production-like names, real employees, or historical facts.

- [ ] **Step 7: Commit**

```bash
git add app/repositories/contracts/pilot-readiness-repository.ts app/repositories/supabase/pilot-readiness-repository.ts app/repositories/registry.ts app/components/initialization/PilotReadinessPanel.tsx app/initialize/page.tsx tests/recovery-e0-c-pilot-lineage.test.mjs tests/recovery-e0-c-ui.test.mjs package.json
git commit -m "feat: verify first pilot fact lineage"
```

### Task 9: Full verification and Review Stop E0-C

**Files:**
- Create: `docs/recovery-e0/e0-c-review-stop-report.md`

**Interfaces:**
- Consumes: Tasks 1–8
- Produces: evidence-backed `Go`, `Conditional Go`, or `No Go` for real Pilot execution; never authorizes Production

- [ ] **Step 1: Run clean local migration replay**

```bash
supabase db reset --local --no-seed
supabase migration list --local
```

Expected: every ordered migration through `20260729193000` applies once with no seed data.

- [ ] **Step 2: Run focused and full pgTAP**

```bash
supabase test db --local supabase/tests/recovery_e0_c_platform_provisioning_test.sql
supabase test db --local
```

Expected: all assertions PASS.

- [ ] **Step 3: Run application tests and build**

```bash
npm test
```

Expected: all Node tests, production build, and rendered HTML test PASS.

- [ ] **Step 4: Run browser verification at three viewports**

Verify at:

- desktop `1440 × 1000`;
- tablet `1024 × 1366`;
- mobile `390 × 844`.

Cover:

- platform login and denied hotel-manager access;
- property preview and confirmation state;
- manager hotel login and finite activation;
- department role direct-route denials;
- baseline classification, validation, conflict, and saved state;
- first-loop readiness links and verified lineage;
- keyboard focus;
- normal-zoom readability;
- 44px mobile touch targets;
- no horizontal overflow;
- no browser console errors;
- no unexplained failed network requests.

Remove local credentials, cookies, screenshots containing synthetic passwords, and reusable preview tokens after capture.

- [ ] **Step 5: Write the Review Stop report**

`docs/recovery-e0/e0-c-review-stop-report.md` must report:

- property provisioning and manager handoff;
- platform-versus-hotel authorization proof;
- baseline classification and commit proof;
- one synthetic Requirement → Session → Attendance → Completion lineage;
- migration and pgTAP results;
- application/build/browser results;
- open risks;
- branch and commit;
- explicit confirmation that Production, DNS, Production environments, real employees, and real facts were untouched;
- explicit confirmation that D5, KPI, Forecast, AI, Feedback, Health, Risk, and automation were not started.

- [ ] **Step 6: Final commit**

```bash
git add docs/recovery-e0/e0-c-review-stop-report.md
git commit -m "docs: record Review Stop E0-C"
```

## Plan self-review

- Every approved role refinement maps to Tasks 3–6.
- All three baseline states map to Tasks 2, 3, and 7.
- All six Pilot success criteria map to Task 8 and are verified in Task 9.
- No task creates D5, analytics, Feedback, AI, or operational automation.
- Real facts and Production remain excluded.
- The only migration is explicitly blocked behind a separate C0 approval.
- D0–D4 facts are referenced, not redefined.
