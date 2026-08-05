# Neon Organization Activation Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the existing Department alias contract, including atomic created-Department resolutions, and rehearse replacing the browser Supabase Organization repository with the server-scoped Neon HTTP boundary in local/preview only.

**Architecture:** Add two narrow Neon alias entrypoints without modifying Phase 4A semantics, route the two new actions through the existing server authorization runner, implement the full browser `DepartmentRepository` over same-origin HTTP, and select it through a hard-gated rehearsal mode. The Supabase repository remains the default and rollback target.

**Tech Stack:** PostgreSQL 15+, Neon pooled PostgreSQL, TypeScript, Vinext/Vite, Node test runner, Supabase Auth client, `pg` server runtime.

## Global Constraints

- Work only in `/Users/hewenqi/Documents/Hotel L&D OS/.worktrees/e3-organization-activation-completion` on `codex/e3-organization-activation-completion`.
- Database work may target only branch `br-aged-river-az1gke14`, endpoint `ep-sparkling-shape-az9gxtuh`.
- Reject branch `br-twilight-leaf-azmowo1k` and endpoint `ep-wild-wave-azjmgdif` before connection.
- Do not modify E1 Actor Context, E2 People, Position, Import, Employee writes, Supabase Auth, or Supabase Storage.
- Do not modify existing files under `tests/`.
- Keep `hotel_ld_application` `NOBYPASSRLS`, non-owner, and without raw business-table privileges.
- Browser code must use HTTP only and must not import `pg` or read `DATABASE_URL`.
- Existing `department`, `ignore`, and `defer` alias behavior must remain unchanged.
- `created_top_level` and `created_child` call the existing controlled
  Department creation entrypoint inside the alias transaction; Department
  creation and hierarchy logic must not be copied.
- Registry activation is local/preview-only, requires `APP_DATA_MODE=neon`, and is hard-denied in production.
- Supabase remains the default repository and the tested fallback.

---

### Task 1: RED contract for alias completion and activation boundary

**Files:**
- Create, scratch only: `.superpowers/sdd/2026-08-05-e3-organization-activation-completion/activation-completion.test.mjs`
- Read: `app/repositories/contracts/department-repository.ts`
- Read: `app/repositories/neon/department-alias-repository.ts`
- Read: `app/api/organization/departments/aliases/[id]/resolution/route.ts`
- Read: `app/lib/environment.ts`
- Read: `app/repositories/registry.ts`

**Interfaces:**
- Consumes: existing `DepartmentRepository` and Phase 4A alias repository.
- Produces: failing executable expectations for the two alias actions, request parser, HTTP repository, and rehearsal-mode guard.

- [ ] **Step 1: Write a real repository behavior test**

  Import `createNeonDepartmentAliasRepository`, give it a fake `NeonQueryable`
  whose `query` returns a complete alias payload, and assert independently that:

  - `merge` invokes `merge_neon_organization_department_alias` with hostname,
    alias ID, and target Department ID;
  - `operational_unit` invokes
    `resolve_neon_organization_department_alias_to_operational_unit` with
    hostname, alias ID, and Operational Unit ID;
  - malformed combinations reject before querying;
  - existing `department`, `ignore`, and `defer` still invoke the Phase 4A
    resolver.
  - `department` with `created_top_level` or `created_child` plus a creation
    draft invokes `create_neon_organization_department_from_alias`.

- [ ] **Step 2: Write parser behavior tests**

  Import `parseAliasResolutionInput` from the planned route input module and
  assert literal results for all five actions. Assert rejection of browser
  property/tenant/actor fields, missing target IDs, both target IDs at once,
  and unsupported actions.

- [ ] **Step 3: Write HTTP repository behavior tests**

  Replace only the external `fetch` boundary with a recording fake and call
  every `DepartmentRepository` method. Assert exact same-origin URLs, methods,
  JSON bodies, `credentials: "same-origin"`, `cache: "no-store"`, returned
  payloads, and propagation of server error messages.

- [ ] **Step 4: Write rehearsal-mode behavior tests**

  Import `resolveOrganizationRepositoryMode` and assert:

  - omitted mode returns `supabase`;
  - `neon` succeeds only for local/preview plus Neon data mode;
  - non-Neon data mode, production app environment, and Vercel Production
    reject `neon`;
  - invalid mode rejects.

- [ ] **Step 5: Run RED**

  Run:

  ```bash
  node --experimental-strip-types --test .superpowers/sdd/2026-08-05-e3-organization-activation-completion/activation-completion.test.mjs
  ```

  Expected: fail because the two entrypoint dispatches, parser module, complete
  HTTP repository, and rehearsal-mode resolver do not exist.

### Task 2: GREEN alias migration and child-safe validator

**Files:**
- Create: `neon/migrations/202608050010_e3_organization_activation_completion.sql`
- Create: `scripts/neon/validate-e3-organization-activation.mjs`
- Modify: `app/repositories/neon/department-alias-repository.ts`
- Modify: `app/services/neon-organization-errors.ts`

**Interfaces:**
- Consumes: Phase 4A alias payload helper and actor/manager authorization helpers; Phase 4B Operational Unit table and policies.
- Produces: `merge_neon_organization_department_alias(text,uuid,uuid)`,
  `resolve_neon_organization_department_alias_to_operational_unit(text,uuid,uuid)`,
  and `create_neon_organization_department_from_alias(text,uuid,text,uuid,text,text,text,text,integer)`.

- [ ] **Step 1: Add child and topology preflight**

  The migration transaction must assert database `neondb`, bootstrap identity
  `neondb_owner`, set-role capability for `hotel_ld_migration_owner`, existing
  Phase 4A/4B entrypoints, forced RLS, `hotel_ld_application` non-bypass status,
  and zero raw privileges before creating objects.

- [ ] **Step 2: Add minimal definer grants and RLS policies**

  Grant `hotel_ld_migration_owner` only the exact alias, Department,
  Operational Unit, Operational Unit alias, and audit columns required. Add
  policies scoped to `session_user = 'hotel_ld_application'`, current actor
  property, and existing manager authorization. Do not grant policies or raw
  table privileges to the application role.

- [ ] **Step 3: Add append-only activation audit**

  Create `app_private.organization_alias_activation_audit_events` with action
  check `merge|operational_unit`, exact-one-target constraint, forced RLS,
  manager-scoped insert policy, and an invoker trigger that rejects update and
  delete.

- [ ] **Step 4: Add merge entrypoint**

  Lock the current-property alias, validate the active same-property target
  Department under lock, update to `merged`, append audit, and return the Phase
  4A payload. Use SQLSTATE `P2000` for hidden/not-found objects, `P2006` for
  invalid targets, and `42501` for authorization denial.

- [ ] **Step 5: Add Operational Unit resolution entrypoint**

  Lock the current-property alias, validate the active same-property
  Operational Unit, insert the Operational Unit alias with the source identity,
  deactivate the Department alias, append audit, and return an alias-shaped
  payload with `operational_unit_id`. Let unique source conflicts map to 409 and
  keep all mutations in the function transaction.

- [ ] **Step 6: Lock down function ACLs and postflight**

  Before ACL lockdown, add the atomic created-Department entrypoint. Accept
  only `created_top_level` and `created_child`, lock the alias, validate parent
  shape/scope, call `create_neon_organization_department(...)` within the same
  transaction, resolve the alias, and append activation audit. Do not insert
  Department or closure rows directly in this function.

  Set owner `hotel_ld_migration_owner`, `SECURITY DEFINER`, and empty search
  path. Revoke all execution from `PUBLIC`, Supabase roles, owner/bootstrap,
  readonly, and application before granting exact execution only to
  `hotel_ld_application`. Postflight must verify function metadata, forced RLS,
  append-only trigger, application-role zero raw privileges, and unchanged role
  topology.

- [ ] **Step 7: Extend the Neon alias repository**

  Dispatch `merge` and `operational_unit` to their exact entrypoints. Require
  only the matching target ID and map `operational_unit_id` in returned payloads.
  Keep the Phase 4A call and mapping unchanged for its original actions.

- [ ] **Step 8: Add guarded validation commands**

  Implement `source`, `dry-run`, `apply`, `catalog`, and `runtime` commands.
  Parse connection URLs before opening a pool; require the child endpoint and
  reject both production identifiers. `apply` accepts only
  `NEON_BOOTSTRAP_DATABASE_URL`; `runtime` accepts only pooled `DATABASE_URL`
  whose role is `hotel_ld_application`.

- [ ] **Step 9: Run focused GREEN**

  Run the scratch test. Expected: alias repository cases pass while later HTTP
  and activation cases remain failing because their modules are not yet added.

- [ ] **Step 10: Commit the database boundary**

  Stage only the migration, validator, alias repository, and error mapper.
  Commit as `feat: complete Neon organization alias contract`.

### Task 3: GREEN API input and complete browser HTTP repository

**Files:**
- Create: `app/api/organization/departments/aliases/[id]/resolution/input.ts`
- Modify: `app/api/organization/departments/aliases/[id]/resolution/route.ts`
- Create: `app/repositories/http/department-repository.ts`
- Reuse: `app/repositories/http/department-read-repository.ts`
- Modify: `app/repositories/contracts/department-repository.ts`
- Modify: `app/repositories/supabase/department-repository.ts`
- Modify: `app/initialize/MappingSetupStep.tsx`

**Interfaces:**
- Consumes: `ApproveDepartmentMappingInput`, existing Organization API routes.
- Produces: `parseAliasResolutionInput(value)` and `createHttpDepartmentRepository(): DepartmentRepository`.

- [ ] **Step 1: Implement the exact alias request parser**

  Return literal typed objects for `department`, `ignore`, `defer`, `merge`,
  `operational_unit`, `created_top_level`, and `created_child`. Canonicalize
  UUIDs. Permit only the action-specific target or Department creation draft
  and reject all unknown or authorization-relevant fields.

- [ ] **Step 2: Wire the route to the parser**

  Preserve request ID, authorization runner, response headers, error mapper,
  path UUID validation, and no-query-string rule. Replace only the Phase 4A
  inline body parser with the new parser.

- [ ] **Step 3: Implement the full HTTP adapter**

  Compose the existing HTTP read repository and add exact HTTP calls:

  - `POST /api/organization/departments` for create;
  - `PATCH /api/organization/departments/:id` for update and active state;
  - `POST .../:id/move-preview` and `POST .../:id/move`;
  - `GET /api/organization/departments/aliases` and `POST .../:id/resolution`;
  - `GET|POST /api/organization/operational-units` and `PATCH .../:id`.

  Strip compatibility-only tenant/property fields where the API already
  resolves scope, and send no identity or role fields.

- [ ] **Step 4: Make created mappings one contract call**

  Extend `ApproveDepartmentMappingInput` with an optional Department creation
  draft. Update `MappingSetupStep` so created top-level/child actions call only
  `approveMapping` with the draft and then reload the tree. Update the Supabase
  fallback repository to preserve its previous sequential create-then-resolve
  behavior inside `approveMapping`; do not add a Supabase migration.

- [ ] **Step 5: Run focused GREEN**

  Run the scratch test. Expected: alias, parser, and all HTTP adapter cases pass;
  activation-mode cases remain failing.

- [ ] **Step 6: Run `npm test`**

  Expected: 201 tests pass, build passes, rendered HTML test passes.

- [ ] **Step 7: Commit the HTTP boundary**

  Stage only the input module, route, and HTTP repository. Commit as
  `feat: add Neon organization HTTP repository`.

### Task 4: GREEN non-production activation and reversible fallback

**Files:**
- Create: `app/lib/organization-repository-mode.ts`
- Modify: `vite.config.ts`
- Modify: `app/repositories/registry.ts`

**Interfaces:**
- Consumes: `AppEnvironment`, `AppDataMode`, and `createHttpDepartmentRepository()`.
- Produces: `resolveOrganizationRepositoryMode(environment, requestedMode, vercelEnvironment)` returning `supabase|neon`.

- [ ] **Step 1: Implement the pure mode guard**

  Default to `supabase`. Accept `neon` only for `APP_DATA_MODE=neon`,
  local/preview app environment, and non-production Vercel environment. Reject
  invalid strings and every production attempt with configuration errors.

- [ ] **Step 2: Expose the non-secret build constant**

  In `vite.config.ts`, load and validate `APP_ORGANIZATION_REPOSITORY`, then add
  only its normalized non-secret value to browser environment defines. Do not
  expose a URL, role, password, token, or database identifier.

- [ ] **Step 3: Select the HTTP repository only in rehearsal mode**

  In the registry, resolve Organization mode once. Select
  `createHttpDepartmentRepository()` only for `neon`; otherwise preserve the
  existing mock/Supabase decisions. Return a module data-source function that
  reports Neon only for Organization during rehearsal. Leave all other module
  selection unchanged.

- [ ] **Step 4: Run full GREEN**

  Run the scratch test and `npm test`. Expected: all activation-completion cases
  pass; project tests report 201 pass, 0 fail, and build succeeds.

- [ ] **Step 5: Verify fallback in process-level builds**

  Build once with an allowed local/preview Neon rehearsal environment and once
  with Organization mode `supabase`. Verify a production Neon Organization
  build fails before compilation. Do not use or print a database URL.

- [ ] **Step 6: Commit activation wiring**

  Stage only the mode module, Vite config, and registry. Commit as
  `feat: rehearse Neon organization activation`.

### Task 5: Child migration and runtime validation

**Files:**
- Modify: `docs/neon/2026-08-05-e3-organization-activation-completion-verification.md`
- Use: `scripts/neon/validate-e3-organization-activation.mjs`

**Interfaces:**
- Consumes: child bootstrap and pooled runtime credentials already configured by the user.
- Produces: redacted catalog/runtime evidence and fallback results.

- [ ] **Step 1: Validate connection identities without printing secrets**

  Confirm bootstrap and runtime URLs parse to endpoint
  `ep-sparkling-shape-az9gxtuh`, not either production identifier. Confirm
  bootstrap role `neondb_owner` only for migration and runtime role
  `hotel_ld_application` for behavior tests.

- [ ] **Step 2: Run source and transactional dry-run validation**

  Run `source`, then `dry-run`. Expected: migration executes and rolls back,
  leaving no completion objects.

- [ ] **Step 3: Apply only to the child branch**

  Run `apply` through `NEON_BOOTSTRAP_DATABASE_URL`, then discard it from all
  runtime commands. Never copy it into `DATABASE_URL`.

- [ ] **Step 4: Run catalog and runtime matrix**

  Verify ACLs, forced RLS, zero raw privileges, manager success, Department
  administrator denial, cross-property denial, inactive/missing targets,
  conflict handling, atomic rollback, audit accuracy, actor cleanup,
  connection reuse, and concurrency serialization.

- [ ] **Step 5: Run UI/API rehearsal and fallback**

  Start the application against the child runtime with Organization mode Neon,
  exercise `/organization` and `/initialize`, then switch Organization mode to
  Supabase, restart, and repeat representative flows. Record only aggregate,
  redacted results.

- [ ] **Step 6: Write verification evidence**

  Record branch/endpoint IDs, roles, commands, pass/deferred/fail matrix,
  rollback procedure, and confirmation that Production was never connected.
  Do not include URLs, passwords, tokens, source alias values, or business rows.

- [ ] **Step 7: Remove scratch artifacts from delivery scope**

  Leave `.superpowers/` untracked and exclude it from commits. Do not remove any
  pre-existing scratch directory owned by another phase.

- [ ] **Step 8: Final verification and commit**

  Run `npm test` and a separate `npm run build`. Stage only the verification
  document and any validator correction. Commit as
  `docs: verify Neon organization activation rehearsal`.
