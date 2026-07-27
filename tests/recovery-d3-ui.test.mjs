import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(
  new URL(
    "../app/components/attendance/AttendanceWorkspace.tsx",
    import.meta.url,
  ),
  "utf8",
).catch(() => "");
const checkIn = await readFile(
  new URL("../app/check-in/page.tsx", import.meta.url),
  "utf8",
).catch(() => "");
const managerPage = await readFile(
  new URL("../app/attendance-feedback/page.tsx", import.meta.url),
  "utf8",
);
const departmentPage = await readFile(
  new URL(
    "../app/department/attendance-feedback/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const navigation = await readFile(
  new URL("../app/services/role-navigation.ts", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../app/recovery-d3.css", import.meta.url),
  "utf8",
).catch(() => "");

test("manager and department pages use one role-aware real Attendance workspace", () => {
  assert.match(managerPage, /AttendanceWorkspace mode="manager"/);
  assert.match(departmentPage, /AttendanceWorkspace mode="department"/);
  assert.match(workspace, /readManagerWorkspace/);
  assert.match(workspace, /readDepartmentWorkspace/);
  assert.match(workspace, /授权部门范围/);
  assert.match(workspace, /breadcrumb/);
});

test("D3 UI supports the complete efficient register lifecycle", () => {
  for (const operation of [
    "openRegister",
    "issueCheckInGrant",
    "recordDetermination",
    "beginReconciliation",
    "closeRegister",
    "reopenRegister",
  ]) {
    assert.match(workspace, new RegExp(operation));
  }
  for (const label of [
    "开放出勤登记",
    "生成签到二维码",
    "开始核对",
    "关闭登记册",
    "重新开启",
    "出席",
    "缺席",
    "获准缺席",
    "无法判断",
  ]) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /现场快速登记/);
  assert.match(workspace, /participant\.observations\.map/);
  assert.match(workspace, /error\.name === "ConflictError"/);
  assert.match(workspace, /await load\(\)/);
});

test("QR experience preserves Observation, determination and Completion boundaries", () => {
  assert.match(checkIn, /location\.hash/);
  assert.match(checkIn, /submitPublicCheckIn/);
  assert.match(checkIn, /最终出勤仍需培训负责人核对/);
  assert.doesNotMatch(checkIn, /attendanceRate|completion|KPI|完成培训/);
  assert.match(workspace, /QR 签到只形成现场 Observation/);
  assert.match(workspace, /完成证据尚未接入/);
});

test("D3 navigation is available while Feedback remains truthfully unavailable", () => {
  assert.match(
    navigation,
    /item\("出勤与反馈", "Attendance & feedback", "\/attendance-feedback", "foundation"\)/,
  );
  assert.match(
    navigation,
    /item\("出勤与反馈", "Attendance & feedback", "\/department\/attendance-feedback", "foundation"\)/,
  );
  assert.match(workspace, /反馈尚未接入真实数据/);
});

test("attendance workspace remains practical at mobile width", () => {
  assert.match(styles, /min-height:44px/);
  assert.match(styles, /@media\(max-width:680px\)/);
  assert.match(styles, /overflow-x:auto/);
  assert.match(styles, /grid-template-columns:1fr/);
  assert.doesNotMatch(styles, /min-width:\\s*[7-9]\\d\\dpx/);
});

test("QR actions report clipboard failure instead of silently failing", () => {
  assert.match(workspace, /navigator\.clipboard\.writeText/);
  assert.match(workspace, /无法复制签到链接/);
});
