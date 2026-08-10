import assert from "node:assert/strict";
import test from "node:test";
import { validateInitializationFixture, validateInitializationTarget } from "./neon-first-initialization-contract.mjs";
import { authUserId, fixture, target } from "./fixtures/neon-first-initialization-test-fixture.mjs";

test("initialization target rejects production and runtime connections", () => {
  assert.equal(validateInitializationTarget(target, { APP_ENV: "development" }, [target]), true);
  assert.throws(() => validateInitializationTarget(target, { APP_ENV: "development" }, []), /NEON_FIRST_INIT_TARGET_UNAPPROVED/);
  assert.throws(() => validateInitializationTarget({ ...target, environment: "production" }, { APP_ENV: "development" }), /NEON_FIRST_INIT_TARGET_FORBIDDEN/);
  assert.throws(() => validateInitializationTarget(target, { APP_ENV: "production" }), /NEON_FIRST_INIT_TARGET_FORBIDDEN/);
  assert.throws(() => validateInitializationTarget(target, { APP_ENV: "development", DATABASE_URL: "postgresql://hotel_ld_application:secret@ep-fresh-neon-pooler.example/neondb" }), /NEON_FIRST_INIT_RUNTIME_URL_FORBIDDEN/);
});

test("initialization fixture is closed and requires an external verified Auth user UUID", () => {
  assert.equal(validateInitializationFixture(fixture, authUserId), true);
  assert.throws(() => validateInitializationFixture({ ...fixture, importedAuthUsers: [] }, authUserId), /NEON_FIRST_INIT_FIXTURE_INVALID/);
  assert.throws(() => validateInitializationFixture(fixture, "not-a-uuid"), /NEON_FIRST_INIT_AUTH_USER_INVALID/);
  assert.throws(() => validateInitializationFixture({ ...fixture, developmentSeed: { ...fixture.developmentSeed, employeeIdentifierId: fixture.developmentSeed.employeeId } }, authUserId), /NEON_FIRST_INIT_FIXTURE_INVALID/);
});
