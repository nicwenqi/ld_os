# E5C Import Mapping / Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Neon-only decision and deterministic preview boundary over immutable E5B staging evidence, without employee commit or batch lifecycle mutation.

**Architecture:** E5C stores current mapping, source-label, and issue decisions in separate property-scoped tables. E5B evidence rows remain immutable. Each decision transaction locks a per-batch decision-version row, revalidates the authenticated actor and E5B sealed version, writes an append-only audit event, and increments only the E5C decision version. Preview recomputes a canonical evidence/decision projection and SHA-256 on every call; it never persists preview state and reports unavailable impact rather than synthetic counts.

**Tech Stack:** PostgreSQL 18 canonical SQL, constrained `SECURITY DEFINER` entrypoints, TypeScript server repository, same-origin HTTP routes, Node test fixtures.

## Global Constraints

- Reuse E1 Actor Context and E3/E4 authority helpers without modification.
- Keep `hotel_ld_application` NOBYPASSRLS and raw table privileges at zero.
- All E5C tables use ENABLE + FORCE RLS; runtime access is exact entrypoint EXECUTE only.
- E5B `import_batches`, `import_source_rows`, and all staged evidence are read-only to E5C.
- No employee commit, batch lifecycle mutation, revert, Storage replacement, Auth migration, or registry activation.
- All entrypoints fix `search_path = ''`, have migration-owner ownership, revoke PUBLIC EXECUTE, and grant only `hotel_ld_application`.
- Stale E5B sealed version or E5C decision version fails closed with `40001`/stable conflict mapping.

---

### Task 1: Contract audit and RED gate

**Files:**
- Create: `app/repositories/contracts/import-mapping-repository.ts`
- Create: `scripts/neon/validate-e5c-import-mapping.test.mjs`
- Create: `scripts/neon/validate-e5c-import-mapping.mjs`
- Create: `docs/neon/e5c-import-mapping-verification.md`

**Interfaces:**
- Define `ImportMappingRepository` methods `getWorkflow`, `saveFieldMappingDecisions`, `saveSourceLabelDecisions`, `saveIssueResolutions`, and `preview`.
- Decision inputs carry `batchId` and `expectedDecisionVersion`; they never carry tenant, property, role, or auth identity.
- Preview returns `{ batchVersion, decisionVersion, state, previewHash, evidenceHash, mapping, sourceLabels, issues, impact }` where impact may be `{state:'unavailable', reason:'employee_commit_not_migrated'}`.

- [ ] Write tests asserting exact entrypoint names/signatures, immutable-evidence exclusions, closed action sets, stale-version conflict, deterministic hash fields, and no browser credentials/Neon imports.
- [ ] Run the focused test and source command; confirm the intended missing-module RED.

### Task 2: E5C schema and manifest

**Files:**
- Create: `neon/canonical/e5c/093_import_mapping_schema.sql`
- Create: `neon/canonical/e5c/e5c-import-mapping-manifest.json`

**Interfaces:**
- Add `import_decision_versions`, `import_field_mapping_decisions`, `import_source_label_decisions`, `import_issue_resolutions`.
- Add `app_private.import_decision_audit_events` with append-only UPDATE/DELETE rejection.
- Add composite E5B scope FKs and unique current-decision keys; no raw values are copied or updated.
- Add exact decision enums/checks and ENABLE/FORCE RLS/policies/ACLs.

- [ ] Implement the schema and source validator fixture.
- [ ] Verify source turns GREEN for schema and remains RED for entrypoints.

### Task 3: Constrained decision and preview entrypoints

**Files:**
- Create: `neon/canonical/e5c/094_import_mapping_entrypoints.sql`
- Modify: `neon/canonical/e5c/e5c-import-mapping-manifest.json`

**Interfaces:**
- `public.read_neon_import_mapping_workflow(text,uuid)`
- `public.save_neon_import_field_mapping_decisions(text,uuid,bigint,jsonb)`
- `public.save_neon_import_source_label_decisions(text,uuid,bigint,jsonb)`
- `public.save_neon_import_issue_resolutions(text,uuid,bigint,jsonb)`
- `public.preview_neon_import_batch(text,uuid,bigint)`

- [ ] Validate manager/property actor, linked E5B batch, sealed evidence, expected decision version, exact JSON keys, target scope against active E3 departments/units and E4 positions/families, and issue correction allowlist.
- [ ] Lock decision state before validating/inserting decisions; audit before incrementing decision version; rollback all on any invalid decision.
- [ ] Build sorted canonical JSON from evidence fingerprints + decisions + authority snapshots; hash with PostgreSQL 18 built-in `sha256(convert_to(...,'UTF8'))`.
- [ ] Return unavailable impact explicitly; never write raw source rows or preview state.

### Task 4: Server repository and dark HTTP boundary

**Files:**
- Create: `app/repositories/neon/import-mapping-repository.ts`
- Create: `app/api/import/batches/[id]/mapping/route.ts`
- Create: `app/api/import/batches/[id]/labels/route.ts`
- Create: `app/api/import/batches/[id]/issues/route.ts`
- Create: `app/api/import/batches/[id]/preview/route.ts`
- Modify: `app/services/neon-import-staging-authorization.ts` only to expose the typed E5C repository alongside the existing E5B repository.

- [ ] Add exact query allowlist and closed payload parsing; map `40001` to HTTP 409, authorization to 403, not-found to 404, business rule violations to 422.
- [ ] Ensure all routes are same-origin, server-only, request-id aware, and do not activate the registry or alter `inspect` RPC.

### Task 5: Validation and canonical child apply

**Files:**
- Modify: `scripts/neon/validate-e5c-import-mapping.mjs` with source/dry-run/apply/catalog/runtime commands.
- Modify: `docs/neon/e5c-import-mapping-verification.md` with redacted results.

- [ ] Run source and all focused tests.
- [ ] On the approved canonical branch only, run dry-run→rollback, apply only 093/094, catalog, and runtime decision/preview matrix using bootstrap direct and pooled application credentials via stdin.
- [ ] Verify manager authorization, cross-property denial, stale decision conflict, target scope, audit append-only, raw privilege denial, deterministic repeated hash, and raw-row immutability.
- [ ] Run `npm test`, `npm run build`, and `git diff --check`; keep the existing progress ledger uncommitted and leave registry/fallback unchanged.
