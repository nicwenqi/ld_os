import test from "node:test";
import assert from "node:assert/strict";
import { createMockDepartmentRepository } from "../app/repositories/mock/department-repository.ts";
import { createMockPositionRepository } from "../app/repositories/mock/position-repository.ts";

const propertyId = "20000000-0000-0000-0000-000000000011";

test("department repository renders arbitrary-depth tree and breadcrumbs", async () => {
  const repository = createMockDepartmentRepository();
  const tree = await repository.listTree(propertyId);
  assert.deepEqual(tree.slice(0, 6).map(node => node.code), ["rooms", "front-office", "concierge", "front-desk", "housekeeping", "floor"]);
  const floor = tree.find(node => node.code === "floor");
  assert.equal(floor.depth, 2);
  assert.deepEqual((await repository.getAncestors(floor.id)).map(node => node.nameEn), ["Rooms", "Housekeeping"]);
  assert.equal((await repository.getDescendants(tree.find(node => node.code === "rooms").id)).length, 5);
});

test("department repository creates, renames, deactivates, and reorders nodes with versions", async () => {
  const repository = createMockDepartmentRepository();
  const root = await repository.createNode({ propertyId, tenantId: "10000000-0000-0000-0000-000000000001", parentId: null, nodeType: "department", code: "quality", nameZh: "质量管理", nameEn: "Quality", sortOrder: 80 });
  const child = await repository.createNode({ propertyId, tenantId: root.tenantId, parentId: root.id, nodeType: "team", code: "audit", nameZh: "审核组", nameEn: "Audit", sortOrder: 10 });
  const renamed = await repository.updateNode({ id: child.id, expectedVersion: child.version, nameZh: "质量审核组", nameEn: "Quality Audit", sortOrder: 20, isActive: true });
  assert.equal(renamed.version, 2);
  assert.equal(renamed.sortOrder, 20);
  const inactive = await repository.setActive(renamed.id, renamed.version, false);
  assert.equal(inactive.isActive, false);
});

test("department move preview and confirmation move the full subtree and reject cycles", async () => {
  const repository = createMockDepartmentRepository();
  const tree = await repository.listTree(propertyId);
  const frontOffice = tree.find(node => node.code === "front-office");
  const engineering = tree.find(node => node.code === "engineering");
  const concierge = tree.find(node => node.code === "concierge");
  const preview = await repository.previewMove(frontOffice.id, engineering.id);
  assert.equal(preview.childDepartmentsAffected, 2);
  assert.ok(preview.syntheticEmployeeImpact > 0);
  await repository.moveNode(frontOffice.id, engineering.id, frontOffice.version);
  assert.equal((await repository.getAncestors(concierge.id)).at(0).code, "engineering");
  await assert.rejects(() => repository.moveNode(engineering.id, concierge.id, engineering.version), /不能移动到自身或下级部门/);
});

test("department aliases stay auditable and can map to departments or operational units", async () => {
  const repository = createMockDepartmentRepository();
  const aliases = await repository.listAliases(propertyId);
  assert.ok(aliases.some(alias => alias.sourceValue === "Marketing & Commnuications" && alias.resolutionType === "deferred"));
  const bar = aliases.find(alias => alias.sourceValue === "Bar 168");
  const food = (await repository.listTree(propertyId)).find(node => node.code === "food-beverage");
  const unit = await repository.createOperationalUnit({ propertyId, tenantId: food.tenantId, departmentId: food.id, parentOperationalUnitId: null, unitType: "outlet", code: "bar-168-new", nameZh: "示范酒吧", nameEn: "Bar 168", sortOrder: 20 });
  const resolved = await repository.approveMapping({ aliasId: bar.id, action: "operational_unit", operationalUnitId: unit.id });
  assert.equal(resolved.resolutionType, "mapped");
  assert.equal(resolved.operationalUnitId, unit.id);
});

test("position repository manages families, official positions, department assignment, and mappings", async () => {
  const repository = createMockPositionRepository();
  const families = await repository.listPositionFamilies(propertyId);
  assert.equal(families.length, 5);
  const family = await repository.savePositionFamily({ propertyId, tenantId: families[0].tenantId, code: "security", nameZh: "安保岗位", nameEn: "Security", description: "Synthetic family", sortOrder: 60, isActive: true });
  const updatedFamily = await repository.savePositionFamily({ ...family, nameZh: "安全保卫岗位" });
  assert.equal(updatedFamily.nameZh, "安全保卫岗位");
  const position = await repository.savePosition({ propertyId, tenantId: family.tenantId, positionFamilyId: family.id, code: "security-officer", nameZh: "安保员", nameEn: "Security Officer", gradeOrBand: "A2", isActive: true });
  const updatedPosition = await repository.savePosition({ ...position, nameZh: "安全保卫员" });
  assert.equal(updatedPosition.nameZh, "安全保卫员");
  await repository.assignPositionToDepartments(position.id, ["61000000-0000-0000-0000-000000000018"]);
  const source = (await repository.listSourceLabels(propertyId)).find(item => item.sourceValue === "Security Guard");
  const preview = await repository.previewSourceImpact(source.id);
  assert.ok(preview.syntheticEmployeeCount > 0);
  const mapped = await repository.approvePositionMapping({ sourceLabelId: source.id, action: "position", targetPositionId: position.id, targetPositionFamilyId: family.id });
  assert.equal(mapped.resolutionStatus, "mapped");
});
