# Review Stop D3 — Trusted Attendance Facts

**Status:** PASS — the existing D3 implementation remains within the approved Attendance Fact boundary and passed fresh database, application, build, and lint verification on 2026-08-01.

## Execution note

The current branch already contained the reviewed D3 implementation before this verification run:

- `3f775fd feat: implement trusted D3 attendance facts`
- `671a937 fix: close D3 attendance review gates`

Both commits are ancestors of the current branch. This run therefore did not duplicate the implementation, alter the C5 design, or create another migration. It verified the existing implementation and recorded the result.

## Completed D3 scope

D3 establishes an independent operational fact layer answering only:

> 某员工是否参加了某次不可变培训交付。

The implemented lineage is:

```text
Published Session Revision
  → Participant Snapshot
  → Attendance Register
  → Observation / Evidence
  → Attendance Determination
```

The determination vocabulary remains exactly:

- `present`
- `absent`
- `excused_absence`
- `unable_to_determine`

No late-minute, score, attendance-rate, reliability, HR attendance, payroll, performance, Completion, KPI, Health, Forecast, Risk, intervention, Feedback, or AI fact belongs to D3.

## Fact and lifecycle boundaries

- One register is bound to one immutable published Session Revision.
- Employee-bearing attendance facts preserve Participant Snapshot and Employee Fact Version lineage.
- QR submission creates an Observation only. It does not create `present`, Completion, or Requirement fulfillment.
- Manual Witness records its Observation, Evidence, Determination, and lineage atomically through the controlled RPC boundary.
- Corrections append superseding facts; historical evidence is not edited in place.
- Supplemental Participant Snapshot requires a reason, authorizer, Requirement Eligibility impact, and follow-up-review flag.
- A register may close with `absent`, `excused_absence`, `unable_to_determine`, or participants without a determination.
- A register cannot close with unresolved observation conflicts or a broken required evidence chain.
- Reopening is a reasoned, authorized, audited action.

## Migration and database surface

D3 uses the existing migration:

`supabase/migrations/20260727142926_recovery_d3_attendance_facts.sql`

No migration was created or changed in this run. The existing additive D3 surface includes:

- `attendance_registers`
- `attendance_register_events`
- `attendance_evidence`
- `attendance_observations`
- `attendance_determinations`
- `attendance_determination_observations`
- `attendance_checkin_grants`
- `attendance_checkin_attempts`
- the reviewed supplemental/publication provenance extension to `session_participant_snapshots`

All exposed D3 relations retain RLS enforcement and direct business DML remains closed. Privileged operations use the reviewed RPC boundary with explicit execution grants and fixed/empty search-path protection.

## Authorization result

- Hotel L&D Manager: may manage registers and attendance facts across the authorized hotel property.
- Department Training Responsible Person: uses the server-derived department projection and descendants rule; no browser-selected property or scope can widen access.
- Public QR participant: may submit only the constrained opaque-token observation request and receives no backend navigation or employee directory.
- Platform identity: receives no hotel Attendance authority.
- Ordinary employees: receive no backend account.

The current authorization model preserves property isolation and prevents cross-department employee disclosure through Attendance projections.

## User experience result

The existing role-aware Attendance workspace supports the approved operating sequence:

```text
选择已发布场次
  → 打开登记册
  → 人工见证或接收 QR Observation
  → 核对异常与冲突
  → 作出轻量 Attendance Determination
  → 关闭登记册
  → 经授权后按理由重开
```

Manager and Department pages share the same business language while receiving different server-authorized projections. Feedback remains truthfully unavailable. Responsive source contracts retain visible focus, 44 px touch targets, mobile participant cards, and no fixed-width register dependency.

The previously accepted D3 browser closure is not regenerated or embellished in this run. No new browser screenshot, console, network, duration, or responsive claim is added. C5 remains Conditional Pass with its separate browser-evidence debt, as explicitly approved.

## Fresh verification evidence — 2026-08-01

| Verification | Result |
| --- | --- |
| Existing worktree/branch isolation | PASS — linked worktree on `codex/recovery-e0-pilot-readiness`; clean before verification. |
| Focused D3/application boundary tests | PASS — 31/31. |
| Clean local Supabase reset | PASS — all existing migrations replayed with repository synthetic seed only. |
| Focused D3 pgTAP | PASS — 66/66. |
| Complete pgTAP suite | PASS — 28 files, 853/853. |
| Database lint | PASS with one inherited Recovery C warning in `app_private.prepare_employee_import_preview_base`; no D3 finding. |
| Complete application suite | PASS — 293/293. |
| Production build | PASS. |
| Rendered HTML test | PASS — 1/1. |
| ESLint | PASS — 0 errors; 4 inherited warnings outside D3. |
| Local cleanup | PASS — local Supabase stopped without backup after verification. |

## D3 acceptance checklist

- [x] Attendance references immutable Session Revision.
- [x] Employee attendance facts reference Participant Snapshot and Employee Fact Version lineage.
- [x] Attendance remains separate from Completion.
- [x] Only the four approved determinations exist.
- [x] QR Observation never automatically creates `present`.
- [x] Manual Witness remains a lightweight, atomic evidence path.
- [x] Supplemental participants retain all four governance facts.
- [x] Register closure allows incomplete determinations but blocks unresolved conflicts and broken evidence.
- [x] Corrections, closure, and reopening retain append-only audit meaning.
- [x] Manager and Department permissions use separate server-authorized projections.
- [x] Public check-in exposes no employee browsing or hotel backend access.
- [x] No new Completion, KPI, Health, Forecast, Risk, Feedback, AI, or intervention behavior was introduced.
- [x] No new migration, Production change, real employee data, or real training fact was created.

## Boundary confirmation

- C5 was not modified and remains Conditional Pass.
- No new D3 business fact was created outside rollback-bound local synthetic database tests.
- No D4 code or fact model was changed in this run.
- Production Supabase, Production deployment, DNS, environment variables, real hotel data, and real users were untouched.

