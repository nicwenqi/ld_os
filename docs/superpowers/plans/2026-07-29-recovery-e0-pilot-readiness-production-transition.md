# Recovery E0 Pilot Readiness & Production Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the controls, rehearsal evidence, and explicit approval gates required to transition the validated D0–D4 training-fact system into a limited first-hotel pilot without creating new training business models or using Production as a test environment.

**Architecture:** E0 is an operational-release layer around the existing D0 employee facts, D1 requirement/eligibility versions, D2 plan/session/participant snapshots, D3 attendance facts, and D4 completion evidence. It creates source-controlled, redacted release controls and non-production verification; each remote schema, data, or traffic action remains a later human-approved gate.

**Tech Stack:** Next.js application and existing repository test harness, Supabase CLI/local Postgres/pgTAP, existing RLS/RPC/Storage boundary, Playwright CLI for protected non-production browser rehearsal, Markdown runbooks and Node-based source-boundary checks.

## Global constraints

- Do not implement D5 or add any training business fact, table, RPC behavior, UI flow, completion behavior, employee account, KPI, Health, Forecast, Risk, AI, dashboard, feedback, or reminder.
- Do not create a database migration in E0. Do not apply migrations, import employees, create accounts, deploy, change DNS/environment, or merge without later explicit approval.
- Production is never a rehearsal environment. No `db reset --linked`, seed, migration repair, raw workbook, credential, token, reusable browser session, or personal-data evidence may be used.
- Retain the D0–D4 immutable-version and append-only-audit contracts exactly. E0 must never turn Present into completion automatically or turn eligibility into assignment.
- Every implementation task first has a failing automated or reviewable check, then the smallest compliant artifact, then a targeted passing check. Keep changes documentation/tooling-only unless a safe source-boundary test requires a test-only script.
- Worktree: `/Users/hewenqi/Documents/Hotel L&D OS/.worktrees/recovery-d2-implementation` on a dedicated `codex/` E0 branch created only after implementation approval.

## Review gates

The plan deliberately separates local deliverables from remote actions:

| Gate | Deliverable | Approval needed to continue |
|---|---|---|
| E0-A | release manifest and environment checks | technical owner |
| E0-B | non-production migration rehearsal | technical owner + database owner |
| E0-C | pilot-property initialization request | explicit user approval + Hotel L&D Manager + database owner |
| E0-D | employee-baseline import verification request | explicit user approval + Hotel L&D Manager |
| E0-E | first-loop verification request | explicit user approval + Hotel L&D Manager + pilot owner |
| E0-F | pilot acceptance report | named business and product approvers |

Implementation must stop after E0-B until the user explicitly authorizes E0-C. E0-C/D/E are procedures and evidence templates now, not actions now.

## Proposed deliverable structure

```text
docs/recovery-e0/
├── release-manifest-template.md
├── production-alignment-runbook.md
├── rehearsal-runbook.md
├── pilot-authorization-runbook.md
├── employee-baseline-runbook.md
├── first-loop-runbook.md
├── security-verification-runbook.md
├── evidence-register-template.md
└── review-stop-e0-report-template.md
tests/
└── recovery-e0-readiness.test.mjs
```

Each runbook must have: purpose; preconditions; prohibited commands/actions; named owner; input and output evidence; stop conditions; privacy-redaction rules; explicit approver; and a one-way next gate. It must state **not performed** when a gate has not been approved rather than fabricating a completion result.

## Task 1: Release manifest and source-mode boundary

**Files:**

- Create: `docs/recovery-e0/release-manifest-template.md`
- Create: `tests/recovery-e0-readiness.test.mjs`
- Modify: `app/lib/environment.ts`
- Modify: `tests/environment.test.mjs`
- Modify: `package.json` to include the readiness test in the explicit standard test suite

- [ ] **Step 1: Write the failing source-boundary test.**

  Assert that the manifest template requires the substantive application SHA, branch, build identifier, ordered migration filenames/checksums, local reset/pgTAP/app/build/browser evidence, named owners, compatibility declaration, redaction statement, and `not performed` statements. Assert it rejects removal of substantive safety text, not merely metadata. Add an environment regression proving `APP_ENV=production` rejects `APP_DATA_MODE=hybrid` while local and Preview may retain their approved hybrid behavior.

- [ ] **Step 2: Run the focused test and confirm it fails because the template is absent.**

  Run: `node --test tests/recovery-e0-readiness.test.mjs`
  
  Expected: one or more assertions fail only for missing E0 artifacts.

- [ ] **Step 3: Create the release-manifest template.**

  Require `APP_ENV=production` and `APP_DATA_MODE=supabase` as the production mode declaration. Make the existing environment boundary fail closed for every non-Supabase Production data mode, without changing local or Preview hybrid behavior. Include an explicit forbidden-command list (`db reset --linked`, `--include-seed`, migration history repair, raw employee export) and a statement that the manifest author does not authorize production work.

- [ ] **Step 4: Re-run the focused test.**

  Expected: source-boundary/manifest assertions pass.

- [ ] **Step 5: Commit the documentation/tooling change.**

  ```bash
  git add docs/recovery-e0/release-manifest-template.md tests/recovery-e0-readiness.test.mjs package.json
  git commit -m "docs: add E0 release readiness controls"
  ```

## Task 2: Read-only production alignment and recovery controls

**Files:**

- Create: `docs/recovery-e0/production-alignment-runbook.md`
- Modify: `tests/recovery-e0-readiness.test.mjs`

- [ ] **Step 1: Extend the test with the required hold conditions.**

  Require manifest-vs-remote migration comparison, schema-drift recording, backup/recovery owner, explicit forward-correction default, and a stop for unexplained drift. Assert the runbook forbids remote reset, seed, migration repair, destructive correction, and mixing schema migration with employee import.

- [ ] **Step 2: Run the focused test; confirm the new assertions fail.**

  Run: `node --test tests/recovery-e0-readiness.test.mjs`

- [ ] **Step 3: Write the alignment runbook.**

  Keep all remote inspection commands as placeholders owned by the database owner; do not execute them during E0 implementation. Specify `db push --dry-run` as an inspection aid only after approved credentials/context, and record an explicit hold if any pending migration differs from the approved manifest.

- [ ] **Step 4: Re-run the focused test.**

  Expected: release and alignment assertions pass.

- [ ] **Step 5: Commit.**

  ```bash
  git add docs/recovery-e0/production-alignment-runbook.md tests/recovery-e0-readiness.test.mjs
  git commit -m "docs: define E0 production alignment gate"
  ```

## Task 3: Clean local and protected Preview rehearsal

**Files:**

- Create: `docs/recovery-e0/rehearsal-runbook.md`
- Modify: `tests/recovery-e0-readiness.test.mjs`

- [ ] **Step 1: Add test assertions for rehearsal coverage.**

  Require a clean local reset with non-identifying fixtures; D0–D4 pgTAP/application/build evidence; manager, scoped department, anonymous public QR, unrelated-department denial, deactivated-account denial, direct-route denial, private-storage denial, and append-only correction checks. Require cleanup of fixtures, browser sessions, tokens, and screenshots with personal data.

- [ ] **Step 2: Run test and verify failure.**

  Run: `node --test tests/recovery-e0-readiness.test.mjs`

- [ ] **Step 3: Create the rehearsal runbook.**

  Define the participant roles, safe fixture standard, desktop/tablet/mobile checks, no-console/no-failed-request/no-horizontal-overflow checks, and the redacted evidence register. State that a Preview proves only the deployed candidate’s experience; it cannot prove Production data or permissions.

- [ ] **Step 4: Execute focused test and full existing local verification.**

  Run the project’s clean local Supabase reset, D0–D4 pgTAP suite, application tests, production build, rendered-page test, and the focused readiness test. Run browser rehearsal only against local/Preview non-production context. Do not connect to Production.

- [ ] **Step 5: Commit and stop at E0-C.**

  ```bash
  git add docs/recovery-e0/rehearsal-runbook.md tests/recovery-e0-readiness.test.mjs
  git commit -m "docs: add E0 pilot rehearsal gate"
  ```

  Stop and submit the E0-C evidence plus a request for explicit authorization before any remote schema, baseline, or pilot activity.

## Task 4: Controlled employee baseline and finite activation procedure

**Files:**

- Create: `docs/recovery-e0/employee-baseline-runbook.md`
- Create: `docs/recovery-e0/pilot-authorization-runbook.md`
- Modify: `tests/recovery-e0-readiness.test.mjs`

- [ ] **Step 1: Add failing assertions.**

  Require private workbook handling, repeat inspection, field exclusions, no employee account creation, review-version/hash, zero-write preview, manager confirmation, authoritative reread, audit, no absence-implies-deactivation, and explicit blocked handling for unresolved department/position/identity rows. Require complete/limited/not-ready baseline classification and named authorization for a limited cohort.

- [ ] **Step 2: Run the focused test; confirm failure.**

  Run: `node --test tests/recovery-e0-readiness.test.mjs`

- [ ] **Step 3: Write both runbooks.**

  The authorization runbook lists the finite activation sections, manager protection, named department responsible accounts, explicit scopes/descendants, forbidden self-widening, no tenant UI, and the distinction between protocol approval and actual production execution.

- [ ] **Step 4: Run focused test.**

  Expected: E0 baseline/activation assertions pass.

- [ ] **Step 5: Commit, but do not run the procedure against Production.**

  ```bash
  git add docs/recovery-e0/employee-baseline-runbook.md docs/recovery-e0/pilot-authorization-runbook.md tests/recovery-e0-readiness.test.mjs
  git commit -m "docs: define E0 baseline and activation gate"
  ```

## Task 5: First closed-loop pilot protocol

**Files:**

- Create: `docs/recovery-e0/first-loop-runbook.md`
- Modify: `tests/recovery-e0-readiness.test.mjs`

- [ ] **Step 1: Add failing assertions for D0–D4 lineage.**

  Require: effective requirement and completion definition; accepted learning method; point-in-time eligibility; plan version/item; immutable session revision; participant snapshot; QR/manual attendance observation; explicit attendance determination; reviewable completion evidence; reviewed completion record; employee fact version and exact source lineage. Assert the protocol forbids automatic attendance-to-completion, assignment/reminder/KPI claims, and raw participant exports.

- [ ] **Step 2: Run focused test and confirm failure.**

  Run: `node --test tests/recovery-e0-readiness.test.mjs`

- [ ] **Step 3: Write the first-loop runbook.**

  It uses a business-approved limited cohort (normally 3–8 employees in one explicitly scoped department), not synthetic production data. Define stops for `Unable to Determine`, missing readiness, unresolved attendance conflict, unauthorized scope, or missing completion provenance. A rejected/revoked correction path is rehearsed only in non-production unless separately approved.

- [ ] **Step 4: Run focused test.**

  Expected: lineage and non-scope assertions pass.

- [ ] **Step 5: Commit.**

  ```bash
  git add docs/recovery-e0/first-loop-runbook.md tests/recovery-e0-readiness.test.mjs
  git commit -m "docs: define E0 first-loop pilot protocol"
  ```

## Task 6: Security evidence, Review Stop E0, and final verification

**Files:**

- Create: `docs/recovery-e0/security-verification-runbook.md`
- Create: `docs/recovery-e0/evidence-register-template.md`
- Create: `docs/recovery-e0/review-stop-e0-report-template.md`
- Modify: `tests/recovery-e0-readiness.test.mjs`

- [ ] **Step 1: Add failing assertions for final gating.**

  Require source-mode assertion, hostname/property isolation, RLS/RPC/Storage checks, account/membership/role/scope checks, anonymous and cross-department denial, stale/deactivated account denial, test-artifact cleanup, redaction, evidence timestamps, and an explicit Go/Conditional Go/No Go result with open risks and approvers.

- [ ] **Step 2: Run focused test; confirm failure.**

  Run: `node --test tests/recovery-e0-readiness.test.mjs`

- [ ] **Step 3: Create final runbooks/templates.**

  The security runbook should require policy/RPC assertions and no sensitive output. The review template must separate `verified`, `not performed`, `blocked`, and `accepted exception`; it must not imply Production actions occurred. Include an explicit confirmation that D5 did not start.

- [ ] **Step 4: Run final verification.**

  Run: focused readiness test; full application tests; clean local Supabase reset; full D0–D4 pgTAP suite; production build; rendered-page test; and local/Preview browser rehearsal. Run `git diff --check`. Record exact commands, result counts, build identifier, timestamp, and sanitized artifacts in the evidence register.

- [ ] **Step 5: Commit and submit Review Stop E0-C.**

  ```bash
  git add docs/recovery-e0 tests/recovery-e0-readiness.test.mjs
  git commit -m "docs: complete E0 pilot readiness controls"
  ```

  Report evidence, the current release commit, unresolved business decisions, and a `Go`/`Conditional Go`/`No Go` recommendation. Do not begin E0-D or any production operation without explicit approval.

## Final acceptance checklist

- [ ] The E0 artifacts make a production schema/data/traffic change impossible to mistake for a local or Preview rehearsal.
- [ ] The proposed remote migration path is manifest-controlled, read-only aligned first, non-destructive, and has forward-correction and restore decision rules.
- [ ] Employee baseline import is private, zero-write before approval, audit-backed, conflict-aware, and creates no employee user account.
- [ ] Finite hotel activation and manager/department scope initialization are understandable and server-authorized.
- [ ] A first real pilot can trace one reviewed completion through immutable D0–D4 facts without deriving KPI, Health, Forecast, Risk, AI, or training effectiveness.
- [ ] RLS/RPC/Storage, source-mode, property, role, scope, browser, accessibility, and cleanup evidence are complete or honestly marked not performed.
- [ ] D0–D4 contracts are unchanged; no migration or Production change occurred while implementing the E0 local deliverables.
- [ ] E0-C is reviewed before any E0-D, E0-E, or E0-F approval request.
