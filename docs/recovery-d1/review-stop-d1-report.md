# Recovery D1 — Review Stop D1

Date: 2026-07-27
Branch: `codex/recovery-d1-implementation`
Implementation commit: `85c0902`

## Completed scope

Recovery D1 establishes the deterministic Learning Requirement Foundation:

- stable Course identity and immutable Course Versions;
- separated content identity, capability identity and continuity metadata;
- hotel business-obligation Requirement identity and Requirement Versions;
- Completion Definitions with four explicit accepted learning-method types;
- effective-dated, explicit eligibility rules for hotel-wide, department branch,
  position, position family, new-employee and employee-status conditions;
- point-in-time tri-state Eligibility Evaluation using Employee Fact Version
  evidence;
- manager lifecycle and editing workspace;
- department-scoped, read-only effective-requirement workspace;
- append-only lifecycle audit evidence and optimistic concurrency.

D1 creates no assignment, plan, session, attendance, completion, feedback, KPI,
forecast, health, risk, intervention or AI fact.

## Domain and version judgment

- Requirement remains the business obligation. It never binds directly to one
  Course Version.
- A Course Version can be one accepted learning method alongside an external
  certificate, controlled assessment or manager-approved equivalency definition.
- Published Course Versions and Approved, Effective, Superseded or Retired
  Requirement Versions are immutable.
- A manager can create a new draft under the same stable Course or Requirement
  identity using identity-level optimistic concurrency.
- Course lifecycle: Draft → Review → Published → Retired.
- Requirement lifecycle: Draft → Approved → Effective → Superseded → Retired.
- D1 adds no suspension state.

## Eligibility judgment

Eligibility Evaluation answers only whether an employee is applicable to a
specified Requirement Version on a specified date.

- Results are `Eligible`, `Not Applicable` or `Unable to Determine`.
- Missing evidence remains explicit and never becomes Not Applicable.
- Evaluation uses `app_private.resolve_employee_fact_at(...)` and returns the
  exact Employee Fact Version identifier.
- Evaluation persists no employee assignment, obligation, completion, reminder,
  KPI or employee-fact dependency.
- Rule periods cannot overlap within one Requirement Version.
- Ambiguous rule periods therefore block publication through deterministic
  constraints and business-readable validation.

## Authorization and isolation

- Hotel L&D Manager reads and mutates D1 only through property-authorized RPCs.
- Department Training Responsible Person receives only Effective Requirement
  Versions relevant to server-derived authorized department scope.
- Department role cannot supply property or department scope from the browser.
- Department role cannot call manager mutation RPCs.
- All 12 D1 relations enable and force RLS.
- Direct `anon` and `authenticated` table mutation privileges are revoked.
- All exposed RPCs re-check live account, membership, role and department scope.
- Security-definer functions use an empty `search_path`; private helpers are not
  executable by browser roles.
- Every foreign-key path has a leading supporting index.

## Data truthfulness and user experience

- `/requirements` is a manager obligation workspace; Course management remains
  secondary.
- `/department/requirements` is scope-explicit and read-only.
- Local review data is labeled and cannot be selected in Production.
- Empty states do not imply that no hotel obligation exists or that operation is
  healthy.
- Save behavior shows pristine, dirty, saving, saved, failed and conflict states,
  then re-reads authoritative state.
- Published or effective definitions are shown as immutable with an explicit
  new-version path.

## Browser verification

Synthetic local-review sessions only:

- manager login and `/requirements` route passed;
- Course draft save, authoritative re-read, Review and Published transitions
  passed;
- Published Course Version became immutable and exposed `建立新版本`;
- empty Requirement save produced business-readable validation;
- department login and `/department/requirements` scope display passed;
- department direct navigation to `/requirements` redirected to
  `/access-denied`;
- desktop 1440×900, tablet 1024×768 and mobile 390×844 had no page-level
  horizontal overflow or framework error overlay;
- all visible mobile buttons met the 44 px touch target;
- keyboard focus showed a 3 px visible outline;
- browser console contained no errors or warnings;
- all observed local application requests returned HTTP 200;
- the browser session, local authentication session and development server were
  closed after verification.

No Preview was created for D1.

## Verification evidence

- Clean local Supabase reset: passed; all migrations replayed and seed completed.
- D1 pgTAP: 41 assertions passed.
- Full pgTAP: 19 files, 555 assertions passed.
- Application: 220 tests passed.
- Production build: passed.
- Rendered server HTML test: passed.
- ESLint: 0 errors; 3 inherited `no-img-element` warnings outside D1.
- Database lint: no D1 findings; one inherited Recovery C/D0 enum-assignment
  warning in `app_private.prepare_employee_import_preview_base`.
- Clean local seed counts:
  - Courses: 0
  - Requirements: 0
  - D1 employee-fact dependencies: 0
  - forbidden D2/later relations: 0

## Migration and Production status

Proposed additive migration:

`20260726175350_recovery_d1_learning_requirement_foundation.sql`

The migration was created and tested locally only. It was not applied to
Production. No Production data, users, accounts, employees, DNS, environment
variables or deployment were changed.

## D2 gate recommendation

**Go after explicit Review Stop D1 approval.**

There is no remaining D1 architecture, authorization, lifecycle or evidence
blocker to begin deterministic D2 work locally. Production migration remains a
separate approval gate. D2 must continue to reference Requirement Version,
Accepted Learning Method, Course Version where applicable and Employee Fact
Version, and must not rewrite historical meaning from current employee state.
