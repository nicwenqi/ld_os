# Private Workbook Cleanup Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pre-staging workbook upload and cleanup work through the real local Supabase Storage API, make route cleanup failures truthful and retry-bounded, and reject excluded employee-import evidence at the RPC boundary.

**Architecture:** Add one migration after `20260716151459` that recreates the private workbook SELECT/cleanup DELETE policies and adds a private payload-allowlist validator invoked by the public staging RPC. Keep the existing applied migrations immutable. Refactor the route catch path around a two-attempt exact-path cleanup helper, and cover the database, real Storage API, and route behavior independently.

**Tech Stack:** TypeScript, Node test runner, Supabase JS 2.110.2, Supabase CLI local stack, PostgreSQL/PLpgSQL, pgTAP.

## Global Constraints

- Do not edit applied migrations.
- Do not edit or duplicate Task 2 files `20260716151459_recovery_c_remaining_import_bypasses.sql` or `recovery_c_remaining_import_bypasses_test.sql`.
- Use no Production or real hotel/workbook data.
- Preserve the Task 1 browser-safe aggregate allowlist and never return object paths or row PII.
- Wait for the concurrent Task 2 commit before final clean reset and full pgTAP.
- Final commit message: `fix: secure private workbook cleanup`.

---

### Task 1: Reproduce Storage policy and RPC payload failures

**Files:**
- Create: `tests/recovery-c-storage-api.test.mjs`
- Modify: `supabase/tests/recovery_c_import_staging_test.sql`

**Interfaces:**
- Consumes: local Supabase URL/keys from `supabase status --output json`.
- Produces: failing proofs for pre-staging Storage API cleanup and excluded payload rejection.

- [ ] **Step 1: Add real Storage API tests**

Create a Node integration test that signs in `property-a1-ld@example.test` with the local-only password, uses the actor client to upload to `property-import-files`, and asserts:

```js
await manager.storage.from(bucket).upload(managerPath, workbookBytes, {
  contentType: workbookMime,
  upsert: false,
});
await manager.rpc("stage_employee_import", invalidPayload);
await manager.storage.from(bucket).remove([managerPath]);
assert.equal((await service.storage.from(bucket).exists(managerPath)).data, false);
```

The same file must prove cross-property upload denial and prove that a successfully linked object cannot be removed and remains present.

- [ ] **Step 2: Add pgTAP payload rejection cases**

Extend the focused staging test with payloads containing forbidden mapping/raw/normalized keys such as `CTC Completion`, `training_history`, `attendance`, `feedback`, `risk`, and `kpi_score`. Assert SQLSTATE `P3220`, a stable excluded-field error, and zero batch/sheet/row evidence after each rejected RPC.

- [ ] **Step 3: Verify RED**

Run:

```bash
node --experimental-strip-types --test tests/recovery-c-storage-api.test.mjs
npx --no-install supabase test db --local supabase/tests/recovery_c_import_staging_test.sql
```

Expected: Storage removal fails because the pre-staging object is not SELECT-visible, and forbidden payloads are accepted or reach later constraints rather than the intended allowlist error.

### Task 2: Add the additive Storage and RPC hardening migration

**Files:**
- Create through CLI: `supabase/migrations/<timestamp>_recovery_c_private_workbook_cleanup.sql`

**Interfaces:**
- Produces: pre-staging SELECT/DELETE authorization with owner binding and `app_private.assert_employee_import_staging_payload_allowed(jsonb)`.

- [ ] **Step 1: Create the migration through Supabase CLI**

Run after RED:

```bash
npx --no-install supabase migration new recovery_c_private_workbook_cleanup
```

Confirm its timestamp is later than `20260716151459`.

- [ ] **Step 2: Recreate Storage policies**

Recreate `import_files_manager_select` so linked objects continue to use `can_manage_property_import_object(name)` while pre-staging objects require both:

```sql
app_private.can_stage_property_import_object(name)
and owner_id = auth.uid()::text
```

Recreate `import_files_staging_cleanup_delete` with the same pre-staging helper and owner binding. Do not add linked-object DELETE authority.

- [ ] **Step 3: Add the payload allowlist validator**

Create a private validator that:

```sql
- accepts only the existing employee target fields;
- rejects source/mapping/raw/normalized keys matching training history,
  CTC/GTC, completion, attendance, feedback, risk, or KPI patterns;
- rejects raw keys absent from fieldMappings.sourceColumnName;
- rejects normalized keys absent from fieldMappings.targetField;
- rejects duplicate source-column or target-field mappings.
```

Raise `IMPORT_STAGING_EXCLUDED_FIELD` with SQLSTATE `P3220` for excluded keys and `IMPORT_STAGING_FIELD_ALLOWLIST_INVALID` with SQLSTATE `P3220` for unmatched/duplicate keys.

- [ ] **Step 4: Invoke validation at the public RPC boundary**

Replace only `public.stage_employee_import(uuid,uuid,jsonb)` in the additive migration so it checks authentication, calls the validator, then delegates to the existing private atomic implementation. Preserve authenticated-only execution.

- [ ] **Step 5: Verify GREEN**

Reset locally, then run the focused pgTAP and real Storage API tests. Both must pass.

### Task 3: Make route cleanup retry-bounded and truthful

**Files:**
- Modify: `tests/recovery-c-import-route.test.mjs`
- Modify: `app/api/import/inspect/route.ts`

**Interfaces:**
- Produces: exact-path cleanup with at most two attempts and a distinct aggregate-only cleanup-failure response.

- [ ] **Step 1: Add failing route tests**

Extend the actor Storage mock with queued remove outcomes and assert:

```js
remove errors once then succeeds -> exactly two attempts and ordinary staging failure response;
remove errors twice -> exactly two attempts and distinct cleanup-failure response;
response JSON -> contains no object path, filename, checksum, or row PII.
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --experimental-strip-types --test tests/recovery-c-import-route.test.mjs
```

Expected: the retry-success and exhausted-cleanup cases fail because the route currently ignores the first remove error.

- [ ] **Step 3: Implement minimal cleanup helper**

Add a helper that calls `remove([objectPath])` at most twice, treats returned errors and thrown errors as failures, and returns a boolean. In the catch path:

```ts
const cleaned = await removeUploadedObject(actorClient, objectPath);
if (!cleaned) {
  return failure(500, "工作簿暂存失败，临时文件清理未完成，请联系管理员");
}
```

Do not expose the path, original filename, checksum, source row, or underlying Storage error.

- [ ] **Step 4: Verify GREEN**

Run the route test and the production activation regressions.

### Task 4: Combined verification, report, and commit

**Files:**
- Append: `.superpowers/sdd/task-4-report.md`

**Interfaces:**
- Consumes: landed Task 2 revocation migration and tests.
- Produces: final evidence and commit.

- [ ] **Step 1: Wait for Task 2 commit**

Confirm the concurrent Task 2 migration/test is committed. Do not stage its files.

- [ ] **Step 2: Run complete verification**

Run:

```bash
npx --no-install supabase db reset --local --yes
npx --no-install supabase test db --local supabase/tests
node --experimental-strip-types --test tests/recovery-c-storage-api.test.mjs
node --experimental-strip-types --test tests/recovery-c-import-route.test.mjs tests/production-activation-wiring.test.mjs tests/initialization-usability-fix.test.mjs
npx --no-install tsc --noEmit --allowImportingTsExtensions --module esnext --moduleResolution bundler --target es2022 --lib es2022,dom,dom.iterable --skipLibCheck app/api/import/inspect/route.ts app/services/production-authorization.ts app/lib/supabase/server-admin.ts
npx --no-install eslint app/api/import/inspect/route.ts tests/recovery-c-import-route.test.mjs tests/recovery-c-storage-api.test.mjs
git diff --check
```

- [ ] **Step 3: Append the report**

Record RED/GREEN commands, the real Storage API evidence, forbidden-payload atomicity, inherited Task 2 staging-table revocation evidence, exact migration order, and any baseline-only concerns.

- [ ] **Step 4: Commit only Task 4 review files**

Stage the route, Task 4 tests, additive Task 4 migration, and report if tracked. Verify staged names exclude Task 2 and unrelated UI work. Commit:

```bash
git commit -m "fix: secure private workbook cleanup"
```
