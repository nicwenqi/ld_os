import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovePositionMappingInput, PositionRepository, SavePositionFamilyInput, SavePositionInput, SavePositionWithDepartmentsInput } from "../contracts/position-repository.ts";
import type { OfficialPosition, PositionFamily, PositionSourceLabel } from "../contracts/organization-models.ts";
type Client = Pick<SupabaseClient, "from" | "auth" | "rpc">;

export function createSupabasePositionRepository(client: Client): PositionRepository {
  const getPosition = async (id: string) => { const { data, error } = await client.from("positions").select("*").eq("id", id).single(); if (error) throw new Error(`无法读取职位：${error.message}`); const { data: assignments } = await client.from("position_department_assignments").select("department_id").eq("position_id", id); return mapPosition(data, (assignments ?? []).map(item => item.department_id)); };
  return {
    async listPositionFamilies(propertyId) { const { data, error } = await client.from("position_families").select("*").eq("property_id", propertyId).order("sort_order"); if (error) throw new Error(`无法读取职位族：${error.message}`); return (data ?? []).map(mapFamily); },
    async savePositionFamily(input: SavePositionFamilyInput) {
      const { data, error } = await client.rpc("save_position_family", {
        p_property_id: input.propertyId,
        p_position_family_id: input.id ?? null,
        p_expected_version: input.version ?? 0,
        p_code: input.code,
        p_name_zh: input.nameZh,
        p_name_en: input.nameEn,
        p_description: input.description,
        p_sort_order: input.sortOrder,
        p_is_active: input.isActive,
      });
      if (error) throw businessError(error.message, "无法保存职位族");
      return mapFamily(data);
    },
    async listPositions(propertyId) { const { data, error } = await client.from("positions").select("*").eq("property_id", propertyId).order("name_zh"); if (error) throw new Error(`无法读取正式职位：${error.message}`); const { data: assignments, error: assignmentError } = await client.from("position_department_assignments").select("position_id,department_id").eq("property_id", propertyId); if (assignmentError) throw new Error(`无法读取职位适用部门：${assignmentError.message}`); return (data ?? []).map(row => mapPosition(row, (assignments ?? []).filter(item => item.position_id === row.id).map(item => item.department_id))); },
    async savePosition(input: SavePositionInput) { const values = { tenant_id: input.tenantId, property_id: input.propertyId, position_family_id: input.positionFamilyId, code: input.code, name_zh: input.nameZh, name_en: input.nameEn, grade_or_band: input.gradeOrBand, is_active: input.isActive }; const query = input.id ? client.from("positions").update(values).eq("id", input.id) : client.from("positions").insert(values); const { data, error } = await query.select("id").single(); if (error) throw new Error(`无法保存正式职位：${error.message}`); return getPosition(data.id); },
    async savePositionWithDepartments(input: SavePositionWithDepartmentsInput) {
      const { data, error } = await client.rpc("save_position_with_departments", {
        p_property_id: input.propertyId,
        p_position_id: input.id ?? null,
        p_expected_version: input.version ?? 0,
        p_position_family_id: input.positionFamilyId,
        p_code: input.code,
        p_name_zh: input.nameZh,
        p_name_en: input.nameEn,
        p_grade_or_band: input.gradeOrBand,
        p_is_active: input.isActive,
        p_department_ids: input.departmentIds,
      });
      if (error) throw businessError(error.message, "无法保存正式职位");
      return mapPosition(
        data,
        data.department_ids ?? data.departmentIds ?? input.departmentIds,
      );
    },
    async assignPositionToDepartments(id, departmentIds) { const current = await getPosition(id); const { error: removeError } = await client.from("position_department_assignments").delete().eq("position_id", id); if (removeError) throw new Error(`无法更新适用部门：${removeError.message}`); if (departmentIds.length) { const { error } = await client.from("position_department_assignments").insert(departmentIds.map((departmentId, index) => ({ tenant_id: current.tenantId, property_id: current.propertyId, position_id: id, department_id: departmentId, is_primary: index === 0 }))); if (error) throw new Error(`无法更新适用部门：${error.message}`); } return getPosition(id); },
    async listSourceLabels(propertyId) { const { data, error } = await client.from("position_aliases").select("*").eq("property_id", propertyId).order("created_at"); if (error) throw new Error(`无法读取职位来源标签：${error.message}`); return (data ?? []).map(mapSource); },
    async previewSourceImpact(id) { const { data, error } = await client.from("position_aliases").select("id,source_system,source_sheet,source_row_count").eq("id", id).single(); if (error || !data) throw new Error("未找到职位来源标签"); const sourceRowCount = Number(data.source_row_count ?? 0); return { sourceLabelId: data.id, sourceEvidence: { sourceSystem: data.source_system, sourceSheet: data.source_sheet ?? "历史批准来源", sourceRowCount }, syntheticEmployeeCount: sourceRowCount, employeeImpact: { state: "unavailable", reason: "import_source_rows_not_migrated" }, departmentImpact: { state: "unavailable", reason: "import_source_rows_not_migrated" } }; },
    async approvePositionMapping(input: ApprovePositionMappingInput) { const { data: userData, error: userError } = await client.auth.getUser(); if (userError || !userData.user) throw new Error("登录状态已失效，请重新登录"); const status = input.action === "position" ? "mapped" : input.action === "family" ? "family_only" : input.action === "external" ? "external_only" : input.action === "ignore" ? "ignored" : "deferred"; const { data, error } = await client.from("position_aliases").update({ target_position_id: input.action === "position" ? input.targetPositionId : null, target_position_family_id: ["position","family"].includes(input.action) ? input.targetPositionFamilyId : null, external_role_code: input.action === "external" ? input.externalRoleCode : null, external_role_name: input.action === "external" ? input.externalRoleName : null, resolution_status: status, approved_by: status === "deferred" ? null : userData.user.id, approved_at: status === "deferred" ? null : new Date().toISOString() }).eq("id", input.sourceLabelId).select("*").single(); if (error) throw new Error(`无法保存职位映射：${error.message}`); return mapSource(data); },
  };
}
// Supabase rows are runtime-shaped until generated database types are introduced.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFamily(row: any): PositionFamily { return { id: row.id ?? row.positionFamilyId, tenantId: row.tenant_id ?? row.tenantId, propertyId: row.property_id ?? row.propertyId, code: row.code, nameZh: row.name_zh ?? row.nameZh, nameEn: row.name_en ?? row.nameEn ?? null, description: row.description ?? null, sortOrder: Number(row.sort_order ?? row.sortOrder), isActive: row.is_active ?? row.isActive, version: Number(row.version ?? 1) }; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPosition(row: any, departmentIds: string[]): OfficialPosition { return { id: row.id ?? row.positionId, tenantId: row.tenant_id ?? row.tenantId, propertyId: row.property_id ?? row.propertyId, positionFamilyId: row.position_family_id ?? row.positionFamilyId ?? null, code: row.code, nameZh: row.name_zh ?? row.nameZh, nameEn: row.name_en ?? row.nameEn ?? null, gradeOrBand: row.grade_or_band ?? row.gradeOrBand ?? null, isActive: row.is_active ?? row.isActive, version: Number(row.version), departmentIds }; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSource(row: any): PositionSourceLabel { const sourceRowCount = Number(row.source_row_count ?? 0); return { id: row.id, propertyId: row.property_id, sourceSystem: row.source_system, sourceSheet: row.source_sheet ?? "历史批准来源", sourceValue: row.source_value, normalizedSourceValue: row.normalized_source_value, sourceRowCount, syntheticEmployeeCount: sourceRowCount, suggestedPositionId: row.target_position_id, suggestedFamilyId: row.target_position_family_id, confidence: row.approved_at ? 100 : 0, suggestionReason: row.approved_at ? "来自已确认的历史映射" : "尚未建立批准规则", targetPositionId: row.target_position_id, targetPositionFamilyId: row.target_position_family_id, externalRoleCode: row.external_role_code, externalRoleName: row.external_role_name, resolutionStatus: row.resolution_status }; }
function businessError(message: string, fallback: string) { const normalized = message.includes(":") ? message.split(":").slice(1).join(":").trim() : message; const error = new Error(normalized || fallback); if (/stale|version|concurrent|更新|版本/.test(message)) error.name = "ConflictError"; return error; }
