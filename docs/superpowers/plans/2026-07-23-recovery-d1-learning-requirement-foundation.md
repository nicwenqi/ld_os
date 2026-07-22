# Recovery D1 Learning Requirement Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, versioned Learning Requirement foundation that defines hotel obligations, accepted completion methods, effective-dated applicability and point-in-time eligibility without creating employee assignments or training-operation facts.

**Architecture:** Add one additive Supabase migration with property-isolated, immutable version records and RPC-only mutation/read boundaries. Expose those facts through a focused repository/service layer and two role-specific workspaces: a manager obligation workspace and a department-scoped read-only view. Eligibility is calculated from D0 employee fact versions at an explicit evaluation date and is never persisted as an employee obligation.

**Tech Stack:** PostgreSQL 17, Supabase RLS/RPC/pgTAP, TypeScript 5.9, React 19, Vinext/Next-compatible App Router, Node test runner, existing Hotel L&D OS repository and save-state patterns.

## Global Constraints

- Requirement is the business-obligation layer; no Requirement Version directly binds one Course Version.
- Course Version separates content identity, capability identity and version-continuity metadata.
- Accepted methods are Published Course Versions, approved external certificates, controlled assessments/examinations and explicitly approved equivalency recognition.
- Eligibility is tri-state and point-in-time: `eligible`, `not_applicable`, `unable_to_determine`.
- Missing evidence never becomes `not_applicable` or zero.
- Published Course Versions and Approved/Effective Requirement Versions are immutable.
- Do not add temporary suspension in D1.
- Do not create Assignment, Enrollment, Plan, Session, Attendance, Completion, Feedback, KPI, Forecast, Health, Risk, Intervention or AI structures.
- Do not create backend accounts for employees.
- Do not use prototype course/session arrays as a Production source.
- Do not accept browser-selected tenant, property, role or department scope as authority.
- Do not apply the migration to Production, import real employees, deploy to Production, modify DNS or start D2.
- Every production-code change follows red-green-refactor and every task ends with a focused commit.

---

## File structure

### New files

- `supabase/migrations/<CLI-generated>_recovery_d1_learning_requirement_foundation.sql` — D1 schema, constraints, lifecycle, RLS, audit and RPCs. Create it only with `supabase migration new recovery_d1_learning_requirement_foundation`.
- `supabase/tests/recovery_d1_learning_requirement_foundation_test.sql` — structural, lifecycle, authorization and eligibility pgTAP coverage.
- `app/repositories/contracts/learning-requirement-repository.ts` — D1 domain and repository contract.
- `app/repositories/mock/learning-requirement-repository.ts` — explicitly labelled local-review repository; never selected in Production.
- `app/repositories/supabase/learning-requirement-repository.ts` — RPC mapping boundary.
- `app/services/learning-requirement-service.ts` — deterministic client validation, save orchestration and business error mapping.
- `app/components/requirements/RequirementWorkspace.tsx` — manager obligation register and editor orchestration.
- `app/components/requirements/CourseVersionEditor.tsx` — secondary Course/Course Version editor.
- `app/components/requirements/RequirementVersionEditor.tsx` — obligation, timing, completion method and rule-set editor.
- `app/components/requirements/EligibilityPreview.tsx` — read-only tri-state point-in-time evaluation.
- `app/components/requirements/DepartmentRequirementWorkspace.tsx` — department-scoped read-only experience.
- `app/requirements/page.tsx` — manager route.
- `app/department/requirements/page.tsx` — department route.
- `app/recovery-d1.css` — responsive, premium D1 presentation.
- `tests/recovery-d1-domain.test.mjs` — contract and pure-service behavior.
- `tests/recovery-d1-repository.test.mjs` — RPC and registry boundaries.
- `tests/recovery-d1-manager-ui.test.mjs` — manager information architecture and action behavior.
- `tests/recovery-d1-department-ui.test.mjs` — scope, direct-route and read-only behavior.

### Modified files

- `app/repositories/registry.ts` — register D1 as a validated foundation module.
- `app/services/role-navigation.ts` — add role-correct Requirement destinations.
- `app/services/auth-routing.ts` — authorize the two new direct routes with no cross-role access.
- `app/globals.css` — import `recovery-d1.css` after Recovery C.
- `package.json` — add all four D1 application tests to the default test gate.
- Existing route- and navigation-test files — replace the assumption that every training-domain destination is unavailable.

---

### Task 1: Freeze D1 domain contracts and pure validation

**Files:**
- Create: `app/repositories/contracts/learning-requirement-repository.ts`
- Create: `app/services/learning-requirement-service.ts`
- Create: `tests/recovery-d1-domain.test.mjs`

**Interfaces:**
- Produces: `CourseRecord`, `CourseVersion`, `RequirementRecord`, `RequirementVersion`, `CompletionDefinition`, `AcceptedLearningMethod`, `EligibilityRuleSet`, `EligibilityEvaluationRow`, `LearningRequirementRepository`, `createLearningRequirementService`.
- Consumes later: repository implementations and both workspaces use only this contract.

- [ ] **Step 1: Write the failing domain test**

Test these exact rules:

```js
test("D1 keeps requirement obligation separate from accepted course methods", () => {
  const draft = validRequirementDraft();
  assert.equal("courseVersionId" in draft, false);
  assert.deepEqual(draft.completionDefinition.methods.map(item => item.type), [
    "course_version",
    "external_certificate",
    "assessment",
    "manager_equivalency",
  ]);
});

test("D1 timing accepts only the four approved deterministic models", () => {
  for (const timing of approvedTimingFixtures()) {
    assert.deepEqual(validateRequirementDraft({ ...validRequirementDraft(), timing }), []);
  }
  assert.match(
    validateRequirementDraft({ ...validRequirementDraft(), timing: { type: "department_transfer" } })[0],
    /仅支持一次性、入职后、自然周期或固定间隔/,
  );
});

test("overlapping rule periods block approval in business language", () => {
  assert.match(validateRequirementDraft(overlappingRuleDraft())[0], /适用规则有效期重叠/);
});
```

- [ ] **Step 2: Run the domain test and verify RED**

Run:

```bash
node --experimental-strip-types --test tests/recovery-d1-domain.test.mjs
```

Expected: FAIL because the contract and service do not exist.

- [ ] **Step 3: Define the discriminated unions and repository contract**

Use these exact public types:

```ts
export type CourseVersionState = "draft" | "review" | "published" | "retired";
export type RequirementVersionState = "draft" | "approved" | "effective" | "superseded" | "retired";
export type LearningMethodType =
  | "course_version"
  | "external_certificate"
  | "assessment"
  | "manager_equivalency";
export type EligibilityState = "eligible" | "not_applicable" | "unable_to_determine";
export type TimingDefinition =
  | { type: "fixed_date"; dueDate: string }
  | { type: "hire_relative"; dueWithinDays: number }
  | { type: "calendar_recurrence"; period: "month" | "quarter" | "year" }
  | { type: "interval_months"; intervalMonths: number; anchorDate: string };

export interface LearningRequirementRepository {
  readManagerFoundation(propertyId: string): Promise<LearningRequirementFoundation>;
  saveCourseDraft(input: SaveCourseDraftInput): Promise<CourseVersion>;
  transitionCourseVersion(input: TransitionCourseVersionInput): Promise<CourseVersion>;
  saveRequirementDraft(input: SaveRequirementDraftInput): Promise<RequirementVersion>;
  approveRequirementVersion(input: ApproveRequirementVersionInput): Promise<RequirementVersion>;
  activateRequirementVersion(input: ActivateRequirementVersionInput): Promise<RequirementVersion>;
  retireRequirementVersion(input: RetireRequirementVersionInput): Promise<RequirementVersion>;
  evaluateEligibility(input: EligibilityEvaluationInput): Promise<EligibilityEvaluationPage>;
  readDepartmentRequirements(): Promise<DepartmentRequirementFoundation>;
}
```

`RequirementVersionDraft` has `completionDefinition` and no direct `courseVersionId`. Each method subtype carries only its permitted evidence fields.

- [ ] **Step 4: Implement deterministic draft validation**

`validateCourseVersionDraft` validates content identity, capability identity, duration and continuity metadata. `validateRequirementDraft` validates one Completion Definition, one or more accepted methods, one approved timing shape, ordered dates, non-overlapping Rule Sets and non-empty employee-status selections. It must not calculate completion, overdue or assignment state.

- [ ] **Step 5: Run the domain test and verify GREEN**

Expected: all D1 domain tests PASS.

- [ ] **Step 6: Commit the contract slice**

```bash
git add app/repositories/contracts/learning-requirement-repository.ts app/services/learning-requirement-service.ts tests/recovery-d1-domain.test.mjs
git commit -m "feat: define D1 learning requirement contracts"
```

---

### Task 2: Add the additive D1 schema and append-only evidence

**Files:**
- Create via CLI: `supabase/migrations/*_recovery_d1_learning_requirement_foundation.sql`
- Create: `supabase/tests/recovery_d1_learning_requirement_foundation_test.sql`

**Interfaces:**
- Consumes: D0 `app_private.is_authorized_property_role`, `app_private.has_authorized_department_scope` and `app_private.resolve_employee_fact_at`.
- Produces: property-scoped Course, Requirement, Completion, Rule Set and audit records; no employee-level operational record.

- [ ] **Step 1: Write the failing structural pgTAP tests**

Assert the presence of exactly these D1 tables:

```sql
select has_table('public', 'courses');
select has_table('public', 'course_versions');
select has_table('public', 'training_requirements');
select has_table('public', 'training_requirement_versions');
select has_table('public', 'completion_definitions');
select has_table('public', 'accepted_learning_methods');
select has_table('public', 'requirement_timing_definitions');
select has_table('public', 'eligibility_rule_sets');
select has_table('public', 'eligibility_rule_departments');
select has_table('public', 'eligibility_rule_positions');
select has_table('public', 'eligibility_rule_position_families');
select has_table('public', 'learning_requirement_audit_events');
```

Also assert that no authenticated direct `INSERT`, `UPDATE` or `DELETE` privilege exists on any of them and that no Assignment, Session, Attendance, Completion Record, Feedback, KPI, Forecast, Risk or Intervention table is introduced by the migration.

- [ ] **Step 2: Run the new pgTAP file and verify RED**

Run:

```bash
HOME=/tmp/codex-supabase SUPABASE_TELEMETRY_DISABLED=true supabase test db supabase/tests/recovery_d1_learning_requirement_foundation_test.sql
```

Expected: FAIL because the D1 relations do not exist.

- [ ] **Step 3: Generate the migration with the CLI**

Run:

```bash
HOME=/tmp/codex-supabase SUPABASE_TELEMETRY_DISABLED=true supabase migration new recovery_d1_learning_requirement_foundation
```

Use the path printed by the CLI. Do not rename it or invent a timestamp.

- [ ] **Step 4: Add the property-scoped identities and versions**

The migration creates:

- `courses`: immutable `tenant_id`/`property_id`, normalized property-unique code, current lineage version and active flag;
- `course_versions`: unique `(course_id, version_number)`, lifecycle state, content fields, capability fields, change metadata, optimistic `version`, review/publish/retire evidence;
- `training_requirements`: property-unique code and stable lineage;
- `training_requirement_versions`: unique `(training_requirement_id, version_number)`, lifecycle state, effective dates, purpose, change metadata and optimistic `version`.

All cross-table foreign keys include tenant and property scope. `course_versions.standard_duration_minutes` is positive. Published or retired Course Versions reject content mutation. Approved, effective, superseded or retired Requirement Versions reject definition mutation.

- [ ] **Step 5: Add completion, timing, rule and audit relations**

Enforce:

- exactly one `completion_definitions` row per Requirement Version with `satisfaction_operator = 'any_one'`;
- `accepted_learning_methods.method_type` is one of the four approved types;
- subtype checks require a Published Course Version reference only for `course_version`, certificate fields only for `external_certificate`, assessment/pass fields only for `assessment`, and approval standard only for `manager_equivalency`;
- exactly one timing definition per Requirement Version with a shape check for the four approved types;
- Rule Set periods use an exclusion constraint so periods under one Requirement Version cannot overlap;
- department/position/family terms reference active records in the same property;
- audit events are append-only and retain actor, action, reason, before/after evidence and time.

- [ ] **Step 6: Enable and force RLS, then revoke direct mutation**

Enable and force RLS on every new public table. Revoke all grants from `anon`; revoke authenticated table mutation. Do not add a broad `TO authenticated USING (true)` policy. Manager and department reads will use the scoped RPC projections defined in later tasks.

- [ ] **Step 7: Reset locally and verify the structural tests GREEN**

Run a clean local reset, then the D1 pgTAP file. Expected: structural and grant tests PASS; local seed creates no Course or Requirement.

- [ ] **Step 8: Commit the schema slice**

```bash
git add supabase/migrations supabase/tests/recovery_d1_learning_requirement_foundation_test.sql
git commit -m "feat: add D1 requirement foundation schema"
```

---

### Task 3: Implement version governance and manager mutation RPCs

**Files:**
- Modify: the CLI-generated D1 migration
- Modify: `supabase/tests/recovery_d1_learning_requirement_foundation_test.sql`

**Interfaces:**
- Produces RPCs: `read_learning_requirement_foundation`, `save_course_version_draft`, `transition_course_version`, `save_requirement_version_draft`, `approve_requirement_version`, `activate_requirement_version`, `retire_requirement_version`.

- [ ] **Step 1: Add failing pgTAP lifecycle tests**

Cover:

- manager can create a Course Draft and Requirement Draft;
- stale expected version raises a business conflict;
- Course Draft cannot publish before Review;
- Course Review can publish only when content, capability and continuity fields are complete;
- Requirement Draft cannot approve without one Completion Definition, accepted method, timing definition and non-conflicting Rule Set;
- course-based method rejects Draft, Review or Retired Course Versions;
- Approved Requirement cannot be mutated;
- activation before `effective_from` fails;
- activating a new version atomically marks the old Effective version Superseded;
- retirement requires a non-blank reason;
- no transition creates employee facts, assignments or completion records.

- [ ] **Step 2: Run the lifecycle tests and verify RED**

Expected: FAIL because the RPCs do not exist.

- [ ] **Step 3: Add one private manager assertion and aggregate draft writers**

Every mutation begins with:

```sql
if not app_private.is_authorized_property_role(p_property_id, 'property_ld_manager') then
  raise exception 'LEARNING_REQUIREMENT_MANAGER_REQUIRED' using errcode = '42501';
end if;
```

Draft RPCs accept an expected concurrency version and one structured JSON payload, validate every referenced object in the property, update the aggregate transactionally, append an audit event and re-read the authoritative aggregate before returning it.

- [ ] **Step 4: Add exact state transition functions**

Allowed transitions are:

```text
Course: draft→review, review→draft with reason, review→published, published→retired
Requirement: draft→approved, approved→effective on/after effective_from,
             effective→superseded only inside activation of a newer version,
             approved/effective/superseded→retired with reason
```

No suspension transition exists. State functions reject all other transitions with Chinese-first messages.

- [ ] **Step 5: Add immutable triggers and audit assertions**

Triggers compare protected definition columns and child aggregate rows after freeze. Only lifecycle evidence fields may change through the state RPC. Audit events reject update/delete for every role.

- [ ] **Step 6: Grant only the intended RPCs**

Revoke function execution from `public`, `anon` and `authenticated`, then grant only the listed public RPC signatures to `authenticated`. Each security-definer RPC checks `auth.uid()`, uses `search_path = ''` and calls D0 authorization.

- [ ] **Step 7: Run lifecycle pgTAP and verify GREEN**

Expected: lifecycle, immutability, audit, stale-write and zero-employee-fact assertions PASS.

- [ ] **Step 8: Commit the governance slice**

```bash
git add supabase/migrations supabase/tests/recovery_d1_learning_requirement_foundation_test.sql
git commit -m "feat: enforce D1 version governance"
```

---

### Task 4: Implement deterministic, scoped Eligibility Evaluation

**Files:**
- Modify: the CLI-generated D1 migration
- Modify: `supabase/tests/recovery_d1_learning_requirement_foundation_test.sql`

**Interfaces:**
- Produces RPCs: `evaluate_learning_requirement_eligibility` and `list_department_effective_requirements`.
- Consumes: `app_private.resolve_employee_fact_at(employee_id, evaluation_date)`.

- [ ] **Step 1: Add failing point-in-time evaluation tests**

Build employee fact fixtures for before and after a department/position/status change. Assert:

```text
known matching facts                  → eligible
known non-matching facts              → not_applicable
missing required department           → unable_to_determine
missing required position             → unable_to_determine
missing hire date for new-employee rule → unable_to_determine
no employee fact at evaluation date   → unable_to_determine
same employee before transfer         → old rule outcome
same employee after transfer          → new rule outcome
```

Also assert the response contains Requirement Version ID, Rule Set ID, Employee Fact Version ID, evaluation date, reason codes and timing explanation, and that evaluation inserts no row anywhere.

- [ ] **Step 2: Add failing authorization tests**

Assert:

- manager can evaluate any employee in the current hotel;
- department role can evaluate only employee facts whose evaluation-date department is within an active authorized branch/descendant;
- unrelated department, inactive account, inactive membership and inactive scope are denied or omitted;
- department list returns only Effective Requirements relevant to authorized scope;
- department projection excludes drafts, approval notes and unrelated department labels;
- anonymous access is denied.

- [ ] **Step 3: Run the focused pgTAP file and verify RED**

Expected: eligibility and scoped-read tests FAIL because the RPCs are absent.

- [ ] **Step 4: Implement the tri-state evaluator**

Evaluation order is deterministic:

1. resolve authorized actor and Requirement Version;
2. verify the version is Effective for the requested date;
3. select exactly one effective Rule Set;
4. resolve the D0 Employee Fact Version at that date;
5. enforce department actor scope using the fact’s department;
6. evaluate configured dimensions;
7. return `unable_to_determine` before any false conclusion when a required fact is missing;
8. otherwise return `eligible` only when every configured dimension matches;
9. return `not_applicable` with explicit non-match reasons.

The evaluator is `stable`, read-only and does not write audit or dependency records.

- [ ] **Step 5: Implement timing explanation without obligation status**

Return a fixed due date, hire-relative due date, calendar period label or anchored interval explanation. Do not return `overdue`, `complete`, `pending`, `assigned` or any equivalent employee obligation state.

- [ ] **Step 6: Implement the department-safe projection**

The department RPC derives scope from D0 authorization. It returns effective obligation summary, accepted methods and only rule context relevant to the authorized branch. It never accepts property ID, department ID or scope arrays from the browser.

- [ ] **Step 7: Run focused and full pgTAP tests and verify GREEN**

Expected: D1 file PASS, then all existing pgTAP files PASS.

- [ ] **Step 8: Commit the eligibility slice**

```bash
git add supabase/migrations supabase/tests/recovery_d1_learning_requirement_foundation_test.sql
git commit -m "feat: add point-in-time eligibility evaluation"
```

---

### Task 5: Connect repositories, services and truthful data-source selection

**Files:**
- Create: `app/repositories/mock/learning-requirement-repository.ts`
- Create: `app/repositories/supabase/learning-requirement-repository.ts`
- Modify: `app/repositories/registry.ts`
- Modify: `app/services/learning-requirement-service.ts`
- Create: `tests/recovery-d1-repository.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 repository contract and Task 3–4 RPCs.
- Produces: `registry.learningRequirements` and authoritative reload behavior.

- [ ] **Step 1: Write failing repository tests**

Assert that:

- `learning-requirements` resolves to Supabase in hybrid/Supabase modes and explicitly labelled mock only in local mock mode;
- Production rejects any mock injection through the existing environment boundary;
- Supabase repository calls only the approved RPCs;
- department reads/evaluations pass no browser-selected property or department scope;
- mutation errors map stale version to `ConflictError`, authorization to access denial and rule conflict to business-readable validation;
- every save or transition re-reads authoritative server state.

- [ ] **Step 2: Run repository tests and verify RED**

Expected: FAIL because the repository implementations and registry member are missing.

- [ ] **Step 3: Implement the Supabase mapper**

Map snake_case RPC payloads only at the repository boundary. Validate lifecycle, timing, method and tri-state values before returning them. Do not query Supabase directly in pages or components.

- [ ] **Step 4: Implement the local-review repository**

Use synthetic records labelled `本地评审数据`. Keep mutations in process memory only for visual review. Do not represent mock evaluation as real hotel facts and never select this repository in Production.

- [ ] **Step 5: Register the D1 module and service**

Add `learning-requirements` to `ModuleName` and the foundation module allowlist. Return `learningRequirements` from `createRepositoryRegistry`. The service validates drafts before repository calls and always reloads after persistence.

- [ ] **Step 6: Add D1 tests to the default gate and verify GREEN**

Add all four D1 `.mjs` files explicitly to the `npm test` script. Run the repository and domain tests. Expected: PASS.

- [ ] **Step 7: Commit the data-boundary slice**

```bash
git add app/repositories app/services package.json tests/recovery-d1-domain.test.mjs tests/recovery-d1-repository.test.mjs
git commit -m "feat: connect D1 requirement repositories"
```

---

### Task 6: Build the manager Learning Requirement workspace

**Files:**
- Create: `app/components/requirements/RequirementWorkspace.tsx`
- Create: `app/components/requirements/CourseVersionEditor.tsx`
- Create: `app/components/requirements/RequirementVersionEditor.tsx`
- Create: `app/components/requirements/EligibilityPreview.tsx`
- Create: `app/requirements/page.tsx`
- Modify: `app/services/role-navigation.ts`
- Modify: `app/services/auth-routing.ts`
- Create: `tests/recovery-d1-manager-ui.test.mjs`
- Modify: existing Recovery A navigation/route tests

**Interfaces:**
- Consumes: `createLearningRequirementService`, current manager session property and organization/position foundation records.
- Produces: `/requirements`, manager-only navigation and usable draft/publish/evaluation actions.

- [ ] **Step 1: Write failing manager UI tests**

Assert the source and rendered contract includes:

- page title `培训要求` before secondary Course foundation;
- obligation register with Draft, Approved, Effective, Superseded and Retired labels;
- separate content identity, capability identity and continuity sections;
- all four timing types and all four accepted method types;
- effective-dated Rule Set editor with descendant choice;
- publication-readiness panel and conflict explanation;
- explicit evaluation date and the three eligibility states;
- CTC/GTC notice stating no automatic requirement is created;
- no Assignment, overdue, completion, attendance, KPI, forecast, risk or AI claim;
- manager-only create, save, review, publish, approve, activate and retire actions;
- shared dirty/saving/saved/failed/conflict states and unsaved-change warning.

- [ ] **Step 2: Run manager UI tests and verify RED**

Expected: FAIL because `/requirements` and components do not exist.

- [ ] **Step 3: Implement the manager page shell and authoritative loading**

Use `ProtectedAppProviders`, `AppShell`, the server-resolved session and registry. Show distinct states for loading, no real Requirements, partial organization facts, source failure and normal data. A missing Requirement source never falls back to the old `app/data/courses.ts` array.

- [ ] **Step 4: Implement Course Version and Requirement Version draft editors**

Editors expose only fields in the locked design. All controls update visible draft state. Save validates, calls the service, reloads authority and displays the shared save state. Frozen versions render read-only with a “创建新版本” action rather than editable controls.

- [ ] **Step 5: Implement completion methods, rules and publication review**

Method editors change their fields by subtype without preserving forbidden subtype data. Rule editor enforces dates, descendants and structured dimensions. Publication review displays every blocking conflict and requires explicit confirmation before lifecycle transition.

- [ ] **Step 6: Implement point-in-time evaluation preview**

Preview requires Requirement Version and evaluation date. It renders separate eligible, not-applicable and unable-to-determine groups, reason evidence and Employee Fact Version evidence. It never labels rows as tasks or obligations and has no write action.

- [ ] **Step 7: Add manager navigation and direct-route tests**

Add `培训要求 / Learning requirements /requirements / foundation` under periodic review before `培训计划`. Add `/requirements` only to `managerRoutes`. Manager can access it; department role cannot access the manager route.

- [ ] **Step 8: Run manager UI, routing and interaction tests and verify GREEN**

Expected: all focused tests PASS.

- [ ] **Step 9: Commit the manager workspace slice**

```bash
git add app/components/requirements app/requirements app/services/role-navigation.ts app/services/auth-routing.ts tests
git commit -m "feat: add manager requirement workspace"
```

---

### Task 7: Build the department-scoped Requirement workspace

**Files:**
- Create: `app/components/requirements/DepartmentRequirementWorkspace.tsx`
- Create: `app/department/requirements/page.tsx`
- Modify: `app/services/role-navigation.ts`
- Modify: `app/services/auth-routing.ts`
- Create: `tests/recovery-d1-department-ui.test.mjs`
- Modify: existing Recovery A department routing/navigation tests

**Interfaces:**
- Consumes: no-argument department repository reads and evaluation inputs containing only Requirement Version, evaluation date, optional employee and pagination; authorization scope remains server-derived.
- Produces: `/department/requirements` with no mutation capability.

- [ ] **Step 1: Write failing department tests**

Assert:

- authorized scope cards and breadcrumbs are always visible;
- only Effective Requirement summaries and Accepted Learning Methods render;
- evaluation uses the explicit date and shows three states;
- no Draft, Review, approval note, create, edit, publish, retire, property selector or department selector appears;
- no unrelated employee or department name appears in a forged-scope repository fixture;
- manager direct access redirects or denies according to the existing route matrix;
- anonymous direct access redirects to `/login`;
- load failure never displays zero or “no requirement” as a false conclusion.

- [ ] **Step 2: Run department tests and verify RED**

Expected: FAIL because the route and workspace do not exist.

- [ ] **Step 3: Implement the scoped read-only page**

Render scope context from `AuthSession.departmentScopes`. Call only `readDepartmentRequirements()` and `evaluateEligibility()` without property, department or scope arguments. Keep the active Requirement, accepted methods and eligibility evidence understandable without revealing global administration.

- [ ] **Step 4: Add department navigation and authorization assertions**

Add `培训要求 / Learning requirements /department/requirements / foundation` immediately after `部门工作台`. Add `/department/requirements` only to `departmentRoutes`. Visible navigation and direct route use the same department role contract.

- [ ] **Step 5: Run department, route and authorization tests and verify GREEN**

Expected: all focused tests PASS.

- [ ] **Step 6: Commit the department slice**

```bash
git add app/components/requirements/DepartmentRequirementWorkspace.tsx app/department/requirements app/services/role-navigation.ts app/services/auth-routing.ts tests
git commit -m "feat: add scoped department requirements"
```

---

### Task 8: Apply premium responsive presentation and interaction truthfulness

**Files:**
- Create: `app/recovery-d1.css`
- Modify: `app/globals.css`
- Modify: `tests/recovery-d1-manager-ui.test.mjs`
- Modify: `tests/recovery-d1-department-ui.test.mjs`

**Interfaces:**
- Produces: desktop, tablet and mobile layouts using existing ivory, ink-blue, champagne, teal, coral and slate tokens.

- [ ] **Step 1: Add failing visual-contract tests**

Assert:

- CSS is imported after Recovery C;
- layout collapses at both tablet and mobile breakpoints;
- touch controls have at least 44px height on mobile;
- focus-visible styling exists for buttons, links, inputs, selects and textareas;
- long course, method and rule labels wrap without horizontal page overflow;
- slate identifies unavailable/unknown, teal only verified state and coral only actionable validation;
- healthy/empty pages avoid decorative metric grids.

- [ ] **Step 2: Run UI tests and verify RED**

Expected: FAIL because D1 styles do not exist.

- [ ] **Step 3: Implement the D1 visual layer**

Use a calm obligation register, progressive editor disclosure, readable normal-zoom type and compact evidence panels. Desktop may use register/detail columns; tablet stacks the detail below the register; mobile puts lifecycle, save state and primary action before supporting evidence. No full-screen dense table is the default.

- [ ] **Step 4: Audit every enabled action**

Each enabled action must save, transition, evaluate, reload, navigate or open a usable confirmation. Disable unavailable transitions with an inline business reason; do not use a prototype toast to imply persistence.

- [ ] **Step 5: Run focused UI tests and verify GREEN**

Expected: manager and department UI tests PASS.

- [ ] **Step 6: Commit the visual slice**

```bash
git add app/recovery-d1.css app/globals.css tests/recovery-d1-manager-ui.test.mjs tests/recovery-d1-department-ui.test.mjs
git commit -m "style: polish D1 requirement experience"
```

---

### Task 9: Complete Review Stop D1 verification

**Files:**
- Modify only if verification reveals a genuine D1 defect.
- Create after verification: `docs/recovery-d1/review-stop-d1-report.md`

**Interfaces:**
- Produces: evidence for D1 completion and a D2 gate decision.

- [ ] **Step 1: Run a clean local Supabase reset**

```bash
HOME=/tmp/codex-supabase SUPABASE_TELEMETRY_DISABLED=true supabase db reset --local
```

Expected: every migration applies and local seed creates zero Course, Requirement, Assignment and Completion records.

- [ ] **Step 2: Run the full pgTAP suite**

```bash
HOME=/tmp/codex-supabase SUPABASE_TELEMETRY_DISABLED=true supabase test db
```

Expected: all existing and D1 tests PASS.

- [ ] **Step 3: Run database lint and review every D1 finding**

```bash
HOME=/tmp/codex-supabase SUPABASE_TELEMETRY_DISABLED=true supabase db lint --local --level warning
```

Fix D1 warnings. Record inherited warnings separately and do not conceal them with unsafe dynamic function rewriting.

- [ ] **Step 4: Run application tests, build and rendered HTML gate**

```bash
npm test
```

Expected: all application tests, Vinext Production build and rendered login check PASS.

- [ ] **Step 5: Run browser verification locally or on a protected Preview**

Verify manager and department routes at desktop, tablet and mobile sizes. Check navigation, return paths, save states, lifecycle confirmation, rule conflicts, tri-state evaluation, keyboard focus, touch targets, normal-zoom readability, horizontal overflow, console errors and failed network requests. Use synthetic local-review data only and remove browser/authentication artifacts afterward.

- [ ] **Step 6: Verify the database boundary**

Run read-only local counts proving zero Assignment, Session, Attendance, Completion, Feedback, KPI, Forecast, Risk and Intervention relations/rows were created. Verify evaluation leaves employee facts and dependency tables unchanged.

- [ ] **Step 7: Write the Review Stop D1 report**

Record:

- completed scope;
- final domain-model judgment;
- migration and RLS impact;
- manager and department authorization evidence;
- lifecycle and immutable-version evidence;
- eligibility state evidence;
- replaced assumptions;
- screenshots and browser checks if a Preview is created;
- test/build results;
- migration status and explicit Production-untouched confirmation;
- branch and commit;
- `Go`, `Conditional Go` or `No Go` for D2.

- [ ] **Step 8: Commit the verified Review Stop**

```bash
git add .
git commit -m "test: complete Recovery D1 review stop"
```

Do not start D2 after this commit.

---

## Plan self-review

- Every design requirement maps to Tasks 1–9.
- Requirement-to-single-Course binding is absent from every contract and RPC.
- Suspension is explicitly rejected for D1.
- All persistence tasks use test-first steps and authoritative re-read.
- Manager and department authorization are independently tested.
- Eligibility remains tri-state, point-in-time and non-persistent.
- No task creates an operational or employee-obligation fact.
- Production migration, real employee import, Production deploy and D2 are explicitly excluded.
