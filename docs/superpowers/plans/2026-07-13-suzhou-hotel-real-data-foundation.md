# Checkpoint 2C — Suzhou Hotel Real-Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current Suzhou hotel usable with real property settings, organization, position, employee, and audited import data while preserving the approved Milestone 1 experience and Checkpoint 2B.1 security foundation.

**Architecture:** Keep the existing tenant/property/membership/RLS schema and add a property-scoped real-data vertical slice. Repository contracts isolate Supabase from page components; hybrid mode routes Settings, organization management, mappings, People, and Import to Supabase while training and analytical modules remain explicitly identified mock experiences. All schema and policy work is migration-first, tested from a clean local Supabase database, and stopped before production application.

**Tech Stack:** Existing vinext/React/TypeScript application, Supabase Postgres 17, Auth, Storage, Edge Functions for controlled workbook processing, pgTAP, Node test runner, and pinned workbook parsing dependency selected through the legacy `.xls` compatibility gate.

## Global Constraints

- Stay within Checkpoint 2C; do not implement broad group or multi-property product UI.
- Preserve all Checkpoint 2B.1 migrations, tables, helpers, RLS policies, and tests.
- Keep multi-property isolation in every new table and foreign key.
- Do not apply migrations, seeds, buckets, functions, or users to production without explicit approval.
- Do not import real hotel data during implementation verification.
- Use synthetic local property data only in Review Stop 2C-A; do not commit the real hotel name, code, domain, logo, administrator identity, or employee data.
- Do not commit real workbook contents, hotel employee data, credentials, database passwords, or secret/service-role keys.
- Use `APP_DATA_MODE=hybrid`; keep current deployed behavior unchanged until a separately approved deployment.
- Treat ChatGPT Sites as design/prototype preview only; do not depend on Sites-specific runtime behavior.
- Keep the production frontend independently deployable from GitHub `nicwenqi/ld_os`.
- Do not select or provision a production hosting provider, change DNS, publish, or deploy during Checkpoint 2C.
- Never put Supabase queries inside page components.
- Never authorize from `user_metadata` or caller-supplied user IDs.
- Enable and force RLS on every exposed table.
- Every `UPDATE` policy uses both `USING` and `WITH CHECK`.
- Preserve employee numbers as text and retain leading zeros.
- Do not import training history, CTC/GTC completion, courses, sessions, attendance, feedback, or KPI actuals.
- Keep Chinese first and English quiet and secondary.
- Every primary action must produce a visible state, dialog, route, confirmation, or validation result.
- Each task follows red-green-refactor and ends with a focused commit only after tests pass.

---

## Proposed File Structure

```text
app/
  lib/
    environment.ts                         # Existing validated mode configuration
    property-context.ts                    # Safe hostname normalization and context result
    supabase/
      browser.ts                           # Browser client with publishable key only
      types.ts                             # Generated database types
  repositories/
    contracts/
      property-repository.ts
      department-repository.ts
      position-repository.ts
      employee-repository.ts
      import-repository.ts
      models.ts
    mock/
      property-repository.ts
      department-repository.ts
      position-repository.ts
      employee-repository.ts
      import-repository.ts
    supabase/
      property-repository.ts
      department-repository.ts
      position-repository.ts
      employee-repository.ts
      import-repository.ts
    registry.ts                             # Per-module mock/real selection
  services/
    property-settings-service.ts
    organization-service.ts
    mapping-service.ts
    employee-service.ts
    import-service.ts
  settings/hotel/page.tsx
  organization/manage/page.tsx
  organization/mapping/departments/page.tsx
  organization/mapping/positions/page.tsx
  people/page.tsx                          # Refactor existing page to EmployeeRepository
  import/page.tsx                          # Refactor existing mock workflow to ImportRepository
  components/
    settings/*
    organization/*
    mapping/*
    people/*
    import/*
tests/
  repository-registry.test.mjs
  property-context.test.mjs
  property-settings.test.mjs
  department-management.test.mjs
  mapping-workflows.test.mjs
  employee-repository.test.mjs
  import-workflow-real.test.mjs
  hybrid-boundaries.test.mjs
  deployment-readiness.test.mjs
supabase/
  migrations/
    *_property_context_and_settings.sql
    *_property_branding_storage.sql
    *_department_hierarchy_and_operational_units.sql
    *_positions_and_employee_master.sql
    *_import_staging_and_audit.sql
    *_organization_and_import_functions.sql
    *_checkpoint_2c_rls_and_storage_policies.sql
  functions/
    process-employee-workbook/
      index.ts
      parser.ts
      mapping.ts
      validation.ts
  tests/
    tenancy_rls_test.sql                   # Existing 37 tests remain unchanged
    property_settings_rls_test.sql
    department_hierarchy_test.sql
    department_scope_rls_test.sql
    employee_rls_test.sql
    import_security_test.sql
    storage_security_test.sql
  seed.sql                                 # Synthetic local data only
```

## Locked repository interfaces

```ts
export type PropertyContext = {
  tenantId: string;
  propertyId: string;
  hostname: string;
  nameZh: string;
  nameEn: string;
  shortName: string;
  logoUrl: string | null;
};

export interface PropertyRepository {
  resolveContext(hostname: string): Promise<PropertyContext | null>;
  getSettings(propertyId: string): Promise<PropertySettings>;
  saveIdentity(input: SavePropertyIdentityInput): Promise<PropertySettings>;
  saveBusinessRules(input: SaveBusinessRulesInput): Promise<PropertySettings>;
  uploadLogo(input: UploadPropertyLogoInput): Promise<PropertyBrandAsset>;
}

export interface DepartmentRepository {
  listTree(propertyId: string, includeInactive?: boolean): Promise<DepartmentNode[]>;
  previewMove(input: PreviewDepartmentMoveInput): Promise<DepartmentMoveImpact>;
  move(input: MoveDepartmentInput): Promise<DepartmentNode[]>;
  create(input: CreateDepartmentInput): Promise<DepartmentNode>;
  update(input: UpdateDepartmentInput): Promise<DepartmentNode>;
  setActive(input: SetDepartmentActiveInput): Promise<DepartmentNode>;
  reorder(input: ReorderDepartmentsInput): Promise<DepartmentNode[]>;
}

export interface PositionRepository {
  list(propertyId: string): Promise<HotelPosition[]>;
  listFamilies(propertyId: string): Promise<PositionFamily[]>;
  listSourceLabels(batchId: string): Promise<PositionSourceLabel[]>;
  resolveSourceLabel(input: ResolvePositionLabelInput): Promise<PositionResolution>;
}

export interface EmployeeRepository {
  search(input: EmployeeSearchInput): Promise<EmployeePage>;
  get(employeeId: string): Promise<EmployeeDetail>;
  updateMaster(input: UpdateEmployeeMasterInput): Promise<EmployeeDetail>;
}

export interface ImportRepository {
  createBatch(input: CreateImportBatchInput): Promise<ImportBatch>;
  uploadFile(input: UploadImportFileInput): Promise<ImportBatch>;
  processWorkbook(batchId: string): Promise<ImportBatch>;
  listSourceLabels(batchId: string, type: "department" | "position"): Promise<SourceLabel[]>;
  resolveLabel(input: ResolveSourceLabelInput): Promise<SourceLabel>;
  validate(batchId: string): Promise<ImportValidationSummary>;
  commit(batchId: string): Promise<ImportCommitSummary>;
  previewReversal(batchId: string): Promise<ImportReversalPreview>;
  reverse(batchId: string, previewToken: string): Promise<ImportCommitSummary>;
}
```

---

## Review Stop 2C-A — Property context and repository foundation

### Task 1: Lock hotel decisions and hybrid boundaries

**Files:**
- Create: `docs/checkpoint-2c/suzhou-property-decision-record.md`
- Modify: `.env.example`
- Test: `tests/environment.test.mjs`, `tests/hybrid-boundaries.test.mjs`

**Interfaces:**
- Produces the approved non-secret property identity values used for local fixtures and later production initialization.
- Produces environment validation for `APP_DATA_MODE=hybrid` and the one primary development/preview hostname.

- [ ] **Step 1: Record synthetic local fixture values** for bilingual names, short name, code, brand, city, hostname, new-employee days, probation meaning, employee-status source, and CTC/GTC settings. Keep all real hotel decisions deferred to the administrator workflow.
- [ ] **Step 2: Write failing environment tests** requiring hybrid mode to have URL, publishable key, base domain, and exactly one valid development hostname while rejecting secret/service-role variables exposed through `NEXT_PUBLIC_*`.
- [ ] **Step 3: Write failing boundary tests** asserting only Settings, organization management, mappings, People, and Import select real repositories in hybrid mode.
- [ ] **Step 4: Run** `node --test tests/environment.test.mjs tests/hybrid-boundaries.test.mjs`; expect failures for missing hybrid registry behavior.
- [ ] **Step 5: Extend `.env.example` and environment parsing** without adding real credentials. Keep mock as the default when `APP_DATA_MODE` is absent.
- [ ] **Step 6: Run focused tests and `npm run build`**; expect both to pass.
- [ ] **Step 7: Commit** with `docs: lock Suzhou property decisions and hybrid boundaries`.

### Task 2: Add repository contracts and mode registry

**Files:**
- Create: `app/repositories/contracts/*.ts`
- Create: `app/repositories/mock/*.ts`
- Create: `app/repositories/registry.ts`
- Test: `tests/repository-registry.test.mjs`

**Interfaces:**
- Produces the five locked repository contracts above.
- Produces `createRepositoryRegistry({ dataMode, supabaseClient })`.

- [ ] **Step 1: Write failing registry tests** proving mock mode returns only mock repositories and hybrid mode returns real repositories only for the five approved modules.
- [ ] **Step 2: Assert dashboard, calendar, session, QR, risk, course, and KPI data continue resolving through existing mock modules.**
- [ ] **Step 3: Run** `node --test tests/repository-registry.test.mjs`; expect failure because the contracts and registry do not exist.
- [ ] **Step 4: Define DTOs and repository interfaces** without importing React or Supabase types into contract files.
- [ ] **Step 5: Implement mock adapters** around the existing `app/data` fixtures so current behavior remains unchanged.
- [ ] **Step 6: Implement the registry** with an exhaustive `mock | hybrid | supabase` switch and no implicit fallback from a failed real repository to mock employee data.
- [ ] **Step 7: Run focused tests, full tests, and build.**
- [ ] **Step 8: Commit** with `feat: add hybrid repository contracts`.

### Task 3: Add property context and settings schema

**Files:**
- Create via `supabase migration new property_context_and_settings`: `supabase/migrations/*_property_context_and_settings.sql`
- Create: `supabase/tests/property_settings_rls_test.sql`
- Modify: `supabase/seed.sql` with synthetic property settings only

**Interfaces:**
- Produces `property_domains`, `property_settings`, and property identity columns.
- Produces `app_private.can_manage_property(p_property_id uuid)` and safe hostname resolution.

- [ ] **Step 1: Create the migration file using the Supabase CLI.**
- [ ] **Step 2: Write failing pgTAP tests** for hostname uniqueness, one primary domain per property, tenant/property composite foreign keys, setting validation, unknown/inactive domain rejection, and cross-property denial.
- [ ] **Step 3: Run a clean reset and pgTAP**; expect failure because the tables do not exist.
- [ ] **Step 4: Extend `properties`** with brand, city, country/region, timezone, and default language while keeping existing synthetic seeds valid.
- [ ] **Step 5: Create `property_domains`** with normalized unique hostname, subdomain, tenant/property composite ownership, primary, verified, and active states.
- [ ] **Step 6: Create `property_settings`** with constrained new-employee days, probation meaning, status source, CTC/GTC flags, initialization facts, optimistic version, and audit columns.
- [ ] **Step 7: Add a safe hostname resolver** returning only approved identity/branding fields; revoke business-table access from anonymous users.
- [ ] **Step 8: Enable and force RLS** and add platform, tenant admin, property manager, member-read, and anonymous-deny policies.
- [ ] **Step 9: Run reset, all pgTAP tests, advisors, and migration list.**
- [ ] **Step 10: Commit** with `feat: add property context and hotel settings schema`.

### Task 4: Add branding Storage and Hotel Settings Center

**Files:**
- Create via CLI: `supabase/migrations/*_property_branding_storage.sql`
- Create: `app/lib/supabase/browser.ts`, `app/repositories/supabase/property-repository.ts`
- Create: `app/services/property-settings-service.ts`
- Create: `app/settings/hotel/page.tsx`, `app/components/settings/*`
- Test: `tests/property-context.test.mjs`, `tests/property-settings.test.mjs`, `supabase/tests/storage_security_test.sql`

**Interfaces:**
- Implements `PropertyRepository`.
- Produces `usePropertySettings()` and section-level save results.

- [ ] **Step 1: Write failing Storage tests** proving the branding bucket is public, no test assumes object-level RLS can restrict public URL retrieval, authenticated metadata/list and write policies are limited to the authorized tenant/property path, and private/import data is prohibited from branding paths.
- [ ] **Step 2: Write failing UI/service tests** for loading, section validation, optimistic conflict, success feedback, invalid logo type/size, and initialization progress.
- [ ] **Step 3: Run focused tests and confirm expected failures.**
- [ ] **Step 4: Create the public branding bucket and object policies** with property-isolated, versioned, non-guessable paths; PNG/JPEG/WebP validation; authenticated metadata/list support; and upload/update/move/delete checks. Do not create `property-import-files` in Review Stop 2C-A.
- [ ] **Step 5: Implement the browser client** with URL and publishable key only; fail closed when hybrid configuration is invalid.
- [ ] **Step 6: Implement PropertyRepository and service methods** with no queries in the page component.
- [ ] **Step 7: Build the Chinese-first Settings Center** with Basic Information, Logo, Business Rules, Initialization Status, unsaved-state protection, validation, save feedback, and synthetic local fixtures only. Logo replacement creates a new immutable object, retains old versions for 30 days, and exposes authorized cleanup for expired non-current versions.
- [ ] **Step 8: Run reset, pgTAP, focused UI tests, full tests, and build.**
- [ ] **Step 9: Stop for Review 2C-A.**
- [ ] **Step 10: Commit** with `feat: add Suzhou hotel settings center` after approval.

---

## Review Stop 2C-B — Organization, mappings, and positions

### Task 5: Add arbitrary-depth department schema

**Files:**
- Create via CLI: `supabase/migrations/*_department_hierarchy_and_operational_units.sql`
- Create: `supabase/tests/department_hierarchy_test.sql`, `supabase/tests/department_scope_rls_test.sql`

**Interfaces:**
- Produces `departments`, `department_closure`, `department_aliases`, `operational_units`, and `operational_unit_aliases`.
- Produces `app_private.is_department_in_user_scope(uuid)`.

- [ ] **Step 1: Create the migration with `supabase migration new department_hierarchy_and_operational_units`.**
- [ ] **Step 2: Write failing pgTAP tests** for arbitrary depth, self-parent rejection, cycle rejection, cross-property rejection, closure correctness, sort uniqueness, active-state behavior, and descendant trainer scope.
- [ ] **Step 3: Preserve and run the existing 37 tenancy tests** to establish the red baseline only for new assertions.
- [ ] **Step 4: Create the five organization tables** with composite tenant/property foreign keys, scoped uniqueness, audit fields, and active states.
- [ ] **Step 5: Add the trainer-scope department foreign key** only after synthetic trainer-scope fixtures reference valid synthetic departments.
- [ ] **Step 6: Implement the department-scope helper** in `app_private` with `auth.uid()`, fixed empty search path, and no recursive policy calls.
- [ ] **Step 7: Add RLS** for platform, tenant admin, property manager, department admin descendant read, and anonymous denial.
- [ ] **Step 8: Run reset, all pgTAP tests, and security advisors.**
- [ ] **Step 9: Commit** with `feat: add property department hierarchy`.

### Task 6: Add atomic organization mutation functions

**Files:**
- Create via CLI: `supabase/migrations/*_organization_and_import_functions.sql`
- Extend: `supabase/tests/department_hierarchy_test.sql`
- Create: `app/repositories/supabase/department-repository.ts`, `app/services/organization-service.ts`
- Test: `tests/department-management.test.mjs`

**Interfaces:**
- Produces RPCs `create_department`, `update_department_details`, `preview_department_move`, `move_department`, `set_department_active`, and `reorder_departments`.
- Implements `DepartmentRepository`.

- [ ] **Step 1: Write failing pgTAP tests** for stale preview tokens, affected employee counts, atomic subtree moves, closure reconstruction, cross-property denial, unauthorized mutation, and SQLSTATE behavior.
- [ ] **Step 2: Write failing repository tests** proving preview is required before move and returned trees are deterministically sorted.
- [ ] **Step 3: Run focused SQL and Node tests; confirm failure.**
- [ ] **Step 4: Implement narrowly scoped database functions** with explicit authorization, fixed search path, fully qualified tables, immutable property ownership, and one transaction per mutation.
- [ ] **Step 5: Revoke function execution from `PUBLIC` and `anon`; grant only required functions to `authenticated`.**
- [ ] **Step 6: Prevent direct authenticated writes to hierarchy identity columns.**
- [ ] **Step 7: Implement DepartmentRepository RPC adapters and typed error mapping.**
- [ ] **Step 8: Run reset, pgTAP, focused Node tests, and security advisors.**
- [ ] **Step 9: Commit** with `feat: add safe department mutations`.

### Task 7: Build Organization Management and Department Mapping

**Files:**
- Create: `app/organization/manage/page.tsx`, `app/components/organization/*`
- Create: `app/organization/mapping/departments/page.tsx`, `app/components/mapping/department-*`
- Create: `app/repositories/supabase/import-repository.ts` staging-label read/resolution subset
- Create: `app/services/mapping-service.ts`
- Test: `tests/department-management.test.mjs`, `tests/mapping-workflows.test.mjs`

**Interfaces:**
- Produces organization tree operations and department-label resolution actions.
- Consumes DepartmentRepository and ImportRepository contracts only.

- [ ] **Step 1: Write failing interaction tests** for top-level/child creation, rename, activate/deactivate, reorder, move preview, stale-preview response, and affected-employee display.
- [ ] **Step 2: Write failing mapping tests** for existing target, new parent/child, operational unit, alias, merge, ignore, defer, confidence display, and explicit confirmation.
- [ ] **Step 3: Run tests and confirm failure because routes/components are absent.**
- [ ] **Step 4: Build the premium organization management workspace** without reusing the mock metrics dashboard route.
- [ ] **Step 5: Build the two-pane Department Claim and Mapping Center** with source evidence, official tree, target path, impact preview, and no automatic mutation.
- [ ] **Step 6: Connect every action to repository/service methods and visible outcomes.**
- [ ] **Step 7: Run focused tests, accessibility checks, full tests, and build.**
- [ ] **Step 8: Commit** with `feat: add department management and mapping`.

### Task 8: Add positions and position mapping

**Files:**
- Create via CLI: `supabase/migrations/*_positions_and_employee_master.sql`
- Create: `app/repositories/supabase/position-repository.ts`
- Create: `app/organization/mapping/positions/page.tsx`, `app/components/mapping/position-*`
- Extend: `tests/mapping-workflows.test.mjs`
- Create: `supabase/tests/employee_rls_test.sql`

**Interfaces:**
- Produces `position_families`, `positions`, `position_aliases`, `employees`, and `employee_external_identifiers`.
- Implements `PositionRepository`.

- [ ] **Step 1: Write failing pgTAP tests** for property-scoped codes, alias uniqueness, optional families, employee-number text preservation, leading-zero preservation, duplicate prevention, composite ownership, and cross-property denial.
- [ ] **Step 2: Write failing UI tests** proving all source positions remain independently reviewable and no generic-role auto-collapse occurs.
- [ ] **Step 3: Run reset and focused tests; confirm failure.**
- [ ] **Step 4: Create position, employee, and external-identifier tables** with UUID keys, property-scoped business uniqueness, audit fields, and active states.
- [ ] **Step 5: Add RLS** for property managers, department-scope employee reads, self-linked employee reads, and anonymous denial.
- [ ] **Step 6: Implement PositionRepository and mapping service actions.**
- [ ] **Step 7: Build the Position Mapping Center** with employee impact and optional family assignment.
- [ ] **Step 8: Run reset, all pgTAP tests, focused UI tests, full tests, and build.**
- [ ] **Step 9: Stop for Review 2C-B.**
- [ ] **Step 10: Commit** with `feat: add hotel positions and mapping` after approval.

---

## Review Stop 2C-C — Employee master and controlled import

### Task 9: Add import staging, audit, and private Storage

**Files:**
- Create via CLI: `supabase/migrations/*_import_staging_and_audit.sql`
- Create via CLI: `supabase/migrations/*_checkpoint_2c_rls_and_storage_policies.sql`
- Create: `supabase/tests/import_security_test.sql`, `supabase/tests/storage_security_test.sql`
- Extend: `supabase/seed.sql` with synthetic batches only

**Interfaces:**
- Produces the eight import staging/audit tables and private `property-import-files` bucket.
- Produces the import state machine and resolution enums.

- [ ] **Step 1: Write failing pgTAP tests** for property isolation, private object access, immutable batch ownership, valid state transitions, source-label aggregation, reusable resolution rules, issue visibility, and applied-change audit.
- [ ] **Step 2: Write failing tests** proving ordinary members and department admins cannot list files, rows, issues, mappings, or history.
- [ ] **Step 3: Run clean reset and pgTAP; confirm failure.**
- [ ] **Step 4: Create import tables** with composite ownership, file hash, sheet metadata, raw/normalized staging JSON, issue status, resolution provenance, and before/after change audit.
- [ ] **Step 5: Create the private bucket and Storage policies** for property-isolated XLS/XLSX/CSV paths.
- [ ] **Step 6: Implement state-transition constraints and immutable batch/file ownership.**
- [ ] **Step 7: Run reset, all pgTAP tests, and advisors.**
- [ ] **Step 8: Commit** with `feat: add audited employee import staging`.

### Task 10: Prove legacy workbook parsing and implement staging processor

**Files:**
- Create: `supabase/functions/process-employee-workbook/index.ts`
- Create: `supabase/functions/process-employee-workbook/parser.ts`
- Create: `supabase/functions/process-employee-workbook/mapping.ts`
- Create: `supabase/functions/process-employee-workbook/validation.ts`
- Create: `supabase/functions/process-employee-workbook/deno.json`
- Create local-only ignored fixture manifest under `supabase/tests/fixtures/README.md`
- Test: Edge Function unit tests colocated with parser modules

**Interfaces:**
- Produces `parseWorkbook(bytes, filename): ParsedWorkbook`.
- Produces authenticated batch transition `uploaded → detected → mapping → validating`.

- [ ] **Step 1: Perform the dependency gate** against a private local copy of the real `.xls`: verify sheet names, merged/header handling, employee-number text preservation, dates, memory limit, license, maintenance, and known vulnerabilities for candidate parsers.
- [ ] **Step 2: Record and pin the approved parser and checksum in `deno.json`/lockfile; reject implementation if no candidate preserves the workbook correctly.**
- [ ] **Step 3: Write failing parser tests** using synthetic `.xls`, `.xlsx`, and `.csv` fixtures covering leading zeros, Chinese/English text, empty cells, formula results, duplicate headers, and invalid files.
- [ ] **Step 4: Run Edge Function tests and confirm expected failures.**
- [ ] **Step 5: Implement the parser adapter** without page or repository knowledge.
- [ ] **Step 6: Implement the authenticated function** using the caller JWT for Storage and database operations so RLS remains authoritative; do not use a browser or committed service-role key.
- [ ] **Step 7: Write source rows, sheets, labels, and parsing issues idempotently using batch/file hash.**
- [ ] **Step 8: Run parser tests, local function test, reset, pgTAP, and secret scan.**
- [ ] **Step 9: Commit** with `feat: process employee workbook into staging`.

### Task 11: Implement validation, commit, audit, and guarded reversal

**Files:**
- Extend via a new CLI migration if Task 6 migration is already committed: `supabase/migrations/*_employee_import_commit_functions.sql`
- Extend: `supabase/tests/import_security_test.sql`, `supabase/tests/employee_rls_test.sql`
- Complete: `app/repositories/supabase/import-repository.ts`, `app/services/import-service.ts`
- Test: `tests/import-workflow-real.test.mjs`

**Interfaces:**
- Produces RPCs `validate_employee_import`, `commit_employee_import`, `preview_employee_import_reversal`, and `reverse_employee_import`.
- Completes `ImportRepository`.

- [ ] **Step 1: Write failing pgTAP tests** for duplicate employee numbers, ambiguous updates, unresolved mappings, invalid dates, cross-property references, atomic commit, before/after audit, idempotent retry, concurrent commit lock, and guarded reversal.
- [ ] **Step 2: Write failing repository tests** for additions, updates, exclusions, unresolved rows, final confirmation, completed report, and refused stale reversal.
- [ ] **Step 3: Run focused tests and confirm failure.**
- [ ] **Step 4: Implement validation** with employee number as the only default identity key and approved external identifier as the only fallback.
- [ ] **Step 5: Implement atomic commit** that revalidates batch status and mappings inside the transaction before inserting/updating employees.
- [ ] **Step 6: Implement applied-change audit and guarded reversal** based on employee version/`updated_at` equality with the imported after state.
- [ ] **Step 7: Revoke public/anonymous execution and grant authenticated execution only after exact role checks.**
- [ ] **Step 8: Implement repository/service adapters with Chinese business error messages.**
- [ ] **Step 9: Run reset, all pgTAP tests, focused Node tests, advisors, and secret scan.**
- [ ] **Step 10: Commit** with `feat: validate and commit audited employee imports`.

### Task 12: Move People and Import Centers to real repositories

**Files:**
- Create: `app/repositories/supabase/employee-repository.ts`, `app/services/employee-service.ts`
- Refactor: `app/people/page.tsx`, `app/import/page.tsx`
- Create/refactor: `app/components/people/*`, `app/components/import/*`
- Test: `tests/employee-repository.test.mjs`, `tests/import-workflow-real.test.mjs`, `tests/hybrid-boundaries.test.mjs`

**Interfaces:**
- Implements `EmployeeRepository`.
- Connects People and Import pages to the hybrid registry.

- [ ] **Step 1: Write failing People tests** for ID/Chinese/English search, hierarchy filters, real identity fields, edit validation, active state, operational unit filter, and pagination.
- [ ] **Step 2: Assert People shows no fabricated training history** and marks training actions as not yet connected.
- [ ] **Step 3: Write failing Import UI tests** for upload, sheet detection, mapping, label resolution, validation groups, confirmation, history, report, and reversal preview.
- [ ] **Step 4: Run tests and confirm existing mock pages fail the real contracts.**
- [ ] **Step 5: Implement EmployeeRepository and service** with department-scope filtering enforced by RLS, not only client filters.
- [ ] **Step 6: Refactor People Center** while preserving the approved premium identity-first layout.
- [ ] **Step 7: Refactor Import Center** into the real controlled workflow with resumable batch state and visible issue resolution.
- [ ] **Step 8: Preserve all primary action feedback, keyboard dismissal, loading, empty, failure, and retry states.**
- [ ] **Step 9: Run focused tests, full tests, responsive browser smoke tests, and build.**
- [ ] **Step 10: Stop for Review 2C-C.**
- [ ] **Step 11: Commit** with `feat: connect People and Import to real data` after approval.

---

## Review Stop 2C-D — Hybrid polish, deployment readiness, and production-approval package

### Task 13: Complete hybrid integration and mock-data disclosure

**Files:**
- Modify: `app/providers.tsx`, `app/components/shell/AppShell.tsx`
- Modify approved mock pages only to add shared source disclosure component
- Create: `app/components/ui/DataSourceNotice.tsx`
- Test: `tests/hybrid-boundaries.test.mjs`, existing checkpoint tests

**Interfaces:**
- Produces a shared `DataSourceNotice` with `real | example | unavailable` states.
- Ensures module data sources are visible and cannot silently fall back.

- [ ] **Step 1: Write failing tests** requiring real-data notices on Settings/organization/People/Import and example-data notices on mock analytical/training pages.
- [ ] **Step 2: Assert a Supabase failure shows retry/error state rather than mock employees.**
- [ ] **Step 3: Run focused tests and confirm failure.**
- [ ] **Step 4: Implement source notices and registry error boundaries** with restrained Chinese-first copy.
- [ ] **Step 5: Verify global navigation and current Milestone 1 visual style remain consistent.**
- [ ] **Step 6: Run all application tests and build.**
- [ ] **Step 7: Commit** with `feat: finalize explicit hybrid data boundaries`.

### Task 14: Add independent deployment-readiness workstream

**Files:**
- Create: `docs/checkpoint-2c/deployment-readiness-checklist.md`
- Create: `tests/deployment-readiness.test.mjs`
- Modify only: `app/lib/environment.ts`, `vite.config.ts`, or route configuration if the checklist exposes a portability defect

**Interfaces:**
- Produces a host-neutral deployment contract; it does not choose, provision, or configure a production hosting provider.
- Produces a documented test matrix for `ktsz.ldchub.cn` and future independent frontend hosting.

- [ ] **Step 1: Write failing readiness tests** requiring no code path to import Sites-only runtime behavior, all declared routes to have SPA fallback coverage, and all production values to arrive through environment variables.
- [ ] **Step 2: Add the checklist** for independent frontend-host compatibility, static asset paths, SPA fallback, Supabase URL/publishable key injection, `APP_ENV`, `APP_DATA_MODE`, `APP_BASE_DOMAIN`, `DEV_PROPERTY_HOSTNAME`, and `PREVIEW_PROPERTY_HOSTNAME`.
- [ ] **Step 3: Document custom-domain requirements** for `ktsz.ldchub.cn` without changing DNS or selecting a provider.
- [ ] **Step 4: Document mainland-China tests**: DNS resolution from at least two mainland networks, HTTPS/TLS chain, root route, direct deep links, refresh on nested routes, Supabase connectivity, hostname resolution, mobile QR links, and static asset loading.
- [ ] **Step 5: Document rollback** as restoring the previous DNS target, verifying TTL/propagation, keeping Supabase schema/data untouched, and retaining the previous frontend artifact until health checks pass.
- [ ] **Step 6: Run** `node --test tests/deployment-readiness.test.mjs`, `npm test`, and `npm run build`; expect all existing mock and application tests to remain green.
- [ ] **Step 7: Confirm explicitly** that no provider account, DNS record, production environment, deployment, or Site publication was changed.
- [ ] **Step 8: Commit** with `docs: add independent China deployment readiness`.

### Task 15: Final local verification and production migration review package

**Files:**
- Create: `docs/checkpoint-2c/local-verification-report.md`
- Create: `docs/checkpoint-2c/production-migration-review.md`
- Modify only tests or migrations if verification exposes a defect

**Interfaces:**
- Produces the approval package; performs no production mutation.

- [ ] **Step 1: Run** `supabase db reset --local --yes`; expect every migration and synthetic seed to apply from zero.
- [ ] **Step 2: Run** `supabase test db --local supabase/tests`; expect all original 37 and all new pgTAP tests to pass.
- [ ] **Step 3: Run local Storage and Edge Function tests** with synthetic fixtures and a private real-workbook compatibility check.
- [ ] **Step 4: Run** `supabase db advisors --local --type security --level warn --fail-on error`; expect no security errors.
- [ ] **Step 5: Run** `npm test`; expect the complete application and rendered HTML suite to pass.
- [ ] **Step 6: Run** `npm run build`; expect a successful production build.
- [ ] **Step 7: Run dependency and secret scans** and verify ignored real workbook copies, `.env*`, passwords, connection strings, and Supabase temporary files are not tracked.
- [ ] **Step 8: Run browser smoke tests** for Settings, organization management, both mapping centers, People, Import, and all preserved mock routes at desktop/tablet/mobile widths.
- [ ] **Step 9: Verify cross-property denial** with Tenant A/A1/A2 and Tenant B/B1 synthetic fixtures, including Storage and department descendant scope.
- [ ] **Step 10: Document migration order, table/RLS impact, bucket/function changes, test counts, known limitations, and guarded rollback plan.**
- [ ] **Step 11: Confirm Git status is clean and create the final Checkpoint 2C commit.**
- [ ] **Step 12: Stop and request explicit production migration approval. Do not push database changes, create production users, import data, publish, or merge.**

---

## Explicit implementation exclusions

- No production Supabase changes during the implementation plan.
- No production tenant/property/user creation without approval.
- No real employee import before production migration and mapping approvals.
- No training-history or CTC/GTC completion import.
- No real KPI, dashboard, calendar, session, attendance, feedback, risk, or course data.
- No group-level or cross-property administration pages.
- No wildcard or customer-owned domain management.
- No HRIS synchronization.
- No automatic organization mutation from match suggestions.
- No employee name-only matching or workbook-absence deactivation.
- No Site publishing or automatic merge.

## Execution handoff

After this specification and plan are approved, execution should use inline checkpointed implementation unless the user explicitly selects another method. Each review stop must be approved before proceeding to the next, and Task 15 always stops before production.
