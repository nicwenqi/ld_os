# Neon Runtime Activation Rehearsal verification

## Scope

The rehearsal selects Neon only for Organization, People, and Position. Property, Initialization, Import, Auth, and Storage retain their existing Supabase paths. No migration, schema change, Production configuration, Auth change, Storage change, or Actor Context change is included.

## Runtime boundary

`APP_RUNTIME_REHEARSAL=enabled` is valid only with `APP_DATA_MODE=neon` in local or preview. Production and Vercel Production are denied. The read-only `/api/runtime/rehearsal-mode` route reports only domain source selection; it cannot change configuration or confer authorization.

Target pages dynamically request that mode. Neon selection dynamically imports only same-origin HTTP adapters; the legacy registry is dynamically loaded only for explicit fallback. Neon request errors reject at the HTTP boundary and do not trigger a fallback request.

## Browser transport evidence

`scripts/neon/validate-runtime-activation-rehearsal.mjs source` passed. It confirmed that Organization, People, and Position pages do not statically import the primary registry, browser Supabase client, Supabase business repositories, `pg`, or `DATABASE_URL`; it also confirmed the Neon domain registry is composed only of HTTP adapters.

The Position adapter covers the existing contract and sends only same-origin requests. Its mutation payload helpers strip `tenantId` and `propertyId`; all Position writes reach the existing atomic Position-save API boundary. Department and operational-unit HTTP writes now strip the same fields, and their server routes inject trusted scope resolved from Actor Context.

Live authenticated browser network capture remains **deferred**: this workspace has neither an installed browser automation driver nor configured accepted non-production manager/department-admin identities. No owner session, direct Neon credential, or `SET ROLE` simulation was substituted.

## Child-only database validation

Existing child validators were rerun against `br-aged-river-az1gke14`, `ep-sparkling-shape-az9gxtuh`, database `neondb`, and pooled runtime role `hotel_ld_application`.

Both validators reject the Production deny-list before connecting. Organization validation confirmed restricted application role, no raw alias privileges, Actor-required entrypoints, and denied raw read/write. Position validation confirmed denied raw alias/Position/family/audit access, denied no-actor entrypoint, transaction rollback cleanup, and clean connection reuse.

Positive real-identity UI cases remain deferred for the same non-production identity-fixture limitation.

## Code verification

- Rehearsal scratch contract tests: 4 passed.
- Existing `npm test`: 201 passed, 0 failed.
- `npm run build`: passed.

## Fallback

Disable `APP_RUNTIME_REHEARSAL` and redeploy to dynamically load the existing Supabase registry. This is an explicit configuration rollback; it is never an automatic response to a Neon request failure.
