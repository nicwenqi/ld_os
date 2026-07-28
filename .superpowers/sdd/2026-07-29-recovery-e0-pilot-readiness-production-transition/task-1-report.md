# Task 1 report — E0-A release manifest and source-mode boundary

## Scope completed

- Added `docs/recovery-e0/release-manifest-template.md`, a redacted E0-A release-manifest template with structured readiness controls.
- Added `tests/recovery-e0-readiness.test.mjs`, which validates the template controls and rejects a manifest with a required control removed.
- Tightened `assertProductionDataBoundary` so `APP_ENV=production` accepts only `APP_DATA_MODE=supabase`; local and preview hybrid behavior is unchanged.
- Added the focused production/hybrid regression assertion in `tests/environment.test.mjs`.

No Production or remote connection, migration, reset, import, deployment, account creation, seed, or data mutation was performed. No D0-D4 fact semantics, database, or application UI behavior was changed.

## TDD evidence

### Red: manifest template

Command:

```sh
node --test tests/recovery-e0-readiness.test.mjs
```

Observed result: exit 1; 0 passed and 1 failed. The assertion failure was `release manifest template must exist before readiness controls can be validated` with `false !== true`, proving the test failed because the template was absent rather than due to a test error.

### Red: Production hybrid boundary

Command:

```sh
node --test tests/environment.test.mjs
```

Observed result: exit 1; 8 passed and 1 failed. `production requires the Supabase data mode` received `NEXT_PUBLIC_SUPABASE_URL is required outside mock mode` rather than the required Production-mode rejection, proving production/hybrid was not yet rejected at the boundary.

### Green: focused verification

Command:

```sh
node --test tests/recovery-e0-readiness.test.mjs tests/environment.test.mjs
```

Observed result: exit 0; 10 passed, 0 failed, 0 skipped, 0 todo.

## Required manifest controls

The template requires application SHA, branch, build identifier, ordered migration filenames and checksums; local reset, pgTAP, application, build, and browser evidence; named owners; compatibility declaration; redaction statement; and an explicit **not performed** state. It declares `APP_ENV=production` and `APP_DATA_MODE=supabase`, forbids the specified unsafe commands/actions, and states the manifest-author and per-operation approval boundary.

## Self-review

Command:

```sh
git diff --check
```

Observed result: exit 0 with no whitespace errors.

## Files intended for this task commit

- `app/lib/environment.ts`
- `tests/environment.test.mjs`
- `tests/recovery-e0-readiness.test.mjs`
- `docs/recovery-e0/release-manifest-template.md`
- `.superpowers/sdd/2026-07-29-recovery-e0-pilot-readiness-production-transition/task-1-report.md`

Existing edits to the E0 plan and design documents were left unmodified and excluded from this task commit.
