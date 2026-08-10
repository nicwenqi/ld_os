import assert from "node:assert/strict";
import test from "node:test";
import { E5E_DEVELOPMENT_SEED, assertSeedTarget, renderSeedManifest } from "./e5e-development-seed.mjs";

test("E5E seed is deterministic and provider-neutral", () => {
  assert.equal(E5E_DEVELOPMENT_SEED.source, "e5e-canonical-development-fixture");
  assert.equal(E5E_DEVELOPMENT_SEED.tenant.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(E5E_DEVELOPMENT_SEED.property.id, "22222222-2222-4222-8222-222222222222");
  assert.equal(E5E_DEVELOPMENT_SEED.auth.managerAuthUserId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.deepEqual([...E5E_DEVELOPMENT_SEED.scenarios], [
    "employee_insert",
    "employee_update_expected_version",
    "external_identifier_conflict",
    "guarded_revert_after_commit",
  ]);
  assert.doesNotMatch(renderSeedManifest(), /DATABASE_URL|SUPABASE|stage_employee_import|legacy/i);
  assert.equal(assertSeedTarget({}), true);
  assert.throws(() => assertSeedTarget({ production: true }), /E5E_SEED_TARGET_FORBIDDEN/);
  assert.throws(() => assertSeedTarget({ apply: true }), /E5E_SEED_APPLY_REQUIRES_STAGING_ONLY_SEEDER/);
});
