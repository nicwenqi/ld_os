# E5B Import Staging Foundation Design

## Goal

Establish the Neon authority for employee-import staging evidence, workbook
lifecycle, Storage saga state, and property-scoped batch history without
implementing employee commit, import commit, revert, final Storage replacement,
Auth migration, registry activation, or UI switching.

Supabase Auth continues to prove identity. Supabase Storage temporarily holds
private workbook objects. Neon owns all E5B business state. No operation treats
Storage and Neon as one transaction, and a Neon rollback never implies that an
uploaded object was deleted.

## Scope

E5B implements:

- an actor- and property-scoped upload intent;
- complete server-side read-back verification of uploaded object bytes;
- immutable workbook, sheet, source-row, field-mapping, issue, and source-label
  evidence;
- separate workbook and Storage lifecycle state machines;
- a durable, retryable cleanup ledger;
- append-only lifecycle audit;
- manager-only workflow and batch-history projections;
- dark server repository and same-origin HTTP contracts required before the
  existing Import route can switch its staging implementation.

E5B does not implement:

- Employee mutation or use of the E5A write entrypoint;
- Import preview, commit, commit items, or revert;
- field-mapping approval, source-label resolution, or issue resolution;
- final Storage-provider replacement;
- Supabase Auth migration;
- Organization, Position, or Import registry activation;
- browser access to Neon or raw staging tables.

## Selected Architecture

Three approaches were considered:

1. **Durable Neon intent plus server Storage gateway and verified staging.**
   Neon records the intent first, the server uploads and reads back the object,
   then Neon records verification and atomically stages evidence. This is the
   selected design because every cross-system outcome is recoverable and
   auditable.
2. **Upload first, then create the Neon batch.** This is simpler but a process
   crash after upload leaves no durable cleanup instruction or ownership record.
   It is rejected.
3. **Mirror linkage state into Supabase Database for Storage RLS.** This allows
   Supabase policies to observe linkage but creates dual business authorities and
   a new consistency problem. It is rejected.

The selected request flow is:

```text
Supabase Auth verification
  -> trusted hostname/property resolution
  -> Neon actor transaction: create upload intent
  -> Supabase Storage: upload exact object path with upsert disabled
  -> Supabase Storage: read back actual object bytes
  -> server: recompute SHA-256, byte size, and verified MIME
  -> Neon actor transaction: record successful object verification
  -> Neon actor transaction: atomically stage and seal all workbook evidence
  -> Neon batch becomes linked and visible in workflow/history projections
```

Upload, read-back, verification recording, and staging are intentionally
separate steps. Each step is idempotent within the allowed lifecycle state.

## Trust and Authorization Boundary

The browser supplies only the workbook file and workflow commands. It never
supplies tenant, property, role, actor, request ID, object path, lifecycle state,
verification result, or cleanup authority.

The server verifies the Supabase Auth session and derives `authUserId`. Trusted
hostname/property resolution derives the property. Existing E1 transaction-local
Actor Context carries `authUserId`, property ID, and request ID into every Neon
operation. Neon re-reads live membership and role facts; a browser session role is
not sufficient authorization evidence.

Only an active `property_ld_manager` may create, verify, stage, read, or list
Import batches. Department administrators have no E5B read or write access.

`hotel_ld_application` remains `NOBYPASSRLS`, owns no objects, and has no raw
privileges on E5B tables. Every runtime database operation uses a constrained
`SECURITY DEFINER` entrypoint owned by `hotel_ld_migration_owner`, with
`search_path = ''`, `PUBLIC EXECUTE` revoked, and an exact EXECUTE grant to
`hotel_ld_application`.

## Database Model

### `import_batches`

One row is the authoritative workbook/import aggregate. It records:

- server-generated batch ID, tenant ID, and property ID;
- import type and source system;
- original and sanitized filename;
- provider, bucket, and server-derived immutable object path;
- declared SHA-256, declared byte size, and declared MIME;
- verified SHA-256, verified byte size, verified MIME, and verification time;
- verification status: `pending`, `passed`, or `failed`;
- workbook lifecycle and Storage lifecycle as separate columns;
- expected evidence counts and sealed evidence hash;
- creator actor, request ID, timestamps, and optimistic version.

The full checksum and object path are internal evidence and are not returned in
browser projections. Tenant, property, batch ID, object path, declared evidence,
and creator are immutable after intent creation.

### `import_sheets`

Stores detected sheet evidence: stable ID, batch scope, sheet name/index,
header-row evidence, row/column counts, hidden state, inferred purpose, selection
state, and creation time. E5B does not allow later browser mutation of sheet
selection.

### `import_source_rows`

Stores immutable raw evidence and its initial server projection: batch/sheet
scope, source row number, `raw_values`, initial `normalized_values`, row
fingerprint, initial processing state, validation summary, and timestamps.

Raw values, source identity, row fingerprint, tenant, property, batch, and sheet
are immutable. E5B exposes no browser endpoint that returns raw values. E5C may
replace normalized projections only through a separately reviewed constrained
entrypoint; it never overwrites raw evidence.

### `import_field_mappings`

Stores the parser's initial mapping evidence: source column identity/index,
suggested target, transformation rule, required flag, and `suggested` or
`excluded` state. E5B does not approve or mutate mappings after staging.

### `import_issues`

Stores parser-discovered issues with batch/source-row scope, type, severity,
allowlisted source field/value projection, business message, initial resolution
state, and timestamps. E5B permits only initial issue insertion during sealed
staging. E5C owns issue decisions.

### `import_source_label_resolutions`

Preserves current contract naming while acting as E5B source-label evidence.
Each row stores type, original/normalized label, source sheet, affected-row
count, and initial `pending` decision. It has no independent Organization or
Position mapping authority. E5C will link it to E3/E4 domain authority and store
the batch-specific resolution snapshot.

`import_resolution_rules` is not migrated. Persistent Department and Position
mapping authority remains in E3/E4 alias objects.

### `import_storage_operations`

One durable ledger row represents the current cleanup obligation for a batch.
It records:

- batch/property scope and exact immutable object path;
- operation type (`delete_unlinked_object` in E5B);
- state: `not_required`, `cleanup_pending`, `cleanup_in_progress`,
  `cleanup_completed`, or `cleanup_failed`;
- attempt count, last attempt time, next attempt time, last error code/message;
- originating and latest request IDs;
- created/updated/completed timestamps.

The ledger is not a general-purpose job queue. E5B permits at most one active
cleanup operation per batch/object. Error text is bounded and sanitized before
persistence.

### `import_activity_events`

Append-only event evidence records actor, request ID, batch/property scope,
event type, prior/new workbook lifecycle, prior/new Storage lifecycle, bounded
payload, and transaction timestamp. Update/delete are rejected by trigger.
Runtime roles cannot read or mutate the table directly.

## Separate Lifecycle State Machines

### Storage lifecycle

The successful path is exact:

```text
intent_created -> uploaded_unverified -> verified -> linked
```

Failure and cleanup states are exact:

```text
intent_created -> cleanup_pending -> cleanup_completed
uploaded_unverified -> verification_failed -> cleanup_pending -> cleanup_completed
verified -> cleanup_pending -> cleanup_completed
cleanup_pending -> cleanup_failed -> cleanup_pending
```

Rules:

- `uploaded_unverified` means the Storage upload returned success but no content
  trust has been established.
- `verified` means actual persisted bytes were read back and all three checks
  passed: SHA-256, byte size, and MIME.
- `linked` means the verified object and the complete staged evidence graph were
  sealed successfully in Neon.
- `verification_failed` can never transition to staging or linked.
- cleanup may be retried from `cleanup_failed`; a retry increments attempt count.
- an absent object during an authorized cleanup is idempotent success.
- a linked object is not eligible for E5B cleanup.

### Workbook lifecycle

E5B uses a separate workbook lifecycle:

```text
intent_created -> inspecting -> mapping_required
intent_created|inspecting -> failed
```

`mapping_required` is the only successful E5B terminal state. Preview, importing,
completed, and reverted transitions are reserved for E5C-E5E. Storage failures do
not fabricate workbook rollback; they produce a failed workbook lifecycle plus
the independent cleanup obligation.

## Full Read-Back Verification

The server computes the declared SHA-256 and byte size from the exact bytes it
parsed before upload. After Storage reports upload success, the server downloads
the actual persisted object through the authorized Storage API and streams all
bytes through a new SHA-256 calculation. Verified MIME is derived from the
read-back content signature and approved workbook/CSV detection rules; Storage
metadata and the original filename are supporting consistency checks, not MIME
verification authority.

`object_verified` requires all of the following:

1. upload succeeded with `upsert: false`;
2. the exact server-generated object path was read back;
3. read-back SHA-256 equals the declared SHA-256;
4. read-back byte count equals the declared byte size;
5. verified MIME equals the declared allowlisted MIME and is compatible with the
   sanitized extension;
6. the batch remains in `uploaded_unverified` with the same optimistic version.

Storage response metadata, ETag, client checksum, filename, or object metadata
cannot satisfy content verification. On mismatch, Neon records declared and
verified evidence, transitions Storage to `verification_failed`, creates or
updates `cleanup_pending`, and never stages source evidence.

Only the checksum prefix and aggregate safe summary may be returned to the
browser. Full declared/verified checksums remain server/database audit evidence.

## Saga and Failure Semantics

### Intent failure

If the Neon intent transaction fails, no upload is attempted. No cleanup ledger
is needed because no object path was used externally.

### Upload failure

The server records a failed workbook lifecycle. If upload outcome is definitely
negative, Storage remains `intent_created`; if outcome is ambiguous, the server
creates `cleanup_pending` for the exact path because the object may exist.

### Read-back or verification failure

The server records `verification_failed` and `cleanup_pending`. Database rollback
does not remove the file. Cleanup executes through the Storage API and records
every attempt.

### Staging failure

The staging transaction rolls back all sheets, rows, mappings, issues, labels,
evidence seal, and linked transition. The previously verified Storage object
still exists, so a separate transaction records `cleanup_pending`. If that
follow-up record cannot be written, the server returns a high-severity failure
and emits operational telemetry containing only batch/request IDs, never source
rows or credentials.

### Process crash

Durable intent and Storage state allow reconciliation to detect stale
`intent_created`, `uploaded_unverified`, `verification_failed`, or `verified`
batches. Reconciliation never guesses that a file is absent. It checks the exact
Storage path and either resumes verification/staging under a fresh authorized
request or creates a cleanup obligation according to retention rules.

### Cleanup execution

Cleanup uses the Storage API, not SQL deletion of `storage.objects`. Each attempt
claims the ledger row with optimistic state/version checks, increments attempt
count, records request ID, and uses bounded exponential backoff. Success or
object-not-found transitions to `cleanup_completed`. Transient failure schedules
another attempt; repeated failure remains visible as `cleanup_failed` for manual
review.

## Staging EntryPoint Contract

E5B introduces these logical constrained entrypoints. Exact SQL signatures are
defined in the implementation plan, not in this design document.

### Create upload intent

Accepts trusted hostname plus declared file evidence and a server-generated
batch ID. It derives tenant/property/actor from context, validates manager role,
sanitizes/recomputes the canonical path, inserts the batch and initial activity,
and returns only batch ID, canonical path for the server Storage gateway,
optimistic version, and lifecycle states.

It rejects caller-supplied tenant, property, role, actor, lifecycle, provider
credentials, or arbitrary object path.

### Record object uploaded

Locks the batch, verifies expected version and `intent_created`, and transitions
only Storage lifecycle to `uploaded_unverified`. It records no verified checksum.

### Record object verification

Accepts server-computed verified SHA-256, byte size, MIME, expected version, and
verification outcome. It locks the batch, compares verified evidence with the
immutable declared evidence, and transitions to `verified` or
`verification_failed`. Failure atomically creates/updates the cleanup ledger.

### Stage verified batch

Requires Storage lifecycle `verified`. Inside one Actor Context transaction it:

1. locks the property/batch in stable order;
2. revalidates manager/property authorization and expected version;
3. validates sheet, mapping, row, issue, and source-label payload shapes and
   allowlists;
4. inserts all evidence, using bounded chunks inside the same transaction where
   required;
5. verifies declared counts, selected-sheet uniqueness, row fingerprints, source
   label counts, and final evidence hash;
6. appends audit;
7. transitions workbook lifecycle to `mapping_required` and Storage lifecycle to
   `linked`.

Any error rolls back the complete evidence graph and linked transition.

### Record cleanup result

Claims only a cleanup-eligible unlinked batch, enforces monotonic attempt count,
and records success, retry, or failure. The entrypoint never performs Storage
I/O itself.

### Read workflow/history projections

Manager-only read entrypoints return allowlisted DTOs. They omit raw source rows,
full checksums, object paths, cleanup error details, and internal actor data.
History returns batch ID, safe filename, workbook status, aggregate row/sheet/
issue counts, created time, and whether cleanup attention is required.

## Server and API Contract

### Current compatibility gate

`app/api/import/inspect/route.ts` keeps its existing
`actorClient.rpc("stage_employee_import")` Supabase contract until the E5B server
boundary, migration, validator, and child runtime matrix are complete. E5B
design work does not modify the route, Storage policy, or registry.

The later implementation adds an injected staging gateway with two explicit
adapters:

- Supabase fallback adapter: preserves the current actor-client RPC path;
- Neon adapter: uses the server Storage saga coordinator and
  `withNeonActorContext()`.

Mode selection is explicit. Neon failure never invokes Supabase staging as an
automatic fallback.

### Browser-visible API

The existing `POST /api/import/inspect` request and safe success response remain
compatible:

- request: multipart file only;
- success: batch ID, `mapping_required`, sanitized filename, checksum prefix,
  sheet/row/issue/source-label aggregates, and explicit excluded categories;
- failure: allowlisted message and HTTP status without object path, full
  checksum, row data, Storage error body, SQL details, or credentials.

Dark E5B APIs prepared for the future HTTP Import repository are:

- `GET /api/import/batches` for current-property history;
- `GET /api/import/batches/:id` for safe workflow projection;
- server-internal cleanup execution boundary, not a browser authorization route.

No API accepts tenant, property, role, actor, Storage lifecycle, cleanup state,
or verification result from the browser.

## Storage ACL Transition Requirement

Supabase Storage remains temporary, but the current cleanup policy cannot remain
the final E5B runtime policy because it determines linkage by reading Supabase
`import_batches`. Neon-linked objects would remain invisible to that policy.

Before E5B runtime activation, a separately reviewed Storage change must ensure:

- authenticated actors retain only the exact-path, manager-authorized first
  upload capability required by the saga;
- linked objects are not actor-deletable;
- cleanup is server-only and must be backed by a Neon `cleanup_pending` ledger;
- no Supabase business-data mirror is introduced;
- Storage service credentials never enter browser code or logs.

This requirement is part of the E5B validation gate but is not implemented by
the E5B design document.

## Migration Scope

The future child-only migration package contains:

- E5B lifecycle types or equivalent constrained text checks;
- the seven staging/history tables and the storage-operation ledger described
  above;
- immutable-scope, evidence, version, and append-only audit triggers;
- FORCE RLS policies restricted to migration-owner execution inside a valid
  Actor Context;
- constrained entrypoints for intent, upload state, verification, staging,
  cleanup result, workflow read, and history read;
- exact owner, `search_path`, REVOKE, GRANT, and raw-privilege postflight checks;
- indexes for property history, batch evidence, lifecycle reconciliation, issue
  state, source labels, and due cleanup work;
- non-destructive rollback instructions suitable for the isolated child branch.

The migration package does not contain Import commit/revert objects, E5A changes,
Supabase Storage SQL, Auth changes, registry wiring, or production identifiers.

## Error Contract

- `400`: malformed file/request or unsupported MIME/extension.
- `401`: missing or expired Supabase identity.
- `403`: inactive actor, non-manager, property/hostname authorization failure.
- `404`: batch is not visible in the actor property.
- `409`: stale batch version, duplicate batch/object intent, staging
  serialization/deadlock conflict, or lifecycle race.
- `413`: file exceeds the approved size limit.
- `422`: workbook/staging evidence is structurally invalid, count/hash mismatch,
  or verification mismatch.
- `503`: Storage or Neon dependency unavailable; cleanup obligation is recorded
  where object existence is possible.
- `500`: cleanup obligation could not be durably recorded after an ambiguous or
  known external side effect; operational escalation is required.

Provider and SQL errors are mapped at the server boundary and are never returned
verbatim.

## Validation Matrix

### Source and contract validation

- existing Import route still contains the actor-client staging RPC until the
  server boundary is approved;
- no registry, Auth, Storage policy, Employee write, Import commit, or revert
  modification is included;
- browser DTOs exclude raw rows, full checksums, object paths, and provider
  errors;
- lifecycle transitions are explicit and independent.

### Migration/catalog validation

- child branch/endpoint allowlist and Production deny-list;
- migration runs with bootstrap/migration credential only;
- entrypoint owner is `hotel_ld_migration_owner`;
- every definer entrypoint has fixed empty `search_path`;
- `PUBLIC` has no EXECUTE;
- only `hotel_ld_application` has exact runtime EXECUTE grants;
- `hotel_ld_application` is `NOBYPASSRLS`, owns no objects, and has zero raw
  staging/audit privileges;
- every staging/audit table has ENABLE and FORCE RLS;
- audit and raw evidence update/delete are rejected;
- application runtime cannot read cleanup errors, full checksums, paths, or raw
  source rows.

### Authorization and tenancy

- unauthenticated and expired sessions are rejected;
- active property manager can create/read own-property batches;
- department administrator is denied;
- inactive/locked manager is denied;
- wrong hostname/property is denied;
- cross-property batch IDs are not visible;
- browser-supplied scope/role/actor/path fields are rejected or ignored as
  untrusted input.

### Full verification

- successful upload alone remains `uploaded_unverified`;
- read-back SHA-256, size, and MIME must all match before `verified`;
- checksum mismatch, truncated object, expanded object, MIME mismatch, and wrong
  path each produce `verification_failed` and `cleanup_pending`;
- metadata/ETag-only evidence cannot mark verified;
- full checksums never appear in browser responses or committed verification
  documents.

### Staging atomicity

- successful stage writes the complete evidence graph and transitions to
  `mapping_required`/`linked` once;
- failure in a late row, issue, source label, audit insert, or seal validation
  rolls back every staging row and the linked transition;
- failed stage leaves the verified object external and creates
  `cleanup_pending` separately;
- retry with identical evidence is idempotent; differing evidence conflicts;
- large approved workbooks use bounded chunks inside one Actor Context
  transaction and remain atomic.

### Cleanup saga

- definite upload failure requires no delete but records failure state;
- ambiguous upload result produces `cleanup_pending`;
- verification or staging failure produces `cleanup_pending`;
- each retry increments attempt count and records request ID/last error;
- transient failure schedules retry without changing workbook evidence;
- object-not-found is cleanup success;
- linked object cannot be claimed for cleanup;
- process-crash reconciliation finds stale nonterminal Storage states;
- cleanup is executed through Storage API, never by deleting Storage metadata in
  SQL.

### Runtime isolation

- pooled connection uses `hotel_ld_application`;
- actor context disappears after commit and rollback;
- connection reuse leaks no actor/property/request ID;
- concurrent actors and properties do not cross;
- concurrent staging/cleanup claims serialize deterministically;
- browser bundle contains no Neon credential, `DATABASE_URL`, `pg`, Storage
  service credential, or cleanup authority.

### Regression gate

- `npm test` remains 201/201;
- `npm run build` succeeds;
- Supabase Import fallback remains active;
- Import route actor client, Auth, Storage, Actor Context, E5A, and registry
  contracts remain unchanged until separately approved activation work.

## Activation Gate

E5B may prepare dark migrations, repositories, validators, and APIs, but it does
not activate the Import registry. Activation requires all of the following:

1. child migration/catalog/runtime matrix passes;
2. full read-back verification matrix passes with real Supabase Storage and the
   Neon application credential;
3. server cleanup gateway and durable retry behavior pass;
4. the Storage ACL transition is independently reviewed and validated;
5. the current actor-client fallback contract remains recoverable;
6. browser network verification shows no Supabase business-database access and
   no Neon credential exposure.

Only after these gates may a separate E5B activation rehearsal switch Import
staging to Neon. Employee preview/commit/revert remain unavailable until E5C-E5E.
