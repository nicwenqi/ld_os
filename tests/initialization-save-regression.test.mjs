import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/initialize/page.tsx", import.meta.url), "utf8");

test("business rules save advances initialization with the persisted settings version", () => {
  assert.match(page, /const updatedRecord=await registry\.property\.saveBusinessRules/);
  assert.match(page, /saveBusinessRules\(\{propertyId:record\.settings\.propertyId,expectedVersion:progress\.version/);
  assert.match(page, /expectedVersion:updatedRecord\.settings\.version/);
});

test("save for later persists navigation without changing confirmation state", () => {
  const saveForLater = page.match(/const saveForLater[\s\S]*?const complete/)?.[0] ?? "";
  assert.match(saveForLater, /registry\.initialization\.saveNavigation/);
  assert.doesNotMatch(saveForLater, /saveStep/);
  assert.doesNotMatch(saveForLater, /stepKeys/);
});
