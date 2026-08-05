# E3 Phase 2A Department write verification

**Applied and verified:** 2026-08-05

**Status:**

- Department write migration: **COMPLETE**
- Runtime/RLS behavior matrix: **COMPLETE**
- Server repository and dark API boundary: **COMPLETE**
- Organization registry activation: **NOT ACTIVATED**
- Supabase Organization fallback: **ACTIVE**
- Production identity acceptance: **DEFERRED**

Phase 2A implements only Department create, detail update, and active-state
update. It does not implement hierarchy move, existing closure rewrite,
aliases, operational units, Position, Import, Employee write, or a browser
registry switch.

## Scope and connection safety

- Approved development target: branch `br-aged-river-az1gke14`, endpoint
  `ep-sparkling-shape-az9gxtuh`, database `neondb`.
- Production deny-list: branch `br-twilight-leaf-azmowo1k`, endpoint
  `ep-wild-wave-azjmgdif`.
- The migration URL guard required the direct child endpoint and
  `current_user=session_user=neondb_owner`.
- Runtime validation required the pooled child endpoint and
  `current_user=session_user=hotel_ld_application` with `NOBYPASSRLS`.
- Connection strings and passwords were neither printed nor copied into
  browser code. The bootstrap credential was not substituted for runtime
  `DATABASE_URL`.
- Production was not connected to or modified.

## Applied migration lineage

| File/revision | SHA-256 | Child outcome |
| --- | --- | --- |
| `202608050005_e3_organization_department_write.sql`, first applied revision | `f5d1a6aeb666be9784a275049775d2d60fb5c6df95471ff239d9cbd8488d0380` | `COMMIT_OK` |
| `202608050005_e3_organization_department_write.sql`, corrected canonical source | `da6d3d23d79ff4969bb4cbbec1048a9e54baf71060ccf7ccb8b505112db0ab34` | Used for clean future environments; no second application |
| `202608050006_e3_organization_department_write_nullif_fix.sql` | `226895c54dcf4b9de3999b78b98800571643e200e6eb1175a57c307191071d46` | Dry-run `ROLLBACK_OK`, then `COMMIT_OK` |

The first true runtime probe exposed a PostgreSQL syntax error in the stored
PL/pgSQL bodies: SQL's `NULLIF` syntax construct had been written as
`pg_catalog.nullif(...)`. Function creation did not execute those paths, so the
error appeared only at runtime. The tracked `005` source was corrected so a
fresh environment cannot reproduce it. The separately reviewed `006` patch
replaced only the two affected child routine definitions and verified that
their owners, security modes, fixed search paths, and ACL boundaries were
unchanged. It is a validated no-op after the corrected `005` source.

## Database objects and entry points

Phase 2A added the exact public entry points:

- `public.create_neon_organization_department(text,uuid,uuid,uuid,text,text,text,text,integer)`
- `public.update_neon_organization_department(text,uuid,bigint,text,text,integer,boolean)`

It also added a private append-only Organization write-audit relation and
private authorization, payload, and audit helpers. Existing
`app_private.prepare_department_insert()` and
`app_private.insert_department_closure()` were pinned as
`SECURITY INVOKER`, owned by `hotel_ld_migration_owner`, with
`search_path=''` and no ambient execution grant.

Create remains atomic: one Department insert computes `depth` and `path_ids`,
creates the closure self row and ancestor rows, verifies representation
agreement, appends audit evidence, and returns the authoritative node. Phase
2A grants no closure UPDATE or DELETE capability.

## Role, ACL, and RLS evidence

The final read-only catalog validator returned:

| Assertion | Result |
| --- | --- |
| Target entry points plus audit relation | `3` |
| Constrained `SECURITY DEFINER` entry points | `2/2` |
| Constrained invoker trigger helpers | `2/2` |
| Department/closure RLS protection | `2/2` |
| Exact Phase 2A write policies | `5` |
| Raw runtime table/column privileges | `0` |
| Migration-owner closure rewrite privileges | `0` |

Both public entry points are owned by `hotel_ld_migration_owner`, fix
`search_path=''`, revoke PUBLIC and unrelated-role execution, and grant the
exact signatures only to `hotel_ld_application`. The application role remains
`NOBYPASSRLS`, owns no protected objects, and has no raw business-table DML.
No runtime role or membership was added, and E1 Actor Context was not changed.

## Real application-role behavior matrix

The matrix used synthetic child-only accounts whose `user_accounts.user_id`
and `auth_user_id` were deliberately different. Every mutation used the real
pooled `hotel_ld_application` credential and transaction-local actor settings;
bootstrap was used only for fixture setup, count-only verification, audit
inspection, and cleanup.

| Behavior | Result |
| --- | --- |
| Property manager creates root Department | PASS |
| Property manager creates child Department | PASS |
| Depth, path, self closure, and ancestor closure | PASS |
| Manager detail update | PASS |
| Manager active-state update | PASS |
| Department administrator mutation | DENIED |
| Cross-property mutation | DENIED |
| Stale expected version | CONFLICT; no accepted mutation |
| Active trainer-scope deactivation blocker | DENIED |
| Audit actor/request/property/object/version evidence | PASS |
| Explicit transaction rollback removes Department and audit | PASS |
| Actor Context absent after transaction/pool reuse | PASS |
| Concurrent manager/admin contexts do not cross | PASS |
| Direct application table read/write | DENIED |

After validation, count-only probes found zero synthetic Phase 2A accounts,
profiles, and Departments. Append-only audit evidence for committed validation
mutations remains as intended.

## Repository and API boundary

The server-only repository is
`app/repositories/neon/department-write-repository.ts`. It receives the
checked-out actor-transaction query interface, uses parameterized calls to the
two exact entry points, and strictly maps returned Department payloads.

The existing same-origin routes now expose dark Neon write handlers:

- `POST /api/organization/departments`
- `PATCH /api/organization/departments/:id`

They verify Supabase Auth server-side, derive trusted hostname context, create
a request ID, enter the unchanged Neon actor transaction, and map stable
authorization/domain errors. Browser-supplied identity, property, role, and
department scope are not authorization evidence. The browser Organization
registry still selects the Supabase repository, so this phase introduces no
dual write or runtime UI activation.

## TDD and project verification

- Connection guard/catalog harness: RED before Phase 2A objects; GREEN after
  migration.
- Repository scratch contract: RED before implementation; `3/3` GREEN.
- Input/error contract: RED before implementation; `3/3` GREEN.
- Built HTTP boundary: POST/PATCH were `405` before handlers; malformed and
  forged bodies became `400`, and valid unauthenticated requests became `401`.
- Runtime matrix first exposed the invalid `pg_catalog.nullif` path; after the
  `006` correction all 14 assertions passed with process exit `0`.
- Fresh `npm test`: tests `201`, pass `201`, fail `0`; its nested production
  build and rendered HTML test also passed.
- Fresh separate `npm run build`: exit `0`, with both Organization Department
  API routes emitted.
- Final `dist/client` scan: zero matches for runtime/bootstrap database
  variables, development/Production endpoint ids, runtime role, Actor Context
  settings, PostgreSQL client markers, or Phase 2A SQL entry-point names.
- `app/api/import/inspect/route.ts` still uses
  `actorClient.rpc("stage_employee_import")`.

## Activation status and next gate

Phase 2A's Neon database, RLS, application credential, repository, and API
implementation are verified on the isolated child. The Supabase Organization
fallback remains active by design. Before any registry switch, a separately
approved activation step must exercise authenticated HTTP success/refresh with
the initialized account system and re-run the Organization read/write matrix.

Phase 3 move/closure work must be a new migration with explicit subtree,
closure rewrite, path rebuild, descendant recalculation, cycle prevention,
locking, concurrency, and rollback review. The Phase 2A grants and policies do
not authorize that work.
