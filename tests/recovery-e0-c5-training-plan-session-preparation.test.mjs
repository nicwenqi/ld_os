import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const planWorkspace = await readFile(
  new URL("../app/components/training/TrainingPlanWorkspace.tsx", import.meta.url),
  "utf8",
).catch(() => "");
const sessionWorkspace = await readFile(
  new URL("../app/components/training/SessionWorkspace.tsx", import.meta.url),
  "utf8",
).catch(() => "");
const departmentSessionWorkspace = await readFile(
  new URL("../app/components/training/DepartmentSessionWorkspace.tsx", import.meta.url),
  "utf8",
).catch(() => "");

test("C5 explains that a delivery plan needs a published course-version method", () => {
  assert.match(
    planWorkspace,
    /只有引用已发布课程版本的认可学习方式才可建立培训要求交付计划/,
  );
  assert.match(
    planWorkspace,
    /外部证书、受控评估或经理等价认定不会自动生成课程、计划或场次/,
  );
  assert.match(planWorkspace, /methodType === "course_version"/);
});

test("C5 session publication is delivery preparation, not attendance or completion", () => {
  for (const workspace of [sessionWorkspace, departmentSessionWorkspace]) {
    assert.match(workspace, /发布仅表示.*准备交付/);
    assert.match(workspace, /不会创建出勤、签到或完成事实/);
  }
  assert.match(sessionWorkspace, /参与人预览为零写入/);
  assert.match(sessionWorkspace, /发布并冻结证据/);
  assert.match(departmentSessionWorkspace, /发布后冻结员工事实版本/);
});

