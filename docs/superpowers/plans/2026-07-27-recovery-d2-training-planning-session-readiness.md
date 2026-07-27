# Recovery D2 Training Planning and Session Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic, property-isolated Training Plan, immutable
Session Revision, resource-readiness, participant-snapshot and
attendance-preparation foundation without creating attendance or completion
facts.

**Architecture:** Extend the accepted D0/D1 foundations through versioned
Training Plan and Training Session aggregates. Drafts remain editable with
optimistic concurrency; approved plans and published session revisions are
immutable. Session publication validates live authorization and resources,
then atomically records exact D1 version references and Employee Fact Version
participant evidence.

**Tech Stack:** PostgreSQL 17 and pgTAP through local Supabase, TypeScript,
React 19, Next.js-compatible App Router through Vinext, repository/service
boundaries, Node test runner, CSS.

## Global Constraints

- Requirement Version remains the obligation source.
- Course Version remains a learning-method reference.
- Employee Fact Version remains the historical employee context.
- No persisted operational fact may depend only on mutable current employee,
  department, requirement, course, owner, trainer or venue state.
- Eligibility Evaluation remains `eligible`, `not_applicable` or
  `unable_to_determine`.
- Approved Plan Versions and Published Session Revisions are immutable.
- There is no generic rule engine.
- Do not create attendance, QR/token, completion, feedback, KPI, health,
  forecast, risk, intervention or AI facts.
- All manager and department authorization is reasserted server-side using
  active account, membership, role and department scope.
- Production Supabase, Production deployment, DNS, environment variables and
  real hotel data remain untouched.

---

### Task 1: D2 contracts and deterministic validation

**Files:**
- Create: `tests/recovery-d2-domain.test.mjs`
- Create: `app/repositories/contracts/training-operations-repository.ts`
- Create: `app/services/training-operations-service.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: D1 `RequirementVersion`, `CourseVersion`, accepted-learning-method
  and eligibility concepts.
- Produces:
  `TrainingPlanVersionDraft`, `TrainingSessionRevisionDraft`,
  `TrainingOperationsFoundation`, `ParticipantSnapshot`,
  `validateTrainingPlanVersionDraft(...)`,
  `validateTrainingSessionRevisionDraft(...)`, and
  `readinessForSessionDraft(...)`.

- [ ] **Step 1: Write failing domain tests**

```js
test("a requirement-delivery plan item requires exact immutable D1 references", () => {
  const errors = validateTrainingPlanVersionDraft(
    requirementPlan({ requirementVersionId: "", acceptedLearningMethodId: "" }),
  );
  assert.deepEqual(errors, [
    "培训要求交付必须引用确切培训要求版本和认可课程方式。",
  ]);
});

test("attendance and completion fields are rejected at the D2 contract boundary", () => {
  assert.throws(
    () => validateTrainingSessionRevisionDraft(sessionDraft({ attendance: [] })),
    /D2 不接受出勤或完成事实/,
  );
});
```

- [ ] **Step 2: Run the domain tests and confirm RED**

Run:

```bash
node --experimental-strip-types --test tests/recovery-d2-domain.test.mjs
```

Expected: failure because the D2 contract and validators do not exist.

- [ ] **Step 3: Implement the minimal contracts and validators**

Define discriminated unions for:

```ts
type PlanItemPurpose = "requirement_delivery" | "development_delivery";
type TrainingPlanVersionState =
  | "draft"
  | "review"
  | "approved"
  | "superseded"
  | "withdrawn";
type SessionRevisionState = "draft" | "published" | "superseded";
type SessionCurrentState = "draft" | "published" | "cancelled";
type SessionReadinessState =
  | "incomplete"
  | "conflict"
  | "ready_to_publish"
  | "needs_review"
  | "unable_to_determine";
```

Reject `mandatory`, attendance, completion, feedback, KPI, risk and forecast
fields at the service boundary. Validate period order, exact D1 references,
positive capacity, authorized owner/resource inputs, hotel time zone and
requirement/development vocabulary.

- [ ] **Step 4: Run the domain tests and confirm GREEN**

Run:

```bash
node --experimental-strip-types --test tests/recovery-d2-domain.test.mjs
```

Expected: all D2 domain tests pass.

- [ ] **Step 5: Commit the contracts**

```bash
git add package.json tests/recovery-d2-domain.test.mjs \
  app/repositories/contracts/training-operations-repository.ts \
  app/services/training-operations-service.ts
git commit -m "feat: define Recovery D2 operational contracts"
```

### Task 2: Additive D2 database foundation and pgTAP proof

**Files:**
- Create: `supabase/tests/recovery_d2_training_operations_foundation_test.sql`
- Create through Supabase CLI:
  `supabase/migrations/<timestamp>_recovery_d2_training_operations_foundation.sql`

**Interfaces:**
- Consumes:
  `employee_fact_versions`, `employee_fact_dependencies`,
  `training_requirement_versions`, `accepted_learning_methods`,
  `course_versions`, unified D0 authorization helpers and department closure.
- Produces manager and department RPC boundaries for plan/session reads,
  draft saves, lifecycle transitions, publication snapshots and cancellation.

- [ ] **Step 1: Write failing pgTAP tests**

The tests must prove behavior, including:

```sql
select throws_ok(
  $$ update public.training_session_revisions
     set starts_at = starts_at + interval '1 hour'
     where lifecycle_state = 'published' $$,
  'Published session revisions are immutable',
  'published session schedule cannot be rewritten'
);

select is(
  (
    select count(*)
    from public.employee_fact_dependencies
    where fact_type = 'session_participant_snapshot'
  ),
  2::bigint,
  'publishing records exact employee fact dependencies'
);
```

Also prove:

- every D2 public table enables and forces RLS;
- browser roles receive no direct mutation grants;
- manager mutation requires live manager authority;
- department mutation derives scope server-side;
- any out-of-scope department or employee rejects the entire transaction;
- plan approval and session publication are immutable and audited;
- plan approval creates no session;
- session publication creates no attendance or completion relation;
- tri-state candidate evidence survives publication;
- development participants are selected, never called eligible;
- trainer and venue overlaps block publication;
- cancellation is append-only and does not erase the published revision.

- [ ] **Step 2: Run the D2 pgTAP test and confirm RED**

Run:

```bash
supabase test db supabase/tests/recovery_d2_training_operations_foundation_test.sql
```

Expected: failure because D2 relations and functions do not exist.

- [ ] **Step 3: Create the migration through the CLI**

Run:

```bash
supabase migration new recovery_d2_training_operations_foundation
```

The migration must add only:

- Training Plan identities, versions and immutable plan items;
- Training Session identities and immutable revisions;
- owner assignment snapshots;
- trainer profiles and effective Course Version delivery approvals;
- venues and session resource confirmations;
- candidate and selected-participant publication snapshots;
- attendance-preparation configuration without an attendance run;
- append-only lifecycle and audit evidence;
- indexes, constraints, triggers, forced RLS and narrowly granted RPCs.

All security-definer functions use `set search_path = ''`, revoke default
`PUBLIC` execute and reassert `auth.uid()` through D0 helpers.

- [ ] **Step 4: Reset the local database and make D2 pgTAP GREEN**

Run:

```bash
HOME=/tmp/codex-supabase SUPABASE_TELEMETRY_DISABLED=true \
  supabase db reset --local
supabase test db supabase/tests/recovery_d2_training_operations_foundation_test.sql
```

Expected: migration replay succeeds and every D2 assertion passes.

- [ ] **Step 5: Run database lint and full pgTAP**

Run:

```bash
supabase db lint --local --level warning
supabase test db
```

Expected: no D2 warning and all existing plus D2 tests pass.

- [ ] **Step 6: Commit the database foundation**

```bash
git add supabase/migrations \
  supabase/tests/recovery_d2_training_operations_foundation_test.sql
git commit -m "feat: add Recovery D2 database foundation"
```

### Task 3: Repository and authoritative-save boundary

**Files:**
- Create: `tests/recovery-d2-repository.test.mjs`
- Create: `app/repositories/mock/training-operations-repository.ts`
- Create: `app/repositories/supabase/training-operations-repository.ts`
- Modify: `app/repositories/registry.ts`
- Modify: `app/repositories/contracts/training-operations-repository.ts`

**Interfaces:**
- Consumes the Task 2 RPC documents.
- Produces:
  `readManagerTrainingOperations(propertyId)`,
  `readDepartmentTrainingOperations()`,
  `savePlanVersionDraft(...)`,
  `transitionPlanVersion(...)`,
  `saveSessionRevisionDraft(...)`,
  `publishSessionRevision(...)`,
  `cancelSession(...)`,
  `saveTrainerProfile(...)`,
  `saveVenue(...)`, and
  `previewSessionParticipants(...)`.

- [ ] **Step 1: Write failing repository tests**

```js
test("department reads and writes accept no browser-selected property or scope", () => {
  assert.equal(repository.readDepartmentTrainingOperations.length, 0);
});

test("Production cannot select the D2 local-review repository", () => {
  assert.throws(
    () => createRepositoryRegistry(productionRequestingMock),
    /Production.*local-review/,
  );
});
```

Repository tests also assert conflict mapping, authoritative re-read after save,
aggregate participant evidence and no direct component query path.

- [ ] **Step 2: Run repository tests and confirm RED**

Run:

```bash
node --experimental-strip-types --test tests/recovery-d2-repository.test.mjs
```

Expected: missing D2 repository registration and methods.

- [ ] **Step 3: Implement real and labelled local-review repositories**

The Supabase repository uses only RPC calls and maps database concurrency to the
shared conflict contract. The mock repository stores synthetic local-review D2
data only in local mock mode, labels the source and enforces the same
authorization and lifecycle semantics.

- [ ] **Step 4: Run repository tests and confirm GREEN**

Run:

```bash
node --experimental-strip-types --test tests/recovery-d2-repository.test.mjs
```

Expected: all repository tests pass.

- [ ] **Step 5: Commit repository boundaries**

```bash
git add tests/recovery-d2-repository.test.mjs app/repositories
git commit -m "feat: connect Recovery D2 repositories"
```

### Task 4: Manager Training Plan and Session workflows

**Files:**
- Create: `tests/recovery-d2-manager-ui.test.mjs`
- Create: `app/components/training-operations/TrainingPlanWorkspace.tsx`
- Create: `app/components/training-operations/TrainingPlanVersionEditor.tsx`
- Create: `app/components/training-operations/TrainingSessionWorkspace.tsx`
- Create: `app/components/training-operations/SessionRevisionEditor.tsx`
- Create: `app/components/training-operations/SessionReadinessPanel.tsx`
- Create: `app/components/training-operations/ParticipantSnapshotPanel.tsx`
- Create: `app/recovery-d2.css`
- Modify: `app/plans/page.tsx`
- Modify: `app/sessions/page.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/services/role-navigation.ts`

**Interfaces:**
- Consumes Task 3 repository and shared save-state/unsaved-change services.
- Produces truthful manager `/plans` and `/sessions` workflows.

- [ ] **Step 1: Write failing manager UI tests**

Tests assert:

- Plan leads with purpose, period and planned capacity, not completion;
- Requirement Delivery and Development Delivery are visibly different;
- no `mandatory`, KPI, risk, forecast, attendance or completion wording;
- Plan lifecycle and Session lifecycle expose only approved D2 transitions;
- Published data is immutable and has an explicit new-version path;
- readiness distinguishes system verification from owner attestation;
- participant panel says “适用员工候选”, never “待完成人员”;
- successful saves re-read authority and show shared save states;
- desktop, tablet and mobile CSS preserve readable hierarchy and touch targets.

- [ ] **Step 2: Run manager UI tests and confirm RED**

Run:

```bash
node --experimental-strip-types --test tests/recovery-d2-manager-ui.test.mjs
```

Expected: current pages still show the unavailable Recovery A boundary.

- [ ] **Step 3: Implement the manager workspaces**

Use focused client components below route-level page components. Every enabled
button must save, transition, open a usable editor, retry a real read or
navigate. Empty real databases show “尚未建立培训计划/场次”, while unavailable
sources show “尚未接入真实数据”.

- [ ] **Step 4: Run manager UI and existing navigation tests**

Run:

```bash
node --experimental-strip-types --test \
  tests/recovery-d2-manager-ui.test.mjs \
  tests/recovery-a-navigation.test.mjs \
  tests/recovery-a-routing.test.mjs
```

Expected: manager D2 and existing role navigation tests pass.

- [ ] **Step 5: Commit manager workflows**

```bash
git add tests/recovery-d2-manager-ui.test.mjs app
git commit -m "feat: add manager planning and session workspaces"
```

### Task 5: Department-scoped Session workflow

**Files:**
- Create: `tests/recovery-d2-department-ui.test.mjs`
- Create:
  `app/components/training-operations/DepartmentSessionWorkspace.tsx`
- Modify: `app/department/sessions/page.tsx`
- Modify: `app/department/calendar/page.tsx`
- Modify: `app/department/page.tsx`
- Modify: `app/services/role-navigation.ts`
- Modify: `app/recovery-d2.css`

**Interfaces:**
- Consumes server-derived department foundation from Task 3.
- Produces a scope-explicit department Session workspace and read-only calendar
  projection.

- [ ] **Step 1: Write failing department tests**

```js
test("department workflow never sends property or department scope to the repository", () => {
  assert.match(source, /readDepartmentTrainingOperations\\(\\)/);
  assert.doesNotMatch(source, /propertyId|selectedScope/);
});
```

Also assert:

- authorized scope and breadcrumb are always visible;
- only scoped Approved Plan Items and Sessions appear;
- a department user can create and manage only self-owned scoped sessions;
- trainer and venue foundation is selection-only;
- no plan approval, global resource management or unrelated employee data;
- direct `/plans` and manager `/sessions` remain denied;
- truthful empty, conflict, stale-snapshot and load-failure states.

- [ ] **Step 2: Run department tests and confirm RED**

Run:

```bash
node --experimental-strip-types --test tests/recovery-d2-department-ui.test.mjs
```

Expected: current department Session page remains unavailable.

- [ ] **Step 3: Implement the scoped workflow**

Reuse the shared Session editor in department mode. Hide manager-only controls
and rely on server authorization rather than UI filtering. Calendar remains a
read-only projection of active Published Session Revisions.

- [ ] **Step 4: Run department and authorization tests**

Run:

```bash
node --experimental-strip-types --test \
  tests/recovery-d2-department-ui.test.mjs \
  tests/recovery-a-department-home.test.mjs \
  tests/authentication-entry.test.mjs
```

Expected: D2 scope and the original two-role contract pass.

- [ ] **Step 5: Commit department workflow**

```bash
git add tests/recovery-d2-department-ui.test.mjs app
git commit -m "feat: add scoped department session workflow"
```

### Task 6: Review Stop D2 verification

**Files:**
- Create: `docs/recovery-d2/review-stop-d2-report.md`
- Modify only if a failing verification exposes a genuine D2 defect.

**Interfaces:**
- Consumes every prior task.
- Produces final Review Stop D2 evidence and a D3 gate recommendation.

- [ ] **Step 1: Run clean database verification**

```bash
HOME=/tmp/codex-supabase SUPABASE_TELEMETRY_DISABLED=true \
  supabase db reset --local
supabase test db
supabase db lint --local --level warning
```

- [ ] **Step 2: Run application verification**

```bash
npm test
npm run lint
git diff --check
```

- [ ] **Step 3: Verify browser behavior**

Use local synthetic manager and department sessions only. Verify:

- manager Plans and Sessions at 1440×900, 1024×768 and 390×844;
- department Session and Calendar scope;
- plan/session saves, validation, immutable states and conflict presentation;
- trainer/venue readiness and participant preview;
- direct-route authorization;
- keyboard focus, 44 px mobile targets, normal-zoom readability;
- no horizontal overflow, console errors or failed network requests.

Close the browser session and local server afterward.

- [ ] **Step 4: Write Review Stop D2 report**

Record:

- implementation and migration summaries;
- exact authorization and historical-reference evidence;
- database, pgTAP, application, build, lint and browser results;
- every D2 acceptance criterion;
- remaining risks and whether the next recovery may begin;
- explicit confirmation that Production and all excluded domains are untouched.

- [ ] **Step 5: Commit the review report**

```bash
git add docs/recovery-d2/review-stop-d2-report.md
git commit -m "test: complete Recovery D2 review stop"
```

Stop at Review Stop D2. Do not create a Production migration action, Preview
deployment, merge or later-phase operational fact.
