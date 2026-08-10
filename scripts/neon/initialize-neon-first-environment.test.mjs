import assert from "node:assert/strict";
import test from "node:test";
import { createInitializationEvidence, parseInitializationArgs, runInitializationCommand } from "./initialize-neon-first-environment.mjs";
import { authUserId, fixture, target } from "./fixtures/neon-first-initialization-test-fixture.mjs";

test("CLI requires a verified Auth user and confines evidence to protected temporary storage", () => {
  assert.throws(() => parseInitializationArgs(["--target-file", "/private/tmp/target.json", "--fixture", "/private/tmp/fixture.json"]), /NEON_FIRST_INIT_AUTH_USER_REQUIRED/);
  assert.throws(() => parseInitializationArgs(["--target-file", "/private/tmp/target.json", "--fixture", "/private/tmp/fixture.json", "--auth-user-id", authUserId, "--evidence-file", "docs/evidence.json"]), /NEON_FIRST_INIT_EVIDENCE_PATH_FORBIDDEN/);
});

test("CLI forwards dry-run to the operator and emits a redacted evidence projection", async () => {
  const args = parseInitializationArgs(["--target-file", "/private/tmp/target.json", "--fixture", "/private/tmp/fixture.json", "--auth-user-id", authUserId, "--dry-run", "--evidence-file", "/private/tmp/evidence.json"]);
  const received = [];
  const result = await runInitializationCommand({
    args,
    environment: { APP_ENV: "development", NEON_BOOTSTRAP_DATABASE_URL: "postgresql://neondb_owner:secret@ep-fresh-neon.c-10.us-east-1.aws.neon.tech/neondb?sslmode=require" },
    readJson: async (path) => path.endsWith("target.json") ? target : fixture,
    initialize: async (input) => { received.push(input); return { status: "dry_run", created: ["tenant"], requestId: "13131313-1313-4131-8131-131313131313", authUserId, tenantId: fixture.tenant.id, propertyId: fixture.property.id, profileId: fixture.manager.profileId, roleAssignmentId: fixture.manager.roleAssignmentId, seedVersion: fixture.seedVersion }; },
  });
  assert.equal(received[0].dryRun, true);
  assert.deepEqual(result, { status: "dry_run", created: ["tenant"], requestId: "13131313-1313-4131-8131-131313131313", authUserId, tenantId: fixture.tenant.id, propertyId: fixture.property.id, profileId: fixture.manager.profileId, roleAssignmentId: fixture.manager.roleAssignmentId, seedVersion: fixture.seedVersion, mode: "dry-run", credentialsRecorded: false });
  assert.deepEqual(createInitializationEvidence({ ...result, password: "never" }, target), { ...result, target, credentialsRecorded: false });
});
