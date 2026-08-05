# E3 Phase 3 Department move / closure verification

**Applied and verified:** 2026-08-05

**Status:**

- Department Move / Closure migration: **COMPLETE**
- Runtime role and RLS boundary: **COMPLETE**
- Server repository and dark API boundary: **COMPLETE**
- Positive development identity acceptance: **DEFERRED**
- Organization registry activation: **NOT ACTIVATED**
- Supabase Organization fallback: **ACTIVE**

Phase 3 adds only Department move preview and authoritative move commit. It
does not activate the browser registry and does not migrate aliases,
operational-unit CRUD, Position, Import, Employee write, Supabase Auth, or
Supabase Storage.

## Scope and connection safety

- Approved target: child branch `br-aged-river-az1gke14`, endpoint
  `ep-sparkling-shape-az9gxtuh`, database `neondb`.
- Production deny-list: branch `br-twilight-leaf-azmowo1k`, endpoint
  `ep-wild-wave-azjmgdif`.
- The bootstrap guard required a direct child connection as `neondb_owner`.
  The runtime guard required a pooled child connection as
  `hotel_ld_application`.
- A full migration dry run finished with an explicit transaction rollback
  before the identical source was applied. Neither connection string nor
  password was emitted.
- Production was not connected to or modified. The bootstrap credential is not
  used by the application runtime.

## Applied migration and database boundary

| File | SHA-256 | Child outcome |
| --- | --- | --- |
| `neon/migrations/202608050007_e3_organization_department_move.sql` | `d58c8973dfd2c56cc349dcb4dc4b1b28b072cc64b7feaa96f932da6d660211dd` | dry-run `ROLLBACK_OK`; then `COMMIT_OK` |

The migration adds the following objects:

- `app_private.lock_neon_organization_hierarchy(uuid)` — transaction-scoped
  property advisory lock; private, invoker-security, fixed `search_path=''`.
- `public.preview_neon_organization_department_move(text,uuid,uuid)` —
  non-binding, read-only preview.
- `public.move_neon_organization_department(text,uuid,uuid,bigint)` — the
  only Phase 3 mutation boundary.
- Narrow migration-owner DELETE policy for closure rewrite and read policy for
  alias impact counting. Neither grants the runtime role raw table access.

Both public functions are owned by `hotel_ld_migration_owner`, are
`SECURITY DEFINER`, fix `search_path=''`, revoke PUBLIC and unrelated-role
execution, and grant their exact signatures only to
`hotel_ld_application`. The existing create entry point is replaced only to
join the same property advisory lock, so a create cannot observe or build a
closure snapshot concurrently with a compliant move.

The append-only write audit relation now permits a `department_move` operation
with only `parent_id`, `depth`, `path_ids`, and `closure` as new structural
field evidence. It remains append-only and has no application table grant.

## Commit semantics and locking

Preview stores no token, state, or lock. It only calculates the currently
visible impact; it does not authorize a later commit.

Commit repeats the actor, hostname, manager-role, and property checks; reads
the source again; validates its supplied `expectedVersion`; obtains the
property advisory lock; locks source/target keys in UUID order; locks the
subtree in UUID order; revalidates target property, active state, no-op, and
cycle rules; then performs one atomic closure/path/depth rewrite. It deletes
only obsolete external ancestor edges and inserts the new external ancestor
edges. Existing internal subtree edges, including self rows, remain intact.

The stored procedure raises stable outcomes:

| Condition | API classification |
| --- | --- |
| Missing or inaccessible source/target in current property | 404 |
| Missing actor context, wrong property, or non-manager | 403 |
| Source version mismatch; database serialization/deadlock conflict | 409 |
| Self-parent, cycle, inactive target, or no-op | 422 |

The source version is the only client optimistic-concurrency token. There is
no preview token and no hierarchy revision. Actor context is still
transaction-local, so commit cannot inherit another request's property or
identity.

## Runtime/RLS evidence

The post-apply catalog probe found all three Phase 3 objects. The real pooled
application credential then returned only the following booleans:

| Assertion | Result |
| --- | --- |
| Runtime endpoint/database/role is the approved child/application tuple | PASS |
| `hotel_ld_application` has `NOBYPASSRLS` | PASS |
| Departments and closure raw table privileges | none |
| Exact preview/move function execution grants | present |
| Entrypoint call without actor context | denied |
| Direct Department table read | denied |

The catalog and runtime probes use no business-row output. The dry-run itself
verified the migration preflight/postflight, SQL bodies, RLS policy creation,
function owner, fixed path, and ACL checks inside one transaction before the
commit was allowed.

## Server boundary

The server-only repository adds the existing contract methods without changing
their signatures:

- `DepartmentRepository.previewMove(id, newParentId)` calls the preview entry
  point with parameterized SQL.
- `DepartmentRepository.moveNode(id, newParentId, expectedVersion)` calls the
  authoritative commit entry point with parameterized SQL and validates the
  returned root ID and parent.

The dark same-origin API handlers are:

- `POST /api/organization/departments/:id/move-preview`
- `POST /api/organization/departments/:id/move`

They accept only the established payload fields, validate the path ID, verify
Supabase Auth on the server, resolve trusted hostname/property context, use
the unchanged actor transaction, and return mapped status codes. They do not
accept browser-supplied actor, property, role, or scope. The Organization
registry remains on the Supabase fallback, so no browser UI route is switched
and no dual-write behavior is introduced.

## Verification and deferred acceptance

- TDD scratch contracts: `3/3` pass (connection guard, parameterized
  repository calls, and input allow-list).
- Applied migration: child-only dry run `ROLLBACK_OK`, then `COMMIT_OK`.
- Post-apply catalog: all three Phase 3 objects present.
- Runtime role probe: all four authority-denial assertions pass.
- Fresh `npm test`: tests `201`, pass `201`, fail `0`.
- Fresh `npm run build`: exit `0`; both dark move routes are emitted.
- `app/api/import/inspect/route.ts` continues to call
  `actorClient.rpc("stage_employee_import")`.

No matching active child manager/account identity is available for a real
positive hierarchy mutation matrix. In accordance with E1/E2's existing
acceptance status, the following are **deferred**, not bypassed: property
manager successful move; department-admin denial with a live identity;
cross-property denial with two live properties; stale-version outcome against
a committed hierarchy; closure/path/depth inspection after a committed move;
rollback fixture proof; and concurrent live actor move serialization. They
must be run through normal Supabase Auth/account provisioning before registry
activation or production deployment. Do not use owner credentials, `SET ROLE`,
raw table grants, or fabricated JWT claims to satisfy those tests.
