# E0-B Sanitized command-output record

This stable evidence artifact records only sanitized local command outcomes. It excludes credentials, raw workbooks, personal data, employee/account identities, QR tokens, and training business facts.

**Run boundary:** disposable local Supabase only; `HOME=/tmp/codex-supabase DO_NOT_TRACK=1` was used for every Supabase invocation. The temporary CLI home was configured with `supabase telemetry disable` before replay.

| UTC window | Command category | Sanitized result |
|---|---|---|
| `2026-07-28T19:07:28Z` | CLI isolation | `supabase telemetry disable` completed in the temporary CLI home. Telemetry status: Telemetry is disabled. |
| `2026-07-28T19:20:31Z` | CLI isolation re-verification | `supabase telemetry status` again returned `Telemetry is disabled.` from the same temporary CLI home with `DO_NOT_TRACK=1`. |
| `2026-07-28T19:07:28Z–19:09:00Z` | Empty migration lane | Empty migration lane: PASS (29 migrations applied). Local history matched the 29-version artifact; no repair command was issued. |
| `2026-07-28T19:07:28Z–19:09:00Z` | Empty-lane aggregate query | No-seed counts: auth.users=0; user_accounts=0; employees=0; training_sessions=0; attendance_registers=0; completion_records=0. |
| `2026-07-28T19:09:00Z` | Deliberate inventory failure | Deliberate checksum mismatch: BLOCKED before database command. The intentionally supplied all-zero D4 checksum did not match the immutable source artifact. |
| `2026-07-28T19:09:00Z` | Local recovery | Recovery reset: PASS. A new `db reset --local --no-seed` completed before the synthetic security lane began. |
| `2026-07-28T19:09:00Z–19:11:00Z` | Focused integrity tests | D0-D4 focused pgTAP: PASS (5 files, 259 assertions). |
| `2026-07-28T19:09:00Z–19:11:00Z` | Full integrity tests | Full pgTAP: PASS (22 files, 737 assertions). |
| `2026-07-28T19:09:00Z–19:11:00Z` | Security coverage | RLS/RPC/Storage: PASS (7 checks). |
| `2026-07-28T19:09:00Z–19:11:00Z` | Application verification | Application and build: PASS (274 Node tests; production build; rendered HTML). |
| `2026-07-28T19:11:00Z` | Local database lint | Lint: BLOCKED FOR FOLLOW-UP. Existing `app_private.prepare_employee_import_preview_base` text-to-`public.import_batch_status` warning was retained without semantic change; a named owner is required before E0-C. |
| `2026-07-28T19:11:58Z` | Final local cleanup | Cleanup: PASS (final no-seed reset, local stack stopped, temporary CLI home removed). |

No remote or Production command was issued. No `--linked`, `db push`, `db pull`, or migration-repair command was issued. The synthetic security lane used only repository-owned fixtures and was removed by the final no-seed reset and local-stack stop.
