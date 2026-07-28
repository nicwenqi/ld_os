# Recovery E0 — Pilot Readiness & Production Transition Design

**Status:** Design only — awaiting approval for implementation and each production gate  
**Scope:** Introduce no new training business fact model. Preserve D0–D4 unchanged.

## 1. Purpose

Recovery E0 makes the already trusted employee, requirement, plan, session, attendance, and completion foundations usable for a deliberately limited first-hotel pilot. It is a controlled transition from locally verified software to a real hotel operating environment; it is not D5, a reporting release, or a production experiment.

The pilot must prove one auditable path:

```text
approved employee baseline
→ effective requirement version
→ evaluated eligibility
→ published plan and immutable session revision
→ participant snapshot
→ attendance observation and determination
→ completion evidence and reviewed completion record
```

Each arrow is an existing D0–D4 contract. E0 adds readiness evidence, operating procedure, release control, and explicit human approval around it; it does not add a parallel fact store or reinterpret any historical fact.

## 2. Product and architecture invariants

- The pilot serves one hotel property in the experience. Existing tenant/property isolation remains architectural infrastructure; hotel users never select a tenant, hotel, property, or role at login.
- Only a Hotel L&D Manager and a Department Training Responsible Person authenticate. Employees stay managed records. A baseline import never provisions Auth identities or backend accounts.
- D0 employee fact versions remain the employee context for later operational facts. Current departments, positions, or status never rewrite history.
- D1 Requirement Version remains the business obligation; Course Version is an accepted learning method where the requirement says it is. Eligibility remains a point-in-time three-state evaluation, not an assignment or task.
- D2 immutable Session Revision and Participant Snapshot remain the plan/delivery context. D3 attendance is an independent fact. D4 completion is independent evidence; neither QR observation nor `Present` automatically creates completion.
- No E0 artifact may manufacture KPI, Health, Forecast, Risk, dashboard facts, feedback, reminders, AI advice, or training history.
- Missing, stale, unresolved, or excluded data is named as such. It is never treated as zero, completed, not applicable, or healthy.

## 3. Recommended transition model

### Decision

Adopt **release manifest → read-only remote alignment → production-like rehearsal → explicit production schema approval → controlled activation and baseline → limited first-loop pilot → review gate**.

This is preferred over a big-bang import and launch because the existing D0–D4 facts are deliberately immutable and traceable. A production migration, a real employee baseline, and the first business facts must be separately observable and reversible by forward correction, not bundled into an opaque one-time operation.

### Rejected paths

| Path | Decision | Reason |
|---|---|---|
| Direct production migration, employee import, and first session in one window | Reject | Cannot isolate schema, permission, baseline, and operating defects. |
| Treat Preview or local data as production evidence | Reject | It does not prove remote configuration, RLS, storage, host context, or approvals. |
| Production database reset, seed, repair, or broad data cleanup | Prohibited | It risks the initial property/account foundation and breaks the recovery discipline. |
| Create temporary employee accounts for pilot administration | Prohibited | Violates the two-role model and needlessly widens access. |
| Expand D0–D4 facts to make the pilot convenient | Reject | Pilot operating procedure must adapt to the trusted model, not weaken it. |

## 4. Pilot-ready definition

The property is **Pilot Ready** only when all conditions below are true.

1. A signed release manifest identifies one immutable application commit, build artefact, ordered D0–D4 migration set and their checksums.
2. A read-only production alignment record shows which migrations are already remote, confirms no drift requiring an unapproved correction, and records backup/restore ownership and rollback choices.
3. A production-like rehearsal has passed from a clean local reset using non-production data, including manager, department-role, anonymous QR, cross-scope denial, and data-recovery paths.
4. Production is configured for authoritative data only: `APP_ENV=production`, `APP_DATA_MODE=supabase`; mock or local-review data cannot become a fallback.
5. The hotel hostname resolves to the intended property context; production login, account status, membership, role, and department-scope resolution have a documented verification result.
6. At least one active Hotel L&D Manager and, when a departmental pilot is chosen, one active Department Training Responsible Person with explicitly assigned official scope exist. No employee receives an account through the import.
7. The employee baseline is either complete for the property or explicitly classified as a limited pilot baseline under section 6.
8. A selected pilot cohort has resolved identity, active lifecycle state, effective organization/position context, and no eligibility `Unable to Determine` result for the chosen requirement.
9. The first controlled loop has a named manager owner, department owner, trainer, venue/resource readiness, participant snapshot, and a recorded operational review.
10. All security, data-quality, and release gates are passed or explicitly accepted by the designated business and technical approvers.

No single success metric substitutes for these gates.

## 5. Gate model and approvals

| Gate | Decision | Evidence | Required approval | What is forbidden before it passes |
|---|---|---|---|---|
| E0-A | Release candidate | commit, build, migration manifest, test reports | technical owner | remote access or production action |
| E0-B | Remote alignment | read-only migration/drift/backup record | technical owner + database owner | rehearsal conclusion |
| E0-C | Production-like rehearsal | redacted run record and security test evidence | L&D product owner + technical owner | production schema change |
| E0-D | Production schema release | approved pending-migration manifest and rollback/forward plan | explicit user approval + database owner | `db push` or any production DDL |
| E0-E | Activation and employee baseline | approved import preview, data-quality report, role/scope checklist | Hotel L&D Manager | real pilot delivery facts |
| E0-F | First closed loop | lineage audit from requirement to reviewed completion | Hotel L&D Manager + pilot department owner | pilot expansion |
| E0-G | Continue, hold, or correct | post-pilot review and open-issue register | Hotel L&D Manager + product owner | additional departments or broad launch |

E0 stops at the next unapproved gate. Approval of E0 design is not approval for E0-D, E0-E, or E0-F.

## 6. Production migration strategy

### 6.1 Release manifest

Before any remote mutation, produce an immutable, redacted release manifest containing:

- application commit SHA, branch, build artifact/version, Node/Supabase CLI versions;
- exact ordered migration filenames from the D0–D4 release and file checksums;
- local clean-reset, pgTAP, application-test, build and browser-verification evidence;
- expected remote migration history and known initial property/account facts only as aggregate identifiers;
- designated database owner, release operator, observation owner, and business approver;
- compatibility statement: application deployment is compatible with the pre-migration state and each intermediate migration state, or a controlled maintenance window is required.

The manifest contains no credentials, raw workbook, employee identity, QR token, session cookie, or export.

### 6.2 Read-only alignment and rehearsal

The database owner first records the remote migration history and schema-drift result without applying anything. Any unexplained divergence is a hold, not a reason to repair history. Rehearsal uses a clean local database and synthetic, non-identifying fixtures. It exercises the same release artifact and migration ordering, then verifies RLS/RPC/Storage behaviors.

Supabase’s CLI workflow supports inspecting pending changes with `db push --dry-run`; a remote reset is destructive and is never part of this plan. [Supabase local-development workflow](https://supabase.com/docs/guides/local-development/cli-workflows)

### 6.3 Approved schema window

Only after E0-D approval may the database owner apply the exact pending manifest migrations once, without seeds, employee import, or unrelated data change in that same operation. Record the resulting remote migration history, database timestamp, and post-change read-only probes.

The application is deployed or traffic is switched only through the separately approved release process after post-migration verification. E0 itself does not authorize Production deployment, DNS, environment-variable change, or merge.

### 6.4 Rollback and correction

- **Application rollback:** return traffic to the last compatible application build only if compatibility was established in the manifest. It never rolls database history backward.
- **Database correction:** default to a reviewed, additive forward-correction migration after root cause and rehearsal. Never edit an already applied migration.
- **Restore:** only the database owner may use an approved restore procedure. A restore is not a routine rollback; it requires an explicit incident decision, confirmed backup point, impact review, and business approval.
- **Business data:** no reset, truncation, or seed operation. If a baseline or pilot fact is wrong, use its existing audit/revert/append-only correction path where available; otherwise hold the pilot and design a reviewable correction.

## 7. Real employee baseline import

### 7.1 Controlled journey

1. The Hotel L&D Manager opens **员工资料更新** under the production property context.
2. The manager uploads the workbook to private import storage. It is not committed to Git, browser logs, or a public link.
3. The system repeats inspection and field recognition. Employee numbers remain text; training-history and formula-derived columns remain excluded.
4. The manager resolves department and position attribution within the workflow. Uncertain mappings stay unresolved; the system never guesses.
5. The manager reviews data issues, including duplicates, invalid dates, lifecycle conflicts, changed external identifiers, and excluded fields.
6. The system produces a zero-write preview, review version/hash, and employee/field before-after evidence. Nothing writes before explicit confirmation.
7. The manager explicitly confirms the reviewed version. The existing transaction, audit, employee-fact-version and conflict protections commit only the approved changes.
8. People Center re-reads authoritative property data; the manager checks update history and the import audit before any pilot session is opened.

### 7.2 Baseline status

| Status | Meaning | Pilot decision |
|---|---|---|
| Complete property baseline | All expected current rows are resolved or documented exclusions; no unresolved record affects intended hotel operations. | Eligible for broader pilot review. |
| Limited pilot baseline | A documented, clean department/cohort is complete; unresolved rows are outside that approved cohort and no hotel-wide denominator or conclusion is shown. | May run one limited department pilot after explicit business approval. |
| Not ready | Identity, lifecycle, department, position, or scope issues affect the intended cohort; preview or commit evidence is missing. | Hold. |

The prior local workbook inspection found two normalized rows without a department. It is an expected re-inspection control, not a production decision. Those rows stay blocked until a manager resolves them. They are never assigned a default department, silently excluded from an all-hotel claim, or deactivated because a workbook omits them.

## 8. First-hotel activation and permission initialization

Activation remains the existing finite five-section process, not a permanent home-page workflow. It must be completed or have narrowly stated operational warnings before the pilot, then maintained through ordinary administration pages.

### Required setup checklist

- Verified hotel identity, business rules, official active department hierarchy, operational units, and relevant positions/position families.
- One active Hotel L&D Manager account with active property membership and valid manager role. The final active manager protection remains enabled.
- Each Department Training Responsible Person is deliberately appointed, has an active account/membership/role, and receives one or more explicit official department branch scopes. Descendant inclusion follows the established scope rule; it is recorded, not implied.
- A department user cannot edit hotel settings, organization, account/role administration, imports, global targets, or their own scope. Direct URLs and server authorization must deny exactly as navigation does.
- Imported employees have no backend account created or linked unless a separately appointed department responsible person already has a valid, deliberately administered account.

Use business-language admin screens; do not expose tenant/platform administration to hotel users.

## 9. First Requirement → Session → Attendance → Completion loop

The first loop is a small, controllable operating proof—not a KPI exercise.

1. **Business obligation:** the manager confirms one published course version, one effective requirement version, its completion definition and accepted learning method. It must be a real approved business requirement, not a convenience test record.
2. **Applicability:** evaluate the selected cohort as of the documented evaluation date. Every intended participant must be `Eligible`; `Unable to Determine` blocks that person from the proof loop until evidence is corrected. `Not Applicable` is not substituted in order to fill a class.
3. **Delivery plan:** create/publish an approved plan version/item and immutable session revision with named owner, trainer, venue/resource readiness, and authorized department scope.
4. **Participant snapshot:** create the snapshot using eligible employees and their employee fact versions. Any supplemental participant follows D3 controlled-reason/authorizer/review rules.
5. **Attendance:** use QR observation and/or manual witness. Reconcile discrepancies, set an explicit determination, and close the register only when D3 conditions are met. QR observation remains observation; it cannot itself make an employee `Present` or complete.
6. **Completion:** create D4 attendance-derived completion evidence only through the approved accepted method and exact immutable references. The authorized reviewer accepts or rejects it. No automatic requirement state, task, reminder, KPI, or health result is generated.
7. **Lineage review:** manager traces one reviewed completion record through evidence, attendance determination, participant snapshot, session revision, eligibility evaluation, requirement version/method, and employee fact version. Department users see only their assigned scope.
8. **Closeout:** record an operational observation: what was clear, what required manual support, and any source-data correction. Do not call it training effectiveness, forecast, or health.

The pilot cohort should normally be one authorized department and a small group (recommended three to eight employees) with sufficient operational coverage. The final department, cohort size, course, requirement, trainer, and release date require business approval.

## 10. Data-quality controls

| Control | Trusted source / check | Blocker condition | Owner | Disposition |
|---|---|---|---|---|
| Employee identity | approved import preview and employee fact version | duplicate/changed unresolved external ID | L&D Manager | correct in employee-update flow |
| Department/position context | official mapping and effective employee fact | missing/ambiguous intended cohort attribute | L&D Manager | resolve, do not infer |
| Lifecycle status | effective employee fact history | inactive or unknown eligibility context | L&D Manager | exclude or correct with evidence |
| Requirement applicability | effective rule set evaluation | `Unable to Determine` for an intended participant | L&D Manager | repair facts/rules then re-evaluate |
| Learning method | effective requirement completion definition | no accepted method matches delivery | L&D Manager | hold; do not create a completion |
| Session readiness | immutable session revision | absent owner/trainer/venue/resource/participant snapshot | manager or scoped department owner | repair revision before delivery |
| Attendance evidence | D3 register and conflict state | unresolved conflict or required evidence gap | session owner | reconcile before close |
| Completion evidence | D4 linked evidence and review | missing exact source/version or unauthorized review | authorized reviewer | reject or hold |
| Freshness/coverage | timestamped aggregate readiness report | stale or incomplete source needed for a conclusion | named data owner | label incomplete; no substituted value |

These controls are operating gates, not scores. They do not calculate hotel performance.

## 11. Security and launch checks

The pre-launch check is evidence-based and redacted:

- production uses authoritative Supabase mode, never local-review/demo fallback; client code contains no privileged database secret;
- hostname/property context, anonymous redirect, invalid-role access denial, active-account/membership/role enforcement, and logout/return path behave correctly;
- manager scope, department branch/descendant scope, unrelated-department denial, deactivated-account denial, and direct-route denial are checked server-side;
- RLS is enabled and policies are verified with actual Manager, Department, and anonymous contexts; privileged RPCs use explicit authorization, fixed search paths, and no broadened write path;
- private import Storage denies department users and anonymous callers; temporary files, raw workbooks, tokens, sessions, screenshots containing personal data, and test credentials are removed after rehearsal;
- browser verification records console errors, failed requests, keyboard focus, normal-zoom readability, 44px mobile targets, and horizontal overflow without capturing personal data;
- security review includes RLS and function/data-integrity checks. Supabase recommends RLS for exposed tables and its testing guidance supports pgTAP verification for RLS, functions, and data integrity. [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) · [database testing overview](https://supabase.com/docs/guides/local-development/testing/overview)

## 12. E0 implementation scope and non-scope

### E0 implementation may add

- redacted runbooks, checklists, evidence-register templates, and release-manifest tooling;
- CI/local checks that make source mode, migration manifest completeness, or unsafe release commands fail early;
- controlled test fixtures and rehearsal scripts that do not contact production;
- documentation and explicit operational approval boundaries.

### E0 implementation may not add

- a migration or data model beyond D0–D4;
- Course/Requirement/Plan/Session/Attendance/Completion business behavior;
- employee accounts, employee self-service, feedback, reminder, dashboard, KPI, Health, Forecast, Risk, AI, D5 functionality;
- production migration, real employee import, production deployment, DNS/environment change, or merge without a later explicit approval.

## 13. Unresolved business decisions requiring approval

1. Is a **limited pilot baseline** acceptable if the selected pilot department/cohort is clean while the property has separately blocked employee rows? If yes, define who may approve it and prohibit hotel-wide conclusions.
2. Which department, cohort size, real course, requirement, trainer, venue, and pilot date form the first loop?
3. Who holds the named roles of database owner, release operator, observation owner, L&D business approver, and incident/restore approver?
4. What backup retention, recovery-point objective, and restoration authority apply to the production project?
5. Is an application release required in the same approved window as schema migration, or must the release manifest prove phased compatibility?
6. What is the acceptable outage/maintenance communication procedure if the compatibility assessment requires a short window?
7. Who may classify evidence as redacted and retain it in the E0 review record?

## 14. E0 acceptance criteria

E0 is complete only when:

- the design above is approved and all named approvers/owners are assigned;
- a versioned release manifest and non-production rehearsal have passed without relying on real employee data;
- every production-changing operation is behind a separate explicit approval gate;
- migration, import, activation, permission, first-loop, data-quality, security, correction, and review procedures have named evidence outputs;
- no E0 implementation changes D0–D4 semantics or introduces a prohibited feature;
- Review Stop E0 provides a clear `Go`, `Conditional Go`, or `No Go` for the first production pilot; and
- no Production schema, employee, account, deployment, DNS, or environment change occurs during E0 design work.

