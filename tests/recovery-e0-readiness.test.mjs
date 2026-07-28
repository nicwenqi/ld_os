import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templatePath = new URL("../docs/recovery-e0/release-manifest-template.md", import.meta.url);
const rehearsalRunbookPath = new URL("../docs/recovery-e0/migration-rehearsal-runbook.md", import.meta.url);
const evidenceRunbookPath = new URL("../docs/recovery-e0/rehearsal-runbook.md", import.meta.url);
const evidenceTemplatePath = new URL("../docs/recovery-e0/evidence-register-template.md", import.meta.url);
const evidencePath = new URL("../docs/recovery-e0/e0-b-migration-rehearsal-evidence.md", import.meta.url);
const manifestArtifactPath = new URL("../docs/recovery-e0/e0-b-local-migration-manifest.sha256", import.meta.url);
const migrationHistoryArtifactPath = new URL("../docs/recovery-e0/e0-b-local-migration-history.txt", import.meta.url);
const commandResultsArtifactPath = new URL("../docs/recovery-e0/e0-b-command-results.md", import.meta.url);
const e0cEntryDecisionPath = new URL("../docs/recovery-e0/e0-c-entry-decision-lock.md", import.meta.url);

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
  ["isolated-cli-environment", "HOME=/tmp/codex-supabase DO_NOT_TRACK=1"],
  ["persistent-telemetry-opt-out", "supabase telemetry disable"],
  ["telemetry-status-verification", "supabase telemetry status"],
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
  ["empty-replay-no-seed", "supabase db reset --local --no-seed"],
  ["synthetic-test-lane", "Synthetic test lane (local only)"],
  ["synthetic-after-empty-replay", "Only after the empty replay has been recorded"],
  ["forbid-real-employee-import", "Do not import real employees."],
  ["forbid-real-account-creation", "Do not create real accounts."],
  ["forbid-real-business-facts", "Do not create real training business facts."],
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
  assert.equal(
    runbook.includes("SUPABASE_TELEMETRY_DISABLED=true"),
    false,
    "the installed CLI did not honor the obsolete telemetry-only environment variable",
  );

  for (const [missingControl, requiredText] of [
    ["forbid-linked", "Do not use `--linked`."],
    ["recovery-reset-local-only", "Reset only the disposable local database."],
  ]) {
    const runbookWithoutControl = runbook.replace(requiredText, "");
    assert.deepEqual(missingRehearsalControls(runbookWithoutControl), [missingControl]);
  }
});

test("E0-B evidence protocol distinguishes verified local proof from unperformed remote work", async () => {
  assert.equal(existsSync(evidenceRunbookPath), true, "E0-B evidence runbook must exist");
  assert.equal(existsSync(evidenceTemplatePath), true, "E0-B evidence register template must exist");

  const [runbook, template] = await Promise.all([
    readFile(evidenceRunbookPath, "utf8"),
    readFile(evidenceTemplatePath, "utf8"),
  ]);

  for (const requiredText of [
    "Verified",
    "Not performed",
    "Blocked",
    "Accepted exception",
    "migration count, order, and checksums",
    "RLS/RPC/Storage",
    "failure stop and recovery",
    "No real hotel identity, employee, account, QR token, or training fact",
    "No Preview or Production connection",
  ]) {
    assert.equal(
      `${runbook}\n${template}`.includes(requiredText),
      true,
      `E0-B evidence protocol requires visible control: ${requiredText}`,
    );
  }
});

test("completed E0-B evidence is self-contained and records a local stop-recovery trail", async () => {
  assert.equal(existsSync(evidencePath), true, "completed E0-B evidence must exist");
  assert.equal(existsSync(manifestArtifactPath), true, "local migration manifest artifact must exist");
  assert.equal(existsSync(migrationHistoryArtifactPath), true, "local migration history artifact must exist");
  assert.equal(existsSync(commandResultsArtifactPath), true, "sanitized command-result artifact must exist");

  const [evidence, manifestArtifact, migrationHistoryArtifact, commandResultsArtifact] = await Promise.all([
    readFile(evidencePath, "utf8"),
    readFile(manifestArtifactPath, "utf8"),
    readFile(migrationHistoryArtifactPath, "utf8"),
    readFile(commandResultsArtifactPath, "utf8"),
  ]);

  for (const requiredText of [
    "Release source commit (full SHA):",
    "Supabase CLI:",
    "UTC started:",
    "UTC completed:",
    "Telemetry: temporary-home `supabase telemetry disable` returned disabled; `DO_NOT_TRACK=1` was set",
    "Migration manifest artifact:",
    "Migration history artifact:",
    "No-seed count artifact:",
    "Command-result artifact:",
    "D0–D4 focused pgTAP: 5 files, 259 assertions, PASS",
    "Full pgTAP: 22 files, 737 assertions, PASS",
    "RLS/RPC/Storage: 7 checks, PASS",
    "Manifest mismatch stop: Blocked",
    "Recovery reset: Verified",
    "Final cleanup: Verified",
    "No Preview or Production connection was used.",
  ]) {
    assert.equal(evidence.includes(requiredText), true, `E0-B evidence requires: ${requiredText}`);
  }

  const manifestLines = manifestArtifact.trim().split("\n").filter(Boolean);
  assert.equal(manifestLines.length, 29, "manifest artifact must contain every local migration checksum");
  assert.match(manifestArtifact, /20260728145050_recovery_d4_completion_evidence\.sql/);

  const migrationHistoryLines = migrationHistoryArtifact.trim().split("\n").filter(Boolean);
  assert.equal(migrationHistoryLines.length, 29, "history artifact must contain every applied local migration version");
  assert.equal(migrationHistoryLines.at(-1), "20260728145050", "history artifact must end with the D4 migration version");

  for (const requiredText of [
    "Sanitized command-output record",
    "Telemetry status: Telemetry is disabled.",
    "Empty migration lane: PASS (29 migrations applied)",
    "No-seed counts: auth.users=0; user_accounts=0; employees=0; training_sessions=0; attendance_registers=0; completion_records=0",
    "Deliberate checksum mismatch: BLOCKED before database command",
    "Recovery reset: PASS",
    "D0-D4 focused pgTAP: PASS (5 files, 259 assertions)",
    "Full pgTAP: PASS (22 files, 737 assertions)",
    "RLS/RPC/Storage: PASS (7 checks)",
    "Application and build: PASS (274 Node tests; production build; rendered HTML)",
    "Lint: BLOCKED FOR FOLLOW-UP",
    "Cleanup: PASS (final no-seed reset, local stack stopped, temporary CLI home removed)",
    "No remote or Production command was issued.",
  ]) {
    assert.equal(commandResultsArtifact.includes(requiredText), true, `command-result artifact requires: ${requiredText}`);
  }
  assert.doesNotMatch(commandResultsArtifact, /sb_(?:secret|publishable)|eyJ[a-zA-Z0-9_-]{20,}/, "command-result artifact must not contain credentials or JWTs");
});

test("E0-C remains locked until named pilot authority, baseline status, and a real requirement approval exist", async () => {
  assert.equal(existsSync(e0cEntryDecisionPath), true, "E0-C entry decision lock must exist before pilot initialization is considered");

  const entryLock = await readFile(e0cEntryDecisionPath, "utf8");
  for (const requiredText of [
    "**Decision:** **NO GO — E0-C has not started.**",
    "Lint warning owner: **Unassigned — blocking**",
    "Pilot property owner: **Unassigned — blocking**",
    "L&D responsibility owner: **Unassigned — blocking**",
    "Pilot scope: **Unapproved — blocking**",
    "Employee baseline status: **Cannot start**",
    "消防安全年度培训",
    "**Candidate only; not an approved or Effective Requirement Version.**",
    "No Production or other remote environment was connected.",
    "Do not create a Course, Requirement, Plan, Session, Attendance, or Completion fact.",
    "D0–D4 semantics remain unchanged.",
  ]) {
    assert.equal(entryLock.includes(requiredText), true, `E0-C entry decision lock requires: ${requiredText}`);
  }
});
