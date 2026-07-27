import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../app/components/training/DepartmentSessionWorkspace.tsx", import.meta.url),
  "utf8",
).catch(() => "");

test("department workflow always displays server-derived authorized scope", () => {
  assert.match(source, /授权部门范围/);
  assert.match(source, /breadcrumb/);
  assert.match(source, /readDepartmentTrainingOperations/);
  assert.doesNotMatch(source, /saveVenue|saveTrainer|酒店设置|账号管理/);
});

test("department workflow creates only scoped Session drafts and honest readiness", () => {
  assert.match(source, /saveDepartmentSessionRevisionDraft/);
  assert.match(source, /previewDepartmentSessionParticipants/);
  assert.match(source, /publishSessionRevision/);
  assert.match(source, /尚未接入出勤记录/);
  assert.match(source, /当前场次准备边界/);
  assert.match(source, /isDepartmentInTarget/);
  assert.match(
    source,
    /value\.lifecycleState === "published" && value\.currentState === "published"/,
  );
});
