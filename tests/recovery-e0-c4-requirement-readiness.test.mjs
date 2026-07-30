import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("C4 guides a manager to explicitly create the first Pilot Requirement without auto-generating training facts", async () => {
  const [workspace, editor, eligibility] = await Promise.all([
    read("../app/components/requirements/RequirementWorkspace.tsx"),
    read("../app/components/requirements/RequirementVersionEditor.tsx"),
    read("../app/components/requirements/EligibilityPreview.tsx"),
  ]);

  assert.match(workspace, /消防安全年度培训/);
  assert.match(workspace, /不会自动生成课程、要求、员工任务或执行事实/);
  assert.match(workspace, /建立第一项酒店培训义务/);
  assert.match(editor, /考试事实尚未接入/);
  assert.match(eligibility, /不适用/);
  assert.match(eligibility, /无法判断/);
  assert.doesNotMatch(
    `${workspace}\n${editor}\n${eligibility}`,
    /createTrainingPlan|createSession|createAttendance|createCompletion|createAssignment|sendReminder/,
  );
});
