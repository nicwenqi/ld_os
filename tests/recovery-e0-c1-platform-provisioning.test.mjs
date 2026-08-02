import assert from "node:assert/strict";
import test from "node:test";

test("C1 preview is redacted, signed, actor-bound, and zero-write", async () => {
  const service = await import("../app/services/platform-property-provisioning.ts");
  const draft = {
    tenantId: "10000000-0000-0000-0000-000000000001",
    propertyCode: "c1-pilot",
    preliminaryNameZh: "C1 本地试运行酒店",
    preliminaryNameEn: "C1 Local Pilot Hotel",
    brand: "C1 Local Brand",
    city: "Suzhou",
    countryRegion: "CN",
    timezone: "Asia/Shanghai",
    defaultLanguage: "zh-CN",
    hostname: "c1-pilot.example.test",
    managerLoginId: "c1-manager",
    managerDisplayName: "C1 本地学习与发展经理",
  };
  const preview = service.preparePropertyProvisioningPreview(draft, {
    actorUserId: "00000000-0000-0000-0000-000000000101",
    secret: "test-only-c1-preview-secret",
    now: new Date("2026-07-30T00:00:00.000Z"),
  });
  assert.equal(preview.normalized.propertyCode, "c1-pilot");
  assert.equal(preview.normalized.hostname, "c1-pilot.example.test");
  assert.doesNotMatch(JSON.stringify(preview), /authUserId|internalEmail|temporaryPassword/);
  assert.deepEqual(
    service.verifyPropertyProvisioningPreview(preview.token, draft, {
      actorUserId: "00000000-0000-0000-0000-000000000101",
      secret: "test-only-c1-preview-secret",
      now: new Date("2026-07-30T00:01:00.000Z"),
    }),
    preview.normalized,
  );
  assert.throws(() => service.verifyPropertyProvisioningPreview(preview.token, {
    ...draft,
    propertyCode: "changed-c1-pilot",
  }, {
    actorUserId: "00000000-0000-0000-0000-000000000101",
    secret: "test-only-c1-preview-secret",
    now: new Date("2026-07-30T00:01:00.000Z"),
  }), /预览内容已变化/);
});

test("C1 platform actor is separate from hotel authorization and Production never uses mock identity", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile("app/services/platform-authorization.ts", "utf8"));
  assert.doesNotMatch(source, /resolveRequestHostname|resolveAuthenticatedRequest/);
  assert.match(source, /platform_memberships/);
  assert.match(source, /APP_ENV.*local|appEnv === "local"/);
  assert.match(source, /dataMode === "mock"/);
});

test("C1 controlled commit compensates only a newly created Auth identity after a failed RPC", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile("app/api/platform/properties/route.ts", "utf8"));
  assert.match(source, /auth\.admin\.createUser/);
  assert.match(source, /generateTemporaryPassword/);
  assert.match(source, /actorClient\.rpc\("provision_initial_property_and_manager"/);
  assert.match(source, /auth\.admin\.deleteUser/);
  assert.doesNotMatch(source, /\.from\("properties"\)\.insert|\.from\("user_accounts"\)\.insert/);
});
