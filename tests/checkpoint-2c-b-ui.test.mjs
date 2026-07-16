import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/permissions/page.tsx", import.meta.url), "utf8");
const registry = await readFile(new URL("../app/repositories/registry.ts", import.meta.url), "utf8");

test("organization workspace covers hierarchy mutation and move confirmation", () => {
  for (const phrase of ["正式部门架构", "新增一级部门", "新增下级部门", "重命名", "调整顺序", "停用部门", "移动部门", "移动影响预览", "所有下级部门将一并移动"]) assert.match(page, new RegExp(phrase));
  for (const phrase of ["当前路径", "目标路径", "下级部门", "员工影响", "别名", "运营单元"]) assert.match(page, new RegExp(phrase));
});

test("claim and mapping center exposes all controlled resolution actions", () => {
  for (const phrase of ["部门认领与映射", "映射到现有部门", "新建一级部门", "新建下级部门", "归类为运营单元", "保存为别名", "合并来源标签", "忽略", "稍后处理"]) assert.match(page, new RegExp(phrase));
  for (const phrase of ["匹配建议", "置信度", "建议原因", "影响预览", "不会自动修改正式组织架构"]) assert.match(page, new RegExp(phrase));
});

test("position workspace supports families, official positions, and source mapping", () => {
  for (const phrase of ["职位族", "正式职位", "职位来源映射", "映射到现有职位", "仅映射职位族", "仅作为外部 LMS 角色", "受影响员工", "适用部门"]) assert.match(page, new RegExp(phrase));
});

test("page uses foundation repositories while training operations remain unavailable", () => {
  assert.match(page, /registry\.department/);
  assert.match(page, /registry\.position/);
  assert.doesNotMatch(page, /\.from\(|createClient|supabase/i);
  assert.match(registry, /organization-management/);
  assert.match(registry, /position-management/);
  assert.match(registry, /foundationModules/);
  assert.match(registry, /return "unavailable"/);
});
