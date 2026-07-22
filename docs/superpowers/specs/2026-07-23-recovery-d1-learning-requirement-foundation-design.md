# Recovery D1 — Learning Requirement Foundation Design

**Status:** Approved design, locked for implementation planning  
**Date:** 2026-07-23  
**Governing checkpoints:** Recovery 0, Recovery A, Recovery B, Recovery C, Recovery D0

## 1. Purpose

Recovery D1 establishes the deterministic foundation that answers:

- 酒店要求什么；
- 谁在某一日期适用；
- 什么时候需要；
- 哪些学习方式可以满足要求；
- 什么证据在未来可以构成完成。

D1 is **Learning Requirement Foundation**, not Course Management and not Training Execution. Requirement remains the business-obligation layer. Courses and other learning methods are controlled ways to satisfy that obligation.

## 2. Locked boundary

### Included

- Course identity and immutable Course Versions;
- content identity and capability identity;
- Learning Methods;
- Requirement identity and immutable Requirement Versions;
- Completion Definitions and Accepted Learning Methods;
- effective-dated Eligibility Rule Sets;
- point-in-time Eligibility Evaluation;
- draft concurrency, lifecycle governance and audit evidence;
- manager administration and department-scoped read-only experience.

### Excluded

- Assignment or employee requirement lists;
- enrollment;
- training plans;
- training sessions;
- attendance or check-in;
- completion records;
- feedback;
- KPI actuals;
- forecasts;
- Training Operations Health;
- risk engines;
- intervention workflows;
- AI recommendations.

D1 creates no training-operation fact and no employee obligation fact.

## 3. Final domain relationship

```text
Course
→ Course Version
→ Learning Method

Requirement
→ Requirement Version
→ Completion Definition
→ Accepted Learning Methods

Requirement Version
→ Eligibility Rule Set
→ Effective Eligibility Rule Set
→ Eligibility Evaluation
```

The relationship deliberately avoids `Requirement Version → one Course Version`. A requirement is a hotel obligation. A Course Version is only one possible accepted way to satisfy it.

## 4. Course identity and version semantics

### Course

Course is the stable hotel-owned identity and version lineage. It contains a property-scoped business code, stable display identity and lifecycle metadata. It does not carry mutable content that could rewrite history.

### Course Version

Every Course Version separates:

**Content identity**

- Chinese and English names;
- description;
- outline;
- learning-material version;
- standard duration in minutes.

**Capability identity**

- learning objectives;
- capability tags;
- assessment criteria.

**Version continuity metadata**

- change reason;
- why the version remains under the same Course identity;
- whether existing requirements or completions may require review;
- a business-facing impact note.

Change-impact metadata is informational only in D1. It does not invalidate a historical completion, create retraining, change eligibility or generate an employee obligation.

### Course Version lifecycle

```text
Draft → Review → Published → Retired
```

- Draft may be edited using optimistic concurrency.
- Review freezes ordinary editing but may return to Draft with an audit reason.
- Published is immutable and may be referenced by an Accepted Learning Method.
- Retired prevents new use but never invalidates existing Requirement Versions or future facts that reference it.

## 5. Requirement identity and version semantics

### Requirement

Requirement is the stable hotel business obligation, for example “全酒店年度消防安全要求”. It owns a property-scoped business code and version lineage.

### Requirement Version

Every Requirement Version contains:

- Chinese and English business names;
- purpose and obligation explanation;
- effective-from and optional effective-to dates;
- one Completion Definition;
- one or more non-overlapping Eligibility Rule Sets;
- one deterministic Timing Definition;
- change reason and continuity rationale;
- approval evidence and lifecycle audit.

### Requirement Version lifecycle

```text
Draft → Approved → Effective → Superseded → Retired
```

- Draft is editable using optimistic concurrency.
- Approved is immutable and may have a future effective date.
- Effective is the approved version applicable on the evaluation date.
- A later effective version causes an earlier version in the same lineage to be presented as Superseded.
- Retired is an explicit terminal business decision and requires a reason.

Effective and Superseded are determined from immutable approval facts, effective dates and later versions. They do not depend on a background job running at midnight.

### Temporary suspension decision

D1 does **not** add a suspension state. The current product has no training-operation fact, assignment or emergency hold workflow that justifies the additional reactivation semantics. A future phase may add suspension only with an explicit business case, effective window, authorization and historical treatment.

## 6. Completion Definition and Accepted Learning Methods

Completion Definition is the deterministic completion-rule boundary. D1 supports `any one accepted method` as the only satisfaction operator.

Accepted Learning Method types are:

1. **Published Course Version**
   - references one immutable Published Course Version;
   - future completion evidence must reference that Course Version.
2. **Approved external certificate**
   - defines certificate type, permitted issuer criteria, evidence description and optional validity period;
   - does not import or approve a certificate in D1.
3. **Controlled assessment or examination**
   - defines assessment identity, evidence description and deterministic pass criteria;
   - does not create an assessment result in D1.
4. **Explicitly approved equivalency recognition**
   - defines the evidence and manager-approval standard permitted by the requirement;
   - does not constitute approval or completion for any employee in D1.

Every Requirement Version must have at least one Accepted Learning Method before approval. A Published Course Version may be referenced by multiple Requirement Versions. Retiring a Course Version does not change historical meaning.

Future completion records must be distinct from attendance. Session publication, enrollment, check-in, attendance and feedback never constitute completion by themselves.

## 7. Timing Definition

D1 supports four deterministic timing models:

1. one-time requirement with a fixed due date;
2. hire-relative requirement due within N days after hire;
3. calendar recurrence by month, quarter or year;
4. interval recurrence every N months from a defined anchor date.

Timing Definitions are immutable after Requirement Version approval. D1 may explain the applicable timing window or due date during evaluation, but it does not label an employee overdue, satisfied or incomplete.

Transfer-, department-change- and position-change-triggered obligations are excluded from D1.

## 8. Eligibility Rule Sets

Each Requirement Version owns one or more effective-dated Rule Sets. Their effective periods must not overlap.

A Rule Set can constrain:

- all hotel employees;
- one or more official department branches, each explicitly declaring descendant inclusion;
- one or more Positions;
- one or more Position Families;
- new-employee condition: required, excluded or not evaluated;
- allowed employment statuses.

Within a dimension, multiple selected values mean “any selected value”. Across dimensions, all configured dimensions must match.

D1 has no free-form rule language, no hidden precedence and no employee-specific exception list.

### Publication conflict gate

Approval must fail when:

- Rule Set effective periods overlap;
- the same period has contradictory new-employee conditions;
- status conditions cannot produce a valid population;
- organization or position references are inactive, outside the property or incompatible;
- a rule can produce ambiguous outcomes;
- required evidence for a configured dimension is not defined.

Errors identify the conflicting period, dimension and business selection in Chinese-first language. A hotel manager is never asked to understand a rule-engine expression.

## 9. Point-in-time Eligibility Evaluation

Eligibility Evaluation answers only:

> On evaluation date X, according to Requirement Version Y, is employee Z applicable to this requirement?

It resolves the D0 `employee_fact_versions` record effective on the evaluation date and returns:

- evaluation date;
- Requirement Version and effective Rule Set;
- Employee Fact Version;
- state;
- matched rule evidence;
- missing-evidence or non-match reasons;
- deterministic timing explanation where calculable.

The three states are:

- `eligible` — 适用；
- `not_applicable` — 不适用；
- `unable_to_determine` — 无法判断。

Missing employee history, department, position, status, hire date or required rule evidence produces `unable_to_determine`. It never silently becomes `not_applicable` and is never counted as zero.

Evaluation is read-only and ephemeral. It creates no Assignment, task, overdue state, reminder, completion obligation, employee history mutation or audit claim that the employee owes training.

## 10. Historical meaning

Future operational facts must reference:

- Requirement Version;
- Accepted Learning Method;
- Course Version where the method is course-based;
- Employee Fact Version.

Current employee state must never rewrite historical training meaning. D1 itself does not create entries in `employee_fact_dependencies`, because it creates no employee-level operational fact. A future phase must add that dependency only when it persists a real employee training fact.

## 11. Authorization model

### Hotel L&D Manager

May:

- create Course and Requirement identities;
- edit Draft versions;
- move Course Versions through Review and Published;
- approve Requirement Versions;
- retire versions with a reason;
- run hotel-wide point-in-time Eligibility Evaluation;
- inspect validation, conflict and audit evidence.

Every action requires D0 unified authorization:

- active backend account;
- active profile;
- active tenant and property membership;
- active manager role;
- current property context.

### Department Training Responsible Person

May only:

- read Effective Requirement summaries applicable within their authorized official department branches;
- inspect accepted learning methods required for understanding the obligation;
- run Eligibility Evaluation only for employees inside current authorized scopes and configured descendants.

May not read drafts, review versions, approval notes, other departments’ employee evaluation, or perform any mutation.

### Data exposure

- Client components never accept a property ID or department scope selected by the browser.
- Security-definer read and mutation functions reassert `auth.uid()` and D0 authorization.
- Tables in `public` have RLS enabled and forced.
- Authenticated clients receive only explicit read or RPC grants; there are no direct mutation grants.
- Department projections omit unrelated employee and department details.

## 12. Product experience

### Manager

Add `/requirements` as **培训要求** under periodic review. The page leads with hotel obligations, not a course catalog.

Primary sections:

1. Requirement register and lifecycle state;
2. Requirement Version editor;
3. Completion Definition and Accepted Learning Methods;
4. effective-dated applicability rules;
5. publication-readiness and conflict review;
6. point-in-time eligibility preview;
7. secondary Course and Course Version foundation.

CTC/GTC hotel-setting flags appear only as configuration notices. They never create a Course, Requirement or draft automatically.

### Department role

Add `/department/requirements` as **培训要求**. It shows:

- active authorized scope and breadcrumb;
- Effective Requirements relevant to scoped employees;
- accepted completion methods;
- scoped Eligibility Evaluation with all three states;
- truthful empty, missing-data and load-failure states.

It exposes no creation, editing, approval or global organization controls.

## 13. Save, validation and error behavior

- Draft saves use the shared states: unchanged, unsaved, saving, saved, failed and conflict.
- Every successful save re-reads authoritative server state.
- Published/Approved data is immutable at both RPC and trigger layers.
- Publication validation is transactional; partial versions cannot be approved.
- Failed authorization returns access denied without leaking existence.
- Missing evidence is an evaluation result, not an exception.
- Source-load failure is distinct from no Requirements and from no applicable employees.
- Every enabled action navigates, changes a visible draft, persists real state or opens a usable confirmation.

## 14. Existing assumptions to replace

- `Course.mandatory` does not define a hotel obligation.
- a Session-level `mandatory` flag does not define a Requirement.
- CTC/GTC property flags do not create requirements.
- attendance does not equal completion.
- current employee department, position or status cannot answer historical applicability.
- a Course Version alone cannot define acceptable external certificates, assessments or equivalency.
- boolean eligibility is insufficient; all evaluations are tri-state.
- prototype arrays under `app/data` are not D1 production sources.
- unavailable `/plans` and `/effectiveness` pages remain unavailable; D1 does not claim plan execution or course effectiveness.

Legacy synthetic course/session fixtures may remain isolated for disabled prototype tests until their owning recovery phase, but D1 repositories and pages must never import or display them.

## 15. Migration impact

One additive local migration is expected to introduce:

- Course identities and Course Versions;
- Requirement identities and Requirement Versions;
- Completion Definitions;
- Accepted Learning Methods;
- effective-dated Eligibility Rule Sets and structured terms;
- append-only lifecycle/audit events;
- indexes, constraints, immutable-version triggers and RLS;
- manager mutation/read RPCs;
- department-scoped read RPCs;
- point-in-time Eligibility Evaluation RPCs.

The migration must not add Assignment, Session, Attendance, Completion, Feedback, KPI, Forecast, Risk, Intervention or AI structures. It is tested only through a clean local Supabase reset and is not applied to Production without separate approval.

## 16. Acceptance criteria

1. Requirement remains the visible and persisted business-obligation layer.
2. Course content and capability identity are versioned separately from Course identity.
3. Requirement Version references a Completion Definition, never one mandatory Course Version.
4. All four Accepted Learning Method types are representable without creating completion facts.
5. All four approved timing models validate deterministically.
6. Rule Sets are effective-dated, non-overlapping and publish-blocked on ambiguity.
7. Eligibility Evaluation uses evaluation-date Employee Fact Versions and returns exactly the three approved states.
8. Missing evidence remains `unable_to_determine`.
9. Evaluation creates no Assignment, overdue, reminder, completion or employee mutation.
10. Published Course Versions and Approved/Effective Requirement Versions are immutable.
11. Version continuity and change-impact metadata cannot invalidate history or trigger retraining.
12. Manager authority is hotel-wide and server-asserted.
13. Department authority is read-only, scope-derived and descendant-aware.
14. CTC/GTC settings create no implicit Course or Requirement.
15. Production never falls back to synthetic Course or Requirement data.
16. Direct URL authorization and visible navigation match.
17. Desktop, tablet and mobile pages are readable, usable and truthful.
18. Clean local reset, pgTAP, application tests, rendered-page checks and production build pass.
19. Production Supabase, users, employees, DNS and deployment remain untouched.
20. D2 does not start.
