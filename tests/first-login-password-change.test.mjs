import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  generateTemporaryPassword,
  validateTemporaryPassword,
  validateUserSelectedPassword,
} from "../app/services/account-administration.ts";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("a hotel user-selected password uses the practical eight-character strength rule", () => {
  assert.throws(() => validateUserSelectedPassword("Hotel1"), /至少 8 位/);
  assert.throws(() => validateUserSelectedPassword("hotelonly"), /大写字母、小写字母和数字/);
  assert.throws(() => validateUserSelectedPassword("HOTEL123"), /大写字母、小写字母和数字/);
  assert.doesNotThrow(() => validateUserSelectedPassword("Hotel2026"));
});

test("system-generated temporary passwords remain twelve-character credentials", () => {
  assert.throws(() => validateTemporaryPassword("Hotel2026"), /至少 12 位/);
  const password = generateTemporaryPassword();
  assert.equal(password.length, 12);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /\d/);
  assert.doesNotThrow(() => validateTemporaryPassword(password));
});

test("account lifecycle routes generate temporary credentials server-side and return them only after success", async () => {
  const [hotelAccounts, platformAccounts, provisioning] = await Promise.all([
    read("../app/api/admin/accounts/route.ts"),
    read("../app/api/platform/properties/[propertyId]/accounts/route.ts"),
    read("../app/api/platform/properties/route.ts"),
  ]);
  for (const source of [hotelAccounts, platformAccounts, provisioning]) {
    assert.match(source, /generateTemporaryPassword/);
    assert.match(source, /issuedTemporaryPassword/);
  }
  assert.doesNotMatch(`${hotelAccounts}\n${platformAccounts}`, /text\(body\.temporaryPassword\)/);
});

test("first password change completes the own-account business transition then requires a fresh login", async () => {
  const [route, page] = await Promise.all([
    read("../app/api/auth/change-password/route.ts"),
    read("../app/change-password/page.tsx"),
  ]);

  assert.match(route, /createServerActorClient/);
  assert.match(route, /createServerPasswordClient/);
  assert.match(route, /auth\.setSession/);
  assert.match(route, /prepare_hotel_password_change/);
  assert.match(route, /complete_hotel_password_change/);
  assert.match(route, /expiredAuthCookies/);
  assert.match(route, /reauthenticationRequired:\s*true/);
  assert.doesNotMatch(route, /\.from\("user_accounts"\)[\s\S]*?\.update\(/);
  assert.match(page, /validateUserSelectedPassword/);
  assert.match(page, /\/login\?passwordChanged=1/);
  assert.match(page, /minLength=\{8\}/);
});

test("the server-only completion boundary still requires an active hotel role", async () => {
  const migration = await read("../supabase/migrations/20260802103506_hotel_password_change_completion_boundary.sql");
  assert.match(migration, /role\.code = 'property_ld_manager'/);
  assert.match(migration, /role\.code = 'department_training_admin'/);
  assert.match(migration, /scope\.is_active/);
});
