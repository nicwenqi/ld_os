# Neon Runtime Final Cutover Rehearsal

## Purpose

This guide validates the canonical business runtime in a non-production
environment. It selects Neon for Organization, People, Position, Employee,
Import, Property, and Initialization. Supabase remains the Auth session adapter
and the server-side Storage adapter only.

## Preconditions

- Use a freshly initialized, approved non-production canonical Neon target.
- Create a new Auth-adapter manager identity and complete the operator bootstrap
  mapping. Do not reuse historical Supabase users, data, passwords, or sessions.
- Provide a real manager login session. Do not use an owner connection,
  `SET ROLE`, synthetic JWT, browser database URL, or browser Neon credential.
- Keep `APP_ENV` and `VERCEL_ENV` non-production.

## Select Neon

Set exactly:

```text
APP_DATA_MODE=neon
APP_RUNTIME_REHEARSAL=enabled
```

The application must reject a missing/invalid rehearsal value and must reject
this selection in Production. `/api/runtime/rehearsal-mode` is observation
only; it reports all seven domains as `neon` and cannot mutate source,
authorization, or session state.

## Browser and runtime acceptance

1. Log in through the Auth adapter with the real manager session.
2. Open Organization, People, Position, Employee, Property/Hotel Settings,
   Initialization, and Import.
3. Confirm every business request is a same-origin `/api/**` request. No
   Supabase Database REST/RPC request may appear.
4. Confirm browser assets do not expose `DATABASE_URL`, a Neon URL/token/key,
   PostgreSQL client, or a raw table client.
5. Exercise manager mutations and an out-of-property/department-admin denial.
   Verify the server-derived Actor Context, `hotel_ld_application`, RLS,
   property scope, connection reuse, and concurrent actor isolation.
6. Run Import end to end: inspect, upload, read-back checksum/size/MIME,
   staging, mapping, preview, commit, employee verification, guarded revert.
7. Force a Storage verification mismatch and a cleanup retry. Verify only the
   claimed exact object path can be removed.
8. Force a Neon HTTP failure and confirm it remains visible; no Supabase
   repository or request is attempted.

## Source and build gates

Run before browser acceptance:

```bash
node scripts/neon/validate-runtime-final-cutover.mjs source
npm test
npm run build
```

The source gate requires all seven domains to have one Neon source and rejects
direct registry construction, Supabase business repositories/clients in browser
consumers, and browser-side Neon credentials.

## Explicit rollback

Rollback is an operator configuration deployment before the next page load:

```text
APP_DATA_MODE=supabase
APP_RUNTIME_REHEARSAL=disabled
```

No browser toggle exists. A Neon failure is not a rollback trigger. Do not
mix sources in one registry instance, dual-write, or change the Auth/Storage
adapter while rehearsing.

## Prohibited actions

- Do not deploy or change Production.
- Do not delete Supabase, alter Supabase Auth, alter Storage policies, or use
  Supabase as a business-data source in Neon selection.
- Do not migrate legacy rows, replay the legacy chain, or introduce a
  compatibility object.
