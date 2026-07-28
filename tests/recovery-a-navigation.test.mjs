import assert from "node:assert/strict";
import test from "node:test";
import { canRoleAccessPath } from "../app/services/auth-routing.ts";
import { navigationForRole } from "../app/services/role-navigation.ts";

const flatten = navigation => navigation.groups.flatMap(group => group.items);

test("manager navigation is ordered by operating frequency", () => {
  const navigation = navigationForRole("property_ld_manager");
  assert.deepEqual(
    navigation.groups.map(group => group.label),
    ["日常运营", "周期复盘", "管理设置"],
  );
  assert.deepEqual(
    navigation.groups[0].items.map(item => item.zh),
    ["运营工作台", "培训日历", "培训场次", "出勤与反馈", "完成证据", "员工", "干预与提醒"],
  );
  assert.deepEqual(
    navigation.groups[1].items.map(item => item.zh),
    ["培训要求", "培训计划", "部门表现", "KPI 与目标", "课程成效", "数据质量"],
  );
  assert.deepEqual(
    navigation.groups[2].items.map(item => item.zh),
    ["员工资料更新", "组织架构", "职位体系", "账号与部门授权", "酒店设置", "酒店启用"],
  );
});

test("department navigation contains only the approved scoped destinations", () => {
  const navigation = navigationForRole("department_training_responsible");
  assert.deepEqual(
    flatten(navigation).map(item => item.zh),
    ["部门工作台", "培训要求", "培训日历", "培训场次", "本部门员工", "出勤与反馈", "完成证据", "补训与提醒", "部门数据"],
  );
  assert.doesNotMatch(
    flatten(navigation).map(item => item.zh).join(" "),
    /酒店设置|员工资料更新|账号与角色|KPI/,
  );
});

test("every visible destination is authorized by the same role contract", () => {
  for (const role of [
    "property_ld_manager",
    "department_training_responsible",
  ]) {
    for (const item of flatten(navigationForRole(role))) {
      assert.equal(canRoleAccessPath(role, item.href), true, `${role}: ${item.href}`);
      assert.equal(item.href.includes("#"), false, item.href);
    }
  }
  assert.deepEqual(navigationForRole("unauthorized").groups, []);
});
