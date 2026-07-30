# Review Stop C3 — Employee Baseline

## Result

**PASS — controlled employee-baseline commit is ready for a future approved Pilot property.**

**Data classification:** local Supabase reset and synthetic local-review browser identities only. No real workbook, employee, account, Property, training fact, Production resource, or deployed environment was accessed or changed.

C3 does not begin C4. It does not create Requirement, Course, Plan, Session, Attendance, Completion, KPI, Forecast, Risk, Health, Feedback, AI, or automation facts.

## Product outcome

The existing Recovery C/D0 employee update path now requires an explicit hotel-manager declaration of the baseline boundary immediately before the already governed transactional commit:

```text
Private workbook
→ inspection and field recognition
→ explicit department / position and issue decisions
→ zero-write preview with per-employee, per-field evidence
→ manager selects baseline classification
→ acknowledgement bound to preview hash
→ controlled transaction
→ Employee Fact Version and authoritative reread
```

The classification is approval evidence, not an employee fact mutation and not a new department scope or eligibility rule:

| Classification | Required declaration | Guardrail |
| --- | --- | --- |
| `Full` | No department boundary and no limitation | Cannot silently carry a hidden limitation or descendants claim. |
| `Restricted` | Human-readable limitation; optional explicit department boundary | Does not imply hotel-wide coverage. |
| `Pilot Limited` | Active current-property department and limitation | Cannot be presented as a hotel-complete baseline. |

The manager sees the selected classification, exact per-employee / per-field before-and-after evidence, preview version, preview hash binding, and after commit the reread classification in update history. The primary confirmation remains disabled until both classification and acknowledgement are present.

## Persistence, fact integrity, and audit

- `20260730105126_recovery_e0_c3_employee_baseline_approval.sql` adds an eight-argument overload of the existing controlled `commit_employee_import` RPC. It does not add a table, employee column, RLS widening, or training-domain fact.
- The existing four-argument browser-capable signature remains present only to return `IMPORT_BASELINE_CLASSIFICATION_REQUIRED`; `authenticated` has no execute privilege on it.
- The classified overload is `SECURITY DEFINER` only for the pre-existing bounded import transaction, has a fixed empty `search_path`, checks an authenticated active Hotel L&D Manager through the existing import manager assertion, and has no `PUBLIC` or `anon` execute grant.
- The approved classification is written in the existing `import_commits.approval_evidence` together with preview version/hash, effective date, actor and approval time, and is repeated in the existing append-only import activity evidence.
- An exact replay with identical approval evidence is idempotent. A changed baseline on a completed batch fails with `IMPORT_APPROVAL_EVIDENCE_MISMATCH`; it cannot rewrite the original approval decision.
- Employee writes remain delegated to the D0 controlled transaction. A successful commit creates the ordinary, effective-dated `Employee Fact Version`; a rejected classification leaves no employee or fact-version write.
- The browser and database pathways do not create Auth users, `user_accounts`, roles, employee login capability, or training-history / CTC / GTC data.

## Authorization and data boundary

- Hotel L&D Manager: the only hotel role that can stage, preview and commit a baseline through the server-authorized import path.
- Department Training Responsible Person: cannot enter `/import`, cannot see the workspace, and cannot upload/commit baseline evidence.
- Platform provisioner: separate platform cookie and control plane; cannot use it to enter `/import` or read hotel employee baseline work.
- Property context is server resolved; the browser supplies neither a property authority nor a department authorization proof. The declared baseline department is validated as active and in the batch's current tenant/property, but it grants no scope.
- Private workbook Storage stays on the existing tenant/property/batch private path. The C3 pgTAP flow stages a local synthetic file only through the approved Storage and staging boundary.

## Migration rehearsal and tests

| Verification | Result |
| --- | --- |
| Clean local Supabase reset, migrations through C3 | PASS |
| Local migration status | `20260730105126` applied locally; no remote or Production command used |
| Focused C3 pgTAP | PASS — 16 assertions |
| Full pgTAP suite | PASS — 26 files, 813 assertions |
| Application regression suite | PASS — 290 tests |
| Production build and rendered HTML verification | PASS |
| `git diff --check` | PASS |

Focused C3 database assertions cover: classified-RPC grant shape, no unclassified bypass, private staged source path, mapping and zero-write preview, no write before approval, Full boundary rejection, transaction rollback on invalid classification, `Pilot Limited` approval evidence, normal Employee Fact Version creation, no account creation, idempotent retry, and changed-evidence rejection.

## Browser verification

The local production build was verified via Playwright and synthetic local-review sessions only.

| Surface | Result |
| --- | --- |
| Manager login and employee update flow | PASS |
| Field/attribution/issue resolution to zero-write preview | PASS |
| Per-employee / per-field preview evidence before commit | PASS |
| Baseline classification + acknowledgement gate | PASS — acknowledgement alone leaves commit disabled |
| Commit and authoritative completed-batch reread | PASS — update history displays `Pilot Limited` boundary |
| Department direct route to `/import` | PASS — access-denied page, no import workspace rendered |
| Platform-provisioner direct route to `/import` | PASS — redirected to hotel login, no import workspace rendered |
| Desktop (1440px), tablet (1024px), mobile (390px) | PASS — no horizontal overflow; normal-zoom content is readable |
| Keyboard focus and C3 touch targets | PASS — visible C3 controls have at least 44px interactive targets |
| Console errors, failed requests, 4xx/5xx responses | PASS — none observed |

Desktop confirmation, desktop completed state, tablet confirmation, mobile confirmation, and department access-denied screenshots were inspected during the local review and then deleted with the local browser contexts and cookies. No reusable browser session, screenshot, automation token, or local server remains.

## C3 acceptance checklist

- [x] Private, property-scoped employee source evidence remains the sole upload/staging route.
- [x] Source file hash, recognition/mapping decisions, issues, zero-write preview, before/after changes and approval evidence remain reviewable.
- [x] No employee row or Employee Fact Version is written before explicit preview-bound manager approval.
- [x] No department, position, identity or status is guessed; unresolved data continues through the existing issue path.
- [x] Full, Restricted and Pilot Limited baseline states are explicit, validated and persisted as approval evidence.
- [x] Transactional commit retains D0 historical employee-fact semantics and authoritative reread.
- [x] No imported employee gains an Auth user or backend account.
- [x] Training history, attendance, completion, CTC/GTC and formula-derived learning data remain excluded.
- [x] Manager, department and platform authorization boundaries remain server enforced.
- [x] No Production migration, Production Supabase/data/account, DNS, environment-variable or Production deployment action occurred.
- [x] Recovery C4 was not started.

## Remaining boundary

This is a readiness control, not a real Pilot import. A real hotel baseline still requires explicit human business approval and an authorized property context before any real file may be staged. The next approved pilot-cycle phase must not begin from C3 automatically.
