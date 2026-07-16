import type { ApproveDepartmentMappingInput, CreateDepartmentInput, CreateOperationalUnitInput, DepartmentRepository, SaveOperationalUnitInput, UpdateDepartmentInput } from "../contracts/department-repository.ts";
import type { DepartmentAlias, DepartmentMovePreview, DepartmentNode, OperationalUnit } from "../contracts/organization-models.ts";

const tenantId = "10000000-0000-0000-0000-000000000001";
const propertyId = "20000000-0000-0000-0000-000000000011";
const ids = { rooms: "61000000-0000-0000-0000-000000000011", front: "61000000-0000-0000-0000-000000000012", concierge: "61000000-0000-0000-0000-000000000013", desk: "61000000-0000-0000-0000-000000000014", housekeeping: "61000000-0000-0000-0000-000000000015", floor: "61000000-0000-0000-0000-000000000016", finance: "61000000-0000-0000-0000-000000000017", engineering: "61000000-0000-0000-0000-000000000018", food: "61000000-0000-0000-0000-000000000019" };

function fixtureNodes(): DepartmentNode[] {
  const make = (id: string, parentId: string | null, nodeType: DepartmentNode["nodeType"], code: string, nameZh: string, nameEn: string, sortOrder: number, employees: number, pathIds: string[]): DepartmentNode => ({ id, tenantId, propertyId, parentId, nodeType, code, nameZh, nameEn, sortOrder, depth: pathIds.length - 1, pathIds, isActive: true, version: 1, syntheticEmployeeCount: employees });
  return [
    make(ids.rooms, null, "division", "rooms", "房务部", "Rooms", 10, 126, [ids.rooms]),
    make(ids.front, ids.rooms, "department", "front-office", "前厅部", "Front Office", 10, 48, [ids.rooms, ids.front]),
    make(ids.concierge, ids.front, "section", "concierge", "礼宾部", "Concierge", 10, 16, [ids.rooms, ids.front, ids.concierge]),
    make(ids.desk, ids.front, "section", "front-desk", "前台", "Front Desk", 20, 32, [ids.rooms, ids.front, ids.desk]),
    make(ids.housekeeping, ids.rooms, "department", "housekeeping", "客房部", "Housekeeping", 20, 78, [ids.rooms, ids.housekeeping]),
    make(ids.floor, ids.housekeeping, "team", "floor", "楼层", "Floor", 10, 61, [ids.rooms, ids.housekeeping, ids.floor]),
    make(ids.finance, null, "department", "finance", "财务部", "Finance", 20, 12, [ids.finance]),
    make(ids.engineering, null, "department", "engineering", "工程部", "Engineering", 30, 24, [ids.engineering]),
    make(ids.food, null, "division", "food-beverage", "餐饮部", "Food & Beverage", 40, 84, [ids.food]),
  ];
}

export function createMockDepartmentRepository(): DepartmentRepository {
  if (typeof window !== "undefined") return createHttpMockDepartmentRepository();
  const nodes = fixtureNodes();
  const units: OperationalUnit[] = [{ id: "63000000-0000-0000-0000-000000000011", tenantId, propertyId, departmentId: ids.food, parentOperationalUnitId: null, unitType: "outlet", code: "bar-168", nameZh: "示范酒吧 168", nameEn: "Bar 168", sortOrder: 10, isActive: true, version: 1 }];
  const aliases: DepartmentAlias[] = [
    alias("a-rooms", "Rooms Division Administration", 8, 18, ids.rooms, "房务部 Rooms", 96, "名称与房务部管理范围高度一致", "mapped"),
    alias("a-floor", "Floor", 12, 61, ids.floor, "房务部 / 客房部 / 楼层", 99, "与正式部门中英文名称完全匹配", "mapped"),
    alias("a-bar", "Bar 168", 6, 14, ids.food, "运营单元 · Bar 168", 94, "更像营业场所，而非正式 HR 部门", "deferred"),
    alias("a-staff", "Staff Restaurant", 4, 9, ids.food, "运营单元 · 员工餐厅", 91, "建议归类为餐饮部下的餐厅运营单元", "deferred"),
    alias("a-marketing", "Marketing & Commnuications", 3, 7, null, "市场传讯部（建议新建）", 82, "英文拼写接近常见部门名称，需要管理员确认", "deferred"),
    alias("a-purchasing", "Pruchasing", 2, 5, null, "采购职能（待确认）", 78, "拼写可能为 Purchasing，暂不自动归并", "ignored"),
  ];

  const sorted = () => [...nodes].sort((a, b) => compareHierarchy(a, b, nodes));
  const node = (id: string) => { const found = nodes.find(item => item.id === id); if (!found) throw new Error("未找到部门"); return found; };
  const copy = (value: DepartmentNode) => ({ ...value, pathIds: [...value.pathIds] });

  return {
    async listTree(candidate) { return candidate === propertyId ? sorted().map(copy) : []; },
    async getNode(id) { return copy(node(id)); },
    async getAncestors(id) { const current = node(id); return current.pathIds.slice(0, -1).map(parentId => copy(node(parentId))); },
    async getDescendants(id) { return sorted().filter(item => item.id !== id && item.pathIds.includes(id)).map(copy); },
    async createNode(input: CreateDepartmentInput) {
      if (input.propertyId !== propertyId || input.tenantId !== tenantId) throw new Error("不能在其他酒店创建部门");
      const parent = input.parentId ? node(input.parentId) : null;
      const id = crypto.randomUUID(); const pathIds = parent ? [...parent.pathIds, id] : [id];
      const created: DepartmentNode = { ...input, id, code: input.code || null, nameEn: input.nameEn || null, depth: pathIds.length - 1, pathIds, isActive: true, version: 1, syntheticEmployeeCount: 0 };
      nodes.push(created); return copy(created);
    },
    async updateNode(input: UpdateDepartmentInput) {
      const current = node(input.id); stale(current, input.expectedVersion);
      Object.assign(current, { nameZh: input.nameZh.trim(), nameEn: input.nameEn.trim() || null, sortOrder: input.sortOrder, isActive: input.isActive, version: current.version + 1 });
      return copy(current);
    },
    async previewMove(id, newParentId): Promise<DepartmentMovePreview> { return preview(nodes, aliases, units, node(id), newParentId ? node(newParentId) : null); },
    async moveNode(id, newParentId, expectedVersion) {
      const moving = node(id); stale(moving, expectedVersion); const target = newParentId ? node(newParentId) : null;
      if (target && (target.id === moving.id || target.pathIds.includes(moving.id))) throw new Error("不能移动到自身或下级部门");
      const oldPath = [...moving.pathIds]; const newRoot = target ? [...target.pathIds, moving.id] : [moving.id];
      for (const item of nodes.filter(item => item.pathIds.includes(moving.id))) {
        const suffix = item.pathIds.slice(oldPath.length); item.pathIds = [...newRoot, ...suffix]; item.depth = item.pathIds.length - 1;
        if (item.id === moving.id) item.parentId = target?.id ?? null; item.version += 1;
      }
      return copy(moving);
    },
    async setActive(id, expectedVersion, active) { const current = node(id); return this.updateNode({ id, expectedVersion, nameZh: current.nameZh, nameEn: current.nameEn ?? "", sortOrder: current.sortOrder, isActive: active }); },
    async listAliases(candidate) { return candidate === propertyId ? aliases.map(item => ({ ...item })) : []; },
    async approveMapping(input: ApproveDepartmentMappingInput) {
      const current = aliases.find(item => item.id === input.aliasId); if (!current) throw new Error("未找到来源标签");
      if (input.action === "department") { current.targetDepartmentId = input.targetDepartmentId ?? null; current.operationalUnitId = null; current.resolutionType = input.resolutionType ?? "mapped"; }
      if (input.action === "operational_unit") { current.operationalUnitId = input.operationalUnitId ?? null; current.targetDepartmentId = null; current.resolutionType = "mapped"; }
      if (input.action === "ignore") current.resolutionType = "ignored";
      if (input.action === "defer") current.resolutionType = "deferred";
      if (input.action === "merge") current.resolutionType = "merged";
      return { ...current };
    },
    async createOperationalUnit(input: CreateOperationalUnitInput) {
      return this.saveOperationalUnit({ ...input, isActive: true });
    },
    async saveOperationalUnit(input: SaveOperationalUnitInput) {
      node(input.departmentId);
      const current = input.id ? units.find(item => item.id === input.id) : undefined;
      if (current) {
        if (current.version !== input.expectedVersion) throw conflict("运营单元资料已被其他操作更新");
        Object.assign(current, {
          departmentId: input.departmentId,
          parentOperationalUnitId: input.parentOperationalUnitId,
          unitType: input.unitType,
          code: input.code || null,
          nameZh: input.nameZh.trim(),
          nameEn: input.nameEn.trim() || null,
          sortOrder: input.sortOrder,
          isActive: input.isActive,
          version: current.version + 1,
        });
        return { ...current };
      }
      const created: OperationalUnit = {
        ...input,
        id: crypto.randomUUID(),
        code: input.code || null,
        nameEn: input.nameEn || null,
        version: 1,
      };
      units.push(created);
      return { ...created };
    },
    async listOperationalUnits(candidate) { return candidate === propertyId ? units.map(item => ({ ...item })) : []; },
  };
}

function createHttpMockDepartmentRepository(): DepartmentRepository {
  return {
    listTree: propertyId => mockOrganizationRequest("listTree", { propertyId }),
    getNode: id => mockOrganizationRequest("getNode", { id }),
    getAncestors: id => mockOrganizationRequest("getAncestors", { id }),
    getDescendants: id => mockOrganizationRequest("getDescendants", { id }),
    createNode: input => mockOrganizationRequest("createNode", input),
    updateNode: input => mockOrganizationRequest("updateNode", input),
    previewMove: (id, newParentId) => mockOrganizationRequest("previewMove", { id, newParentId }),
    moveNode: (id, newParentId, expectedVersion) =>
      mockOrganizationRequest("moveNode", { id, newParentId, expectedVersion }),
    setActive: (id, expectedVersion, active) =>
      mockOrganizationRequest("setActive", { id, expectedVersion, active }),
    listAliases: propertyId => mockOrganizationRequest("listAliases", { propertyId }),
    approveMapping: input => mockOrganizationRequest("approveMapping", input),
    createOperationalUnit: input => mockOrganizationRequest("createOperationalUnit", input),
    saveOperationalUnit: input => mockOrganizationRequest("saveOperationalUnit", input),
    listOperationalUnits: propertyId =>
      mockOrganizationRequest("listOperationalUnits", { propertyId }),
  };
}

async function mockOrganizationRequest<T>(
  action: string,
  input: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("/api/mock-organization", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, input }),
  });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) {
    const error = new Error(payload.message ?? "本地组织验证服务不可用");
    if (response.status === 409) error.name = "ConflictError";
    throw error;
  }
  return payload;
}

function alias(id: string, sourceValue: string, sourceRowCount: number, employees: number, target: string | null, suggestion: string, confidence: number, reason: string, resolutionType: DepartmentAlias["resolutionType"]): DepartmentAlias {
  return { id, propertyId, sourceSystem: "synthetic-workbook", sourceSheet: "Synthetic Department Labels", sourceValue, normalizedSourceValue: sourceValue.trim().toLowerCase(), sourceRowCount, syntheticEmployeeCount: employees, suggestedTargetId: target, suggestionLabel: suggestion, confidence, suggestionReason: reason, targetDepartmentId: resolutionType === "mapped" ? target : null, operationalUnitId: null, resolutionType, isActive: true };
}
function stale(node: DepartmentNode, version: number) { if (node.version !== version) throw new Error("部门资料已更新，请刷新后重试"); }
function conflict(message: string) { const error = new Error(message); error.name = "ConflictError"; return error; }
function preview(nodes: DepartmentNode[], aliases: DepartmentAlias[], units: OperationalUnit[], moving: DepartmentNode, target: DepartmentNode | null): DepartmentMovePreview {
  if (target && (target.id === moving.id || target.pathIds.includes(moving.id))) throw new Error("不能移动到自身或下级部门");
  const subtree = nodes.filter(item => item.pathIds.includes(moving.id)); const path = (node: DepartmentNode) => node.pathIds.map(id => nodes.find(item => item.id === id)?.nameZh).join(" / ");
  return { currentPath: path(moving), proposedPath: target ? `${path(target)} / ${moving.nameZh}` : moving.nameZh, childDepartmentsAffected: subtree.length - 1, syntheticEmployeeImpact: moving.syntheticEmployeeCount, aliasesAffected: aliases.filter(item => item.targetDepartmentId && subtree.some(node => node.id === item.targetDepartmentId)).length, operationalUnitsAffected: units.filter(unit => subtree.some(node => node.id === unit.departmentId)).length };
}
function compareHierarchy(a: DepartmentNode, b: DepartmentNode, nodes: DepartmentNode[]) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const length = Math.min(a.pathIds.length, b.pathIds.length);
  for (let index = 0; index < length; index += 1) {
    if (a.pathIds[index] === b.pathIds[index]) continue;
    const left = byId.get(a.pathIds[index])!, right = byId.get(b.pathIds[index])!;
    return left.sortOrder - right.sortOrder || left.nameZh.localeCompare(right.nameZh, "zh-CN");
  }
  return a.pathIds.length - b.pathIds.length;
}
