# Recovery C Trusted Employee Data and People Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a trusted, property-scoped employee workbook update workflow and authoritative People Center without connecting training operations.

**Architecture:** Extend the existing employee/import schema rather than replacing it. Workbooks are parsed on the server, staging and mapping remain property-scoped, deterministic database functions generate the preview and execute one atomic commit, and pages consume repositories/services rather than direct Supabase queries. Preview uses clearly labelled privacy-safe review data; real-workbook compatibility is proven locally with aggregate-only evidence.

**Tech Stack:** Next/Vinext, React 19, TypeScript, Supabase Postgres/Auth/Storage/RLS/RPC, SheetJS, Node test runner, pgTAP, Vercel Preview.

## Global Constraints

- Only Hotel L&D Managers and Department Training Responsible Persons authenticate.
- Imported employees never receive Auth users, `user_accounts`, memberships, role assignments, or backend workspaces.
- Do not import training history, CTC/GTC completion, courses, sessions, attendance, feedback, QR facts, KPI actuals, forecasts, health calculations, interventions, or AI recommendations.
- Do not silently guess missing identity, department, position, status, or termination.
- Do not deactivate an employee because the employee is absent from one workbook.
- Do not expose raw workbooks or import evidence to department roles.
- Do not query Supabase directly from page components.
- Do not apply migrations or data changes to Production.
- Do not deploy to Vercel Production, change DNS, merge automatically, or start Recovery D.

---

### Task 1: Lock privacy-safe parser and real-workbook evidence

**Files:**
- Modify: `app/services/import/workbook-parser.ts`
- Modify: `app/services/import/production-workbook-staging.ts`
- Create: `tests/recovery-c-workbook.test.mjs`
- Modify: `tests/workbook-parser.test.mjs`
- Create: `docs/recovery-c/real-workbook-inspection.md`
- Create: `supabase/tests/fixtures/README.md`

**Interfaces:**
- Consumes `WorkbookFile`.
- Produces `PreparedEmployeeMasterStaging` whose `rawValues` and `normalizedValues` contain approved employee-master fields only.
- Produces aggregate evidence with no names, employee numbers, source row values, or full checksum.

- [ ] **Step 1: Write a failing exclusion test**

```js
test("Recovery C staging never persists excluded workbook values", () => {
  const result = prepareEmployeeMasterStaging(syntheticWorkbookWithTrainingColumns());
  assert.equal(result.sourceRows[0].rawValues["CTC"], undefined);
  assert.equal(result.sourceRows[0].rawValues["GTC"], undefined);
  assert.equal(result.sourceRows[0].rawValues["Mini Orientation"], undefined);
  assert.equal(result.sourceRows[0].rawValues["Gender"], undefined);
  assert.equal(result.fieldMappings.some(item => item.sourceColumnName === "CTC"), false);
  assert.equal(result.safeSummary.trainingHistoryImported, false);
  assert.equal(result.safeSummary.ctcGtcImported, false);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --experimental-strip-types --test tests/recovery-c-workbook.test.mjs
```

Expected: FAIL because current staging copies every source column into `rawValues`.

- [ ] **Step 3: Limit staged evidence to approved fields**

Implement an explicit approved-source-column set derived from non-excluded mappings. Store only approved source fields in `rawValues`; keep excluded column names and reasons in the inspection summary. Preserve the full original workbook only in private Storage.

- [ ] **Step 4: Add edge-case tests**

Cover leading zeros, empty/whitespace department values, duplicate employee numbers, ambiguous dates, missing employee numbers, three-sheet exclusion, actual >25 MB rejection, and CSV MIME alignment.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
node --experimental-strip-types --test tests/recovery-c-workbook.test.mjs tests/workbook-parser.test.mjs tests/production-activation-wiring.test.mjs
```

Expected: all focused parser/staging tests pass.

- [ ] **Step 6: Record privacy-safe real-workbook evidence**

Write only aggregate facts, recognized/excluded field names, file size, and checksum prefix to `docs/recovery-c/real-workbook-inspection.md`. State explicitly that the workbook remains outside Git and that zero employee rows were written.

- [ ] **Step 7: Commit**

```bash
git add app/services/import/workbook-parser.ts app/services/import/production-workbook-staging.ts tests/recovery-c-workbook.test.mjs tests/workbook-parser.test.mjs docs/recovery-c/real-workbook-inspection.md supabase/tests/fixtures/README.md
git commit -m "test: lock Recovery C workbook privacy boundary"
```

### Task 2: Add deterministic import state, audit, and security

**Files:**
- Create via CLI: `supabase/migrations/*_recovery_c_employee_update_integrity.sql`
- Create: `supabase/tests/recovery_c_employee_update_test.sql`
- Modify: `supabase/tests/employee_import_test.sql`
- Modify: `supabase/tests/storage_security_test.sql`

**Interfaces:**
- Produces `import_source_label_resolutions` and `import_activity_events`.
- Produces RPCs:
  - `confirm_employee_import_field_mapping(uuid,bigint,jsonb)`
  - `resolve_employee_import_source_label(uuid,bigint,text,text,uuid,text)`
  - `resolve_employee_import_issue(uuid,bigint,uuid,text,jsonb)`
  - `prepare_employee_import_preview(uuid,bigint,jsonb)`
  - hardened `commit_employee_import(uuid,bigint)`
  - `preview_employee_import_revert(uuid)`
  - `revert_employee_import(uuid,text)`
  - `list_department_employee_directory(text,integer,integer)`

- [ ] **Step 1: Create the migration through the CLI**

Run:

```bash
npx --no-install supabase migration new recovery_c_employee_update_integrity
```

Expected: one timestamped migration file.

- [ ] **Step 2: Write failing pgTAP tests**

The new test must assert:

```sql
select has_table('public', 'import_source_label_resolutions');
select has_table('public', 'import_activity_events');
select function_privs_are(
  'public', 'prepare_employee_import_preview', array['uuid','bigint','jsonb'],
  'authenticated', array['EXECUTE']
);
select throws_ok(
  $$update public.import_commit_items set after_snapshot = '{}'$$,
  '42501', null, 'commit evidence is append-only'
);
```

Also cover manager account status, every allowed/forbidden batch transition, actor spoofing denial, cross-property mapping rejection, exact department scope, descendant scope, non-descendant denial, approved department fields only, full update-field coverage, identifier conflict, idempotent commit, stale preview, Storage overwrite/delete retention, and safe/unsafe reversal.

- [ ] **Step 3: Run clean reset and verify RED**

Run:

```bash
npx --no-install supabase db reset --local --yes
npx --no-install supabase test db --local supabase/tests/recovery_c_employee_update_test.sql
```

Expected: new assertions fail because the migration capabilities do not exist.

- [ ] **Step 4: Implement tables, constraints, indexes, and grants**

Requirements:

```sql
alter table public.import_source_label_resolutions enable row level security;
alter table public.import_source_label_resolutions force row level security;
alter table public.import_activity_events enable row level security;
alter table public.import_activity_events force row level security;

revoke insert, update, delete on public.import_commits, public.import_commit_items
  from authenticated;
revoke insert, update, delete on public.import_activity_events
  from authenticated;
```

Add indexes for batch/type/status, employee `source_batch_id`, external identifier `employee_id`, external identifier `source_batch_id`, and department-scope directory queries.

- [ ] **Step 5: Implement strict manager authorization**

Every privileged function must:

```sql
if auth.uid() is null then
  raise exception 'AUTH_REQUIRED' using errcode = '42501';
end if;
```

Then verify active property membership, exact `property_ld_manager` assignment, active/unlocked `user_accounts` status, property ownership, fixed empty search path, and no caller-supplied user identity.

- [ ] **Step 6: Implement deterministic preview**

`prepare_employee_import_preview` must:

- lock the batch;
- verify expected version;
- apply confirmed source-label decisions;
- preserve employee numbers as text;
- match by property + employee number only;
- detect external-identifier conflicts;
- classify insert/update/unchanged/excluded/unresolved;
- calculate new-employee state from hire date and property rule;
- require explicit batch status treatment when no status field exists;
- update staging rows and batch counts only;
- append an activity event;
- write no `employees` or `employee_external_identifiers`.

- [ ] **Step 7: Harden commit and reversal**

Commit must lock affected employees/identifiers, rerun validation, update every approved employee field, preserve absent employees, append before/after evidence, and be idempotent.

Reversal must use a short-lived preview token, recheck locked employee/identifier versions, deactivate inserts rather than delete, restore updates, and refuse conflicts.

- [ ] **Step 8: Add the department employee directory RPC**

Return approved fields only and derive all branches from the authenticated account’s active department scopes plus closure rows. Do not accept a browser-supplied department scope.

- [ ] **Step 9: Run all pgTAP tests and verify GREEN**

Run:

```bash
npx --no-install supabase db reset --local --yes
npx --no-install supabase test db --local supabase/tests
```

Expected: all existing and Recovery C pgTAP tests pass.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations supabase/tests
git commit -m "feat: secure Recovery C employee update transactions"
```

### Task 3: Complete repositories and application services

**Files:**
- Modify: `app/repositories/contracts/import-repository.ts`
- Modify: `app/repositories/contracts/employee-repository.ts`
- Modify: `app/repositories/supabase/import-repository.ts`
- Modify: `app/repositories/supabase/employee-repository.ts`
- Modify: `app/repositories/mock/import-repository.ts`
- Modify: `app/repositories/mock/employee-repository.ts`
- Create: `app/services/import-service.ts`
- Create: `app/services/employee-service.ts`
- Create: `tests/recovery-c-import-service.test.mjs`
- Create: `tests/recovery-c-employee-service.test.mjs`

**Interfaces:**

```ts
export type EmployeeUpdatePreview = {
  additions: number;
  updates: number;
  unchanged: number;
  exclusions: number;
  blocked: number;
  unresolved: number;
  version: number;
  status: "mapping_required" | "ready_for_review";
};

export type EmployeeDirectoryPage = {
  rows: readonly EmployeeRecord[];
  total: number;
  refreshedAt: string;
};
```

- [ ] **Step 1: Write failing repository/service tests**

Assert resume, mappings, source-label resolution, row correction, explicit exclusion, preview counts, commit acknowledgement, audit read, reversal preview, conflict mapping, server pagination, and department approved-field projection.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --experimental-strip-types --test tests/recovery-c-import-service.test.mjs tests/recovery-c-employee-service.test.mjs
```

- [ ] **Step 3: Implement typed repository methods**

Repository methods must map database errors to business errors:

```ts
type ImportConflict =
  | "batch_stale"
  | "employee_stale"
  | "mapping_stale"
  | "identifier_conflict"
  | "revert_conflict";
```

No page may import Supabase clients.

- [ ] **Step 4: Implement the import service**

The service owns step eligibility, progress, unsaved decisions, explicit confirmation requirements, authoritative reread after every persisted action, and the rule that preview does not write employees.

- [ ] **Step 5: Implement employee directory service**

Support property-scoped manager queries and server-authorized department queries with search, department, position/family, status, limit, and offset.

- [ ] **Step 6: Verify GREEN and full repository regression**

```bash
node --experimental-strip-types --test tests/recovery-c-import-service.test.mjs tests/recovery-c-employee-service.test.mjs tests/repository-registry.test.mjs tests/recovery-a-department-home.test.mjs
```

- [ ] **Step 7: Commit**

```bash
git add app/repositories app/services tests/recovery-c-import-service.test.mjs tests/recovery-c-employee-service.test.mjs
git commit -m "feat: add trusted employee update services"
```

### Task 4: Make server staging RLS-authoritative

**Files:**
- Modify: `app/api/import/inspect/route.ts`
- Modify: `app/services/production-authorization.ts`
- Modify: `app/lib/supabase/server-admin.ts`
- Create: `tests/recovery-c-import-route.test.mjs`

**Interfaces:**
- `POST /api/import/inspect` derives actor/property from authenticated server context.
- Business writes use `createServerActorClient(actor.accessToken)`.
- Response contains aggregate inspection and batch identity only.

- [ ] **Step 1: Write failing route-boundary tests**

```js
assert.match(routeSource, /createServerActorClient/);
assert.doesNotMatch(routeSource, /createServerAdminClient/);
assert.doesNotMatch(routeSource, /form\\.get\\([\"']propertyId[\"']\\)/);
assert.match(routeSource, /property-import-files/);
```

Add authenticated manager success, department denial, disabled-manager denial, invalid file cleanup, and no partial staging tests against local Supabase.

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/recovery-c-import-route.test.mjs
```

- [ ] **Step 3: Refactor staging**

Use the actor-scoped client for the batch, Storage, sheet, mapping, row, issue, and source-label writes. Keep the service secret only inside existing server authentication resolution and never expose it to the browser.

- [ ] **Step 4: Make failure cleanup deterministic**

Use one narrowly authorized staging RPC for database writes or prove the cleanup transaction with integration tests. Storage cleanup must remove only the just-created path.

- [ ] **Step 5: Verify GREEN**

Run the route tests and relevant production activation tests.

- [ ] **Step 6: Commit**

```bash
git add app/api/import/inspect/route.ts app/services/production-authorization.ts app/lib/supabase/server-admin.ts tests/recovery-c-import-route.test.mjs
git commit -m "fix: enforce actor-scoped employee staging"
```

### Task 5: Build the manager employee-update experience

**Files:**
- Refactor: `app/import/page.tsx`
- Create: `app/components/import/EmployeeUpdateProgress.tsx`
- Create: `app/components/import/FileInspectionStep.tsx`
- Create: `app/components/import/FieldRecognitionStep.tsx`
- Create: `app/components/import/AttributionStep.tsx`
- Create: `app/components/import/IssueResolutionStep.tsx`
- Create: `app/components/import/EmployeeUpdatePreviewStep.tsx`
- Create: `app/components/import/EmployeeUpdateHistory.tsx`
- Create: `app/recovery-c.css`
- Modify: `app/globals.css`
- Modify: `tests/checkpoint-2c-c.test.mjs`
- Modify: `tests/checkpoint-4b.test.mjs`
- Create: `tests/recovery-c-import-ui.test.mjs`

**Interfaces:**
- Consumes `ImportService`.
- Produces a seven-step resumable workflow plus history and guarded reversal.

- [ ] **Step 1: Replace obsolete tests with failing Recovery C expectations**

Require:

- the seven Chinese business steps;
- explicit exclusions;
- saved/dirty/saving/failed/conflict states;
- department and position mapping;
- row-level issue handling;
- six-category zero-write preview;
- explicit confirmation;
- update history and reversal preview;
- no prototype toast;
- no training-history import.

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/recovery-c-import-ui.test.mjs tests/checkpoint-2c-c.test.mjs tests/checkpoint-4b.test.mjs
```

- [ ] **Step 3: Build the workflow using Recovery B patterns**

Reuse `AdministrationSaveState`, unsaved-change guard, dialogs, focus treatment, and authoritative reread. Keep current property identity visible. Separate source facts, manager decisions, and commit results.

- [ ] **Step 4: Add privacy-safe Preview review state**

Mock mode must be labelled **受保护评审数据** and must never be selected in Production. It may demonstrate the complete workflow with synthetic rows and must not accept or contain the real workbook.

- [ ] **Step 5: Add responsive visual rules**

Desktop, tablet, and mobile must preserve:

- 44px controls;
- readable 11–14px operational text;
- no horizontal page overflow;
- stackable mapping and preview detail;
- sticky or readily reachable step navigation;
- visible focus and dialog return focus.

- [ ] **Step 6: Verify GREEN**

Run the focused UI tests, lint modified files, and build.

- [ ] **Step 7: Commit**

```bash
git add app/import app/components/import app/recovery-c.css app/globals.css tests
git commit -m "feat: complete trusted employee update journey"
```

### Task 6: Make People Center authoritative for both roles

**Files:**
- Refactor: `app/people/page.tsx`
- Refactor: `app/department/employees/page.tsx`
- Modify: `app/services/department-foundation.ts`
- Create: `app/components/people/EmployeeDirectory.tsx`
- Create: `app/components/people/EmployeeProfileDrawer.tsx`
- Create: `tests/recovery-c-people-ui.test.mjs`
- Modify: `tests/recovery-a-department-home.test.mjs`

**Interfaces:**
- Manager consumes `EmployeeDirectoryPage` for the current property.
- Department role consumes only the server-scoped directory result.

- [ ] **Step 1: Write failing People tests**

Assert manager filters, pagination, authoritative source status, update history link, profile refresh, no training facts, and no employee account assumptions.

Assert department breadcrumb, explicit scopes, descendant behavior, approved fields, no import link, no global counts, no raw identifiers, and direct URL denial for `/people` and `/import`.

- [ ] **Step 2: Verify RED**

```bash
node --experimental-strip-types --test tests/recovery-c-people-ui.test.mjs tests/recovery-a-department-home.test.mjs
```

- [ ] **Step 3: Build shared directory components**

The list is responsive and paginated. The profile drawer must set initial focus, trap focus, restore focus, close on Escape/backdrop, and lock background scrolling.

- [ ] **Step 4: Connect manager and department sources**

Manager reads current-property employees. Department role calls only the scoped boundary and never loads the full organization or full employee repository.

- [ ] **Step 5: Verify GREEN**

Run focused People, routing, authorization, and accessibility source tests.

- [ ] **Step 6: Commit**

```bash
git add app/people app/department/employees app/components/people app/services/department-foundation.ts tests
git commit -m "feat: connect authorized People Center"
```

### Task 7: Complete local database and application verification

**Files:**
- Create: `docs/recovery-c/local-verification-report.md`
- Modify only defects exposed by verification.

- [ ] **Step 1: Clean reset**

```bash
npx --no-install supabase db reset --local --yes
```

Expected: every migration and synthetic seed applies from zero.

- [ ] **Step 2: Run all pgTAP**

```bash
npx --no-install supabase test db --local supabase/tests
```

Expected: all tests pass, including property isolation, department scope, Storage, import, commit, audit, and reversal.

- [ ] **Step 3: Run database security advisors**

Discover the installed CLI syntax with:

```bash
npx --no-install supabase db advisors --help
```

Then run the local security advisor and resolve all errors attributable to Recovery C.

- [ ] **Step 4: Run application verification**

```bash
npm run lint
npm test
```

Expected: all Node tests, parser tests, production build, and rendered HTML test pass.

- [ ] **Step 5: Verify real workbook locally**

Run aggregate inspection against the approved external workbook and compare it to `docs/recovery-c/real-workbook-inspection.md`. Do not commit or upload the workbook.

- [ ] **Step 6: Verify Auth separation**

Compare Auth/user-account counts before and after a synthetic import transaction. Employee count may change locally; Auth users, `user_accounts`, memberships, and role assignments must not.

- [ ] **Step 7: Write report and commit**

```bash
git add docs/recovery-c/local-verification-report.md
git commit -m "test: verify Recovery C employee foundation"
```

### Task 8: Protected Preview and browser review evidence

**Files:**
- Create: `artifacts/recovery-c-browser/*.png`
- Create: `artifacts/recovery-c-browser/browser-verification-results.json`
- Modify code only for genuine Recovery C defects.

**Interfaces:**
- Produces one SSO-protected Vercel Preview.
- Uses privacy-safe synthetic review data only.

- [ ] **Step 1: Read the Vercel deployment and browser verification skills**

Use the exact current CLI syntax and keep Production target/environment unchanged.

- [ ] **Step 2: Deploy Preview**

Build with explicit local-review environment values that cannot silently connect to Production or present review data as real.

- [ ] **Step 3: Capture manager workflow**

Desktop, tablet, and mobile screenshots must cover file inspection, field recognition, department attribution, position attribution, issue resolution, zero-write preview, confirmation/completion, history/reversal preview, and manager People Center.

- [ ] **Step 4: Capture department role**

Show authorized scope, approved employee fields, no import/admin navigation, and direct-route denial.

- [ ] **Step 5: Verify interactions**

Record navigation/return paths, role visibility/direct-route authorization, save and conflict states, keyboard focus, normal-zoom readability, touch targets, overflow, console errors, page errors, failed requests, and error responses.

- [ ] **Step 6: Remove temporary artifacts**

Close browser contexts, revoke/rotate any temporary Preview bypass credential, delete temporary scripts/cookies, and retain only approved screenshots and aggregate JSON.

- [ ] **Step 7: Commit final evidence**

```bash
git add artifacts/recovery-c-browser
git commit -m "test: add Recovery C browser review evidence"
```

## Self-review

- Spec coverage: every Acceptance item is assigned to Tasks 1–8.
- Privacy: the real workbook stays outside Git and Preview; excluded values are not staged.
- Role model: no employee or platform workspace is introduced.
- Type consistency: preview and directory contracts are defined once and consumed by later tasks.
- Scope: no Recovery D module is implemented.
- Production boundary: all migrations and employee writes remain local until separate approval.
