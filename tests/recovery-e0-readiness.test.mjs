import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templatePath = new URL("../docs/recovery-e0/release-manifest-template.md", import.meta.url);

const requiredControls = [
  "application-sha",
  "branch",
  "build-identifier",
  "ordered-migration-filenames-and-checksums",
  "local-reset-evidence",
  "pgtap-evidence",
  "application-evidence",
  "build-evidence",
  "browser-evidence",
  "named-owners",
  "compatibility-declaration",
  "redaction-statement",
  "not-performed-state",
  "production-app-env-production",
  "production-app-data-mode-supabase",
  "forbid-db-reset-linked",
  "forbid-include-seed",
  "forbid-migration-history-repair",
  "forbid-raw-employee-export",
  "forbid-production-test-environment",
  "manifest-author-no-production-authority",
  "separate-approval-per-production-operation",
];

function controlMarker(control) {
  return `<!-- recovery-e0-control: ${control} -->`;
}

function missingControls(manifest) {
  return requiredControls.filter((control) => !manifest.includes(controlMarker(control)));
}

test("release manifest rejects a missing required readiness control", async () => {
  assert.equal(
    existsSync(templatePath),
    true,
    "release manifest template must exist before readiness controls can be validated",
  );

  const manifest = await readFile(templatePath, "utf8");
  assert.deepEqual(missingControls(manifest), []);

  const missingControl = "forbid-production-test-environment";
  const manifestWithoutControl = manifest.replace(controlMarker(missingControl), "");
  assert.deepEqual(missingControls(manifestWithoutControl), [missingControl]);
});
