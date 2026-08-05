# E3 Phase 1 Department read verification

**Applied and verified:** 2026-08-05

**Status:**

- Migration/RLS foundation: **COMPLETE**
- Runtime boundary and Actor Context isolation: **COMPLETE**
- Positive manager/department identity acceptance: **DEFERRED**
- Registry activation: **NOT ACTIVATED**
- Supabase Organization fallback: **ACTIVE**

Positive identity acceptance is deferred for the same reason recorded for E2:
the child does not currently contain an active manager or department-scoped
account matching the repository's synthetic fixture identities. The account
system will be reinitialized before production deployment. Owner credentials,
`SET ROLE`, or fabricated runtime grants were not used to manufacture a
positive result.

## Scope and safety boundary

- Approved non-production target: project `flat-brook-43278549`, branch
  `br-aged-river-az1gke14`, endpoint `ep-sparkling-shape-az9gxtuh`, database
  `neondb`.
- Production deny-list: branch `br-twilight-leaf-azmowo1k`, endpoint
  `ep-wild-wave-azjmgdif`.
- Before migration, both URLs passed local fail-closed guards without printing
  connection material. `NEON_BOOTSTRAP_DATABASE_URL` was direct and used
  `neondb_owner`; `DATABASE_URL` was pooled and used
  `hotel_ld_application`. Both mapped to the approved child and neither
  matched Production.
- The bootstrap database preflight independently returned the exact database,
  `current_user=session_user=neondb_owner`, permission to `SET` the constrained
  migration owner, zero pre-existing E3 entry points, and the exact Neon branch
  setting.
- The bootstrap credential was used only for the reviewed migration
  transaction. After `COMMIT`, every validation connection read only
  `DATABASE_URL`; bootstrap was not reused as runtime or written into runtime
  configuration.
- Production was not connected to or modified. No connection string, password,
  user identifier, department name, or row payload was printed.

## Applied migration

| File | Applied SHA-256 | Outcome |
| --- | --- | --- |
| `neon/migrations/202608040004_e3_organization_department_read.sql` | `a7cc39522062fb313d34417ea1754e50639454bffc9693744412014e87f3da5d` | Transaction committed atomically |

The migration's own preflight and postflight completed inside the same
transaction. It created the Phase 1 append-only read-audit boundary, ten
private Organization authorization helpers, and these two public entry points:

- `public.resolve_neon_organization_property(text)`
- `public.read_neon_organization_department_tree(text)`

Both public functions are owned by `hotel_ld_migration_owner`, are
`SECURITY DEFINER`, use `search_path=''`, revoke PUBLIC and unrelated-role
execution, and grant execution directly only to `hotel_ld_application`.

## Application-role catalog evidence

The post-commit catalog probe used the real pooled
`hotel_ld_application` credential and emitted only booleans and counts:

| Assertion | Result |
| --- | --- |
| `current_user=session_user=hotel_ld_application` | PASS |
| Application remains `NOBYPASSRLS` and non-superuser | PASS |
| Exact single `hotel_ld_people_read` membership with no SET/admin option | PASS (`1`) |
| Exact entry-point owner/security/search-path catalog | PASS (`2/2`) |
| Application entry-point execute grants | PASS (`2/2`) |
| Unexpected entry-point ACLs | PASS (`0`) |
| Raw Organization table/column grants for application and People group | PASS (`0`) |
| Organization tables with ENABLE/FORCE RLS | PASS (`5/5`) |
| Pinned read-inert legacy BYPASSRLS definer trigger | PASS (`1`) |
| Unchanged E2 People policies | PASS (`17`) |
| Unchanged E2 People public functions | PASS (`5`) |
| Objects owned by runtime/permission/readonly roles | PASS (`0`) |

The approved legacy exception remains only
`departments_insert_closure` → `app_private.insert_department_closure()`.
It is not reachable from the Phase 1 read entry points. Converting that edge to
the constrained write design remains Phase 2's first hardening gate before any
Neon Department mutation.

## Runtime behavior matrix

All probes used the real pooled application login. Actor values were installed
only with transaction-local `set_config(..., true)`. Public payloads were
validated in memory and never printed.

| Behavior | Result |
| --- | --- |
| Configured trusted hostname resolves exactly once | PASS |
| Unknown hostname resolves no property | PASS |
| Direct Department table read | DENIED (`42501`) |
| Direct Department insert/update/delete | DENIED (`42501`) |
| Direct private-helper execution | DENIED (`42501`) |
| Missing Actor Context | DENIED (`42501`) |
| Wrong hostname for current context | DENIED (`42501`) |
| Wrong property for trusted hostname | DENIED (`42501`) |
| Unknown/unauthorized actor | DENIED (`42501`) |
| Context absent after COMMIT | PASS |
| Context absent after ROLLBACK | PASS |
| Reused pooled connection starts uncontaminated | PASS |
| Two concurrent actors retain separate context | PASS |
| Manager tree success against a live development identity | DEFERRED — no matching active account |
| Department exact/descendant scope and unrelated exclusion | DEFERRED — no matching active scoped account |

The deferred positive cases are identity-fixture acceptance, not permission
bypasses. They must be repeated after the account system is initialized and
before registry activation or production deployment.

## Application and browser boundary

The server path remains:

1. Supabase Auth verifies the user server-side.
2. The server resolves the trusted hostname.
3. `withNeonResolvedActorContext()` opens one application-role transaction.
4. Actor identity, property, and request ID are installed transaction-locally.
5. The server-only Organization repository calls the two constrained entry
   points.
6. Forced RLS derives live property, role, and department scope.
7. COMMIT/ROLLBACK clears context before pool reuse.
8. Browsers use same-origin HTTP APIs and never receive Neon credentials.

No Organization registry switch was made. The existing Supabase Organization
repository remains the active fallback until the approved activation gate is
completed. Position, Import, Employee write, Supabase Auth, Supabase Storage,
and the Import inspect actor-client RPC contract remain unchanged.

## Regression and bundle evidence

- The E3 static migration contract passed `1/1`, and the applied file's fresh
  SHA-256 remained
  `a7cc39522062fb313d34417ea1754e50639454bffc9693744412014e87f3da5d`.
- `npm test` passed `201/201`, with `0` failures; its nested production build
  and rendered HTML test also passed.
- A separate `npm run build` passed and emitted all four Department read API
  routes.
- The final `dist/client` scan found zero instances of runtime/bootstrap
  database variables, Neon endpoint markers, PostgreSQL pool markers, Actor
  Context settings, or E3 SQL entry-point names.
- `app/api/import/inspect/route.ts` still calls
  `actorClient.rpc("stage_employee_import")`; the Import authorization and mock
  contract were not changed.

## Remaining acceptance gate

Before activation, provision or initialize development identities through the
normal Supabase Auth/account workflow and rerun:

- manager property-scoped Department tree success;
- department exact scope;
- `include_descendants=true` descendant inclusion;
- `include_descendants=false` descendant exclusion;
- unrelated Department exclusion;
- authenticated HTTP success and refresh behavior.

Do not use `neondb_owner`, `hotel_ld_migration_owner`, raw grants, `SET ROLE`,
or browser-supplied authorization facts for that acceptance test.
