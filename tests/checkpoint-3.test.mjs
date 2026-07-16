import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path,import.meta.url),"utf8");

test("calendar and sessions state the real data boundary",async()=>{
  for (const path of ["../app/calendar/page.tsx","../app/sessions/page.tsx"]) {
    const page=await read(path);
    assert.match(page,/UnavailableOperationalPage/);
    assert.doesNotMatch(page,/saveDraft|publishSession|session-1|showToast/);
  }
});

test("predictable prototype session and QR routes are removed",async()=>{
  for (const path of ["../app/sessions/session-1/page.tsx","../app/check-in/session-1/page.tsx","../app/feedback/session-1/page.tsx"]) await assert.rejects(access(new URL(path,import.meta.url)));
});

test("the shared unavailable experience explains evidence and return paths",async()=>{
  const page=await read("../app/components/operations/UnavailableOperationalPage.tsx");
  for (const token of ["尚未接入真实数据","requiredFacts","returnHref","DataStateBadge"]) assert.match(page,new RegExp(token));
  assert.doesNotMatch(page,/showToast/);
});
