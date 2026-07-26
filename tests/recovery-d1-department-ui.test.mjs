import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canRoleAccessPath } from "../app/services/auth-routing.ts";
import { navigationForRole } from "../app/services/role-navigation.ts";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("department requirements route is visible and directly authorized only for its role", () => {
  const items = navigationForRole(
    "department_training_responsible",
  ).groups.flatMap(group => group.items);
  assert.ok(items.some(item =>
    item.href === "/department/requirements" &&
    item.zh === "培训要求" &&
    item.availability === "foundation"
  ));
  assert.equal(
    canRoleAccessPath(
      "department_training_responsible",
      "/department/requirements",
    ),
    true,
  );
  assert.equal(
    canRoleAccessPath("property_ld_manager", "/department/requirements"),
    false,
  );
});

test("department workspace derives scope server-side and remains read-only", async () => {
  const [page, workspace] = await Promise.all([
    read("../app/department/requirements/page.tsx"),
    read("../app/components/requirements/DepartmentRequirementWorkspace.tsx"),
  ]);
  assert.match(page, /DepartmentRequirementWorkspace/);
  assert.match(workspace, /readDepartmentRequirements/);
  assert.match(workspace, /授权部门范围/);
  assert.match(workspace, /仅显示已生效要求/);
  assert.match(workspace, /适用性评估/);
  assert.match(workspace, /只读/);
  assert.doesNotMatch(
    workspace,
    /saveRequirementVersionDraft|transitionRequirementVersion|酒店设置|员工资料更新/,
  );
  assert.doesNotMatch(workspace, /propertyId\s*:/);
});

test("department empty state does not imply no obligation or healthy operation", async () => {
  const workspace = await read(
    "../app/components/requirements/DepartmentRequirementWorkspace.tsx",
  );
  assert.match(workspace, /当前授权范围尚无可显示的已生效培训要求/);
  assert.match(workspace, /不代表员工没有培训义务/);
  assert.match(workspace, /不会显示草稿或仅已批准版本/);
});
