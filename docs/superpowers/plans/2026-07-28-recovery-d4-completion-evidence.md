# Recovery D4 Completion Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an immutable, authorized Completion Evidence and Completion
Record layer without creating assignments, analytics, feedback, or D5 facts.

**Architecture:** Controlled RPCs write append-only common evidence plus one
source-specific detail, followed by a separate authorized review that may
create an immutable Completion Record. Manager and Department workspaces read
separate server-authorized projections and share one Chinese-first UI.

**Tech Stack:** PostgreSQL 15, Supabase RLS/RPC, pgTAP, TypeScript, React,
vinext, Node test runner, Playwright browser verification.

## Global Constraints

- Production Supabase, Production deployment, DNS, environment variables, and
  real hotel data remain untouched.
- D0 Employee Fact Version, D1 Requirement Version and Accepted Learning
  Method, D2 Session Revision and Participant Snapshot, and D3 Attendance
  facts remain immutable.
- Completion never equals Attendance and never creates Assignment, reminder,
  Feedback, KPI, Health, Forecast, Risk, AI, or HR performance facts.
- Only Hotel L&D Manager and Department Training Responsible Person are
  authenticated application roles.
- Department access is constrained by the event-time Employee Fact Version
  department and existing descendant rules.
- Every implementation behavior follows RED → GREEN → REFACTOR.

---

### Task 1: Lock D4 domain behavior in failing tests

**Files:**
- Create: `tests/recovery-d4-domain.test.mjs`
- Create: `tests/recovery-d4-repository.test.mjs`
- Create: `tests/recovery-d4-ui.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: test contracts for `validateCompletionEvidenceDraft`,
  `createSupabaseCompletionRepository`, role-aware routes, real-only module
  classification, and the Completion workspace.

- [ ] Write domain tests that reject forbidden Assignment/analytics fields,
  keep Attendance separate, validate external and recognition details, and
  prevent `unable_to_determine` from becoming Completion.
- [ ] Write repository tests for the two read projections and six controlled
  D4 mutation calls.
- [ ] Write UI tests for `/completions`, `/department/completions`, role
  routing, source-specific forms, explicit review, revocation, scope copy,
  mobile touch targets, and truthful unavailable Assessment copy.
- [ ] Add the three D4 files to `npm test`.
- [ ] Run the three tests and verify failure because D4 production modules and
  routes do not exist.

Run:

```bash
node --experimental-strip-types --test \
  tests/recovery-d4-domain.test.mjs \
  tests/recovery-d4-repository.test.mjs \
  tests/recovery-d4-ui.test.mjs
```

Expected: FAIL on missing D4 modules and routes.

### Task 2: Build the database fact and authorization boundary

**Files:**
- Create with CLI: `supabase/migrations/20260728145050_recovery_d4_completion_evidence.sql`
- Create: `supabase/tests/recovery_d4_completion_evidence_test.sql`

**Interfaces:**
- Consumes: D0 authorization and employee facts; D1 requirement methods; D2
  sessions and participant snapshots; D3 Attendance determinations.
- Produces: the eight D4 append-only tables and seven controlled RPCs named in
  the design specification.

- [x] Run `supabase migration new recovery_d4_completion_evidence`; the CLI
  created `20260728145050_recovery_d4_completion_evidence.sql`.
- [ ] Write pgTAP structure and security tests first: RLS, no direct table
  access, authenticated-only RPC execution, foreign-key indexes, immutable
  facts, and absence of later-scope tables.
- [ ] Run the D4 pgTAP file and verify failure because the migration is empty.
- [ ] Implement base evidence, source detail, review, Completion Record,
  revocation, and audit tables with composite property lineage.
- [ ] Implement append-only guards, source-lineage validation, event-time
  Employee Fact Version resolution, audit insertion, and dependency ledger
  insertion.
- [ ] Implement separate Manager and Department read documents.
- [ ] Implement Attendance, external, and Manager Recognition evidence RPCs.
- [ ] Implement explicit accept/reject review and reasoned revocation RPCs.
- [ ] Add pgTAP behavior tests for each source, non-Present/Unable rejection,
  immutable history after employee transfer, cross-property/cross-department
  denial, Manager Recognition Manager-only access, duplicate review, stale
  conflict, revocation, and audit preservation.
- [ ] Run focused D4 pgTAP until green.

Run:

```bash
HOME=/tmp/supabase-d4 SUPABASE_TELEMETRY_DISABLED=true \
  supabase db reset --local
HOME=/tmp/supabase-d4 SUPABASE_TELEMETRY_DISABLED=true \
  supabase test db --local \
  supabase/tests/recovery_d4_completion_evidence_test.sql
```

Expected: all focused D4 assertions pass.

### Task 3: Implement the typed service and repository boundary

**Files:**
- Create: `app/repositories/contracts/completion-repository.ts`
- Create: `app/repositories/supabase/completion-repository.ts`
- Create: `app/services/completion-service.ts`
- Modify: `app/repositories/registry.ts`
- Modify: `tests/recovery-d4-domain.test.mjs`
- Modify: `tests/recovery-d4-repository.test.mjs`
- Modify: `tests/repository-registry.test.mjs`

**Interfaces:**
- Produces: `CompletionRepository`, `CompletionWorkspace`,
  `validateExternalCompletionDraft`,
  `validateManagerRecognitionDraft`, and real-only D4 registry wiring.

- [ ] Verify domain and repository tests are red against the desired typed
  interfaces.
- [ ] Implement strict source-specific TypeScript unions and boundary types.
- [ ] Implement validation that rejects cross-source fields and all forbidden
  later facts.
- [ ] Implement Supabase RPC mapping with business-conflict classification.
- [ ] Register `completion` as Supabase-only in hybrid/real mode and
  unavailable in mock mode.
- [ ] Run D4 domain, repository, and registry tests until green.

### Task 4: Implement role-aware Completion workspaces

**Files:**
- Create: `app/components/completion/CompletionWorkspace.tsx`
- Create: `app/completions/page.tsx`
- Create: `app/department/completions/page.tsx`
- Create: `app/recovery-d4.css`
- Modify: `app/globals.css`
- Modify: `app/services/role-navigation.ts`
- Modify: `app/services/auth-routing.ts`
- Modify: `app/components/attendance/AttendanceWorkspace.tsx`
- Modify: `tests/recovery-a-routing.test.mjs`
- Modify: `tests/recovery-a-navigation.test.mjs`
- Modify: `tests/recovery-d3-ui.test.mjs`
- Modify: `tests/recovery-d4-ui.test.mjs`

**Interfaces:**
- Consumes: `CompletionRepository` and the authenticated session property or
  server-derived Department scope.
- Produces: Manager `/completions` and Department
  `/department/completions`.

- [ ] Verify route, navigation, and D4 UI tests are red before page code.
- [ ] Add direct-route authorization for the two role-specific paths.
- [ ] Add frequency navigation entries without exposing cross-role routes.
- [ ] Implement a shared workspace with truthful conclusion, scope,
  evidence/record lists, three source flows, explicit accept/reject review,
  reasoned revocation, conflict reload, empty/error states, and real actions.
- [ ] Link D3 Attendance to D4 Completion without changing D3 facts or
  implying automatic completion.
- [ ] Add responsive CSS with visible focus, 44px actions, one-column mobile
  flow, and no page-level horizontal overflow.
- [ ] Run D4 UI and Recovery A/D3 regression tests until green.

### Task 5: Verify the complete local database and application

**Files:**
- Modify only if a failing test proves a D4 defect.

**Interfaces:**
- Produces: fresh Review Stop D4 test evidence.

- [ ] Run a clean local Supabase reset and confirm every migration replays.
- [ ] Run focused D4 pgTAP and record file/assertion counts.
- [ ] Run the complete pgTAP suite and record file/assertion counts.
- [ ] Run `npm test` and record application, rendered-page, and build results.
- [ ] Run `npm run lint` and distinguish pre-existing warnings from D4 errors.
- [ ] Run `git diff --check`.

### Task 6: Browser verification and Review Stop D4

**Files:**
- Save privacy-safe screenshots outside the repository under the current
  Codex visualization directory.
- Modify code only after a failing regression test reproduces a genuine
  browser defect.

**Interfaces:**
- Produces: desktop/mobile Manager and Department evidence for Review Stop D4.

- [ ] Seed disposable local-only Manager, Department, requirement methods,
  employees, one Present Attendance determination, and one Unable
  determination.
- [ ] Verify Manager Attendance evidence recording, explicit acceptance,
  Completion Record creation, and reasoned revocation.
- [ ] Verify external evidence recording and rejection/acceptance behavior.
- [ ] Verify Manager Recognition is Manager-only.
- [ ] Verify Department sees and mutates only event-time authorized scope;
  direct Manager route and cross-scope facts are denied.
- [ ] Verify Unable/Absent Attendance cannot create Completion Evidence.
- [ ] Verify desktop 1440px and mobile 390px: console, failed requests,
  horizontal overflow, keyboard focus, and minimum 44px touch targets.
- [ ] Remove disposable fixtures, sessions, local credentials, and browser
  tabs; stop local Supabase with no backup.
- [ ] Run final status and test evidence, commit the branch, and stop at Review
  Stop D4 without starting D5.
