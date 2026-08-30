# Supabase Runtime-Zero Audit — 2026-08-31

## Scope and evidence rules

This record audits the Training App source and the connected Vercel project `hotel-ld-os`. It does not recreate Supabase, migrate data, expose environment values, or treat historical documentation as executable code. `CURRENT`, `TARGET`, and `UNKNOWN` are kept separate below.

## Repository truth

- Audit branch: `codex/supabase-runtime-zero`
- Start commit: `dff5d20255d29863d591dd1735100a957fd9f584`
- Reference branch: `codex/canonical-neon-baseline` at the same start commit
- Local `main`: `eac1e71`; it is an ancestor of the reference branch and is 254 commits behind it (`main...codex/canonical-neon-baseline = 0/254`).
- The actual Training App exists on both branches, but `main` lacks the canonical Neon and Better Auth implementation. The reference branch contains `pg`, `better-auth`, and `@vercel/blob`, with no Supabase package dependency.
- Existing dirty worktrees and their untracked files were not modified, stashed, reset, cleaned, or staged. Audit changes were made in the dedicated worktree `.worktrees/supabase-runtime-zero`.

`CURRENT`: the canonical branch is the verified repository implementation. `main` is incomplete/stale for the intended architecture.

`TARGET`: Production must use a reviewed descendant of the canonical implementation.

## Supabase reference classification

The repository was searched filename-first and content-second for case variants of Supabase; known Supabase environment names; `@supabase/`; `.supabase.co`; `/rest/v1`; REST/RPC/client calls; Auth; Storage; Realtime; Edge Functions; and `createClient`. Generated Vercel output was separately scanned after an exact production-format build.

### A. Active runtime dependency — must fix

No A hit exists in the canonical source or its generated Vercel artifact.

The deployment audit did find A hits in the source commit currently serving Production, `19ffae5ecca9c0a7da97ce6a28448d84746c6ad4`: `app/lib/supabase/browser.ts`, `app/lib/supabase/server-admin.ts`, `app/repositories/supabase/*`, and dependent routes/services. That commit also depends on `@supabase/supabase-js` and lacks `pg`, Better Auth, and Vercel Blob. This is an unresolved Production runtime defect until cutover.

### B. Deployment/environment dependency — must fix

- The old Production commit's `.env.example` requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Vercel Production contains no Supabase variable names, so no obsolete Vercel value required deletion.
- Vercel Production is missing `DATABASE_URL`, `NEON_ENDPOINT_ID`, `AUTH_DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BLOB_READ_WRITE_TOKEN`; therefore it cannot safely run the canonical artifact.
- Ignored local files `.env.local` and `.vercel/.env.production.local` contained stale Supabase names. Only those exact named entries were removed, without reading or printing their values.

### C. Test/validation-only reference — intentional

Negative checks in `scripts/neon/validate-supabase-free-baseline.mjs`, its tests, source-contract validators, and related tests intentionally name Supabase so that regressions fail closed. They remain.

The source gate had a real blind spot: production-capable scripts under `scripts/` were not scanned. A failing fixture was added first, then the gate was extended to scan executable JavaScript/TypeScript scripts while excluding fixtures, test files, and validators whose purpose is to contain negative markers.

### D. Historical documentation/comment — harmless

References under `docs/archive/supabase-project/`, historical migration plans/records, and Neon SQL migration comments document the completed exit. They are not imported, deployed, or executed by the application and remain as audit evidence.

### E. False positive

- Generic `createClient` factories unrelated to Supabase.
- SQL/query-builder method names such as `.from`.
- `/api/auth/access-token`, which is a compatibility tombstone returning HTTP 404 and releases no browser token.
- Test names and error messages that assert legacy behavior is absent.

## Runtime path maps

### Database and authorization

- Business runtime: server routes/services -> constrained Neon repositories -> `app/lib/neon/server.ts` -> `DATABASE_URL`. The guard requires a Neon hostname, TLS, database `neondb`, application role `hotel_ld_application`, and matching `NEON_ENDPOINT_ID`. Pooling is supported; bootstrap/owner credentials are not an application runtime fallback.
- Authentication store: Better Auth -> `app/lib/auth/better-auth.ts` -> `AUTH_DATABASE_URL`, isolated service role `hotel_ld_auth_service`, schema `app_auth`, TLS, and database `neondb`.
- Authorization: Better Auth supplies identity/session only. `request-authentication.ts` resolves the UUID subject into Neon authorization, role, organization/property scope, and Actor Context before business access. Admin and manager checks remain enforced.
- Property, organization, people, departments, positions, employees, initialization, imports, exports, and account administration all route through Neon repositories/services. Browser repositories call same-origin application APIs; they do not receive database or provider credentials.
- No active server action, background job, or production-capable script imports a Supabase client or calls Supabase REST/RPC.

### Authentication

- Login, logout, password change, session retrieval, and the catch-all auth route use Better Auth.
- Server-side guards resolve Better Auth session state and then Neon authorization/Actor Context.
- No Supabase JWT, refresh token, access token, or Auth API is accepted as an application authorization shortcut.

### Storage and external paths

- Import files use the private, server-only Vercel Blob gateway and `BLOB_READ_WRITE_TOKEN` with exact object paths.
- No active code uses Supabase Storage, signed URLs, Realtime, Edge Functions, or deleted-project endpoints.
- Property-branding upload is explicitly unavailable in the canonical baseline; there is no hidden Supabase fallback and no repository-proven replacement implementation. This is a known feature gap, not a Supabase runtime dependency.

## Environment matrix (names only)

| Variable | Repository contract | Vercel Production | Vercel Preview | Classification |
| --- | --- | --- | --- | --- |
| `APP_ENV` | REQUIRED | PRESENT | PRESENT | REQUIRED |
| `APP_DATA_MODE` | REQUIRED | PRESENT | PRESENT | REQUIRED |
| `APP_BASE_DOMAIN` | REQUIRED | PRESENT | PRESENT | REQUIRED |
| `DATABASE_URL` | REQUIRED | ABSENT | PRESENT | REQUIRED |
| `NEON_ENDPOINT_ID` | REQUIRED | ABSENT | PRESENT | REQUIRED |
| `AUTH_DATABASE_URL` | REQUIRED | ABSENT | PRESENT | REQUIRED |
| `BETTER_AUTH_SECRET` | REQUIRED | ABSENT | PRESENT | REQUIRED |
| `BLOB_READ_WRITE_TOKEN` | REQUIRED for import storage | ABSENT | PRESENT | REQUIRED |
| `PREVIEW_PROPERTY_HOSTNAME` | Preview contract | ABSENT | PRESENT | Preview-only |
| `SUPABASE_URL` | Not used | ABSENT | ABSENT | OBSOLETE |
| `NEXT_PUBLIC_SUPABASE_URL` | Not used | ABSENT | ABSENT | OBSOLETE |
| `SUPABASE_ANON_KEY` | Not used | ABSENT | ABSENT | OBSOLETE |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Not used | ABSENT | ABSENT | OBSOLETE |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Not used | ABSENT | ABSENT | OBSOLETE |
| `SUPABASE_SERVICE_ROLE_KEY` | Not used | ABSENT | ABSENT | OBSOLETE |
| `SUPABASE_SECRET_KEY` | Not used | ABSENT | ABSENT | OBSOLETE |

Preview values were not copied into Production: reachability and variable presence do not prove that credentials have the correct Production branch, endpoint, database, role, tenant, or property scope.

## Vercel topology

- Project: `hotel-ld-os` (`prj_LWWqjlOsHToxi7cVemxm6xKtw9m1`)
- Configured Production branch: `main`
- Aliased READY Production: deployment `dpl_HwvZr71WiqvVub7p5GsYeKWm5tCE`, commit `19ffae5ecca9c0a7da97ce6a28448d84746c6ad4`
- Production aliases include `hotel-ld-os.vercel.app` and `ktsz.ldchub.cn`.
- Latest relevant READY Preview: deployment `dpl_HQ2EFEQqaNVMn86BspWH8TCzEfXk`, commit `dff5d20255d29863d591dd1735100a957fd9f584`, branch `codex/canonical-neon-baseline`.
- The project metadata also records a newer errored Production attempt from stale `main`; it did not replace the READY aliases.

`CURRENT`: Production is not running the canonical Neon/Better Auth implementation. Preview is ahead of Production.

`TARGET`: after Production-scoped credentials are supplied and verified, deploy/promote an immutable artifact matching the reviewed canonical descendant, verify aliases and runtime, then update the Production source branch without rewriting history.

`UNKNOWN`: correct Production-scoped values for the five missing required names. Their values were not available from an authorized Production source.

No Production mutation was made because it would either deploy an artifact guaranteed to fail its environment guard or reuse Preview-scoped secrets without evidence of correct Production scope.

## Validation evidence

- Supabase-free source gate: PASS, including production-capable script coverage.
- Supabase-free validator tests: PASS (13/13).
- Focused Better Auth/auth-split tests: PASS (31/31).
- Runtime final-cutover source tests: PASS (4/4); all business domains resolve to Neon, no Supabase business client, no browser Neon credential.
- Configured `npm test`: PASS (188/188), including its embedded standard build and rendered-HTML test.
- Exact Vercel-format build (`NITRO_PRESET=vercel npx vite build`): PASS.
- Generated `.vercel/output` scan for Supabase markers/endpoints/imports: PASS (zero hits).
- `git diff --check`: PASS.
- Lint: FAIL on the unchanged canonical baseline (14 errors, 89 warnings), including pre-existing explicit-`any` and validator naming violations outside this repair.
- Broad historical `node --test scripts/neon/*.test.mjs`: FAIL because out-of-config legacy tests still expect Supabase session/RPC behavior and stale catalog counts. The configured suite and current canonical validators pass; the historical fixtures were not rewritten to conceal the mismatch.
- Requested `scripts/neon/validate-supabase-exit.mjs live`: NOT AVAILABLE in active source. Only an archived historical operator copy exists and was not treated as a live validator.

## Runtime smoke and logs

- Current Production app and login route: LOAD PASS on the default/custom aliases, but they are the stale Supabase-source deployment.
- Canonical Preview login route: LOAD PASS.
- Authenticated session, representative read/write, property scope, and admin/manager authorization: NOT RUN. No disposable credential/fixture authority was available, and Vercel deployment protection prevented anonymous API acceptance checks.
- Bounded Preview and Production log scans found no Supabase hostname/name, DNS, missing-auth-database, or runtime error matches. This does not supersede the Production source evidence.
- Disposable fixtures: NOT CREATED; cleanup therefore NOT REQUIRED.

## Remaining blockers

1. Production aliases still point to source containing active Supabase runtime paths.
2. Production lacks the required Neon, Better Auth, and Blob environment variables, and no verified Production-scoped values were available.
3. Required lint is red on the canonical baseline.
4. Authenticated Production smoke and live Neon/Better Auth validation cannot run until a canonical Production deployment and disposable identity authority exist.
