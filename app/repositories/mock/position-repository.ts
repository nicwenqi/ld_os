import type { ApprovePositionMappingInput, PositionRepository, SavePositionFamilyInput, SavePositionInput, SavePositionWithDepartmentsInput } from "../contracts/position-repository.ts";
import type { OfficialPosition, PositionFamily, PositionSourceLabel } from "../contracts/organization-models.ts";

const tenantId = "10000000-0000-0000-0000-000000000001", propertyId = "20000000-0000-0000-0000-000000000011";
export function createMockPositionRepository(): PositionRepository {
  if (typeof window !== "undefined") return createHttpMockPositionRepository();
  const families: PositionFamily[] = [["f-manager","manager","管理人员","Manager"],["f-supervisor","supervisor","主管人员","Supervisor"],["f-associate","associate","一线员工","Associate"],["f-culinary","culinary","厨房岗位","Culinary"],["f-engineering","engineering","工程岗位","Engineering"]].map((item, index) => ({ id: item[0], tenantId, propertyId, code: item[1], nameZh: item[2], nameEn: item[3], description: "Synthetic position family", sortOrder: (index + 1) * 10, isActive: true, version: 1 }));
  const positions: OfficialPosition[] = [
    position("p-fo-manager", "f-manager", "front-office-manager", "前厅部经理", "Front Office Manager", "M2", ["61000000-0000-0000-0000-000000000012"]),
    position("p-concierge", "f-supervisor", "concierge-supervisor", "礼宾主管", "Concierge Supervisor", "S1", ["61000000-0000-0000-0000-000000000013"]),
    position("p-associate", "f-associate", "guest-service-associate", "宾客服务专员", "Guest Service Associate", "A2", ["61000000-0000-0000-0000-000000000014"]),
    position("p-engineer", "f-engineering", "engineer", "工程技工", "Engineer", "T2", ["61000000-0000-0000-0000-000000000018"]),
    position("p-chef", "f-culinary", "chef-de-partie", "厨房主管", "Chef de Partie", "C2", ["61000000-0000-0000-0000-000000000019"]),
  ];
  const sources: PositionSourceLabel[] = [
    source("s-fo", "FO Mgr", 3, ["前厅部"], "p-fo-manager", "f-manager", 96, "缩写与前厅部经理高度匹配", "mapped"),
    source("s-agent", "Guest Service Agent", 14, ["前台", "礼宾部"], "p-associate", "f-associate", 91, "工作内容与宾客服务职位相近", "mapped"),
    source("s-security", "Security Guard", 8, ["保安区域（来源标签）"], null, "f-associate", 74, "未找到正式职位，建议确认职位族", "deferred"),
    source("s-legacy", "Legacy Job Label", 2, ["历史来源"], null, null, 30, "信息不足，建议稍后处理", "deferred"),
  ];
  return {
    async listPositionFamilies(candidate) { return candidate === propertyId ? families.map(copy) : []; },
    async savePositionFamily(input: SavePositionFamilyInput) {
      const current = input.id ? families.find(item => item.id === input.id) : undefined;
      if (current) {
        if (current.version !== input.version) throw conflict("职位族资料已被其他操作更新");
        Object.assign(current, input, { version: current.version + 1 });
      } else {
        const created = { ...input, id: crypto.randomUUID(), version: 1 } as PositionFamily;
        families.push(created);
        return copy(created);
      }
      return copy(current);
    },
    async listPositions(candidate) { return candidate === propertyId ? positions.map(item => ({ ...item, departmentIds: [...item.departmentIds] })) : []; },
    async savePosition(input: SavePositionInput) { const current = input.id ? positions.find(item => item.id === input.id) : undefined; if (current) { Object.assign(current, input, { version: current.version + 1 }); return { ...current, departmentIds: [...current.departmentIds] }; } const created = { ...input, id: crypto.randomUUID(), version: 1, departmentIds: [] } as OfficialPosition; positions.push(created); return { ...created, departmentIds: [] }; },
    async savePositionWithDepartments(input: SavePositionWithDepartmentsInput) {
      const current = input.id ? positions.find(item => item.id === input.id) : undefined;
      if (current) {
        if (current.version !== input.version) throw conflict("职位资料已被其他操作更新");
        Object.assign(current, input, {
          departmentIds: [...input.departmentIds],
          version: current.version + 1,
        });
        return { ...current, departmentIds: [...current.departmentIds] };
      }
      const created = {
        ...input,
        id: crypto.randomUUID(),
        version: 1,
        departmentIds: [...input.departmentIds],
      } as OfficialPosition;
      positions.push(created);
      return { ...created, departmentIds: [...created.departmentIds] };
    },
    async assignPositionToDepartments(id, departmentIds) { const current = positions.find(item => item.id === id); if (!current) throw new Error("未找到正式职位"); current.departmentIds = [...departmentIds]; return { ...current, departmentIds: [...departmentIds] }; },
    async listSourceLabels(candidate) { return candidate === propertyId ? sources.map(copy) : []; },
    async previewSourceImpact(id) { const current = sources.find(item => item.id === id); if (!current) throw new Error("未找到职位来源标签"); return { sourceLabelId: current.id, sourceEvidence: { sourceSystem: current.sourceSystem, sourceSheet: current.sourceSheet, sourceRowCount: current.sourceRowCount }, syntheticEmployeeCount: current.sourceRowCount, employeeImpact: { state: "available", value: { employeeCount: current.syntheticEmployeeCount } }, departmentImpact: { state: "available", value: { departmentNames: [...sourceDepartments.get(current.id) ?? []] } } }; },
    async approvePositionMapping(input: ApprovePositionMappingInput) { const current = sources.find(item => item.id === input.sourceLabelId); if (!current) throw new Error("未找到职位来源标签"); current.targetPositionId = input.action === "position" ? input.targetPositionId ?? null : null; current.targetPositionFamilyId = ["position","family"].includes(input.action) ? input.targetPositionFamilyId ?? null : null; current.externalRoleCode = input.action === "external" ? input.externalRoleCode ?? "external-role" : null; current.externalRoleName = input.action === "external" ? input.externalRoleName ?? current.sourceValue : null; current.resolutionStatus = input.action === "position" ? "mapped" : input.action === "family" ? "family_only" : input.action === "external" ? "external_only" : input.action === "ignore" ? "ignored" : "deferred"; return copy(current); },
  };
}

function createHttpMockPositionRepository(): PositionRepository {
  return {
    listPositionFamilies: propertyId => mockPositionRequest("listPositionFamilies", { propertyId }),
    savePositionFamily: input => mockPositionRequest("savePositionFamily", input),
    listPositions: propertyId => mockPositionRequest("listPositions", { propertyId }),
    savePosition: input => mockPositionRequest("savePosition", input),
    savePositionWithDepartments: input =>
      mockPositionRequest("savePositionWithDepartments", input),
    assignPositionToDepartments: (positionId, departmentIds) =>
      mockPositionRequest("assignPositionToDepartments", { positionId, departmentIds }),
    listSourceLabels: propertyId => mockPositionRequest("listSourceLabels", { propertyId }),
    previewSourceImpact: sourceLabelId =>
      mockPositionRequest("previewSourceImpact", { sourceLabelId }),
    approvePositionMapping: input => mockPositionRequest("approvePositionMapping", input),
  };
}

async function mockPositionRequest<T>(
  action: string,
  input: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("/api/mock-positions", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, input }),
  });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) {
    const error = new Error(payload.message ?? "本地职位验证服务不可用");
    if (response.status === 409) error.name = "ConflictError";
    throw error;
  }
  return payload;
}

function position(id: string, positionFamilyId: string, code: string, nameZh: string, nameEn: string, gradeOrBand: string, departmentIds: string[]): OfficialPosition { return { id, tenantId, propertyId, positionFamilyId, code, nameZh, nameEn, gradeOrBand, isActive: true, version: 1, departmentIds }; }
const sourceDepartments = new Map<string, string[]>([["s-fo", ["前厅部"]], ["s-agent", ["前台", "礼宾部"]], ["s-security", ["保安区域（来源标签）"]], ["s-legacy", ["历史来源"]]]);
function source(id: string, sourceValue: string, count: number, _departmentNames: string[], suggestedPositionId: string | null, suggestedFamilyId: string | null, confidence: number, reason: string, resolutionStatus: PositionSourceLabel["resolutionStatus"]): PositionSourceLabel { return { id, propertyId, sourceSystem: "synthetic-workbook", sourceSheet: "Synthetic Position Labels", sourceValue, normalizedSourceValue: sourceValue.toLowerCase(), sourceRowCount: count, syntheticEmployeeCount: count, suggestedPositionId, suggestedFamilyId, confidence, suggestionReason: reason, targetPositionId: resolutionStatus === "mapped" ? suggestedPositionId : null, targetPositionFamilyId: resolutionStatus === "mapped" ? suggestedFamilyId : null, externalRoleCode: null, externalRoleName: null, resolutionStatus }; }
function copy<T>(value: T): T { return structuredClone(value); }
function conflict(message: string) { const error = new Error(message); error.name = "ConflictError"; return error; }
