# Auth / Authorization Split — Task 5 Validation Record

Date: 2026-08-11

## Scope

This record covers the Neon authorization session projection and property-context entrypoints. Supabase remains an authentication adapter only. No Production, Supabase business data, Storage provider, RLS policy, or legacy repository was changed.

## Connection-free validation

All required local gates passed:

- Auth / Authorization focused tests: 24/24.
- Canonical bootstrap contract tests: 32/32.
- Canonical database/catalog/runtime contract tests: 25/25.
- Task 5 catalog/runtime contract tests: 5/5.
- Auth source gate: all six flags true.
- Runtime final-cutover source gate: Neon source, one registry, no Supabase business client, no browser Neon credential.
- Supabase business-call AST audit: all six source flags true; adversarial fixture matrix remained fail-closed.
- `npm test`: 201/201, build and rendered HTML passed.
- `npm run build`: passed.
- `git diff --check`: passed.

The canonical database validator now binds identity assertions to the exact authorized target tuple rather than a retired default staging tuple.

## Approved live target

Only the approved non-Production target was contacted:

- project: `delicate-wind-06430851`
- branch: `br-icy-scene-aukkzv69` (`main`)
- endpoint: `ep-frosty-math-audxlq88`
- database: `neondb`
- server: PostgreSQL 18.4
- bootstrap identity: `neondb_owner`

No other branch, Production, Supabase, or Storage endpoint was contacted. Connection strings were supplied through protected stdin and were not printed or persisted.

## Live gate results

### Source

PASS. The source and contract gates above pass without database access.

### Dry-run

FAIL-CLOSED as designed. The direct bootstrap connection reached the approved target and the validator stopped with `CANONICAL_NEON_EMPTY_BASELINE_REQUIRED` before any install. Read-only catalog evidence showed the acceptance seed is present (`tenants`, `properties`, `user_accounts`, `profiles`, memberships, and role assignment each have one row); Import business rows are zero. No apply was attempted and no persistent change was made.

### Apply

NOT RUN. The dry-run precondition was not satisfied, so applying the E1–E5A baseline would have violated the empty-baseline guard. No migration SQL was written to the target.

### Catalog

NOT PASS. The canonical catalog validator stopped on target schema drift (`app_private.initialization_audit_events` is absent). A direct read-only routine inventory also found that the two Auth / Authorization entrypoints required by this split—`public.resolve_neon_property_context(text)` and `public.read_neon_authorization_session(text)`—are absent from this target. The target therefore cannot prove the Task 5 catalog contract.

### Runtime

NOT RUN. Runtime is gated on catalog success and a verified post-apply target. The real Supabase Auth-session matrix (manager, department scope, refresh re-resolution, cross-property denial, actor cleanup, pooled reuse, and raw-table denial) remains pending until a clean target containing the current 080/085 authority modules is supplied. No fake claims, `SET ROLE`, or raw runtime DML was used.

## Status and next action

Task 5 connection-free implementation is merge-ready. Live acceptance is **not ready** because the approved target is a previously populated schema projection that is missing the current property/auth authority modules. The safe next step is a fresh canonical acceptance database/branch (or an explicitly approved, empty, isolated rebuild), followed by source → rollback-only dry-run → apply → catalog → real-session runtime. Do not relax the empty-baseline guard or patch the populated target in place.

Remaining Supabase dependencies are limited to the Auth adapter (sign-in, user lookup, refresh) and Storage adapter. Supabase business repositories and legacy RPC paths remain retained historical code but are blocked from the active Auth/session/authorization path by the AST source gate.
