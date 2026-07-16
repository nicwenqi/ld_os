import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = path => readFile(new URL(path,import.meta.url),"utf8");

test("department scope comes from the authenticated session, not local storage",async()=>{
  const [service,home]=await Promise.all([read("../app/services/department-foundation.ts"),read("../app/department/page.tsx")]);
  assert.match(service,/session.departmentScopes/);
  assert.match(service,/includeDescendants/);
  assert.match(home,/session.departmentScopes/);
  assert.doesNotMatch(`${service}${home}`,/localStorage|useDepartmentScope/);
});

test("visible primary actions navigate, retry or change real local view state",async()=>{
  const [home,people,unavailable,shell]=await Promise.all([read("../app/page.tsx"),read("../app/people/page.tsx"),read("../app/components/operations/UnavailableOperationalPage.tsx"),read("../app/components/shell/AppShell.tsx")]);
  assert.match(home,/Link href/);
  assert.match(people,/setQuery|setSelected|重新读取/);
  assert.match(unavailable,/Link href=\{returnHref\}/);
  assert.doesNotMatch(`${home}${people}${unavailable}${shell}`,/showToast/);
});

test("employee drawer remains dismissible and inline administration protects unsaved edits",async()=>{
  const [hook,people,organization,positions,accounts,saveState]=await Promise.all([
    read("../app/lib/use-escape-dismiss.ts"),
    read("../app/people/page.tsx"),
    read("../app/organization/page.tsx"),
    read("../app/positions/page.tsx"),
    read("../app/accounts/page.tsx"),
    read("../app/components/administration/AdministrationSaveState.tsx"),
  ]);
  assert.match(hook,/Escape/);
  assert.match(people,/useEscapeDismiss/);
  assert.match(people,/aria-modal="true"/);
  for (const page of [organization,positions,accounts]) {
    assert.match(page,/useUnsavedChangesWarning/);
    assert.match(page,/AdministrationSaveState/);
    assert.doesNotMatch(page,/aria-modal="true"/);
  }
  assert.match(saveState,/beforeunload/);
  assert.match(saveState,/读取最新资料/);
});

test("Recovery A visual layer preserves touch targets and focus visibility",async()=>{
  const css=await read("../app/recovery-a.css");
  assert.match(css,/min-height:44px/);
  assert.match(css,/focus-visible/);
  assert.doesNotMatch(await read("../app/effectiveness/page.tsx"),/<svg/);
});
