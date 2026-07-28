import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templatePath = new URL("../docs/recovery-e0/release-manifest-template.md", import.meta.url);
const rehearsalRunbookPath = new URL("../docs/recovery-e0/migration-rehearsal-runbook.md", import.meta.url);

const requiredControls = [
  ["application-sha", "Application SHA:"],
  ["branch", "Branch:"],
  ["build-identifier", "Build identifier:"],
  ["ordered-migration-filenames-and-checksums", "| Order | Migration filename | Checksum |"],
  ["local-reset-evidence", "Local reset evidence:"],
  ["pgtap-evidence", "pgTAP evidence:"],
  ["application-evidence", "Application evidence:"],
  ["build-evidence", "Build evidence:"],
  ["browser-evidence", "Browser evidence:"],
  ["named-owners", "Named owners:"],
  ["compatibility-declaration", "Compatibility declaration:"],
  ["redaction-statement", "this manifest contains no credentials, personal data, raw workbooks, tokens, browser sessions, or real hotel records."],
  ["not-performed-state", "State: **not performed**"],
  ["production-app-env-production", "APP_ENV=production"],
  ["production-app-data-mode-supabase", "APP_DATA_MODE=supabase"],
  ["forbid-db-reset-linked", "Do not run `db reset --linked`."],
  ["forbid-include-seed", "Do not use `--include-seed`."],
  ["forbid-migration-history-repair", "Do not repair migration history."],
  ["forbid-raw-employee-export", "Do not export raw employee data."],
  ["forbid-production-test-environment", "Do not use Production as a test environment."],
  ["manifest-author-no-production-authority", "The manifest author does not authorize Production work."],
  ["separate-approval-per-production-operation", "Each Production schema, data, or traffic operation requires its own separate explicit approval record."],
];

function missingControls(manifest) {
  return requiredControls
    .filter(([, requiredText]) => !manifest.includes(requiredText))
    .map(([control]) => control);
}

const rehearsalControls = [
  ["isolated-cli-environment", "HOME=/tmp/codex-supabase SUPABASE_TELEMETRY_DISABLED=true"],
  ["empty-local-reset", "supabase db reset --local"],
  ["ordered-inventory", "find supabase/migrations -type f -name '*.sql' -print | sort"],
  ["migration-checksums", "shasum -a 256"],
  ["migration-history", "supabase migration list --local"],
  ["focused-d0-pgtap", "supabase test db --local supabase/tests/recovery_d0_foundation_gate_test.sql"],
  ["focused-d1-pgtap", "supabase test db --local supabase/tests/recovery_d1_learning_requirement_foundation_test.sql"],
  ["focused-d2-pgtap", "supabase test db --local supabase/tests/recovery_d2_training_operations_foundation_test.sql"],
  ["focused-d3-pgtap", "supabase test db --local supabase/tests/recovery_d3_attendance_facts_test.sql"],
  ["focused-d4-pgtap", "supabase test db --local supabase/tests/recovery_d4_completion_evidence_test.sql"],
  ["full-pgtap", "supabase test db --local"],
  ["local-recovery-point", "Recovery point (local only):"],
  ["stop-migration-failure", "Stop immediately if a migration fails."],
  ["stop-inventory-mismatch", "Stop immediately if the ordered migration inventory or any checksum differs."],
  ["stop-pgtap-failure", "Stop immediately if focused or full pgTAP fails."],
  ["stop-security-failure", "Stop immediately if RLS, RPC, or Storage security validation fails."],
  ["stop-unrecoverable-reset", "Stop immediately if the disposable local reset cannot be completed."],
  ["forbid-linked", "Do not use `--linked`."],
  ["forbid-push", "Do not run `supabase db push`."],
  ["forbid-pull", "Do not run `supabase db pull`."],
  ["forbid-repair", "Do not run migration repair."],
  ["forbid-seed", "Do not use seed data."],
  ["forbid-employee-import", "Do not import employees."],
  ["forbid-account-creation", "Do not create accounts."],
  ["forbid-business-fixtures", "Do not create business-fact fixtures."],
  ["forbid-remote", "Do not connect to any remote or Production environment."],
  ["forbid-production-data-change", "Do not change Production data."],
  ["recovery-preserve-evidence", "Preserve only redacted evidence."],
  ["recovery-stop-run", "Stop the run."],
  ["recovery-reset-local-only", "Reset only the disposable local database."],
  ["recovery-diagnose", "Diagnose the failure."],
  ["recovery-replay-clean", "Replay from a clean local state."],
  ["no-production-remediation", "This runbook does not define a Production remediation."],
  ["scope-exclusion", "This rehearsal makes no migration, D0-D4 semantic, application behavior, UI, D5, KPI, Feedback, AI, Forecast, Health, or Risk change."],
];

function missingRehearsalControls(runbook) {
  return rehearsalControls
    .filter(([, requiredText]) => !runbook.includes(requiredText))
    .map(([control]) => control);
}

test("release manifest rejects a missing required readiness control", async () => {
  assert.equal(
    existsSync(templatePath),
    true,
    "release manifest template must exist before readiness controls can be validated",
  );

  const manifest = await readFile(templatePath, "utf8");
  assert.deepEqual(missingControls(manifest), []);

  for (const [missingControl, requiredText] of [
    ["production-app-data-mode-supabase", "APP_DATA_MODE=supabase"],
    ["forbid-production-test-environment", "Do not use Production as a test environment."],
  ]) {
    const manifestWithoutControl = manifest.replace(requiredText, "");
    assert.deepEqual(missingControls(manifestWithoutControl), [missingControl]);
  }
});

test("migration rehearsal runbook constrains the E0-B replay to a disposable local Supabase environment", async () => {
  assert.equal(
    existsSync(rehearsalRunbookPath),
    true,
    "migration rehearsal runbook must exist before the non-production replay can be approved",
  );

  const runbook = await readFile(rehearsalRunbookPath, "utf8");
  assert.deepEqual(missingRehearsalControls(runbook), []);

  for (const [missingControl, requiredText] of [
    ["forbid-linked", "Do not use `--linked`."],
    ["recovery-reset-local-only", "Reset only the disposable local database."],
  ]) {
    const runbookWithoutControl = runbook.replace(requiredText, "");
    assert.deepEqual(missingRehearsalControls(runbookWithoutControl), [missingControl]);
  }
});
