# Review Stop C4 — Requirement Readiness

## Result

**PASS — the Pilot property has a controlled Requirement-readiness path, reusing the approved D1 learning-requirement foundation.**

**Data classification:** all verification used a clean disposable local Supabase reset and local synthetic review identities only. No real hotel Property, employee, Course, Requirement, Plan, Session, Attendance, Completion, account, workbook, Production resource, or deployment was accessed or changed.

C4 creates no Training Plan, Plan Version, Session, Attendance, Completion, KPI, Forecast, Risk, Health, Feedback, AI, Reminder, assignment, participant snapshot, or training execution fact.

## C4 product outcome

The manager-facing `培训要求` workspace now makes the first controlled Pilot action explicit:

```text
Manager explicitly chooses the Pilot business case
→ creates Requirement identity + Draft Requirement Version
→ states purpose, effective dates, Completion Definition and scope
→ selects an existing accepted Learning Method
→ saves and re-reads the authoritative aggregate
→ explicitly approves and makes the version effective
→ runs a read-only point-in-time Eligibility Evaluation
```

`消防安全年度培训` is an illustrative Pilot business input only. It is never generated from a course, workbook, CTC/GTC field, group prompt, or system default. The UI states this explicitly: it will not auto-create a course, Requirement, employee task, or execution fact.

The requirement remains the hotel business obligation. Its Completion Definition holds accepted Learning Methods; C4’s controlled case demonstrates the existing `external_certificate` method, so a Course Version is not required. Existing `course_version`, `external_certificate`, `assessment`, and `manager_equivalency` definitions are unchanged. Assessment now truthfully states that it defines future evidence and passing criteria only: **考试事实尚未接入**.

## Fact, version, and eligibility boundary

- A Requirement Version retains its effective dates, business purpose, obligation explanation, Completion Definition, accepted Learning Method(s), and effective Eligibility Rule Set.
- Draft → Approved → Effective is an explicit manager lifecycle. Approved and Effective versions are immutable; change requires a new version.
- Evaluation is strictly point-in-time. It evaluates the selected effective Requirement Version at date X against an `Employee Fact Version`; it does not create an assignment, due date, reminder, participant, attendance, completion, or KPI record.
- The canonical three states remain **适用** (`eligible`), **不适用** (`not_applicable`), and **无法判断** (`unable_to_determine`). “Not Eligible” was not introduced as a fourth or ambiguous state.
- Missing department/position/status evidence remains `unable_to_determine`, including its business-readable reason; it is never turned into `not_applicable` or zero.

## Authorization

| Actor | C4 result |
| --- | --- |
| Hotel L&D Manager | Can create, save, approve, make effective, and evaluate the hotel Requirement aggregate through existing guarded D1 RPCs. |
| Department Training Responsible Person | Cannot create or change hotel-level Requirements; remains limited to server-derived, read-only effective Requirement visibility and scoped evaluation. |
| Platform provisioner | Has no hotel Requirement read or mutation authority and cannot enter the hotel workspace through the platform-plane session. |

The existing RLS/RPC boundary was reused. No direct browser DML or broad access was added. Platform authorization remains separate from hotel authorization.

## Migration impact

**No migration was created or required.** C4 is a controlled reuse of the previously approved D1 tables, RLS policies, immutable-version triggers, append-only audit evidence, and narrow RPCs. It does not alter D0 Employee Fact Version, D1 Requirement/Course semantics, or D2–D4 operational fact semantics.

## Verification evidence

| Verification | Result |
| --- | --- |
| Clean local Supabase reset | PASS — all migrations replayed locally; synthetic seed only |
| Focused C4 pgTAP | PASS — 20 assertions |
| Full pgTAP suite | PASS — 27 files, 833 assertions |
| Application regression suite | PASS — 291 tests |
| Production build + rendered HTML test | PASS |
| `git diff --check` | PASS |
| Browser: Manager manual create/save/approve/effective | PASS — local mock review data only |
| Browser: Department direct manager route | PASS — access denied; read-only department Requirement view remains accessible |
| Browser: Platform identity direct hotel route | PASS — returned to hotel login; no hotel business workspace exposed |
| Browser: desktop 1440px and mobile 390px | PASS — normal-zoom readable, no horizontal overflow |
| Browser: keyboard focus and primary action targets | PASS — focused control visible; sampled primary actions at least 44px |
| Browser: console errors / failed network requests | PASS — none observed |

Focused C4 database evidence proves: manager-only create, department and platform denial, external-certificate Completion Definition link, effective Eligibility Rule Set link, Draft → Approved → Effective lifecycle, immutable effective version, tri-state eligibility, Employee Fact Version reference, retained missing-department evidence, and zero Plan/Session/Attendance/Completion/assignment side effects.

The reviewed local screenshots covered the desktop empty/readiness state, desktop effective-version editor, and mobile effective Requirement and evaluation boundary. They were inspected and deleted with the temporary browser context, local server, and local screenshots; no reusable browser session, credential, access token, or automation artifact remains.

## C4 acceptance checklist

- [x] Hotel L&D Manager can explicitly create a Requirement identity and version with business purpose, effective dates, scope, Completion Definition, and accepted method.
- [x] The recommended fire-safety case is guidance only; nothing is auto-generated.
- [x] Existing Learning Methods are reused; no new method or assessment fact is introduced.
- [x] Eligibility stays point-in-time, three-state, explainable, and Employee-Fact-Version referenced.
- [x] Department role and platform identity have no hotel Requirement creation authority.
- [x] No Plan, Session, Attendance, Completion, assignment, KPI, Forecast, Risk, Health, Feedback, AI, or Reminder fact was created.
- [x] No migration or Production action occurred.
- [x] C5 was not started.

## Remaining boundary

C4 establishes Requirement Readiness only. A real Pilot training cycle may use the existing D2–D4 capabilities only after an explicit business approval; it must not be started automatically from this Review Stop.
