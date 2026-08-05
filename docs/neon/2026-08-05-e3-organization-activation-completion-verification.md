# E3 Organization Activation Completion verification

## Scope and environment

This record covers only the Neon child branch `br-aged-river-az1gke14` at
endpoint `ep-sparkling-shape-az9gxtuh`.

- Production branch deny-list: `br-twilight-leaf-azmowo1k`
- Production endpoint deny-list: `ep-wild-wave-azjmgdif`
- Migration connection: direct `NEON_BOOTSTRAP_DATABASE_URL` as
  `neondb_owner`
- Runtime connection: pooled `DATABASE_URL` as `hotel_ld_application`

The validator checked the child endpoint, database, role, and pooling shape
before opening each connection. Production was not connected or modified.
No URL, password, token, alias source value, or business row is recorded here.

The current `pg` stack emitted its forward-compatibility warning for legacy
SSL-mode interpretation. This did not weaken the current verified connection,
but the child runtime/bootstrap URLs should be normalized to explicit
`sslmode=verify-full` before upgrading to the next major `pg` connection-string
semantics.

Migration source:
`neon/migrations/202608050010_e3_organization_activation_completion.sql`

## Migration and catalog evidence

The child-only validator completed these stages:

| Stage | Result |
| --- | --- |
| source contract | pass |
| transactional migration dry-run and rollback | pass |
| child migration apply | pass |
| post-apply catalog verification | pass |
| pooled application-role negative verification | pass |

The migration added three constrained entrypoints:

- `merge_neon_organization_department_alias(text,uuid,uuid)`
- `resolve_neon_organization_department_alias_to_operational_unit(text,uuid,uuid)`
- `create_neon_organization_department_from_alias(text,uuid,text,uuid,text,text,text,text,integer)`

The created-Department entrypoint accepts only `created_top_level` and
`created_child`. It locks the alias, validates the parent shape and current
property, then calls the existing controlled
`create_neon_organization_department(...)` entrypoint in the same transaction.
It does not duplicate Department row, depth, path, closure, or Department-audit
logic. Department creation, alias resolution, and activation audit therefore
commit or roll back together.

Catalog verification established:

- all three entrypoints are owned by `hotel_ld_migration_owner`, are
  `SECURITY DEFINER`, and have fixed empty `search_path`;
- `PUBLIC EXECUTE` is absent and exact execute is granted to
  `hotel_ld_application`;
- `hotel_ld_application` remains non-superuser and `NOBYPASSRLS`;
- the application role has zero raw privileges on Departments, Department
  aliases, Operational Units, Operational Unit aliases, and activation audit;
- participating business relations retain enabled and forced RLS;
- `app_private.organization_alias_activation_audit_events` is forced-RLS and
  append-only.

## Runtime and authorization evidence

Runtime verification used the pooled `hotel_ld_application` credential. It did
not use `SET ROLE`, the migration owner, or the bootstrap owner.

| Case | Result |
| --- | --- |
| runtime role is non-superuser and NOBYPASSRLS | pass |
| raw Department alias read | denied as required |
| raw Operational Unit alias write | denied as required |
| exact execute grants for all three entrypoints | pass |
| entrypoint call without Actor Context | denied as required |

The application boundary continues to obtain identity from server-side
Supabase Auth, resolve hostname/property on the server, and execute the Neon
repository inside transaction-scoped Actor Context. No browser identity,
tenant, property, role, database URL, or JWT authorization claim is accepted by
the alias API payload parser.

## Activation rehearsal and fallback

The Organization repository selector remains an explicit rehearsal switch:

- default and rollback mode: `APP_ORGANIZATION_REPOSITORY=supabase`;
- Neon rehearsal additionally requires `APP_DATA_MODE=neon`;
- Neon rehearsal is accepted only for local/preview;
- `APP_ENV=production` or `VERCEL_ENV=production` hard-denies the Neon mode
  before application compilation;
- only Organization selects the same-origin HTTP repository; Property, People,
  Position, Import, and Initialization selection remains unchanged.

Local process checks produced this redacted matrix:

| Case | Result |
| --- | --- |
| Neon rehearsal build | pass |
| Supabase fallback build | pass |
| Production Neon rehearsal build | rejected as required |
| Neon-mode `/organization` page boot | HTTP 200 |
| anonymous Organization directory API | HTTP 401 |
| anonymous alias-resolution API | HTTP 401 |
| Supabase fallback `/organization` page boot after restart | HTTP 200 |

Rollback is an environment switch to `supabase` followed by a rebuild/restart.
It requires no schema rollback, data copy, browser database access, or source
revert.

## Identity-dependent behavior matrix

The approved local configuration contains no accepted test user credentials or
actor fixture identifiers. The following acceptance cases are therefore
explicitly deferred rather than simulated with the bootstrap owner, forged JWT
claims, raw table access, or persistent session settings:

| Case | Status |
| --- | --- |
| refreshed real manager session succeeds | deferred |
| property manager merge and Operational Unit resolution | deferred |
| property manager created top-level and child resolution | deferred |
| Department administrator read and mutation denial | deferred |
| cross-property and inactive/missing target rejection | deferred |
| duplicate/concurrent resolution conflict behavior | deferred |
| audit field correctness under a real actor | deferred |
| mutation failure atomic rollback under a real actor | deferred |
| actor cleanup, connection reuse, and concurrent actor isolation | deferred |

These cases must use an intentionally seeded development identity through
Supabase Auth -> trusted server property resolution -> transaction-scoped Actor
Context -> pooled application credential. They are not Production acceptance.

## Regression and contract evidence

- focused TDD contract cases: 8 passed, 0 failed
- existing `tests/` files: unchanged
- registry default and Supabase fallback: retained
- browser Neon access: absent; Organization uses same-origin HTTP
- Actor Context: unchanged
- Import actor-scoped RPC contract: unchanged
- Position and Employee write: unchanged
- `npm test`: 201 passed, 0 failed; its build and rendered-HTML check passed
- separate `npm run build`: passed

## Child-only schema rollback

Application rollback should normally leave these dark objects in place. If an
explicit schema rollback is approved for the child branch, stop rehearsal
traffic and use one migration-owner transaction to revoke the three exact
application execute grants, drop the three public entrypoints, remove their
private helper/policies and the activation audit relation, and revoke the
added migration-owner column grants. Phase 4A objects are not changed. This is
not a Production procedure.
