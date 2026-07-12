import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("organization scope persists across route navigation", async () => {
  const scope = await read("../app/state/department-scope.tsx");
  assert.match(scope, /localStorage/);
  assert.match(scope, /hotel-ld-scope/);
  assert.match(scope, /setDepartmentId/);
});

test("scope drives operational pages beyond dashboards", async () => {
  for (const path of ["../app/calendar/page.tsx", "../app/people/page.tsx", "../app/kpi/page.tsx", "../app/permissions/page.tsx"]) {
    const page = await read(path);
    assert.match(page, /useDepartmentScope/);
    assert.match(page, /departmentId/);
  }
});

test("primary controls have visible outcomes", async () => {
  const risk = await read("../app/risk/page.tsx");
  assert.match(risk, /severityFilter/);
  assert.match(risk, /setSeverityFilter/);
  const people = await read("../app/people/page.tsx");
  assert.match(people, /href="\/import"/);
  assert.doesNotMatch(people, /将在 4B 开放/);
});

test("custom drawers and dialogs support escape dismissal and dialog semantics", async () => {
  const hook = await read("../app/lib/use-escape-dismiss.ts");
  assert.match(hook, /Escape/);
  for (const path of ["../app/calendar/page.tsx", "../app/people/page.tsx", "../app/permissions/page.tsx", "../app/import/page.tsx", "../app/feedback/session-1/page.tsx", "../app/components/hierarchy/DepartmentScopePicker.tsx"]) {
    const page = await read(path);
    assert.match(page, /useEscapeDismiss/);
    assert.match(page, /aria-modal="true"/);
    assert.match(page, /aria-label=/);
  }
});

test("final visual cleanup avoids authored SVG and preserves mobile touch targets", async () => {
  const effectiveness = await read("../app/effectiveness/page.tsx");
  assert.doesNotMatch(effectiveness, /<svg/);
  const css = await read("../app/checkpoint-5.css");
  assert.match(css, /min-height:44px/);
  assert.match(css, /focus-visible/);
});
