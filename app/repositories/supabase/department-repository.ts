import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApproveDepartmentMappingInput, CreateDepartmentInput, CreateOperationalUnitInput, DepartmentRepository, SaveOperationalUnitInput, UpdateDepartmentInput } from "../contracts/department-repository.ts";
import type { DepartmentAlias, DepartmentNode, OperationalUnit } from "../contracts/organization-models.ts";

type Client = Pick<SupabaseClient, "from" | "rpc" | "auth">;
export function createSupabaseDepartmentRepository(client: Client): DepartmentRepository {
  const getNode = async (id: string) => {
    const { data, error } = await client.from("departments").select("*").eq("id", id).single();
    if (error) throw businessError(error, "无法读取部门资料"); return mapNode(data);
  };
  return {
    async listTree(propertyId) { const { data, error } = await client.from("departments").select("*").eq("property_id", propertyId).order("sort_order"); if (error) throw businessError(error, "无法读取正式部门架构"); const nodes = (data ?? []).map(mapNode); return nodes.sort((a, b) => treeOrder(a, b, nodes)); },
    getNode,
    async getAncestors(id) { const current = await getNode(id); if (current.pathIds.length < 2) return []; const { data, error } = await client.from("departments").select("*").in("id", current.pathIds.slice(0, -1)); if (error) throw businessError(error, "无法读取部门路径"); const map = new Map((data ?? []).map(row => [row.id, mapNode(row)])); return current.pathIds.slice(0, -1).map(parentId => map.get(parentId)!).filter(Boolean); },
    async getDescendants(id) { const current = await getNode(id); const tree = await this.listTree(current.propertyId); return tree.filter(item => item.id !== id && item.pathIds.includes(id)); },
    async createNode(input: CreateDepartmentInput) { const { data, error } = await client.rpc("create_department", rpcCreate(input)); if (error) throw businessError(error, "无法创建部门"); return getNode(data); },
    async updateNode(input: UpdateDepartmentInput) { const { error } = await client.rpc("update_department_details", { p_department_id: input.id, p_expected_version: input.expectedVersion, p_name_zh: input.nameZh, p_name_en: input.nameEn, p_sort_order: input.sortOrder, p_is_active: input.isActive }); if (error) throw businessError(error, "无法更新部门"); return getNode(input.id); },
    async previewMove(id, newParentId) { const { data, error } = await client.rpc("preview_department_move", { p_department_id: id, p_new_parent_id: newParentId }); if (error) throw businessError(error, "无法预览移动影响"); const row = Array.isArray(data) ? data[0] : data; return { currentPath: row.current_path, proposedPath: row.proposed_path, childDepartmentsAffected: Number(row.child_departments_affected), syntheticEmployeeImpact: Number(row.employee_impact_placeholder), aliasesAffected: Number(row.aliases_affected), operationalUnitsAffected: Number(row.operational_units_affected) }; },
    async moveNode(id, newParentId, expectedVersion) { const { error } = await client.rpc("reparent_department", { p_department_id: id, p_new_parent_id: newParentId, p_expected_version: expectedVersion }); if (error) throw businessError(error, "无法移动部门"); return getNode(id); },
    async setActive(id, expectedVersion, active) { const current = await getNode(id); return this.updateNode({ id, expectedVersion, nameZh: current.nameZh, nameEn: current.nameEn ?? "", sortOrder: current.sortOrder, isActive: active }); },
    async listAliases(propertyId) { const { data, error } = await client.from("department_aliases").select("*").eq("property_id", propertyId).order("created_at"); if (error) throw businessError(error, "无法读取部门来源标签"); return (data ?? []).map(mapAlias); },
    async approveMapping(input: ApproveDepartmentMappingInput) { const userId = await currentUserId(client); const { data: existing, error: readError } = await client.from("department_aliases").select("*").eq("id", input.aliasId).single(); if (readError) throw businessError(readError, "未找到部门来源标签"); if (input.action === "operational_unit") { const { error: disableError } = await client.from("department_aliases").update({ is_active: false }).eq("id", input.aliasId); if (disableError) throw businessError(disableError, "无法更新部门来源标签"); const { error } = await client.from("operational_unit_aliases").insert({ tenant_id: existing.tenant_id, property_id: existing.property_id, source_system: existing.source_system, source_value: existing.source_value, normalized_source_value: existing.normalized_source_value, operational_unit_id: input.operationalUnitId, approved_by: userId, approved_at: new Date().toISOString() }); if (error) throw businessError(error, "无法归类运营单元"); return { ...mapAlias(existing), targetDepartmentId: null, operationalUnitId: input.operationalUnitId ?? null, resolutionType: "mapped", isActive: false }; }
      let targetDepartmentId = input.targetDepartmentId ?? null;
      if (input.action === "department" && (input.resolutionType === "created_top_level" || input.resolutionType === "created_child")) {
        if (!input.createDepartment) throw new Error("新建部门资料缺失");
        const { data: createdId, error: createError } = await client.rpc("create_department", rpcCreate({ ...input.createDepartment, tenantId: existing.tenant_id, propertyId: existing.property_id }));
        if (createError) throw businessError(createError, "无法创建部门");
        targetDepartmentId = createdId;
      }
      const resolution = input.action === "department" ? input.resolutionType ?? "mapped" : input.action === "ignore" ? "ignored" : input.action === "merge" ? "merged" : "deferred";
      const { data, error } = await client.from("department_aliases").update({ target_department_id: input.action === "department" || input.action === "merge" ? targetDepartmentId : null, resolution_type: resolution, approved_by: resolution === "deferred" ? null : userId, approved_at: resolution === "deferred" ? null : new Date().toISOString(), is_active: true }).eq("id", input.aliasId).select("*").single(); if (error) throw businessError(error, "无法保存部门映射"); return mapAlias(data);
    },
    async createOperationalUnit(input: CreateOperationalUnitInput) {
      return this.saveOperationalUnit({ ...input, isActive: true });
    },
    async saveOperationalUnit(input: SaveOperationalUnitInput) {
      const { data, error } = await client.rpc("save_operational_unit", {
        p_property_id: input.propertyId,
        p_operational_unit_id: input.id ?? null,
        p_expected_version: input.expectedVersion ?? 0,
        p_department_id: input.departmentId,
        p_parent_operational_unit_id: input.parentOperationalUnitId,
        p_unit_type: input.unitType,
        p_code: input.code,
        p_name_zh: input.nameZh,
        p_name_en: input.nameEn,
        p_sort_order: input.sortOrder,
        p_is_active: input.isActive,
      });
      if (error) throw businessError(error, "无法保存运营单元");
      return mapUnit(data);
    },
    async listOperationalUnits(propertyId) { const { data, error } = await client.from("operational_units").select("*").eq("property_id", propertyId).order("sort_order"); if (error) throw businessError(error, "无法读取运营单元"); return (data ?? []).map(mapUnit); },
  };
}
function rpcCreate(input: CreateDepartmentInput) { return { p_tenant_id: input.tenantId, p_property_id: input.propertyId, p_parent_id: input.parentId, p_node_type: input.nodeType, p_code: input.code, p_name_zh: input.nameZh, p_name_en: input.nameEn, p_sort_order: input.sortOrder }; }
// Supabase rows are runtime-shaped until generated database types are introduced.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapNode(row: any): DepartmentNode { return { id: row.id, tenantId: row.tenant_id, propertyId: row.property_id, parentId: row.parent_id, nodeType: row.node_type, code: row.code, nameZh: row.name_zh, nameEn: row.name_en, sortOrder: row.sort_order, depth: row.depth, pathIds: row.path_ids, isActive: row.is_active, version: Number(row.version), syntheticEmployeeCount: 0 }; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAlias(row: any): DepartmentAlias { return { id: row.id, propertyId: row.property_id, sourceSystem: row.source_system, sourceSheet: row.source_sheet ?? "历史批准来源", sourceValue: row.source_value, normalizedSourceValue: row.normalized_source_value, sourceRowCount: Number(row.source_row_count??0), syntheticEmployeeCount: Number(row.source_row_count??0), suggestedTargetId: row.target_department_id, suggestionLabel: row.target_department_id?"复用已批准映射":"等待选择正式部门", confidence: row.approved_at ? 100 : 0, suggestionReason: row.approved_at ? "来自已确认的历史映射" : "尚未建立批准规则", targetDepartmentId: row.target_department_id, operationalUnitId: null, resolutionType: row.resolution_type, isActive: row.is_active }; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapUnit(row: any): OperationalUnit { return { id: row.id ?? row.operationalUnitId, tenantId: row.tenant_id ?? row.tenantId, propertyId: row.property_id ?? row.propertyId, departmentId: row.department_id ?? row.departmentId, parentOperationalUnitId: row.parent_operational_unit_id ?? row.parentOperationalUnitId ?? null, unitType: row.unit_type ?? row.unitType, code: row.code ?? null, nameZh: row.name_zh ?? row.nameZh, nameEn: row.name_en ?? row.nameEn ?? null, sortOrder: Number(row.sort_order ?? row.sortOrder), isActive: row.is_active ?? row.isActive, version: Number(row.version ?? 1) }; }
function treeOrder(a: DepartmentNode, b: DepartmentNode, nodes: DepartmentNode[]) { const byId = new Map(nodes.map(node => [node.id, node])); const length = Math.min(a.pathIds.length, b.pathIds.length); for (let index = 0; index < length; index += 1) { if (a.pathIds[index] === b.pathIds[index]) continue; const left = byId.get(a.pathIds[index])!, right = byId.get(b.pathIds[index])!; return left.sortOrder - right.sortOrder || left.nameZh.localeCompare(right.nameZh, "zh-CN"); } return a.pathIds.length - b.pathIds.length; }
async function currentUserId(client: Client) { const { data, error } = await client.auth.getUser(); if (error || !data.user) throw new Error("登录状态已失效，请重新登录"); return data.user.id; }
function businessError(error: { code?: string; message: string }, fallback: string) { const message = error.message.includes(":") ? error.message.split(":").slice(1).join(":").trim() : error.message; const result = new Error(message || fallback); if (/stale|version|concurrent|更新|版本/.test(error.message)) result.name = "ConflictError"; return result; }
