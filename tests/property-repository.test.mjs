import assert from "node:assert/strict";
import test from "node:test";

import { createMockPropertyRepository } from "../app/repositories/mock/property-repository.ts";

test("synthetic property fixture resolves without real hotel identity", async () => {
  const repository = createMockPropertyRepository();
  const context = await repository.resolveContext("training-demo.example.test");
  assert.equal(context?.nameZh, "示范酒店");
  assert.equal(context?.hostname, "training-demo.example.test");
  assert.equal(await repository.resolveContext("unconfigured-hotel.example.test"), null);
});

test("identity and business rules use optimistic concurrency", async () => {
  const repository = createMockPropertyRepository();
  const initial = await repository.getProperty("20000000-0000-0000-0000-000000000011");
  const changed = await repository.saveBusinessRules({
    propertyId: initial.identity.id,
    expectedVersion: initial.settings.version,
    newEmployeeDays: 60,
    probationFieldMeaning: "confirmation_date",
    employeeStatusSource: "manual",
    ctcMandatory: true,
    gtcMandatory: false,
  });
  assert.equal(changed.settings.version, initial.settings.version + 1);
  await assert.rejects(
    repository.saveBusinessRules({
      propertyId: initial.identity.id,
      expectedVersion: initial.settings.version,
      newEmployeeDays: 30,
      probationFieldMeaning: "unused",
      employeeStatusSource: "manual",
      ctcMandatory: false,
      gtcMandatory: false,
    }),
    /资料已被更新/,
  );
});

test("logo replacement uses non-guessable versions and retains the previous logo", async () => {
  const repository = createMockPropertyRepository();
  const first = await repository.uploadLogo({
    tenantId: "10000000-0000-0000-0000-000000000001",
    propertyId: "20000000-0000-0000-0000-000000000011",
    file: new File(["first"], "logo.png", { type: "image/png" }),
  });
  const second = await repository.uploadLogo({
    tenantId: "10000000-0000-0000-0000-000000000001",
    propertyId: "20000000-0000-0000-0000-000000000011",
    file: new File(["second"], "logo.webp", { type: "image/webp" }),
  });
  assert.match(first.objectPath, /\/branding\/[0-9a-f-]{36}\/logo-v1\.png$/);
  assert.match(second.objectPath, /\/branding\/[0-9a-f-]{36}\/logo-v2\.webp$/);
  assert.notEqual(first.objectPath, second.objectPath);
  assert.equal((await repository.getProperty(second.propertyId)).currentLogo?.id, second.id);
});
