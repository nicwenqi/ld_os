# Neon Runtime Final Cutover Rehearsal Design

## Goal

Make the canonical business domains run through the Neon HTTP boundary by
default in an explicitly enabled, non-production rehearsal. The selectable
domains are Organization, People, Position, Employee, Import, Property, and
Initialization. Supabase remains only the Auth and Storage adapter.

## Scope and boundaries

- Keep Actor Context, `hotel_ld_application`, RLS, constrained database
  entrypoints, and the existing same-origin HTTP repositories unchanged.
- Keep Supabase Auth for sessions and Storage for objects. Neither adapter is
  an authorization source for business data.
- Do not change Production, Supabase schemas or Storage policies, or activate
  the cutover in Production.
- Do not delete Supabase repositories. A deliberate configuration change is
  the only rollback path.
- Do not provide a browser-accessible Neon credential, PostgreSQL client, or
  raw business-table path.

## Selected approach

The application has one authoritative runtime decision: an explicit
non-production `neon` rehearsal selection. It is evaluated server-side by the
runtime-mode endpoint and client-side before a business registry is loaded.

The selection is valid only when:

1. `APP_DATA_MODE=neon`;
2. `APP_RUNTIME_REHEARSAL=enabled`;
3. the application and Vercel environment are not Production.

All other real-data selections must resolve to the explicit Supabase registry.
An inconsistent, incomplete, or unsupported configuration fails before a
repository is returned. A Neon request failure is surfaced to the caller; it
never triggers a repository substitution or retry against Supabase.

## Runtime topology

```
Browser UI
  -> /api/runtime/rehearsal-mode (configuration observation only)
  -> same-origin HTTP repository
  -> server Auth adapter validates real session
  -> Actor Context / hotel_ld_application / RLS
  -> Neon business data

Browser UI
  -> Auth adapter only (session lifecycle)
  -> Storage adapter only through a server Import saga
```

The lazy loader dynamically imports the Neon or Supabase registry only after
the authoritative selection is read. It does not initialize a Supabase browser
client in Neon rehearsal. Pages that currently construct the synchronous
registry directly will use the same loader/hook so Property, Initialization,
and Import cannot diverge from Organization, People, and Position.

## Registry and page behavior

`RuntimeDomainRegistry` remains the page-facing contract. It supplies HTTP
repositories for all selected Neon domains and the current Supabase registry
only after an explicit fallback selection. No route or page receives a
tenant, property, role, database URL, or repository-source override from the
browser.

The cutover updates these browser consumers to wait for one registry:

- Organization, People, and Position retain their existing loader path.
- Import, Initialization, Hotel Settings, and InitializationStatusCard move
  from direct `createRepositoryRegistry()` construction to the loader path.
- Any shared page/service that needs a registry receives the loaded instance;
  it does not construct another one.

The status endpoint remains read-only. It can report the selected source and
the complete domain matrix but cannot change source, authorization, or session
state.

## Failure and rollback

Configuration errors return a clear unavailable state. HTTP failures preserve
the domain error and provide retry only against the selected source. A
rollback is an operator configuration deployment that selects Supabase before
the next page load; it is not a client-side fallback and does not mix sources
within a registry instance.

## Validation

Connection-free tests will prove:

- exact non-production Neon selector requirements and Production denial;
- every listed domain selects the same source;
- Neon mode does not call or dynamically load the Supabase business registry;
- fallback requires explicit Supabase selection;
- all direct-registry browser consumers use the loader;
- no browser source imports `pg`, `DATABASE_URL`, Neon credentials, or a raw
  table client.

The staging rehearsal will then validate a freshly initialized Neon property,
a real Auth session, Organization/People/Position/Employee workflows, the
full Import workflow, browser network isolation, Actor Context cleanup,
connection reuse, property scope, and RLS. Storage validation is performed
through the existing server saga: upload, read-back checksum/size/MIME,
cleanup retry, and exact-path protection.

## Success criteria

- A non-production explicit Neon runtime selection routes all seven business
  domains through same-origin HTTP to Neon.
- There is no silent fallback or Supabase business-data browser client in the
  selected path.
- Supabase fallback remains present but only after explicit selection.
- Auth and Storage remain the only Supabase runtime dependencies.
- Production behavior is unchanged and rejects the rehearsal selector.
