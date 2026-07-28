import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templatePath = new URL("../docs/recovery-e0/release-manifest-template.md", import.meta.url);

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
