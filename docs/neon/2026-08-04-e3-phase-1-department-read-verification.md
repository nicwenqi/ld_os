# E3 Phase 1 Department read verification

**Status: IMPLEMENTED / DATABASE VALIDATION BLOCKED**

This is a closeout record for the reviewed E3 Phase 1 source and application
boundary. It is not evidence that E3 has been applied to Neon or that the
runtime behavior matrix has passed.

## Scope and safety boundary

- Approved non-production target: project `flat-brook-43278549`, branch
  `br-aged-river-az1gke14`, endpoint `ep-sparkling-shape-az9gxtuh`, database
  `neondb`.
- Production deny-list: branch `br-twilight-leaf-azmowo1k`, endpoint
  `ep-wild-wave-azjmgdif`. Production was not connected to or modified.
- The runtime URL was parsed locally only inside a fail-closed sanitized guard;
  it was never printed or exposed. A real pooled `hotel_ld_application`
  connection was made only to the approved child for a read-only `pg_catalog`
  probe that emitted booleans and counts. No business table or payload was
  read, and no direct `hotel_ld_migration_owner` login, `neondb_owner`
  bootstrap connection, migration, runtime DDL, or `SET ROLE` was attempted.
- `.env.local` contains only the runtime `DATABASE_URL`; it provides no
  independent child `neondb_owner` bootstrap connection for the approved
  endpoint and database. The guarded runtime value was never printed or
  exposed. The runtime credential cannot apply E3, and a direct
  `hotel_ld_migration_owner` login also fails the exact bootstrap-identity
  preflight.

## Reviewed source identity

| Item | Evidence |
| --- | --- |
| Migration | `neon/migrations/202608040004_e3_organization_department_read.sql` |
| SHA-256 | `a7cc39522062fb313d34417ea1754e50639454bffc9693744412014e87f3da5d` |
| Task 1 source | committed as `f1252a17...`; independently static-reviewed clean |
| Task 2 boundary | commits `f214e07` and `2c2bbb5`; scratch checks 4/4 and TypeScript passed; review approved |
| Task 3 API boundary | commits `0e625d4` and `97b091f`; final scratch checks 3/3 and TypeScript passed; task review and scoped final re-review approved |
| Whole-slice source review | `IMPLEMENTATION APPROVE`; no Critical or Important findings; runtime-drift HTTP taxonomy fix resolved with no new findings |

The migration source is reviewed and transaction-wrapped, but no E3
PostgreSQL parse, apply, post-apply catalog ACL/RLS assertion, entry-point
behavior, or transaction-isolation matrix has been run against the child
database in this closeout.

## Sanitized runtime and prior read-only catalog evidence

The guarded local runtime check passed with only these facts before opening the
child application connection:

```text
endpoint=ep-sparkling-shape-az9gxtuh
database=neondb
role=hotel_ld_application
pooled=true
production-deny-match=false
```

The closeout then used the real child `hotel_ld_application` pooled connection
for a read-only `pg_catalog` probe. It did not read business tables or data and
returned only these limited results:

| Probe | Result | Meaning |
| --- | --- | --- |
| Database identity | `database_ok=true` | The probe used `neondb`. |
| Runtime identity | `runtime_identity_ok=true` | The application identity check passed. |
| Runtime constraint | `runtime_role_constrained=true` | The checked runtime role remained constrained. |
| E3 target functions | `phase1_target_function_count=0` | E3 entry points are absent: the migration has **not** been applied. |
| Organization forced RLS | `organization_force_rls_count=5` | The E2 tables `departments`, `department_closure`, `department_aliases`, `operational_units`, and `operational_unit_aliases` retain forced RLS. This does not validate E3. |

The approved legacy exception remains the exact
`departments_insert_closure` → `app_private.insert_department_closure()`
`SECURITY DEFINER` / BYPASSRLS trigger edge. It is a Phase 1 read-path-inert
exception, not an approval for Department writes. Its conversion to the
approved constrained invoker path is Phase 2's first hardening gate, before
any Neon Department write.

## Verification matrix

| Area | Result | Evidence or limitation |
| --- | --- | --- |
| E3 code and static review | PASS | Task 1 source independently reviewed clean; Tasks 2–3 reviews approved; final whole-slice review and scoped re-review returned `IMPLEMENTATION APPROVE`. |
| Application regressions | PASS | Fresh post-fix `npm test` exited 0: 201 tests passed, 0 failed; its build and rendered HTML test also passed (1/1). |
| Separate production build | PASS | Fresh `npm run build` exited 0. The route table included `/api/organization/departments`, `/api/organization/departments/:id`, `/api/organization/departments/:id/ancestors`, and `/api/organization/departments/:id/descendants`. |
| Browser asset boundary | PASS | `rg` of `dist/client` for `DATABASE_URL`, `NEON_ENDPOINT_ID`, `pg-pool`, `app.actor_`, `resolve_neon_organization_property`, and `read_neon_organization_department_tree` returned exit 1 with no output (zero matches). |
| Child migration PostgreSQL parse and apply | BLOCKED | No child-only `neondb_owner` bootstrap connection for the approved endpoint/database is available. |
| E3 catalog, grants, ownership, ACL, RLS, entry-point owner/`SECURITY DEFINER`/`search_path`, legacy-trigger, and E2-inventory assertions | BLOCKED | E3 is absent (`phase1_target_function_count=0`); no post-apply catalog matrix exists. |
| E3 authorization and read behavior | BLOCKED | Missing/wrong context, authorization, tree scope, descendant flag, exclusion, rollback/commit/reuse, and concurrent-actor behavior remain unverified. |
| Production safety | PASS | The deny-listed production branch and endpoint were neither connected to nor modified. |
| Business data handling | PASS | This closeout read no business payload. |

## Activation and next gate

Registry activation: **NOT ACTIVATED**.

Supabase Organization fallback: **ACTIVE**.

Phase 1 Department read: **COMPLETE only if migration and runtime matrix passed.**
Current status is **IMPLEMENTED / DATABASE VALIDATION BLOCKED**. Phase 2 must
not start from this record.

The sole unblock is a child-only `neondb_owner` bootstrap connection for the
approved endpoint `ep-sparkling-shape-az9gxtuh` and database `neondb`. If a
local secret key is needed, name it `NEON_BOOTSTRAP_DATABASE_URL`; it must not
replace the runtime `DATABASE_URL`. The migration's exact preflight requires
both `current_user` and `session_user` to be `neondb_owner`; it then verifies
the required `SET ROLE` capability and transitions internally to the
constrained `hotel_ld_migration_owner` as designed. The runtime
`hotel_ld_application` login cannot apply E3, and a direct
`hotel_ld_migration_owner` login fails that bootstrap-identity preflight.
Production and generic owner credentials are forbidden. After a safe sanitized
identity preflight, apply the reviewed migration and rerun the complete catalog
and behavior matrix without printing connection material or business payloads.
