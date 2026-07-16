import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/initialize/page.tsx", import.meta.url), "utf8");

test("property and activation writes use their separate authoritative concurrency versions", () => {
  assert.match(page, /expectedVersion:\s*authoritative\.settings\.version/);
  assert.match(page, /let activationProgress\s*=\s*progress/);
  assert.match(page, /activationProgress\s*=\s*await registry\.initialization\.getProgress/);
  assert.match(page, /expectedVersion:\s*activationProgress\.version/);
  assert.match(page, /expectedVersion:\s*nextProgress\.version/);
  assert.doesNotMatch(page, /saveBusinessRules\([\s\S]{0,180}expectedVersion:\s*progress\.version/);
});

test("save for later persists navigation without changing confirmation state", () => {
  const saveForLater = page.match(/const saveForLater[\s\S]*?const completeActivation/)?.[0] ?? "";
  assert.match(saveForLater, /registry\.initialization\.saveNavigation/);
  assert.doesNotMatch(saveForLater, /saveStep/);
  assert.doesNotMatch(saveForLater, /markSaved|setHotelDraftDirty\(false\)|setChildDraftDirty\(false\)/);
});
