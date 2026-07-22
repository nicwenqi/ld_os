# Recovery D0 Trusted Foundation Gate Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every locally actionable Recovery C trust and authorization gate before any training-operation fact can be created.

**Architecture:** Keep the approved Recovery C import transaction and property isolation, then add deterministic row reprojection, reviewable preview evidence, database-recorded approval, append-only employee fact versions, and a single active-account/scope authorization contract. Direct browser DML against employee identity data is removed; all changes pass through audited functions. No training entity is introduced.

**Tech Stack:** Next.js/Vinext, React 19, TypeScript, Supabase Postgres 17, RLS, security-definer RPCs in a private implementation schema with explicit public wrappers, pgTAP, Node test runner.

## Global Constraints

- Do not create courses, plans, sessions, attendance, feedback, completion, KPI actuals, Health, Forecast, Risk, Intervention, or AI data.
- Do not upload or import the real hotel workbook.
- Do not apply any migration or data change to Production.
- Preserve exactly two authenticated hotel application roles and no employee accounts.
- Missing or uncertain facts remain blocked or unavailable; they never become zero or guessed values.
- Every schema change is additive or a reviewed privilege tightening migration and is verified from a clean local reset.

---

### Task 1: Field-decision authority and deterministic reprojection

**Files:**
- Modify: `app/services/import/workbook-parser.ts`
- Modify: `app/services/import/production-workbook-staging.ts`
- Modify: `app/components/import/FieldRecognitionStep.tsx`
- Test: `tests/recovery-d0-import-integrity.test.mjs`
- Test: `supabase/tests/recovery_d0_import_authority_test.sql`

**Interfaces:**
- Consumes: existing `ImportFieldMappingDecision` and immutable `raw_values`.
- Produces: server-authoritative `normalized_values` regenerated from confirmed mappings; excluded mappings remove their target values; duplicate confirmed targets fail.

- [ ] Write application and pgTAP tests proving a changed target and an exclusion alter the preview while employee rows remain untouched.
- [ ] Run the focused tests and confirm they fail because reprojection is absent.
- [ ] Add deterministic field normalization for text, dates, and approved employment statuses; rebuild batch source-label evidence after field decisions.
- [ ] Run focused tests until green.

### Task 2: Exact zero-write preview and approval evidence

**Files:**
- Modify: `app/repositories/contracts/import-repository.ts`
- Modify: `app/repositories/supabase/import-repository.ts`
- Modify: `app/repositories/mock/import-repository.ts`
- Modify: `app/services/import-service.ts`
- Modify: `app/components/import/EmployeeUpdatePreviewStep.tsx`
- Modify: `app/import/page.tsx`
- Modify: `app/recovery-c.css`
- Test: `tests/recovery-d0-preview-approval.test.mjs`
- Test: `supabase/tests/recovery_d0_import_authority_test.sql`

**Interfaces:**
- Produces `EmployeeUpdatePreview.rows`, each with employee number, action, field, before value, after value, reason, and effective date.
- Produces `previewHash`; `commitBatch(batchId, version, previewHash, acknowledged)` records the exact approved version and rejects missing/stale approval.

- [ ] Write failing tests for row-level differences, review hash, effective date, and database-enforced acknowledgement.
- [ ] Implement safe preview-row projection without returning raw workbook values.
- [ ] Store approval actor, timestamp, preview version/hash, effective date, and approved summary in immutable commit evidence.
- [ ] Render progressive-disclosure preview rows and status-treatment availability truthfully.
- [ ] Verify focused application and pgTAP tests.

### Task 3: Remove employee write bypasses

**Files:**
- Modify: `app/repositories/contracts/employee-repository.ts`
- Modify: `app/repositories/supabase/employee-repository.ts`
- Modify: `app/repositories/mock/employee-repository.ts`
- Test: `tests/recovery-d0-employee-boundary.test.mjs`
- Test: `supabase/tests/recovery_d0_employee_security_test.sql`

**Interfaces:**
- Employee repository remains read-only for application consumers.
- Browser roles have `SELECT` only on employee master data; employee and external-identifier writes occur only inside audited security-definer operations.

- [ ] Write tests proving direct manager INSERT/UPDATE/DELETE fails for employees and identifiers.
- [ ] Remove unused mutation methods from repository contracts and implementations.
- [ ] Revoke table DML and drop permissive insert/update policies while preserving manager reads and department RPC reads.
- [ ] Verify commit and guarded correction functions still write transactionally.

### Task 4: Employee fact versions and lifecycle semantics

**Files:**
- Test: `supabase/tests/recovery_d0_employee_lifecycle_test.sql`
- Modify: new D0 migration created by `supabase migration new recovery_d0_trusted_foundation_gate`.

**Interfaces:**
- Produces append-only `employee_fact_versions` with employee UUID, employee number, department, operational unit, position, family, employment status, effective date, recorded version, source commit/item, actor, and reason.
- Produces point-in-time resolver returning the latest recorded fact effective on a requested business date.

- [ ] Write failing pgTAP tests for baseline facts, transfer/status changes, same-day corrections, append-only evidence, and point-in-time resolution.
- [ ] Add the append-only fact-version table, indexes, RLS, grants, and deterministic resolver.
- [ ] Record a fact version for every committed insert/update and every guarded revert; unchanged/excluded rows create no lifecycle event.
- [ ] Derive new-employee qualification from hire date, observation date, and the relevant property rule rather than trusting persisted `is_new_employee`.
- [ ] Define employee-number changes as guarded forward corrections using immutable employee UUID and identity history; never merge by name.

### Task 5: Unified authorization and downstream-safe correction

**Files:**
- Test: `supabase/tests/recovery_d0_authorization_test.sql`
- Modify: D0 migration.

**Interfaces:**
- Produces one property-role assertion requiring active account, unlocked account, active profile, tenant membership, property membership, active role, and active property/tenant.
- Produces one department-scope assertion adding active scope plus exact/descendant evaluation.

- [ ] Write failing tests for suspended/locked/disabled accounts, revoked memberships, inactive roles/scopes, exact scope, and descendants.
- [ ] Implement unified private authorization helpers and make existing property/department helpers delegate to them.
- [ ] Add a dependency registry contract so employee-import revert refuses destructive rollback once future downstream facts register an employee reference; absent downstream tables remain an explicit empty registry.
- [ ] Verify no hotel-user platform workspace or employee account path is introduced.

### Task 6: Full verification and review stop

**Files:**
- Create: `docs/recovery-d0/review-stop-d0-report.md`
- Update: this plan checklist.

- [ ] Run a clean local Supabase reset.
- [ ] Run every pgTAP file and confirm all assertions pass.
- [ ] Run Storage integration tests.
- [ ] Run `npm test`, `npm run lint`, and the production build.
- [ ] Run database security/advisor checks where available and record any tool limitation honestly.
- [ ] Confirm no training table, real workbook, Auth user, Production migration, Production data, DNS, or deployment mutation occurred.
- [ ] Commit the complete D0 changes on `codex/recovery-d0` and stop before D1.
