# Recovery D3 Trusted Attendance Facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a trustworthy, independent Attendance Fact layer that answers whether a snapshotted employee participated in one immutable training delivery without creating Completion, KPI, Health, Forecast, Risk, intervention, or AI facts.

**Architecture:** Extend the approved D2 aggregate with one Attendance Register per immutable published Session Revision. Store public or manual observations, evidence, determinations, control events, and token attempts as explicit append-only facts; keep the register row as an optimistic-concurrency projection. Every employee-bearing fact references the D2 Participant Snapshot and matching D0 Employee Fact Version.

**Tech Stack:** PostgreSQL/Supabase migrations and pgTAP, Next.js/Vinext, React 19, TypeScript, `@supabase/supabase-js`, Node test runner, QR SVG generation through a pinned package.

## Global Constraints

- Attendance answers only whether an employee participated in a training delivery; it is not HR attendance, working time, shift, payroll, or performance evidence.
- Determinations are exactly `present`, `absent`, `excused_absence`, or `unable_to_determine`.
- QR Observation is not an Attendance Determination and never creates `present`.
- D3 supports QR self-check-in and Manual Witness only.
- Supplemental Participant Snapshots require a reason, authorizer, Requirement Eligibility impact, and follow-up flag.
- A register may close with participants that have no determination, but it may not close with an unreviewed observation, unresolved conflict, or broken determination evidence chain.
- Attendance never creates Completion Evidence or Requirement fulfillment.
- Manager and department workflows must remain practical at desktop, tablet, and mobile sizes.
- No Production migration, Production data, real training data, deployment, DNS, or environment-variable change.

---

### Task 1: Attendance domain contract and deterministic validation

**Files:**
- Create: `app/repositories/contracts/attendance-repository.ts`
- Create: `app/services/attendance-service.ts`
- Create: `tests/recovery-d3-domain.test.mjs`

**Interfaces:**
- Produces: `AttendanceDetermination`, `AttendanceRegisterState`, `AttendanceObservation`, `AttendanceParticipant`, `AttendanceWorkspace`, `AttendanceRepository`.
- Produces: `validateAttendanceDeterminationDraft`, `validateSupplementalParticipantDraft`, `canCloseAttendanceRegister`.

- [ ] **Step 1: Write failing domain tests**

Cover these observable behaviors:

```ts
validateAttendanceDeterminationDraft({
  determination: "present",
  reason: "现场确认",
});
// []

validateAttendanceDeterminationDraft({
  determination: "present",
  reason: "现场确认",
  attendanceScore: 90,
});
// includes "D3 不接受出勤评分、迟到分钟、完成或分析字段。"

canCloseAttendanceRegister({
  unresolvedObservationCount: 0,
  brokenEvidenceCount: 0,
  participantWithoutDeterminationCount: 4,
});
// { allowed: true, blockers: [] }
```

The production mutations caught are: adding a fifth status, accepting analysis fields, equating QR with a determination, and blocking closure only because a participant lacks a determination.

- [ ] **Step 2: Run the domain test and observe the missing-module failure**

Run:

```bash
node --experimental-strip-types --test tests/recovery-d3-domain.test.mjs
```

Expected: FAIL because the D3 contract and service do not exist.

- [ ] **Step 3: Implement the minimal contract and deterministic validators**

Keep explicit unions and reject `lateMinutes`, `attendanceScore`, `attendanceRate`, `reliabilityRating`, `completion`, `kpi`, `forecast`, `health`, `risk`, and `ai`.

- [ ] **Step 4: Run the focused test to green**

Run the command from Step 2 and require zero failures.

### Task 2: Database fact model, RPC boundary, and pgTAP

**Files:**
- Create: `supabase/tests/recovery_d3_attendance_facts_test.sql`
- Create via `supabase migration new recovery_d3_attendance_facts`: the generated `supabase/migrations/*_recovery_d3_attendance_facts.sql`
- Modify: the generated migration only

**Interfaces:**
- Produces authenticated RPCs:
  - `read_attendance_workspace(uuid)`
  - `read_department_attendance_workspace()`
  - `open_attendance_register(uuid,bigint)`
  - `issue_attendance_checkin_grant(uuid,bigint)`
  - `record_attendance_determination(uuid,uuid,text,text,uuid[],bigint)`
  - `add_supplemental_participant_snapshot(uuid,uuid,text,boolean,boolean,bigint)`
  - `begin_attendance_reconciliation(uuid,bigint)`
  - `close_attendance_register(uuid,bigint,text)`
  - `reopen_attendance_register(uuid,bigint,text)`
- Produces public RPC: `submit_attendance_checkin(text,text,text,text)`.

- [ ] **Step 1: Write the failing pgTAP contract**

The test must assert:

- all D3 relations and RPC signatures exist;
- every D3 relation enables and forces RLS;
- `anon` and `authenticated` have no direct table DML;
- only the submission RPC is executable by `anon`;
- a register opens only for the current published, uncancelled Session Revision;
- opening locks the delivery Revision against replacement publication;
- a QR grant stores only a token hash and is bound to the register window;
- a valid QR submission writes one Observation and zero Determinations;
- duplicate idempotent submission writes no duplicate Observation;
- failed exact identity matching returns a generic result and stores no plaintext identity;
- manual witness writes Observation, Evidence, Determination, and Employee Fact dependencies atomically;
- the four determinations are accepted and a fifth is rejected;
- closure allows participants without determinations;
- closure rejects an Observation without a linked Determination;
- corrections append and do not overwrite;
- Supplemental Participant Snapshot captures all four required governance fields;
- department role cannot cross current authorized scope;
- no Completion, KPI, Health, Forecast, Risk, intervention, or AI relation is created.

- [ ] **Step 2: Run pgTAP against the D2 schema and observe missing D3 objects**

Run the repository pgTAP command used by the existing local Supabase workflow, targeting `recovery_d3_attendance_facts_test.sql`.

Expected: FAIL on missing D3 tables/functions, not fixture syntax.

- [ ] **Step 3: Generate the migration with the Supabase CLI**

```bash
HOME=/tmp/supabase-d3 supabase migration new recovery_d3_attendance_facts
```

- [ ] **Step 4: Implement explicit D3 relations and guarded RPCs**

Create:

- `attendance_registers`
- `attendance_register_events`
- `attendance_evidence`
- `attendance_observations`
- `attendance_determinations`
- `attendance_determination_observations`
- `attendance_checkin_grants`
- `attendance_checkin_attempts`

Extend `session_participant_snapshots` with explicit publication/supplemental origin and supplemental governance fields. Use append-only guards for evidence tables, revoke default access, force RLS, validate tenant/property lineage on every foreign-key path, and use empty `search_path` on all privileged functions.

- [ ] **Step 5: Reset the disposable local database and run focused pgTAP**

Require the migration to replay from a clean reset and the focused D3 test to pass.

- [ ] **Step 6: Run all pgTAP tests**

Require zero regressions across every existing SQL test file.

### Task 3: Supabase repository and truthful data-source registry

**Files:**
- Create: `app/repositories/supabase/attendance-repository.ts`
- Create: `tests/recovery-d3-repository.test.mjs`
- Modify: `app/repositories/registry.ts`
- Modify: `tests/repository-registry.test.mjs`

**Interfaces:**
- Consumes: D3 RPCs from Task 2.
- Produces: `createSupabaseAttendanceRepository(client)`.
- Adds registry key: `attendance`.
- Adds module source: `attendance` is `supabase` outside mock mode and `unavailable` in mock mode.

- [ ] **Step 1: Write failing repository tests**

Assert literal RPC names and parameters, especially:

```ts
await repository.readDepartmentWorkspace();
// read_department_attendance_workspace with {}

await repository.submitPublicCheckIn({
  token: "opaque",
  employeeNumber: "0007",
  employeeName: "员工甲",
  idempotencyKey: "attempt-1",
});
// submit_attendance_checkin with no property, role, scope, or employee UUID
```

Also assert conflict errors use the shared `ConflictError` contract and no D3 mock repository is selected.

- [ ] **Step 2: Run and observe missing repository failures**

```bash
node --experimental-strip-types --test tests/recovery-d3-repository.test.mjs tests/repository-registry.test.mjs
```

- [ ] **Step 3: Implement the minimal repository and registry wiring**

Normalize database snake-case states to the contract without inventing metrics, completion, or feedback.

- [ ] **Step 4: Run focused repository tests to green**

Require zero failures.

### Task 4: Manager attendance workflow

**Files:**
- Create: `app/components/training/AttendanceWorkspace.tsx`
- Create: `tests/recovery-d3-manager-ui.test.mjs`
- Modify: `app/attendance-feedback/page.tsx`
- Modify: `app/services/role-navigation.ts`
- Modify: `app/styles/recovery-a.css`

**Interfaces:**
- Consumes: `registry.attendance` and the manager D3 repository methods.
- Produces: manager flow `select session → open → observe/determine → reconcile → close`.

- [ ] **Step 1: Write failing manager UI tests**

Assert:

- attendance is marked `foundation`, while feedback remains unavailable;
- the manager page calls real repository methods;
- the page displays current state, immutable Session Revision, participant snapshot lineage, QR observation versus determination copy, and closure counts;
- the four lightweight determinations are present and no score/rate/late-minute UI exists;
- all actions have visible working states and return paths;
- responsive CSS provides 44 px touch targets, visible focus, and no fixed-width roster overflow.

- [ ] **Step 2: Run and observe the existing unavailable page failure**

```bash
node --experimental-strip-types --test tests/recovery-d3-manager-ui.test.mjs
```

- [ ] **Step 3: Implement the smallest complete manager workspace**

Use a calm command surface: session selector, register judgment, compact counts, participant cards/table, exception review, token panel, and explicit close confirmation. Keep Feedback as a separate truthful unavailable notice.

- [ ] **Step 4: Run the focused manager tests to green**

Require zero failures.

### Task 5: Department-scoped attendance workflow

**Files:**
- Create: `app/components/training/DepartmentAttendanceWorkspace.tsx`
- Create: `tests/recovery-d3-department-ui.test.mjs`
- Modify: `app/department/attendance-feedback/page.tsx`

**Interfaces:**
- Consumes: `readDepartmentWorkspace()` with no property or scope parameter.
- Produces: a scope-breadcrumb-first attendance surface restricted to server-returned rows.

- [ ] **Step 1: Write failing department UI tests**

Assert the page:

- always shows active scope and breadcrumb;
- never accepts browser-selected property or expanded department scope;
- never exposes hotel settings, accounts, imports, other-department identities, or hotel-wide closure;
- permits full register closure only when the server projection says `canCloseRegister`;
- keeps Feedback unavailable.

- [ ] **Step 2: Run and observe the existing unavailable page failure**

```bash
node --experimental-strip-types --test tests/recovery-d3-department-ui.test.mjs
```

- [ ] **Step 3: Implement the scoped workspace**

Reuse the participant action language and responsive visual system from Task 4 without duplicating authorization logic in the browser.

- [ ] **Step 4: Run focused department tests to green**

Require zero failures.

### Task 6: Constrained public QR check-in

**Files:**
- Create: `app/api/attendance/check-in/route.ts`
- Create: `app/check-in/[token]/page.tsx`
- Create: `app/components/training/PublicAttendanceCheckIn.tsx`
- Create: `tests/recovery-d3-qr-route.test.mjs`
- Modify: `app/lib/supabase/server-admin.ts`
- Modify: `app/styles/recovery-a.css`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `createServerPublicClient()` using only URL and publishable key.
- Produces: `createAttendanceCheckInHandler()` accepting token, employee number, employee name, and idempotency key.
- Produces: public page with no authenticated application shell.

- [ ] **Step 1: Write failing route and public-page tests**

Assert:

- malformed requests are rejected before Supabase calls;
- the handler passes no property, role, scope, employee UUID, secret key, or service-role key;
- database failures return generic business messages;
- successful submission says only that a签到 Observation was received and awaits attendance determination;
- the page provides no employee search, backend navigation, completion claim, or attendance result;
- mobile fields and button meet the 44 px touch target.

- [ ] **Step 2: Run and observe missing route/page failures**

```bash
node --experimental-strip-types --test tests/recovery-d3-qr-route.test.mjs
```

- [ ] **Step 3: Add the pinned QR dependency and implement the public boundary**

Generate QR SVG only for the manager-issued opaque link. Do not add camera, GPS, image, face, biometric, or complex anti-cheat behavior.

- [ ] **Step 4: Run the focused public-flow tests to green**

Require zero failures.

### Task 7: Review Stop D3 verification and report

**Files:**
- Create: `docs/recovery-d3/review-stop-d3-report.md`
- Modify: `package.json` to include all D3 application tests in the full test command.

**Interfaces:**
- Produces: complete Review Stop D3 evidence.

- [ ] **Step 1: Run focused D3 tests**

Run D3 domain, repository, manager, department, QR, and pgTAP tests.

- [ ] **Step 2: Run clean local database verification**

Run a clean Supabase reset, every pgTAP file, and database lint/advisors. Record exact assertion counts and inherited findings separately.

- [ ] **Step 3: Run the full application verification**

Run:

```bash
npm test
npm run lint
```

Require application tests, Production build, and rendered HTML test to pass.

- [ ] **Step 4: Perform browser verification**

Using disposable local synthetic data only, verify:

- manager flow from published Session to closed register;
- manual registration can be completed in under three minutes;
- QR self-check-in creates Observation but no Determination;
- department scope and direct-route authorization;
- close with an unrecorded participant;
- close rejection with an unreconciled QR Observation;
- desktop, tablet, and mobile readability, focus, touch targets, overflow, console, and failed requests.

Remove synthetic credentials, tokens, browser sessions, and temporary servers afterwards.

- [ ] **Step 5: Write the Review Stop D3 report**

Record implementation, migration, authorization, tests, acceptance checklist, remaining risks, branch/commit, and explicit confirmation that Production and D4 remain untouched.

- [ ] **Step 6: Commit the verified implementation**

Commit only after fresh verification evidence exists.
