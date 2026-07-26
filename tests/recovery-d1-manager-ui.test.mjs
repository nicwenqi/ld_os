import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canRoleAccessPath } from "../app/services/auth-routing.ts";
import { navigationForRole } from "../app/services/role-navigation.ts";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("manager navigation and direct authorization expose one obligation workspace", () => {
  const navigation = navigationForRole("property_ld_manager");
  const items = navigation.groups.flatMap(group => group.items);
  const requirement = items.find(item => item.href === "/requirements");
  assert.deepEqual(requirement, {
    zh: "培训要求",
    en: "Learning requirements",
    href: "/requirements",
    availability: "foundation",
  });
  assert.equal(canRoleAccessPath("property_ld_manager", "/requirements"), true);
  assert.equal(
    canRoleAccessPath(
      "department_training_responsible",
      "/requirements",
    ),
    false,
  );
});

test("manager workspace leads with the hotel obligation, not Course management", async () => {
  const [page, workspace, requirement, course, eligibility] =
    await Promise.all([
      read("../app/requirements/page.tsx"),
      read("../app/components/requirements/RequirementWorkspace.tsx"),
      read("../app/components/requirements/RequirementVersionEditor.tsx"),
      read("../app/components/requirements/CourseVersionEditor.tsx"),
      read("../app/components/requirements/EligibilityPreview.tsx"),
    ]);
  assert.match(page, /RequirementWorkspace/);
  assert.match(workspace, /酒店培训义务/);
  assert.match(workspace, /培训要求/);
  assert.match(workspace, /课程与学习方式/);
  assert.match(requirement, /完成定义/);
  assert.match(requirement, /认可学习方式/);
  assert.match(requirement, /适用规则/);
  assert.match(requirement, /不创建员工任务/);
  assert.match(course, /内容身份/);
  assert.match(course, /能力身份/);
  assert.match(course, /版本连续性/);
  assert.match(eligibility, /适用性评估/);
  assert.match(eligibility, /无法判断/);
  assert.match(eligibility, /员工事实版本/);
  assert.doesNotMatch(
    `${workspace}${requirement}${course}${eligibility}`,
    /TrainingPlan|SessionEditor|AttendanceRepository|KpiRepository|ForecastService|AIRecommendation/,
  );
});

test("D1 manager edits use persistent save and immutable lifecycle controls", async () => {
  const [workspace, requirement, course] = await Promise.all([
    read("../app/components/requirements/RequirementWorkspace.tsx"),
    read("../app/components/requirements/RequirementVersionEditor.tsx"),
    read("../app/components/requirements/CourseVersionEditor.tsx"),
  ]);
  const source = `${workspace}\n${requirement}\n${course}`;
  for (const token of [
    "AdministrationSaveState",
    "useUnsavedChangesWarning",
    "saveRequirementVersionDraft",
    "saveCourseVersionDraft",
    "transitionRequirementVersion",
    "transitionCourseVersion",
    "重新读取服务器状态",
  ]) {
    assert.match(source, new RegExp(token));
  }
  assert.match(source, /已发布版本不可编辑/);
  assert.match(source, /建立新版本/);
  assert.match(source, /newVersionOf/);
  assert.match(source, /已批准或已生效版本不可编辑/);
  assert.doesNotMatch(source, /toast|prototype/i);
});

test("D1 visual layer is responsive, readable and touch-safe", async () => {
  const [globals, css] = await Promise.all([
    read("../app/globals.css"),
    read("../app/recovery-d1.css"),
  ]);
  assert.match(globals, /recovery-d1\.css/);
  for (const token of [
    "requirement-workspace",
    "requirement-hero",
    "requirement-editor",
    "eligibility-preview",
    "min-height:44px",
    "focus-visible",
    "overflow-x:auto",
    "@media(max-width:900px)",
    "@media(max-width:640px)",
  ]) {
    assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
