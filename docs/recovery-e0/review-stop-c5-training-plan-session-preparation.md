# Review Stop C5 — Training Plan and Session Preparation

**Status:** Conditional pass — database, application and build evidence pass; browser execution evidence remains unavailable in the current isolated local-browser environment.

## Scope completed

C5 reuses the reviewed D1/D2 model without a schema change:

```text
Effective Requirement Version
  → approved Course Version learning method
  → Training Plan / immutable Plan Version / Plan Item
  → Session Draft / immutable Session Revision
  → zero-write Participant Snapshot preview
  → published preparation snapshot
```

- A `Requirement` remains the hotel obligation. A Course Version is only an accepted delivery method.
- Requirement-delivery plans and sessions require an accepted `course_version` method. External certificate, controlled assessment and manager-equivalency methods do not auto-create a Course, Plan or Session.
- A published Session Revision means **准备交付** only. It freezes preparation evidence and Participant Snapshot context; it creates no Attendance Observation, Attendance Evidence, Attendance Determination, Completion Evidence or Completion Record.
- Participant Snapshot preview stays zero-write. Published snapshots retain Employee Fact Version dependencies and the three-state Eligibility outcome from the immutable Requirement Version context.
- Manager operations remain hotel-wide through manager RPCs. Department Training Responsible Persons use the server-derived property and permitted department descendants only. Platform identities have no hotel business RPC path.

## Product changes

The existing Plan and Session workspaces are now explicit about the operational boundary:

- `培训计划` explains that only an accepted published Course Version can become a requirement-delivery plan and that non-session completion methods never auto-generate delivery facts.
- Manager and Department Session preparation state that publication means `已准备交付` and does **not** create attendance, check-in or completion facts.
- Existing source tests expecting a future attendance handoff were corrected to the approved C5 truth boundary.

No Course, Requirement, Plan, Session, Attendance or Completion business record was created outside rollback-bound synthetic test execution.

## Data model and migration status

**No migration was required or created.** C5 uses the existing additive D2 tables, immutable-version triggers, append-only audit events, RLS policies and guarded RPCs:

- `training_plans`, `training_plan_versions`, `training_plan_items`
- `training_sessions`, `training_session_revisions`
- `trainer_profiles`, `trainer_course_approvals`, `training_venues`
- `session_participant_snapshots`, `attendance_preparation_configs`
- `training_operation_audit_events`

The focused C5 pgTAP gate confirms that the public write path is RPC-only, each relevant relation forces RLS, publication does not reference `attendance_records`, `attendance_determinations` or `completion_records`, and the reviewed immutable-version protection triggers remain present.

## Verification evidence

| Check | Result |
| --- | --- |
| Clean local migration replay, no seed | PASS — all existing migrations replayed in a disposable local database; no C5 migration exists. |
| Focused C5 pgTAP | PASS — 20 assertions. |
| Full pgTAP after the repository's synthetic local seed | PASS — 28 files, 853 assertions. |
| C5 / D2 focused application tests | PASS — 7 tests. |
| Full application suite | PASS — 293 tests. |
| Production build | PASS. |
| Rendered HTML test | PASS. |
| Lint | PASS — 0 errors; 4 inherited warnings outside C5 (one unused import and three existing image-optimization notices). |

The initial unseeded full-pgTAP attempt failed because legacy test files intentionally rely on the repository's synthetic `profiles` fixtures. The no-seed migration replay itself succeeded. The full suite was then rerun with the documented local synthetic seed and passed.

## Browser evidence limitation

Browser interaction was attempted against an isolated local development server. The browser runtime cannot route to the workspace's localhost service. The safe alternative of converting rollback-bound test fixtures into committed local business facts was rejected by the environment because it would violate the no-fake-business-facts / no-direct-DML boundary.

Therefore, **no desktop, tablet or mobile browser interaction evidence is claimed** for C5. There are no screenshots, no browser console result and no browser network result to present. The current evidence covers behavior through guarded RPC pgTAP, source-level UI contracts, full application tests, build and rendered-page output only.

To convert this Review Stop from Conditional Pass to Pass, use an approved non-production browser-accessible environment containing only manager-approved synthetic fixture data created through the normal controlled flow, then verify manager Plan → Session → zero-write Participant Snapshot → publish preparation and Department scope denial at desktop, tablet and mobile widths. That work must still not create Attendance or Completion facts.

## C5 acceptance checklist

- [x] Plan identity, version and item reuse immutable D2 facts.
- [x] Requirement-delivery Plan Item preserves exact Requirement Version, Accepted Learning Method and Course Version references.
- [x] Session Revision preserves immutable Plan Item, Course Version, owner, trainer approval, venue and resource-readiness evidence.
- [x] Participant Snapshot preview is zero-write and published Snapshot preserves Employee Fact Version and Eligibility context.
- [x] Published Session Revision is preparation only, not attendance or completion.
- [x] Manager authority and Department server-derived scope are covered by the D2/C5 database and application suites.
- [x] Platform identity remains outside hotel business operations under C0 regression coverage.
- [x] No migration, Production change, fake hotel fact, Attendance or Completion implementation was introduced.
- [ ] Desktop/tablet/mobile interactive browser evidence — blocked by the isolated browser network and no-fake-fixture boundary.

## Boundary retained

C5 does not introduce Attendance Observation, Attendance Evidence, Attendance Determination, Completion Evidence, Completion Record, KPI, Forecast, Risk, Health, Feedback, AI or Reminder behavior. It stops at Review Stop C5 and does not enter Attendance.
