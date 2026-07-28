# E0-C entry decision lock — Pilot property and employee-baseline readiness

**Decision date:** `2026-07-29`

**Release evidence:** E0-A and E0-B are passed on `codex/recovery-e0-pilot-readiness` at `9553b63`.
**Decision:** **NO GO — E0-C has not started.**

This is a decision record, not a Pilot authorization. It records the information that must be explicitly assigned before any property initialization or real employee-baseline preparation is allowed. No Production or other remote environment was connected.

## Blocking decisions

| Required decision | Current state | What must be supplied to unlock it |
| --- | --- | --- |
| Lint warning owner | Lint warning owner: **Unassigned — blocking** | Name the database owner who accepts ownership of the existing `app_private.prepare_employee_import_preview_base` status-type lint finding. |
| Pilot property owner | Pilot property owner: **Unassigned — blocking** | Name the hotel-side person authorized to approve Pilot scope and operational use for the selected property. |
| L&D responsibility owner | L&D responsibility owner: **Unassigned — blocking** | Name the Hotel L&D Manager who approves the baseline preview and carries the Pilot business decision. |
| Pilot scope | Pilot scope: **Unapproved — blocking** | Identify one official department branch, its descendant rule, a limited cohort size, and the Department Training Responsible Person (if delegated). |
| Employee baseline | Employee baseline status: **Cannot start** | Provide a new, manager-authorized private workbook inspection and zero-write preview. The historical local workbook inspection is not a current property baseline. |

No owner has been inferred from source code, local fixtures, commits, or the pre-existing Suzhou-hotel context. A role title alone is insufficient: the decision record must identify an accountable person or formally delegated business function before E0-C can be opened.

## Lint finding: owner, risk, and treatment plan

**Finding:** local `db lint` reports a text-to-`public.import_batch_status` assignment in existing `app_private.prepare_employee_import_preview_base`.

**Risk:** this is a typed status-transition boundary in the trusted employee-update path. The existing local test suite passes, but the warning may conceal an invalid status value or future enum drift until runtime. It must not be silently accepted merely because E0-B migration replay passed.

**Current owner:** unassigned; therefore this is an E0-C entry blocker.

**Required treatment plan, to be approved by the named database owner:**

1. Reproduce and classify the lint warning in a disposable local environment only.
2. Confirm every current status value and transition against the enum and existing Recovery C tests.
3. Propose the smallest explicit type-boundary correction or a documented justified exception; do not weaken import audit, preview, approval, or employee-fact-version protections.
4. Run clean local reset, relevant pgTAP, application tests, and lint again before requesting a separately approved corrective migration, if one is genuinely required.
5. Keep E0-C at `No Go` until the named owner signs the disposition and the user separately approves any implementation or migration.

## Pilot definition — proposal only

The recommended first business case remains **消防安全年度培训**. **Candidate only; not an approved or Effective Requirement Version.** It creates no Course, Course Version, Learning Method, Requirement, Requirement Version, Plan, Session, Attendance, or Completion evidence.

When authority is assigned, the proposed scope is one clean, explicitly authorized department branch with a small operational cohort. The exact department, cohort, trainer, venue, requirement version, accepted method, and date must be confirmed by the named Pilot property owner and L&D responsibility owner. A limited cohort may never support a hotel-wide denominator, KPI, health, forecast, or completion claim.

## Employee baseline decision

`Cannot start` does not mean “no employees” or “inactive employees.” It means no real baseline has yet satisfied the current E0 controls. Before E0-D can be requested, the named L&D responsibility owner must approve:

1. private workbook intake under the correct property context;
2. fresh inspection and field recognition with employee numbers preserved as text;
3. exclusion of training-history and CTC/GTC completion columns;
4. department/position/identity/status issue handling without guesswork or absence-implies-deactivation;
5. a review-version/hash and employee/field before-after zero-write preview;
6. explicit confirmation, authoritative reread, import audit, and a baseline classification of `Full`, `Restricted`, or `Cannot start`.

Imported employees remain managed records. This process must not create Auth users, backend accounts, training facts, or employee self-service access.

## Invariants and next gate

- D0–D4 semantics remain unchanged.
- Do not create a Course, Requirement, Plan, Session, Attendance, or Completion fact.
- No Production migration, deployment, environment-variable change, DNS change, account creation, employee import, or real property mutation is authorized by this record.
- E0-C can be reconsidered only after every blocking decision above has a named accountable owner and the user explicitly approves the resulting Pilot/property initialization request.
- E0-D, E0-E, E0-F, D5, Feedback, KPI, AI, Forecast, Health, and Risk remain out of scope.
