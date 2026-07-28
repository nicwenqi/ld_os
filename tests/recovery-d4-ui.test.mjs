import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(
  new URL("../app/components/completion/CompletionWorkspace.tsx", import.meta.url),
  "utf8",
).catch(() => "");
const managerPage = await readFile(
  new URL("../app/completions/page.tsx", import.meta.url),
  "utf8",
).catch(() => "");
const departmentPage = await readFile(
  new URL("../app/department/completions/page.tsx", import.meta.url),
  "utf8",
).catch(() => "");
const navigation = await readFile(
  new URL("../app/services/role-navigation.ts", import.meta.url),
  "utf8",
);
const routing = await readFile(
  new URL("../app/services/auth-routing.ts", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../app/recovery-d4.css", import.meta.url),
  "utf8",
).catch(() => "");

test("Manager and Department expose one role-aware Completion Evidence workspace", () => {
  assert.match(managerPage, /CompletionWorkspace mode="manager"/);
  assert.match(departmentPage, /CompletionWorkspace mode="department"/);
  assert.match(workspace, /<AppShell>/);
  assert.match(workspace, /readManagerWorkspace/);
  assert.match(workspace, /readDepartmentWorkspace/);
  assert.match(workspace, /授权部门范围/);
});

test("D4 UI keeps evidence, review, Completion and revocation visibly separate", () => {
  for (const label of [
    "待核验证据",
    "已核验完成事实",
    "出勤来源",
    "外部证据",
    "经理等价认定",
    "接受证据",
    "拒绝证据",
    "撤销完成记录",
  ]) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /Attendance Present 只是可用来源证据/);
  assert.match(workspace, /尚未接入受控考核证据/);
  assert.match(workspace, /不会生成任务、提醒或 KPI/);
});

test("D4 enabled actions call real repository operations and reload authority", () => {
  for (const operation of [
    "recordAttendanceEvidence",
    "recordExternalEvidence",
    "recordManagerRecognition",
    "reviewEvidence",
    "revokeCompletionRecord",
  ]) {
    assert.match(workspace, new RegExp(operation));
  }
  assert.match(workspace, /error\.name === "ConflictError"/);
  assert.match(workspace, /await load\(\)/);
});

test("D4 role navigation and direct routes do not cross", () => {
  assert.match(
    navigation,
    /item\("完成证据", "Completion evidence", "\/completions", "foundation"\)/,
  );
  assert.match(
    navigation,
    /item\("完成证据", "Completion evidence", "\/department\/completions", "foundation"\)/,
  );
  assert.match(routing, /"\/completions"/);
  assert.match(routing, /"\/department\/completions"/);
});

test("D4 remains readable, focus-visible and touch-safe on mobile", () => {
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media\s*\(max-width:\s*680px\)/);
  assert.match(styles, /grid-template-columns:\s*1fr/);
  assert.doesNotMatch(styles, /min-width:\s*[7-9]\d\dpx/);
});
