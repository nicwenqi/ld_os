# E0-B migration rehearsal evidence

**Status:** Complete local rehearsal — Review Stop E0-B
**Release source commit (full SHA):** `d61cff25772774db35b6662b45648d3bffec6def`
**Owner:** E0 technical rehearsal operator
**Supabase CLI:** `2.105.0`
**UTC started:** `2026-07-28T19:07:28Z`
**UTC completed:** `2026-07-28T19:11:58Z`
**Telemetry: temporary-home `supabase telemetry disable` returned disabled; `DO_NOT_TRACK=1` was set.** The installed CLI did not report disabled from the environment variable alone, so the persistent temporary-home opt-out was explicitly verified before the rerun.
**Target:** disposable local Supabase only
**Data classification:** no real hotel data, accounts, employee records, or training facts

**Migration manifest artifact:** [`e0-b-local-migration-manifest.sha256`](./e0-b-local-migration-manifest.sha256) — 29 ordered migration checksums.
**Migration history artifact:** [`e0-b-local-migration-history.txt`](./e0-b-local-migration-history.txt) — the same 29 local history versions as the manifest; no mismatch or repair operation occurred.
**No-seed count artifact:** [`e0-b-command-results.md`](./e0-b-command-results.md) — aggregate local query returned `0` for `auth.users`, `user_accounts`, `employees`, `training_sessions`, `attendance_registers`, and `completion_records` after the no-seed reset and again at cleanup.
**Command-result artifact:** [`e0-b-command-results.md`](./e0-b-command-results.md) — redacted, timestamped local command outcomes for replay, stop/recovery, tests, lint, and cleanup; contains no credentials, personal data, or business facts.

| Item | Status | Redacted evidence | Disposition |
|---|---|---|---|
| Release manifest/environment boundary | Verified | E0-A readiness/environment test; Production accepts only `APP_DATA_MODE=supabase` | 10 focused checks passed before E0-B; retained in standard suite. |
| Empty local reset | Verified | Local `db reset --local --no-seed`; all 29 migrations applied | No linked or remote target used. |
| Migration count, order, and checksums | Verified | 29 local migration files; local history contains the same 29 versions; full checksums are in the linked manifest artifact | No order or history mismatch. |
| Empty-lane account/employee/fact counts | Verified | `auth.users`, `user_accounts`, `employees`, `training_sessions`, `attendance_registers`, and `completion_records` each returned `0` | Confirms no seed business facts after the formal replay. |
| D0–D4 focused pgTAP | Verified | D0–D4 focused pgTAP: 5 files, 259 assertions, PASS | Executed only after synthetic test-lane reset. |
| Full pgTAP | Verified | Full pgTAP: 22 files, 737 assertions, PASS | Includes tenancy/RLS and storage security files. |
| RLS/RPC/Storage | Verified | RLS/RPC/Storage: 7 checks, PASS | Covers RLS enabled/no broad policy, private helper boundary, and private Storage authorization paths. |
| Failure stop and recovery | Verified | Manifest mismatch stop: Blocked — deliberately supplied all-zero D4 checksum differed from the actual file checksum; no database command followed. | Recovery reset: Verified — a fresh local `db reset --local --no-seed` preceded synthetic test verification. |
| Application/build verification | Verified | 274 Node tests, build PASS, rendered HTML PASS | No browser/Preview work belongs in E0-B. |
| Lint/advisor result | Blocked for follow-up | Local `db lint` returned one warning in existing `app_private.prepare_employee_import_preview_base`: text assignment to `public.import_batch_status` | No semantic change made in E0-B. Owner must be assigned before E0-C; it is not treated as accepted. |
| Cleanup | Verified | Final cleanup: Verified — final local `db reset --local --no-seed` repeated the 29 migration replay; aggregate counts again all `0`; local stack stopped with no backup | No local synthetic fixture retained. |

## Non-performed work

- **Not performed:** any Preview or Production connection, migration, schema change, account or property initialization, employee baseline import, workbook upload, course/requirement/session/attendance/completion business operation, deployment, DNS/environment modification, or D5 work. No Preview or Production connection was used.
- **Not performed:** Production migration history alignment. That belongs only to approved E0-C Pilot property initialization.

## Review recommendation

**Go to Review Stop E0-B.** The approved D0–D4 migration set replays cleanly into a no-seed local database, existing security/integrity suites pass in their documented synthetic test lane, and the rehearsal ends clean. E0-C remains blocked pending explicit approval and named Pilot/property owners.
