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
const navigation = await readFile(
  new URL("../app/services/role-navigation.ts", import.meta.url),
  "utf8",
);

test("manager D2 workspaces explain planning and execution boundaries", () => {
  assert.match(planWorkspace, /培训计划不是培训场次/);
  assert.match(planWorkspace, /已批准计划不会自动创建场次/);
  assert.match(sessionWorkspace, /发布后可开放独立出勤登记/);
  assert.match(sessionWorkspace, /参与人预览为零写入/);
  assert.match(sessionWorkspace, /Unable to Determine|无法判断/);
});

test("manager D2 actions call real repository operations", () => {
  assert.match(planWorkspace, /savePlanVersionDraft/);
  assert.match(planWorkspace, /transitionPlanVersion/);
  assert.match(sessionWorkspace, /saveSessionRevisionDraft/);
  assert.match(sessionWorkspace, /previewSessionParticipants/);
  assert.match(sessionWorkspace, /publishSessionRevision/);
  assert.match(sessionWorkspace, /cancelSession/);
  assert.match(sessionWorkspace, /saveVenue/);
  assert.match(sessionWorkspace, /saveTrainer/);
  assert.match(planWorkspace, /建立新版本/);
  assert.match(sessionWorkspace, /建立新修订/);
  assert.match(sessionWorkspace, /编辑草稿/);
  assert.match(
    sessionWorkspace,
    /value\.lifecycleState === "published" && value\.currentState === "published"/,
  );
});

test("D2 navigation becomes available without exposing later facts", () => {
  assert.match(
    navigation,
    /item\("培训计划", "Training plans", "\/plans", "foundation"\)/,
  );
  assert.match(
    navigation,
    /item\("培训场次", "Training sessions", "\/sessions", "foundation"\)/,
  );
  assert.match(
    navigation,
    /item\("培训场次", "Training sessions", "\/department\/sessions", "foundation"\)/,
  );
  assert.match(
    navigation,
    /item\("出勤与反馈", "Attendance & feedback", "\/attendance-feedback", "foundation"\)/,
  );
});
