# Review Stop C — Trusted Employee Data Update and People Foundation

Review date: 2026-07-18  
Branch: `codex/recovery-c`

## 1. Final employee-data-update journey

The manager journey is a finite seven-step hotel workflow: 文件检查 → 字段识别 → 部门归属确认 → 职位归属确认 → 数据问题处理 → 更新预览 → 确认更新. File inspection and every manager decision remain separate from employee-master writes. Each decision save uses an authoritative base version, persists through a repository/service boundary and rereads current server state. The final confirmation is disabled until the server preview has no blocking or unresolved rows and the manager explicitly acknowledges the exact update scope.

## 2. Approved real-workbook inspection

The approved legacy workbook was inspected locally and never uploaded to Preview or Supabase. Aggregate-only evidence: 196 employee candidates; 194 structurally valid; 2 rows missing department after normalization; 0 missing employee numbers; 0 missing positions; 0 duplicate employee numbers; 196 valid hire dates; 196 valid probation/confirmation dates; 30 department source labels; 113 position source labels; 13 excluded columns. Employee numbers remained text and preserved leading zeroes. Zero employee rows were written.

## 3. Field recognition and exclusions

Recognized employee-master targets are employee number, Chinese name, English name, department source label, position source label, grade/band, hire date and probation/confirmation date. Gender, orientation/training tracking, onboarding/training completion, leadership journey, problem handling, first aid, formula-derived CTC and formula-derived GTC are excluded. The CTC and GTC tracking sheets are excluded. Excluded values never enter raw/normalized staging, employees or any training-operation table.

## 4–6. Department and position attribution

Department and position source labels are resolved inside the employee-update journey. The manager must associate each source label with an active official department/position, explicitly exclude affected rows or defer the decision. There is no silent guess. The real workbook's 30 department and 113 position labels still require the manager's business decisions; therefore a truthful final real-workbook update preview cannot be claimed yet.

The two rows with missing normalized departments remain blocked. Each requires an explicit official-department correction, explicit exclusion or deferral. Neither row can enter the employee master while unresolved.

## 7. Row identity and validation handling

- Missing employee numbers are blocked and never become generated identities.
- Every row sharing a duplicate employee number is blocked; the system does not choose a winner.
- Employee numbers remain external text identifiers, including leading zeroes.
- Ambiguous/invalid dates become issues rather than guessed dates.
- Conflicting target-field recognition is rejected.
- Unresolved department/position values block commit unless explicitly excluded.
- Absence from one workbook never silently deactivates an existing employee.

## 8–9. Zero-write preview and explicit confirmation

The protected end-to-end review fixture produced this server preview: 18 additions, 7 updates, 91 unchanged, 3 exclusions, 0 blocked and 0 unresolved. This fixture is visibly labelled local review data and cannot be selected in Production. Before the explicit checkbox was selected, the commit button remained disabled and the employee master remained unchanged. Browser evidence records authoritative versions 1–6 before commit and version 7 after commit.

The real workbook has no final preview yet because 30 department and 113 position decisions are still pending; presenting a made-up real preview would violate the product's truthfulness contract.

## 10–12. Commit, audit and correction guarantees

Commit is manager-only and transactional. It validates property/actor, current batch version, saved field decisions, saved attribution decisions, row resolutions, preview version and explicit acknowledgement before applying additions/updates. Unchanged and excluded rows are not written. Audit evidence records the batch, actor, property, row-level before/after evidence and counts. A post-commit authoritative reread confirms batch status and audit evidence.

Revert begins with a zero-write preview. It restores an audited before-state or deactivates a newly added record only when the current employee version still matches the committed evidence. Later changes create conflicts and block overwrite. The audit trail is retained. When reversal is unsafe or inappropriate, a later employee update provides a forward-correction path.

## 13–15. People Center and account boundary

The manager People Center uses the authorized current-property employee repository with server pagination, search and business filters. It shows identity, official department, position/family, hire/confirmation dates and effective status; training history is explicitly unavailable.

The department People Center uses only server-resolved authorized department branches and descendants. Browser verification showed employee `0007` in the authorized Front Office branch and hid unrelated Engineering employee `0012`. The department role cannot access raw workbooks or `/import` and was redirected to `/access-denied`.

Employee commit tests prove that `auth.users`, backend `user_accounts`, memberships and role assignments are unchanged. Imported employees never receive application accounts.

## 16–18. Exclusions, migrations and security

Training history, CTC/GTC completion, attendance, feedback, KPI, risk and forecasting data remain absent. Six additive migrations are proposed locally/for Preview only:

- `20260716134322_recovery_c_employee_update_integrity.sql`
- `20260716143542_recovery_c_actor_scoped_import_staging.sql`
- `20260716144503_recovery_c_transaction_integrity_followup.sql`
- `20260716151459_recovery_c_remaining_import_bypasses.sql`
- `20260716152053_recovery_c_private_workbook_cleanup.sql`
- `20260716155714_recovery_c_workbook_exclusion_alignment.sql`

Local verification covers property/tenant isolation, actor-scoped staging, manager-only RPCs, private Storage object ownership and exact-path cleanup, department-scope reads, optimistic concurrency, explicit-confirmation commit and guarded revert. Security advisor reported no issues. No proposed migration was applied to Production.

## 19. Browser and visual evidence

Evidence lives in `artifacts/recovery-c-browser/`. Desktop screenshots cover all seven update stages, zero-write preview, explicit confirmation, completion, audit history, revert preview, manager People Center and department-scoped People Center. Tablet screenshots cover the update entry and People Center. Mobile screenshots cover update entry, People Center summary and records, plus the department-role forbidden route.

At 1280/1440, 1024 and 390 px, verified pages had no horizontal overflow. Normal headings measured 29–40 px. The mobile access-denied card measures 354 px within a 390 px viewport, with 46 px actions. The smallest observed People action is 35 px, above WCAG 2.2's 24 px minimum; primary form and route actions use 44–48 px targets. Focus visibility is present, and closing the revert dialog restored focus to its trigger.

## 20–21. Local verification

- Clean local Supabase reset: passed.
- pgTAP: 17 files, 478/478 passed.
- Storage integration: 3/3 passed on two runs.
- Application tests: 197/197 passed.
- Rendered HTML: 1/1 passed.
- Production build: passed.
- ESLint: 0 errors; 3 existing `next/image` advisory warnings.
- Browser console: 0 warnings and 0 errors in the final session.
- Local application requests observed during the final route flow: all successful; no failed app request.
- Horizontal overflow: none at the tested desktop/tablet/mobile viewports.

Three genuine defects were fixed through regression tests: local-review department data widening beyond the authorized branch; mobile access-denied intrinsic-width collapse; and browser-default GET semantics on the pre-hydration login form. The login form now declares POST fallback semantics.

## 22–25. Preview, source and production protection

Protected Preview: `https://hotel-ld-im6w6rzdz-nicwenqis-projects.vercel.app` (`dpl_9T1umF1kSKZnjAyhUwvjJuJCxGQy`, Ready, target Preview). Project inspection confirms Vercel SSO deployment protection with `all_except_custom_domains`. Local-review fixtures are guarded by environment validation and cannot silently activate in Production. Browser screenshots were captured from the exact local application source; the approved real workbook remained outside Git and Preview.

Production Supabase, Production employees, accounts, properties, departments, positions, scopes, DNS, Vercel Production configuration and Production deployment were untouched. No branch was merged. Recovery D was not started.
