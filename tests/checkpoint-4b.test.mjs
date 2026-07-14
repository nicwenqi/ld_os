import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Organization and Permissions is a business-facing control center", async () => {
  const page = await read("../app/permissions/page.tsx");
  for (const label of [
    "组织与权限中心",
    "多级部门架构",
    "岗位管理",
    "部门培训员",
    "角色与账号",
    "邀请账号",
    "部门范围预览",
    "切换体验角色",
    "学习与发展经理",
    "部门培训管理员",
    "覆盖员工",
    "可执行事项",
    "下一步行动",
  ]) assert.match(page, new RegExp(label));
  assert.match(page, /assignedBranch/);
  assert.match(page, /allowedActions/);
});

test("Import Center exposes a safe guided mock workflow", async () => {
  const page = await read("../app/import/page.tsx");
  for (const label of [
    "导入中心",
    "上传 Excel",
    "识别工作表",
    "选择相关工作表",
    "字段映射",
    "预览变更",
    "新增员工",
    "更新员工",
    "重复员工",
    "未匹配部门",
    "未匹配课程",
    "排除本次导入",
    "确认导入",
    "导入历史",
  ]) assert.match(page, new RegExp(label));
  assert.match(page, /setStep/);
  assert.match(page, /resolvedIssues/);
  assert.match(page, /importComplete/);
});

test("shell navigates to Checkpoint 4B modules", async () => {
  const navigation = await read("../app/services/role-navigation.ts");
  assert.match(navigation, /href:"\/permissions/);
  assert.match(navigation, /href:"\/import/);
});
