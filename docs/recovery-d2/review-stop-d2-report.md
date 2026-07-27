# Recovery D2 — Review Stop D2

Date: 2026-07-27
Branch: `codex/recovery-d2-implementation`
Implementation commit: `122ca20`

## Completed scope

Recovery D2 establishes the deterministic planning and session-readiness
foundation:

- stable Training Plan identity and immutable Plan Versions;
- plural Plan Items with requirement-delivery or development-delivery purpose;
- effective department terms and approval-time department snapshots;
- stable Session identity and immutable Session Revisions;
- explicit operational ownership through an active hotel role assignment;
- hotel-controlled trainer profiles and Course Version delivery approvals;
- hotel-controlled venues and publication-time venue evidence;
- target department scope and descendant behavior;
- zero-write participant preview using D1 tri-state Eligibility Evaluation;
- publication-time Participant Snapshots with Employee Fact Version dependencies;
- attendance-preparation configuration without attendance facts;
- append-only cancellation and operational audit evidence;
- manager-wide and server-derived department-scoped workflows.

D2 creates no attendance record, QR/token, completion evidence, feedback, KPI,
Health, Forecast, Risk, intervention or AI fact.

## Domain and lifecycle judgment

- A Training Plan is management intent and planned capacity. It is not a
  Session, attendance result, completion result or KPI contribution.
- Approved Plan Versions are immutable. A replacement approval supersedes the
  prior version without rewriting its Plan Items or department snapshots.
- A Session is the stable delivery identity. Time, venue, trainer and
  participant-readiness facts are stored in immutable Session Revisions.
- Publishing a replacement Session Revision supersedes the prior publication.
- Cancellation is an append-only event and does not rewrite the Published
  Session Revision.
- A cancelled Session is terminal for revision actions in the current D2
  workflow; a new delivery uses a new Session identity.
- Superseding a Plan Version does not strand an existing Session draft tied to
  the original immutable Plan Item.

## Participant and attendance boundary

- Requirement-delivery Sessions preserve the exact Requirement Version,
  Accepted Learning Method and Course Version.
- D1 Eligibility Evaluation remains `Eligible`, `Not Applicable` or
  `Unable to Determine`.
- Preview persists no participant snapshot.
- Publication stores every evaluated target candidate, its eligibility state,
  selection decision, reason and Employee Fact Version dependency.
- `Unable to Determine` remains explicit and unselected.
- Development Sessions use a selected audience and never claim D1 eligibility.
- Attendance preparation stores only the future capture mode and opening/closing
  window. It creates no attendance record or QR token.

## Authorization and isolation

- Hotel L&D Manager reads and maintains the hotel-wide D2 foundation through
  property-authorized RPCs.
- Department Training Responsible Person reads and maintains Sessions only
  through server-derived property and department scope.
- Department Session save and preview accept no browser-selected property.
- Department options, participants, owners and Sessions are constrained to
  explicitly authorized branches and configured descendants.
- Department role cannot maintain Training Plans, venues, trainer profiles or
  hotel-wide resources.
- All 17 D2 relations enable and force RLS.
- `anon` and `authenticated` have no direct table grants on D2 relations.
- Browser roles use narrow RPCs that re-check live account, membership, role,
  account status and department scope.
- Security-definer functions use an empty `search_path`; foreign-key paths have
  supporting indexes.

## User experience

- `/plans` is a real manager planning-governance workspace.
- `/sessions` is a real manager Session and resource-readiness workspace.
- `/department/sessions` always displays the server-confirmed active scope and
  breadcrumb.
- Save states show pristine, dirty, saving, saved, failed and conflict behavior,
  followed by authoritative re-read.
- Participant preview explicitly says zero-write and distinguishes selected,
  eligible and unable-to-determine employees.
- The navigation marks Plans and Sessions as connected foundations while
  Calendar, attendance, feedback, KPI and later operational modules remain
  unavailable.
- Production cannot select a mock D2 repository or silently show local-review
  D2 facts.

## Browser verification

Disposable local synthetic data only:

- manager User ID/password login and `/plans` passed;
- Plan draft save, authoritative re-read, Review and Approved transitions
  passed;
- Plan replacement preserved immutable prior meaning;
- Session draft save and zero-write participant preview passed;
- the preview created zero Participant Snapshot rows;
- publication stored two candidate snapshots, one selected Eligible employee,
  one unselected Unable-to-Determine employee and two Employee Fact Version
  dependencies;
- manager trainer and venue readiness view passed;
- department login and `/department/sessions` passed;
- department scope showed `房务部 › 前厅部` and only `前厅部`, `礼宾部`,
  `前台` as selectable departments;
- the department owner list contained only its authorized active role;
- direct department navigation to `/plans` and `/settings/hotel` resolved to
  `/access-denied`;
- desktop 1440×900, tablet 1024×768 and mobile 390×844 had no page-level
  horizontal overflow;
- visible mobile interactive targets met the 44 px target;
- keyboard focus showed a visible 3 px outline;
- the browser console contained no application errors;
- successful workflow requests returned HTTP 200.

Two browser-found defects were fixed:

1. cancelled Sessions no longer expose invalid repeat-cancel or new-revision
   controls;
2. an existing Session draft can still be maintained when its immutable Plan
   Item belongs to a subsequently superseded Plan Version.

The browser session, synthetic credentials, local authentication artifacts,
temporary TLS files and development server were removed after verification.

## Verification evidence

- Clean local Supabase reset: passed; all migrations replayed and seed completed.
- D2 pgTAP: 65 assertions passed.
- Full pgTAP: 20 files, 620 assertions passed.
- Application: 240 tests passed.
- Production build: passed.
- Rendered server HTML test: passed.
- ESLint: 0 errors; 3 inherited `no-img-element` warnings outside D2.
- Database lint: no D2 findings; one inherited Recovery C/D0 enum-assignment
  warning in `app_private.prepare_employee_import_preview_base`.
- Clean local schema: 17 D2 tables; all 17 enable and force RLS; zero direct
  `anon` or `authenticated` table grants.

## Migration and Production status

Proposed additive migration:

`20260727002833_recovery_d2_training_operations_foundation.sql`

The migration was applied and tested only on the disposable local Supabase
stack. It was not applied to Production. No Production data, real hotel
employees, users, accounts, deployment, DNS or environment variables changed.

No Preview or Production deployment was created.

## Remaining follow-ups

- The database aggregate supports multiple Plan Items, but the first manager
  editor intentionally maintains one item per edit surface. Before complex
  multi-item hotel plans are rolled out, add a dedicated add/remove/reorder
  Plan Item experience without changing the aggregate or version contracts.
- External trainers are supported by the model, while the initial workspace
  emphasizes employee-linked trainers. Add the complete external-trainer
  maintenance form only when a real hotel use case is approved.
- D3 must create attendance facts separately from
  `attendance_preparation_configs` and must preserve Session Revision,
  participant snapshot and Employee Fact Version references.

## D2 acceptance checklist

- [x] Training Plan identity and versioning
- [x] Plan Version and Plan Items
- [x] stable Session identity and immutable Session Revisions
- [x] Session ownership
- [x] trainer and Course Version readiness foundation
- [x] venue and resource readiness foundation
- [x] zero-write participant preview
- [x] publication-time Participant Snapshot
- [x] attendance preparation boundary only
- [x] manager hotel-wide workflow
- [x] department server-scoped workflow
- [x] D0 and D1 historical references preserved
- [x] immutable published/approved facts
- [x] no later training facts or intelligence scope
- [x] clean local migration, RLS, tests and production build
- [x] Production untouched

## Next gate

Recovery D2 is ready for review. D3 must not begin until Review Stop D2 is
explicitly approved. Production migration remains a separate approval gate.
