# E5B Import Staging Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Neon import-staging and Storage-saga foundation, including trusted upload intent, byte-level object verification, atomic workbook evidence staging, retryable cleanup, and read-only workflow/history projections, while leaving employee commit, import commit/revert, Auth, Storage provider, registry activation, and the current Supabase `actorClient.rpc("stage_employee_import")` route contract unchanged.

**Architecture:** Supabase Auth continues to prove the user and Supabase Storage continues to hold workbook objects. Neon becomes authoritative for upload intent, verification evidence, workbook staging evidence, cleanup obligations, lifecycle state, and audit. Each database operation runs through the existing transaction-scoped Actor Context as `hotel_ld_application`; Storage calls occur outside Neon transactions and are reconciled through a durable saga ledger. The E5B server boundary is built dark and validated directly; `/api/import/inspect` remains on its existing actor-scoped Supabase RPC until a separately approved activation.

**Tech Stack:** Next.js Route Handlers, TypeScript, `@supabase/supabase-js`, `pg`, Neon PostgreSQL, PostgreSQL RLS and constrained `SECURITY DEFINER` functions, Node `crypto`, SheetJS, Node test runner, existing Neon migration validators.

## Global Constraints

- Work only against Neon child branch `br-aged-river-az1gke14`, endpoint `ep-sparkling-shape-az9gxtuh`.
- Reject production branch `br-twilight-leaf-azmowo1k` and endpoint `ep-wild-wave-azjmgdif` before opening a database connection.
- Use `NEON_BOOTSTRAP_DATABASE_URL` only for migration dry-run/apply/catalog checks and require role `neondb_owner`.
- Use pooled `DATABASE_URL` only for runtime validation and require role `hotel_ld_application`.
- Never print a full connection string or password.
- Do not change E1 Actor Context, database role topology, Auth, Storage provider, registry activation, employee commit, import commit/revert, or employee write behavior.
- Do not modify existing test files. Add the committed E5B validator instead.
- Do not grant `hotel_ld_application` raw privileges on any E5B table, sequence, or audit relation.
- Every exposed entrypoint is owned by `hotel_ld_migration_owner`, is `SECURITY DEFINER`, has `SET search_path = ''`, has PUBLIC execution revoked, and grants EXECUTE only to `hotel_ld_application`.
- All E5B tables have RLS enabled and forced. The runtime role is `NOBYPASSRLS`, owns no runtime object, and cannot become table owner.
- Browser inputs never establish tenant, property, role, object ownership, checksum verification, or cleanup authority.
- The existing literal call `actorClient.rpc("stage_employee_import")` in `app/api/import/inspect/route.ts` must remain present and unchanged throughout E5B.
- A successful Storage API response is not verification. `verified` requires a second server-side download of the actual bytes and recomputation of checksum, size, and content-derived MIME.
- No database rollback is described or implemented as deleting a Storage object.

## File and Responsibility Map

| File | Responsibility |
|---|---|
| `neon/migrations/202608070017_e5b_import_staging_schema.sql` | E5B tables, constraints, indexes, append-only audit trigger, FORCE RLS, ownership and default privilege hardening. |
| `neon/migrations/202608070018_e5b_import_saga_entrypoints.sql` | Upload intent, upload observation, verification, cleanup claim/result, workflow/history read entrypoints. |
| `neon/migrations/202608070019_e5b_import_staging_entrypoints.sql` | Begin/chunk/finalize staging entrypoints and exact application EXECUTE grants. |
| `app/repositories/contracts/import-staging-repository.ts` | E5B-only contract and lifecycle/result types; does not expand the legacy `ImportRepository`. |
| `app/repositories/neon/import-staging-repository.ts` | SQL adapter and deterministic bounded chunking inside one actor transaction. |
| `app/services/neon-import-staging-authorization.ts` | Supabase Auth identity to existing Neon Actor Context and manager/property authorization. |
| `app/services/import/storage-object-verification.ts` | Full read-back byte verification and content-derived workbook MIME classification. |
| `app/services/import/storage-saga-coordinator.ts` | Cross-system ordering and compensation; never claims atomicity across Storage and Neon. |
| `app/services/import/storage-cleanup-executor.ts` | Same-property, manager-authorized cleanup claim/remove/result loop with expiring claims. |
| `app/services/import/neon-import-inspection-boundary.ts` | Dark server boundary joining existing workbook preparation to the E5B saga/repository. |
| `app/api/import/batches/route.ts` | Dark read-only workflow/history endpoint. |
| `app/api/import/batches/[id]/route.ts` | Dark read-only batch evidence endpoint. |
| `scripts/neon/validate-e5b-import-staging.mjs` | Source, dry-run, child apply, catalog, runtime, isolation, rollback, and injected Storage-saga validation. |
| `docs/neon/e5b-import-staging-verification.md` | Redacted child-branch evidence, matrix result, deferred activation blockers and rollback notes. |

The implementation must not edit `app/repositories/registry.ts` or `app/api/import/inspect/route.ts`.

---

### Task 1: Establish the RED contract and child-connection validator

**Files:**
- Create: `scripts/neon/validate-e5b-import-staging.mjs`
- Create: `app/repositories/contracts/import-staging-repository.ts`
- Read only: `app/api/import/inspect/route.ts`
- Read only: `scripts/neon/validate-e5a-employee-write.mjs`

**Interfaces produced:**

```ts
export type ImportStorageLifecycle =
  | "intent_created"
  | "uploaded_unverified"
  | "verification_failed"
  | "verified"
  | "linked"
  | "cleanup_pending"
  | "cleanup_in_progress"
  | "cleanup_failed"
  | "cleanup_completed";

export type ImportWorkbookLifecycle =
  | "intent_created"
  | "inspecting"
  | "mapping_required"
  | "failed";

export type ImportVerificationStatus = "pending" | "passed" | "failed";

export type CreateImportUploadIntentInput = {
  batchId: string;
  originalFilename: string;
  sanitizedFilename: string;
  declaredChecksumSha256: string;
  declaredSizeBytes: number;
  declaredMimeType: string;
  sourceSystem: string;
};

export type RecordImportObjectVerificationInput = {
  batchId: string;
  expectedVersion: number;
  verifiedChecksumSha256: string;
  verifiedSizeBytes: number;
  verifiedMimeType: string;
  status: "passed" | "failed";
  failureReason: string | null;
};

export type ImportUploadIntent = {
  batchId: string;
  objectPath: string;
  storageLifecycle: "intent_created";
  workbookLifecycle: "intent_created";
  verificationStatus: "pending";
  version: number;
};

export type ImportSagaState = {
  batchId: string;
  storageLifecycle: ImportStorageLifecycle;
  workbookLifecycle: ImportWorkbookLifecycle;
  verificationStatus: ImportVerificationStatus;
  version: number;
};

export type StageVerifiedWorkbookInput = {
  batchId: string;
  expectedVersion: number;
  evidence: {
    batch: Readonly<Record<string, unknown>>;
    sheets: readonly Readonly<Record<string, unknown>>[];
    fieldMappings: readonly Readonly<Record<string, unknown>>[];
    sourceRows: readonly Readonly<Record<string, unknown>>[];
    issues: readonly Readonly<Record<string, unknown>>[];
    sourceLabels: readonly Readonly<Record<string, unknown>>[];
  };
};

export type ImportStagingResult = ImportSagaState & {
  storageLifecycle: "linked";
  workbookLifecycle: "mapping_required";
};

export type MarkCleanupPendingInput = {
  batchId: string;
  expectedVersion: number;
  reason: string;
};

export type ClaimDueCleanupInput = { limit: number; claimId: string };
export type ImportCleanupClaim = {
  batchId: string;
  bucket: "property-import-files";
  objectPath: string;
  claimId: string;
  attemptCount: number;
  leaseExpiresAt: string;
};
export type CompleteCleanupInput = { batchId: string; claimId: string };
export type FailCleanupInput = {
  batchId: string;
  claimId: string;
  error: string;
  nextAttemptAt: string;
};

export type ImportWorkflowProjection = {
  batchId: string;
  fileName: string;
  storageLifecycle: ImportStorageLifecycle;
  workbookLifecycle: ImportWorkbookLifecycle;
  verificationStatus: ImportVerificationStatus;
  counts: { total: number; valid: number; warning: number; error: number };
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type ImportHistoryItem = ImportWorkflowProjection;

export interface ImportStagingRepository {
  createUploadIntent(input: CreateImportUploadIntentInput): Promise<ImportUploadIntent>;
  recordObjectUploaded(batchId: string, expectedVersion: number): Promise<ImportSagaState>;
  recordObjectVerification(input: RecordImportObjectVerificationInput): Promise<ImportSagaState>;
  stageVerifiedWorkbook(input: StageVerifiedWorkbookInput): Promise<ImportStagingResult>;
  markCleanupPending(input: MarkCleanupPendingInput): Promise<ImportSagaState>;
  claimDueCleanup(input: ClaimDueCleanupInput): Promise<ImportCleanupClaim | null>;
  completeCleanup(input: CompleteCleanupInput): Promise<ImportSagaState>;
  failCleanup(input: FailCleanupInput): Promise<ImportSagaState>;
  getWorkflow(batchId: string): Promise<ImportWorkflowProjection | null>;
  listHistory(): Promise<readonly ImportHistoryItem[]>;
}
```

All repository construction receives trusted `hostname`, `tenantId`, and `propertyId` from the authorization service, not from these method inputs. Replace the `Readonly<Record<string, unknown>>` transport records with named, exact staging-evidence types copied from the already parsed fields in `PreparedEmployeeMasterStaging`; those types must contain no arbitrary database column or authorization field. Full checksums and Storage paths are server-internal and absent from browser projection types.

- [ ] Implement validator URL guards copied structurally from E5A with constants for the approved child/production branch, endpoints, database `neondb`, bootstrap role `neondb_owner`, and runtime role `hotel_ld_application`.
- [ ] Support exact commands `source`, `dry-run`, `apply`, `catalog`, `runtime`, and `storage-runtime`.
- [ ] In `source`, require all three planned migration files, all planned server files, the exact entrypoint names from Tasks 3 and 4, `security definer`, `set search_path = ''`, FORCE RLS, exact revoke/grant fragments, byte read-back logic, and the unchanged `actorClient.rpc("stage_employee_import")` literal.
- [ ] Make `source` fail now because migrations/repositories/services do not exist.
- [ ] Run: `node scripts/neon/validate-e5b-import-staging.mjs source`
- [ ] Expected: failure `E5B_IMPORT_STAGING_SOURCE_CONTRACT_MISSING` without opening a network connection.
- [ ] Commit: `test(neon): define e5b import staging red contract`

---

### Task 2: Create the E5B schema, lifecycle constraints, RLS and audit base

**Files:**
- Create: `neon/migrations/202608070017_e5b_import_staging_schema.sql`
- Modify: `scripts/neon/validate-e5b-import-staging.mjs`

**Migration objects:**

1. `public.import_batches`
   - Trusted tenancy: `tenant_id`, `property_id`, `created_by_auth_user_id`.
   - Workbook evidence: original/sanitized filenames, source system, declared/verified checksum, size and MIME.
   - Separate states: `storage_lifecycle`, `workbook_lifecycle`, `verification_status`.
   - Counts: detected sheets, total/valid/warning/error rows.
   - `version bigint not null default 1`, timestamps, linked timestamp, failure reason.
2. `public.import_sheets`
3. `public.import_source_rows`
4. `public.import_field_mappings`
5. `public.import_issues`
6. `public.import_source_label_resolutions`
   - Evidence only; E5B creates pending department/position source labels and does not resolve them.
7. `app_private.import_storage_operations`
   - Operation state, attempt count, last attempt/request IDs, last error, next attempt, claim ID, lease expiry.
8. `app_private.import_activity_events`
   - Append-only actor/request/batch/property event snapshots.

**Required invariants:**

- Unique `(id, tenant_id, property_id)` parent keys and composite child foreign keys prevent cross-property attachment.
- Object path follows exactly `<tenant>/<property>/imports/<batch>/<sanitized filename>` and is created server-side.
- SHA-256 values are 64 lowercase hexadecimal characters; sizes are positive and capped at the existing workbook upload limit.
- Storage lifecycle allows only the approved success/failure transitions; workbook lifecycle has a separate transition function.
- `verification_status='passed'` requires all verified evidence fields and exact equality of declared and verified checksum/size plus MIME compatibility.
- `storage_lifecycle='linked'` requires `verification_status='passed'` and `workbook_lifecycle='mapping_required'`.
- Cleanup claims have a UUID and future lease only while `cleanup_in_progress`.
- Audit updates/deletes raise an exception. No cascade can delete audit history.

- [ ] Start and end the migration with `begin;` and `commit;`.
- [ ] Transfer ownership to `hotel_ld_migration_owner`; do not leave `neondb_owner` as owner.
- [ ] Enable and FORCE RLS on every public and private E5B table.
- [ ] Create application policies only for the internal execution path required by constrained entrypoints; keep direct application table ACL at zero.
- [ ] Revoke PUBLIC and `hotel_ld_application` raw table/sequence privileges explicitly.
- [ ] Add indexes for property history, batch children, source label evidence, due cleanup, claim expiry and request/event lookup.
- [ ] Add append-only trigger to `app_private.import_activity_events`.
- [ ] Extend validator source assertions for all eight tables, constraints, FORCE RLS, audit trigger and ACL revokes.
- [ ] Run: `node scripts/neon/validate-e5b-import-staging.mjs source`
- [ ] Expected: still RED because saga and staging entrypoints and application files are absent.
- [ ] Commit: `feat(neon): add e5b import staging schema foundation`

---

### Task 3: Add constrained saga and read-projection entrypoints

**Files:**
- Create: `neon/migrations/202608070018_e5b_import_saga_entrypoints.sql`
- Modify: `scripts/neon/validate-e5b-import-staging.mjs`

**Entrypoints produced:**

```text
public.create_neon_import_upload_intent(text,uuid,text,text,text,bigint,text,text)
public.record_neon_import_object_uploaded(text,uuid,bigint)
public.record_neon_import_object_verification(text,uuid,bigint,text,bigint,text,text,text)
public.mark_neon_import_cleanup_pending(text,uuid,bigint,text)
public.claim_neon_import_cleanup(text,uuid,integer,uuid)
public.complete_neon_import_cleanup(text,uuid,uuid,uuid)
public.fail_neon_import_cleanup(text,uuid,uuid,uuid,text,timestamptz)
public.get_neon_import_workflow(text,uuid)
public.list_neon_import_history(text)
```

The first argument is trusted hostname. Actor, tenant, property, role and request ID come only from E1 Actor Context and live Neon membership. UUID cleanup claim IDs are server-generated and stored with a five-minute lease. A completion/failure call must match the current unexpired claim and current property.

- [ ] Add a private authorization helper that asserts actor context, resolves hostname/property, and requires current property manager role. Do not edit E1 helpers.
- [ ] `create_neon_import_upload_intent` derives tenant/property/actor/request, builds the object path, inserts batch + initial storage operation + audit, and returns server-internal intent state.
- [ ] `record_neon_import_object_uploaded` locks the batch, enforces expected version and `intent_created`, transitions only to `uploaded_unverified`, increments version and audits.
- [ ] `record_neon_import_object_verification` locks the batch and records declared and verified evidence. `passed` transitions to `verified`; mismatch/failure transitions to `verification_failed` and creates/updates cleanup obligation atomically.
- [ ] `mark_neon_import_cleanup_pending` is idempotent for any uploaded-but-unlinked object and never makes a linked object cleanup-eligible.
- [ ] `claim_neon_import_cleanup` selects only due same-property work with `for update skip locked`, reclaims expired leases, increments `attempt_count`, stores current request ID, and returns exact server-only bucket/path plus claim ID.
- [ ] Completion/failure entrypoints validate claim ownership. Completion marks cleanup completed and audits; failure stores a bounded error, next-attempt time and audits.
- [ ] Read functions return browser-safe projections: filenames, lifecycle states, counts, timestamps and abbreviated checksum status; never object path or full hashes.
- [ ] Give every entrypoint the owner/search path/PUBLIC/application EXECUTE treatment in Global Constraints.
- [ ] Add source/catalog assertions for signatures, owner, `prosecdef`, `proconfig`, exact grants, no PUBLIC EXECUTE and no raw application ACL.
- [ ] Run: `node scripts/neon/validate-e5b-import-staging.mjs source`
- [ ] Expected: still RED because staging entrypoints and services are absent.
- [ ] Commit: `feat(neon): add e5b import storage saga entrypoints`

---

### Task 4: Add atomic, bounded workbook-staging entrypoints

**Files:**
- Create: `neon/migrations/202608070019_e5b_import_staging_entrypoints.sql`
- Modify: `scripts/neon/validate-e5b-import-staging.mjs`

**Entrypoints produced:**

```text
public.begin_neon_import_staging(text,uuid,bigint,jsonb)
public.append_neon_import_sheets(text,uuid,jsonb)
public.append_neon_import_field_mappings(text,uuid,jsonb)
public.append_neon_import_source_rows(text,uuid,jsonb)
public.append_neon_import_issues(text,uuid,jsonb)
public.append_neon_import_source_labels(text,uuid,jsonb)
public.finalize_neon_import_staging(text,uuid,bigint,jsonb,text)
```

These functions are called on one database client inside one `withNeonActorContext` transaction. `begin` obtains and holds the batch row lock until the caller transaction commits/rolls back. Chunk entrypoints must prove that the lock belongs to the current transaction with `pg_try_advisory_xact_lock`/transaction-local staging guard or equivalent private guard; they may not be safely callable as independent commits.

- [ ] `begin` requires manager, same property, `verified`, `verification_status='passed'`, workbook `intent_created`, and exact expected version; it changes workbook state to `inspecting` without incrementing the public version yet.
- [ ] Each append entrypoint rejects unknown JSON keys, empty/oversized payloads, duplicate IDs, cross-batch IDs, invalid enum values and child references outside the same batch/property.
- [ ] Source row payload never includes training, payroll, CTC or employee commit facts.
- [ ] Source labels are inserted only as pending evidence for `department` and `position`.
- [ ] `finalize` recomputes database counts from staged rows, verifies the supplied deterministic evidence manifest/hash, verifies exactly one selected employee-master sheet, transitions workbook to `mapping_required`, storage to `linked`, increments version once and appends the lifecycle audit.
- [ ] Any function failure leaves the outer transaction abortable. A late finalize failure must roll back every sheet, row, mapping, issue and source-label insert from that staging attempt.
- [ ] Apply the exact function ACL hardening from Global Constraints.
- [ ] Extend source/catalog checks for all signatures, transaction lock behavior, state guards, exact grants and absence of commit/revert SQL.
- [ ] Run: `node scripts/neon/validate-e5b-import-staging.mjs source`
- [ ] Expected: still RED because repository and services are absent.
- [ ] Commit: `feat(neon): add atomic e5b workbook staging entrypoints`

---

### Task 5: Implement deterministic chunking and the Neon repository

**Files:**
- Create: `app/repositories/neon/import-staging-repository.ts`
- Modify: `app/repositories/contracts/import-staging-repository.ts`
- Modify: `scripts/neon/validate-e5b-import-staging.mjs`

**Interfaces consumed:** E5B contract from Task 1, `NeonQueryable`, the entrypoints from Tasks 3 and 4.

**Chunk strategy:**

- Sort each evidence collection deterministically before hashing and sending.
- Source rows: maximum 250 rows and maximum 1 MiB of serialized UTF-8 JSON per call.
- Sheets, mappings, issues and source labels: maximum 250 records and maximum 512 KiB per call.
- If one record exceeds its byte limit, reject before the first staging SQL call with `E5B_IMPORT_STAGING_RECORD_TOO_LARGE`.
- Chunking is transport control only. No partial-progress lifecycle exists and no chunk is committed independently.
- The repository calls `begin`, every chunk, and `finalize` on the same `NeonQueryable` supplied by one Actor Context transaction.
- Compute SHA-256 over a canonical manifest containing ordered collection counts and ordered record hashes. The database recomputes its corresponding evidence before linking.

- [ ] Implement `createNeonImportStagingRepository(database, trustedHostname, trustedScope)`; never accept scope from browser input.
- [ ] Map every SQL payload with strict record/string/integer/enum checks and fail closed with `NEON_IMPORT_STAGING_PAYLOAD_INVALID:<field>`.
- [ ] Do not catch and downgrade SQL errors in the repository.
- [ ] Add validator source checks proving bounded chunk constants, byte-length checks, deterministic sort/hash and absence of `commitBatch`, `revertBatch`, employee DML and direct table SQL.
- [ ] Run: `node scripts/neon/validate-e5b-import-staging.mjs source`
- [ ] Expected: still RED because authorization, verifier, coordinator and APIs are absent.
- [ ] Commit: `feat(neon): add e5b import staging repository`

---

### Task 6: Implement trusted read-back byte verification

**Files:**
- Create: `app/services/import/storage-object-verification.ts`
- Modify: `scripts/neon/validate-e5b-import-staging.mjs`

**Interfaces produced:**

```ts
export type StorageObjectReader = {
  download(bucket: string, objectPath: string): Promise<Uint8Array>;
};

export type VerifiedWorkbookObject = {
  checksumSha256: string;
  sizeBytes: number;
  contentDerivedMimeType: string;
};

export async function verifyWorkbookStorageObject(input: {
  reader: StorageObjectReader;
  bucket: "property-import-files";
  objectPath: string;
  sanitizedFilename: string;
  declaredChecksumSha256: string;
  declaredSizeBytes: number;
  declaredMimeType: string;
}): Promise<VerifiedWorkbookObject>;
```

- [ ] `download` must return newly read bytes after upload; upload response and Storage metadata cannot satisfy this interface.
- [ ] Recompute SHA-256 with Node `crypto.createHash("sha256")` over the downloaded bytes and compare using `timingSafeEqual` after validating both hex strings.
- [ ] Recompute exact byte length.
- [ ] Derive MIME from content:
  - XLS requires OLE compound-file magic and a successful SheetJS workbook parse.
  - XLSX requires ZIP magic and a successful SheetJS workbook parse; declared filename must be `.xlsx`.
  - CSV requires valid UTF-8, no NUL bytes, a successful existing workbook parser inspection and `.csv` filename.
- [ ] Reject an extension/content or declared/content mismatch. Do not use client type or Storage metadata as the derived MIME.
- [ ] Return no bytes and no object path to callers after verification.
- [ ] Add deterministic in-memory verifier assertions to validator `source` mode for checksum mismatch, size mismatch, MIME mismatch and valid CSV/XLSX fixtures without network access.
- [ ] Run: `node scripts/neon/validate-e5b-import-staging.mjs source`
- [ ] Expected: still RED because coordinator and APIs are absent.
- [ ] Commit: `feat(import): verify uploaded workbooks from read-back bytes`

---

### Task 7: Implement authorization, saga coordinator and retryable cleanup

**Files:**
- Create: `app/services/neon-import-staging-authorization.ts`
- Create: `app/services/import/storage-saga-coordinator.ts`
- Create: `app/services/import/storage-cleanup-executor.ts`
- Modify: `scripts/neon/validate-e5b-import-staging.mjs`

**Authorization boundary:**

```ts
export async function runAuthorizedNeonImportStaging<T>(
  request: Request,
  requestId: string,
  operation: (context: AuthorizedImportStagingContext) => Promise<T>,
): Promise<{ data: T; headers: Headers }>;
```

`AuthorizedImportStagingContext` contains the trusted actor Storage client, the repository bound to the existing Neon transaction, hostname, and browser-safe response headers. It does not expose tenant/property selection to request bodies.

**Saga order:**

1. Authorized Neon transaction creates upload intent and commits.
2. Server uploads bytes to the exact returned path in Supabase Storage.
3. A new authorized Neon transaction records `uploaded_unverified`.
4. Server downloads the object again and verifies actual bytes.
5. A new authorized Neon transaction records verification result.
6. Existing workbook parser produces evidence from the verified downloaded bytes, not the original browser buffer.
7. One authorized Neon transaction begins, chunks and finalizes staging.
8. Only successful finalization marks Storage `linked` and workbook `mapping_required`.

**Cleanup execution strategy:**

- Immediate compensation is attempted after any upload-success/pre-link failure.
- Persist `cleanup_pending` before calling Storage deletion.
- Claim due work in a fresh authenticated manager Actor Context for the same property; do not impersonate the original user and do not add a system role.
- The claim entrypoint uses `for update skip locked`, a random claim UUID and a five-minute lease. Concurrent executors cannot delete the same object under different active claims.
- Delete only the exact bucket/path returned by the claim via the server Storage client; never delete by prefix and never issue SQL against `storage.objects`.
- Persist success/failure in a new Actor Context transaction. Failure increments the attempt, stores current request ID/last error, and schedules exponential delays of 30 seconds, 2 minutes, 10 minutes, 1 hour, then 6 hours capped.
- Expired claims are reclaimable. A successful or linked object is never claimable.
- E5B exposes no browser cleanup route and configures no autonomous scheduler. The dark staging boundary runs one same-property due cleanup before/after an authenticated import attempt. Scheduler/system-principal design remains a later activation decision.

- [ ] Map auth failures to 401, property/role failures to 403, missing batch to 404, stale/claim/serialization conflicts to 409, evidence/state validation to 422 and unavailable service to 503.
- [ ] Preserve refreshed Supabase Auth cookies.
- [ ] Ensure Storage calls happen outside database callbacks; database callbacks remain short and transaction-scoped.
- [ ] When staging rolls back, record cleanup pending in a separate subsequent transaction, then run cleanup. Never describe the failed staging transaction as owning the Storage deletion.
- [ ] Add source assertions for saga ordering, read-back-before-parse, no service-role business DB substitution, exact-path deletion, lease/retry schedule and route preservation.
- [ ] Run: `node scripts/neon/validate-e5b-import-staging.mjs source`
- [ ] Expected: still RED because dark boundary/APIs are absent.
- [ ] Commit: `feat(import): add e5b storage saga coordinator`

---

### Task 8: Build the dark inspection boundary and read-only APIs

**Files:**
- Create: `app/services/import/neon-import-inspection-boundary.ts`
- Create: `app/api/import/batches/route.ts`
- Create: `app/api/import/batches/[id]/route.ts`
- Create: `app/api/import/batches/input.ts`
- Modify: `scripts/neon/validate-e5b-import-staging.mjs`
- Read only: `app/api/import/inspect/route.ts`

**Dark boundary contract:**

```ts
export async function inspectAndStageWorkbookInNeon(input: {
  request: Request;
  requestId: string;
  file: File;
}): Promise<{ batchId: string; status: "mapping_required"; summary: BrowserSafeImportSummary }>;
```

- [ ] Reject query-selected tenant/property/role and reject identity/scope fields in JSON/form inputs.
- [ ] Reuse `prepareEmployeeMasterStaging`, but call it only with the verified read-back bytes returned by Task 6.
- [ ] Return the same browser-safe inspection summary shape currently produced by inspect; never return full checksum, object path, raw source rows or audit internals.
- [ ] `GET /api/import/batches` lists current-property workflow history through Neon HTTP and accepts only bounded pagination parameters.
- [ ] `GET /api/import/batches/[id]` returns same-property batch workflow/evidence or 404; cross-property objects are indistinguishable from missing.
- [ ] Both APIs require `APP_DATA_MODE=neon`, Supabase Auth verification, Actor Context and manager authorization; they are dark endpoints and do not alter registry selection.
- [ ] Do not add a POST route that activates Neon inspect. Do not edit `app/api/import/inspect/route.ts`.
- [ ] Extend validator source checks for same-origin API shapes, no browser Neon imports, `server-only` repository/services, and exact unchanged inspect RPC call.
- [ ] Run: `node scripts/neon/validate-e5b-import-staging.mjs source`
- [ ] Expected: PASS with no database connection.
- [ ] Run: `npm test`
- [ ] Expected: existing 201/201 baseline remains green; no existing test file was changed.
- [ ] Run: `npm run build`
- [ ] Expected: production build succeeds and client chunks contain no `pg`, `DATABASE_URL`, bootstrap URL or Neon credential.
- [ ] Commit: `feat(import): add dark e5b staging boundary and history api`

---

### Task 9: Validate migrations on the child branch

**Files:**
- Modify: `scripts/neon/validate-e5b-import-staging.mjs`
- Create: `docs/neon/e5b-import-staging-verification.md`

**Execution order:**

- [ ] Run source validation before reading credentials:
  `node scripts/neon/validate-e5b-import-staging.mjs source`
- [ ] Run bootstrap rollback validation:
  `node scripts/neon/validate-e5b-import-staging.mjs dry-run`
- [ ] Expected: validator confirms child branch/endpoint/database/owner role, applies all three migrations inside an outer transaction, validates objects, rolls back, then proves no dry-run objects persisted.
- [ ] Apply to child only:
  `node scripts/neon/validate-e5b-import-staging.mjs apply`
- [ ] Catalog validation:
  `node scripts/neon/validate-e5b-import-staging.mjs catalog`
- [ ] Record redacted values only: child branch ID, endpoint ID, database, role names and pass/fail booleans.

**Catalog matrix:**

- All eight relations owned by migration owner, FORCE RLS, expected constraints/indexes/triggers present.
- Every public entrypoint owned by migration owner, `SECURITY DEFINER`, exact empty search path, no PUBLIC EXECUTE, exact application EXECUTE.
- `hotel_ld_application` is login, NOBYPASSRLS, does not own tables/functions, has raw privileges of zero.
- Audit relation has no UPDATE/DELETE/TRUNCATE path and append-only trigger is enabled.
- No employee commit/revert routine, employee DML grant, registry object or Storage schema object was created.

- [ ] Commit: `docs(neon): record e5b child catalog validation`

---

### Task 10: Run runtime, isolation, rollback and Storage-saga matrices

**Files:**
- Modify: `scripts/neon/validate-e5b-import-staging.mjs`
- Modify: `docs/neon/e5b-import-staging-verification.md`

**Runtime fixtures:** Create all property, actor and batch fixtures inside validator-owned transactions on the child branch and roll them back. Use only synthetic workbooks and synthetic Supabase Storage paths under the approved development property. Never read production business data.

**Database runtime matrix:**

- [ ] Unauthenticated/missing Actor Context denied.
- [ ] Department admin denied for intent, staging, cleanup and history.
- [ ] Property manager can create intent and read same-property workflow/history.
- [ ] Cross-property intent/batch/cleanup access is denied or 404 as specified.
- [ ] Stale expected version returns conflict and changes no state.
- [ ] Verification cannot pass on checksum, size or content MIME mismatch.
- [ ] Unverified object cannot begin staging.
- [ ] Finalization recomputes counts/hash and rejects tampering.
- [ ] Inject a failure in the last staging chunk/finalize; prove all staged database evidence rolls back while the already uploaded object remains represented by cleanup obligation.
- [ ] Two concurrent cleanup claims serialize with `skip locked`; only one active claim receives an object.
- [ ] Expired claim is reclaimable; wrong claim completion/failure is rejected.
- [ ] Audit before/after snapshots and request IDs are correct and immutable.
- [ ] Actor context disappears after rollback, connection reuse leaks no context, concurrent actors do not cross.
- [ ] Direct table read/write and direct private table access by application role fail.

**Storage runtime matrix (`storage-runtime`):**

- [ ] Use dependency-injected Storage gateway first: upload response success followed by corrupted read-back must record verification failure and cleanup pending.
- [ ] Verify SHA-256, exact byte count and content-derived MIME from actual read-back bytes.
- [ ] Simulate first deletion failure then success; prove attempts, request IDs, last error, backoff and completion audit.
- [ ] Prove exact-path deletion; sibling/prefix objects are untouched.
- [ ] If real child Supabase Storage validation is configured, use only a synthetic object and remove it at test end. Never print credentials or object contents.
- [ ] Record the known activation gate: linked-object Storage ACL policy transition is not part of E5B and must be separately reviewed before `/api/import/inspect` switches to Neon.

- [ ] Run: `node scripts/neon/validate-e5b-import-staging.mjs runtime`
- [ ] Run: `node scripts/neon/validate-e5b-import-staging.mjs storage-runtime`
- [ ] Commit: `docs(neon): verify e5b import staging runtime matrix`

---

### Task 11: Final regression, scope audit and merge readiness

**Files:**
- Modify only if evidence needs correction: `docs/neon/e5b-import-staging-verification.md`

- [ ] Run: `git diff --name-only 1ac5a97...HEAD`
- [ ] Confirm only the files listed in this plan are present.
- [ ] Run: `rg -n "stage_employee_import" app/api/import/inspect/route.ts`
- [ ] Confirm the current actor-scoped Supabase RPC call is unchanged.
- [ ] Run: `git diff 1ac5a97...HEAD -- app/api/import/inspect/route.ts app/repositories/registry.ts app/lib/neon/actor-context.ts`
- [ ] Expected: no diff.
- [ ] Run: `npm test`
- [ ] Expected: 201 tests, 201 pass, 0 fail, including the build embedded in the suite.
- [ ] Run: `npm run build`
- [ ] Expected: pass.
- [ ] Run: `git status --short`
- [ ] Confirm `.superpowers/`, scratch files, credential files, generated fixtures and temporary verification output are absent.
- [ ] Confirm main-worktree B-class changes were never copied, overwritten, staged or committed.
- [ ] Confirm registry remains inactive, existing inspect stays Supabase-backed, and no automatic fallback or activation was added.
- [ ] Commit any verification-only correction as: `docs(neon): finalize e5b import staging verification`

## Validation Gate Summary

E5B is merge-ready only when all of the following are true:

- Source validator passes without a database connection.
- Bootstrap dry-run rolls back cleanly on the approved child.
- Child apply and catalog checks pass.
- Runtime uses pooled `hotel_ld_application`, which remains NOBYPASSRLS and has zero raw E5B table privilege.
- Manager, department-admin, unauthenticated and cross-property behavior matches the matrix.
- Verification is based on actual downloaded bytes and detects checksum, size and content MIME mismatch.
- Staging evidence is all-or-nothing despite bounded transport chunks.
- Cleanup is durable, leased, exact-path, retryable and audited; Storage calls never occur inside a Neon transaction.
- `npm test` reports 201/201 and `npm run build` passes.
- `/api/import/inspect`, registry, Actor Context, Auth and Storage provider remain unchanged.

## Deliberately Deferred After E5B

- Switching `/api/import/inspect` from `actorClient.rpc("stage_employee_import")` to the dark Neon boundary.
- Supabase Storage policy transition for linked-object protection under Neon authority.
- Autonomous cleanup scheduler/system-principal design.
- Field/source-label decisions beyond pending evidence.
- Employee preview, import commit, employee mutation orchestration and revert.
- Import registry activation, Auth migration and Storage provider replacement.
