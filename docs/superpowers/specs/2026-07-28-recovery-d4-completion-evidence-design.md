# Recovery D4 — Trusted Completion Evidence Design

## Status and governing contract

Recovery D4 establishes a trusted Completion Evidence fact layer. It does not
create an LMS task system and does not decide KPI, Health, Forecast, Risk,
intervention, feedback, employee performance, or AI conclusions.

The governing lineage is:

```text
Requirement Version
→ Accepted Learning Method
→ Source Evidence
→ Authorized Evidence Review
→ Completion Record
→ Optional append-only Revocation
```

Every Completion fact preserves the event-time:

- employee identity through `Employee Fact Version`;
- obligation through `Requirement Version`;
- accepted way to satisfy that obligation through `Accepted Learning Method`;
- delivery identity through `Course Version` when the method is course-based;
- exact `Session Revision`, participant snapshot, and Attendance Determination
  when Attendance is the evidence source.

Current mutable employee, requirement, course, session, or attendance state
never rewrites historical Completion meaning.

## Fact boundaries

### Completion Evidence

Completion Evidence is an immutable source assertion offered for review. It
answers:

> What evidence exists, when did it occur, which employee fact version and
> Requirement Version does it concern, and which Accepted Learning Method is
> it claiming to satisfy?

Recording evidence does not mean the Requirement is completed.

### Evidence Review

Evidence Review is a single, append-only authorized decision:

- `accepted`: the evidence satisfies the referenced Accepted Learning Method;
- `rejected`: the evidence does not satisfy it, with a business reason.

An evidence row is never edited after review. Incorrect or incomplete evidence
is replaced by a new evidence row.

### Completion Record

A Completion Record is an immutable verified fact created only when an
Evidence Review accepts the evidence. It answers:

> On this date, using this accepted method and this evidence, the employee
> completed this exact Requirement Version.

Completion Records are not assignments, tasks, due dates, reminders, KPI
inputs, or claims about current employee status.

### Revocation

Revocation is a separate append-only fact linked to the original Completion
Record. It retains:

- original Completion Record and Evidence;
- reason;
- authorized operator;
- timestamp;
- audit event.

The original row remains immutable and visible as revoked. A correction
requires new evidence and a new reviewed Completion Record. The new record may
reference the revoked record it supersedes.

## Source structures

### Attendance source

The Attendance source stores exact references to:

- `Session Revision`;
- `Participant Snapshot`;
- the current `Attendance Determination` used at evidence-recording time.

It is accepted only when:

- the determination is `Present`;
- the determination, participant snapshot, attendance register, and session
  revision share one lineage;
- the session is a Requirement-delivery session;
- the session references the same Requirement Version, Accepted Learning
  Method, and Course Version;
- the accepted method is a `course_version` method.

The RPC derives the Requirement, method, Course Version, employee, and Employee
Fact Version from the immutable Attendance lineage. The browser cannot
substitute them.

`Present` is only eligible source evidence. It does not automatically create
Completion Evidence or a Completion Record. A manager or in-scope Department
Training Responsible Person must record and then explicitly accept the
evidence.

### External evidence source

The external source is accepted only for an `external_certificate` method and
stores:

- issuer;
- credential or certificate reference;
- issue date;
- optional expiry date;
- privacy-conscious evidence summary.

The server resolves the Employee Fact Version effective on the issue date.
Missing point-in-time employee evidence blocks recording. D4 stores a
reference and summary only; it does not add public document storage.

### Manager recognition source

The recognition source is accepted only for a `manager_equivalency` method.
It stores:

- recognition date;
- recognition basis;
- a snapshot of the approved equivalency standard;
- the approving Hotel L&D Manager and time.

Only a Hotel L&D Manager can create or accept Manager Recognition evidence.
Recognition is a controlled decision, not an inferred completion and not an
employee self-claim.

### Assessment methods

D1 assessment methods remain valid Requirement definitions, but D4 does not
invent an assessment result source. They appear as “尚未接入受控考核证据” and
cannot produce a Completion Record in D4.

## Data model

The migration adds:

1. `completion_evidence`
   - immutable common lineage, source type, event date, summary, integrity
     hash, actor, and timestamp.
2. `completion_attendance_sources`
   - one-to-one Attendance source lineage.
3. `completion_external_sources`
   - one-to-one external certificate evidence.
4. `completion_manager_recognition_sources`
   - one-to-one authorized equivalency recognition.
5. `completion_evidence_reviews`
   - one immutable accepted or rejected review per evidence row.
6. `completion_records`
   - immutable accepted Completion fact, optionally superseding one revoked
     record.
7. `completion_record_revocations`
   - one immutable revocation per Completion Record.
8. `completion_audit_events`
   - immutable business audit events for record, review, completion, and
     revocation actions.

All exposed-schema tables:

- enable and force RLS;
- revoke direct browser table access;
- reject update and delete;
- use tenant/property composite foreign keys;
- index foreign keys and read paths;
- are written only inside controlled RPC transactions.

The D0 `employee_fact_dependencies` ledger receives append-only dependencies
for Completion Evidence and Completion Records.

## Deterministic validation

The server deterministically validates:

- active account, membership, role, property, and department scope;
- employee and Employee Fact Version lineage;
- Requirement Version and Accepted Learning Method lineage;
- method/source compatibility;
- Course Version identity when applicable;
- exact Attendance lineage and `Present` determination;
- evidence dates and external expiry shape;
- one final review per evidence;
- no duplicate active Completion Record for one employee and Requirement
  Version;
- revocation authority and reason;
- supersession only against a revoked record with the same employee and
  Requirement Version.

Missing or contradictory source facts block the operation. `Unable to
Determine` never becomes Completion.

## Concurrency

Evidence and Completion facts are append-only, so stale editing is impossible.
Review, duplicate-active-record checks, and revocation use transaction locks
and unique constraints. A concurrent second review, completion, or revocation
returns a business conflict and the UI re-reads authoritative state.

## Authorization

### Hotel L&D Manager

May read, record, review, and revoke Completion facts across the current hotel
property. May use all three D4 source types.

### Department Training Responsible Person

May read and manage Attendance and external evidence only when the referenced
Employee Fact Version department is inside an explicitly authorized branch.
Descendant behavior uses the existing D0 scope helper. The user cannot select a
property or widen scope in the browser.

Department users cannot:

- create or accept Manager Recognition evidence;
- read or mutate Completion facts whose event-time department is outside
  scope;
- access raw tables;
- create employee accounts or Completion for an arbitrary current employee
  without an event-time fact version.

### Anonymous and employees

No Completion RPC or table access. Public QR check-in remains D3 Observation
only.

## RPC boundary

The browser uses only:

- `read_completion_workspace(property_id)` for Manager;
- `read_department_completion_workspace()` for Department;
- `record_attendance_completion_evidence(determination_id, summary)`;
- `record_external_completion_evidence(employee_id, requirement_version_id,
  method_id, issuer, reference, issued_on, expires_on, summary)`;
- `record_manager_recognition_evidence(employee_id, requirement_version_id,
  method_id, recognition_date, basis)`;
- `review_completion_evidence(evidence_id, decision, reason,
  supersedes_record_id?)`;
- `revoke_completion_record(record_id, reason)`.

All mutation RPCs re-run server authorization and lineage validation. Public
execute privileges are revoked; only `authenticated` receives the approved
functions.

## Product experience

Manager route: `/completions`

Department route: `/department/completions`

Both routes use one role-aware Completion workspace. The page hierarchy is:

1. truthful conclusion;
2. explicit authorized property or department scope;
3. source boundary explanation;
4. pending evidence requiring review;
5. verified Completion Records;
6. source-specific evidence recording.

Enabled actions always call real RPCs or open usable forms. The workspace
never displays an employee as overdue or assumes a missing Completion Record
means incomplete.

Attendance and Requirement pages link to the Completion workspace. Feedback
remains truthfully unavailable.

## Empty, error, and degraded states

- No evidence: “尚无已登记完成证据”，not zero completion.
- No active records: “尚无已核验完成事实”，not failure or risk.
- Assessment method: “尚未接入受控考核证据”.
- Source load failure: preserve the page shell and scope, show retry.
- Unauthorized route: `/access-denied`.
- Conflict: show authoritative reload message and re-read.
- Revoked record: retain original evidence, operator, reason, and time.

No demo data is allowed in real or Production modes. Mock mode marks D4
unavailable rather than synthesizing Completion.

## Acceptance contract

D4 passes only when:

1. every evidence row has one Requirement Version and Accepted Learning
   Method;
2. course-based evidence preserves Course Version;
3. Attendance evidence preserves exact Session Revision, participant snapshot,
   Employee Fact Version, and a `Present` determination;
4. mutable current employee data cannot affect old facts;
5. evidence, reviews, records, revocations, and audits are append-only;
6. all three approved source structures work;
7. `Unable to Determine` and non-Present Attendance cannot create evidence;
8. evidence recording is not Completion until explicit authorized acceptance;
9. revocation retains complete original lineage and audit;
10. Manager and Department projections enforce the same server scope;
11. anonymous, employee, and cross-department access is denied;
12. no Assignment, reminder, Feedback, KPI, Health, Forecast, Risk, AI, or HR
    fact exists;
13. clean reset, D4 pgTAP, full pgTAP, application tests, build, and browser
    verification pass;
14. Production remains untouched and D5 does not start.
