# E0-B non-production migration rehearsal runbook

## Purpose and boundary

This runbook replays the already-approved D0-D4 release artifact only in a disposable local Supabase environment. It is a readiness rehearsal, not a migration, release, or approval to change any environment.

This rehearsal makes no migration, D0-D4 semantic, application behavior, UI, D5, KPI, Feedback, AI, Forecast, Health, or Risk change.

Every command below is local-only and isolates Supabase CLI state with `HOME=/tmp/codex-supabase` and `DO_NOT_TRACK=1`. Before replay, run `supabase telemetry disable` in that temporary HOME and verify `supabase telemetry status` reports disabled. Do not replace the local flags, the isolated HOME, or the telemetry setting.

## Hard prohibitions

- Do not use `--linked`.
- Do not run `supabase db push`.
- Do not run `supabase db pull`.
- Do not run migration repair.
- Do not import real employees.
- Do not create real accounts.
- Do not create real training business facts.
- Do not connect to any remote or Production environment.
- Do not change Production data.

No production connection, schema operation, data operation, traffic operation, or Production remediation belongs in this rehearsal.

## Preconditions

1. Start from the approved release artifact and release-manifest migration inventory. Record only redacted evidence references; never copy credentials, employee data, accounts, workbooks, tokens, or business facts into rehearsal evidence.
2. Confirm the target is the disposable local stack. If the local stack cannot be started, stop without substituting Preview, remote, or Production.
3. Explicitly disable telemetry inside the disposable CLI home, then verify the persisted setting before any replay command:

   ```sh
   HOME=/tmp/codex-supabase DO_NOT_TRACK=1 npx --no-install supabase telemetry disable
   HOME=/tmp/codex-supabase DO_NOT_TRACK=1 npx --no-install supabase telemetry status
   ```

   Stop if the status does not report disabled. `DO_NOT_TRACK=1` is required on every Supabase command even after the temporary-home setting is disabled.
4. Start the local stack:

   ```sh
   HOME=/tmp/codex-supabase DO_NOT_TRACK=1 npx --no-install supabase start
   ```

## Empty local replay

1. Reset the disposable database without seed data. This is the required empty local reset:

   ```sh
   HOME=/tmp/codex-supabase DO_NOT_TRACK=1 npx --no-install supabase db reset --local --no-seed
   ```

2. Record the reset timestamp and the literal local target in the redacted evidence register.
3. Build the ordered local migration inventory and checksums:

   ```sh
   HOME=/tmp/codex-supabase DO_NOT_TRACK=1 sh -c "find supabase/migrations -type f -name '*.sql' -print | sort | xargs shasum -a 256"
   ```

4. Compare that ordered output, including every filename, order, and checksum, against the approved release-manifest inventory. Record the comparison result without copying sensitive content.
5. Verify local migration history:

   ```sh
   HOME=/tmp/codex-supabase DO_NOT_TRACK=1 npx --no-install supabase migration list --local
   ```

   Compare the local history with the same approved inventory; do not repair a mismatch.

## Verification sequence

### Synthetic test lane (local only)

Only after the empty replay has been recorded, reset the same disposable local database with the repository's built-in synthetic seed solely to supply the existing pgTAP security-fixture baseline:

```sh
HOME=/tmp/codex-supabase DO_NOT_TRACK=1 npx --no-install supabase db reset --local
```

This second reset is not employee-baseline import, hotel activation, or Pilot data creation. It may create only repository-owned synthetic fixtures required by the test suite; those fixtures remain local and are removed when the disposable stack is stopped or reset without seed. Do not add any new fixture, workbook, account, employee, course, requirement, session, attendance, or completion record outside the test transactions already owned by the repository suite.

Run the focused D0-D4 pgTAP tests in order. These commands use only the local database and the repository test files.

```sh
HOME=/tmp/codex-supabase DO_NOT_TRACK=1 npx --no-install supabase test db --local supabase/tests/recovery_d0_foundation_gate_test.sql
HOME=/tmp/codex-supabase DO_NOT_TRACK=1 npx --no-install supabase test db --local supabase/tests/recovery_d1_learning_requirement_foundation_test.sql
HOME=/tmp/codex-supabase DO_NOT_TRACK=1 npx --no-install supabase test db --local supabase/tests/recovery_d2_training_operations_foundation_test.sql
HOME=/tmp/codex-supabase DO_NOT_TRACK=1 npx --no-install supabase test db --local supabase/tests/recovery_d3_attendance_facts_test.sql
HOME=/tmp/codex-supabase DO_NOT_TRACK=1 npx --no-install supabase test db --local supabase/tests/recovery_d4_completion_evidence_test.sql
```

Then run the full local pgTAP suite:

```sh
HOME=/tmp/codex-supabase DO_NOT_TRACK=1 npx --no-install supabase test db --local
```

Run the repository's existing local RLS, RPC, and Storage security coverage only with its synthetic test fixtures; do not create any additional business-fact fixture:

```sh
HOME=/tmp/codex-supabase DO_NOT_TRACK=1 node --test tests/security-tenancy-source.test.mjs tests/recovery-c-storage-api.test.mjs
```

Recovery point (local only): after the reset, inventory comparison, local migration-history verification, focused pgTAP, full pgTAP, and RLS/RPC/Storage validation have passed, record a redacted evidence reference and the local reset timestamp. This is a local checkpoint, not a backup or a remote recovery point.

## Mandatory stops and recovery

- Stop immediately if a migration fails.
- Stop immediately if the ordered migration inventory or any checksum differs.
- Stop immediately if focused or full pgTAP fails.
- Stop immediately if RLS, RPC, or Storage security validation fails.
- Stop immediately if the disposable local reset cannot be completed.

On any stop condition: Preserve only redacted evidence. Stop the run. Reset only the disposable local database. Diagnose the failure. Replay from a clean local state. Do not continue from a partially reset or partially migrated local state, and do not use a remote system to diagnose or recover.

This runbook does not define a Production remediation.

## Evidence to retain

Record the release identifier, local reset timestamp, ordered migration filenames and checksums, local migration-history comparison, focused and full pgTAP totals, RLS/RPC/Storage coverage result, and any stop/recovery sequence. Mark unperformed steps honestly. Retain redacted evidence only.
