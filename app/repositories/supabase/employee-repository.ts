/* eslint-disable @typescript-eslint/no-explicit-any -- Dynamic Supabase relation rows are normalized at this repository boundary. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DepartmentEmployeeDirectoryOptions,
  EmployeeDirectoryOptions,
  EmployeeDirectoryPage,
  EmployeeRecord,
  EmployeeRepository,
} from "../contracts/employee-repository.ts";

type Client = Pick<SupabaseClient, "from" | "rpc">;
const select = "*,departments(name_zh),operational_units(name_zh),positions(name_zh),position_families(name_zh),employee_external_identifiers(identifier_type)";

function map(row: any): EmployeeRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    propertyId: row.property_id,
    employeeNumber: row.employee_number,
    nameZh: row.name_zh,
    nameEn: row.name_en,
    departmentId: row.department_id,
    departmentName: row.departments?.name_zh ?? "",
    operationalUnitId: row.operational_unit_id,
    operationalUnitName: row.operational_units?.name_zh ?? null,
    positionId: row.position_id,
    positionName: row.positions?.name_zh ?? null,
    positionFamilyId: row.position_family_id,
    positionFamilyName: row.position_families?.name_zh ?? null,
    gradeOrBand: row.grade_or_band,
    hireDate: row.hire_date,
    probationOrConfirmationDate: row.probation_or_confirmation_date,
    employmentStatus: row.employment_status,
    isNewEmployee: Boolean(row.is_new_employee),
    isActive: Boolean(row.is_active),
    externalIdentifierTypes: (row.employee_external_identifiers ?? []).map((item: any) => item.identifier_type),
    version: Number(row.version),
  };
}

function mapDepartment(row: any): EmployeeRecord {
  return {
    id: `department:${row.employee_number}`,
    tenantId: "",
    propertyId: "",
    employeeNumber: row.employee_number,
    nameZh: row.name_zh,
    nameEn: row.name_en,
    departmentId: row.department_id,
    departmentName: row.department_name_zh ?? row.department_name_en ?? "",
    operationalUnitId: row.operational_unit_id,
    operationalUnitName: row.operational_unit_name_zh ?? row.operational_unit_name_en ?? null,
    positionId: row.position_id,
    positionName: row.position_name_zh ?? row.position_name_en ?? null,
    positionFamilyId: row.position_family_id,
    positionFamilyName: row.position_family_name_zh ?? row.position_family_name_en ?? null,
    gradeOrBand: null,
    hireDate: row.hire_date,
    probationOrConfirmationDate: row.probation_or_confirmation_date,
    employmentStatus: row.employment_status,
    isNewEmployee: Boolean(row.is_new_employee),
    isActive: row.employment_status === "active",
    externalIdentifierTypes: [],
    version: 0,
  };
}

function safeSearch(value: string) {
  return value.replace(/[,%()]/g, " ").trim();
}

export function createSupabaseEmployeeRepository(client: Client): EmployeeRepository {
  return {
    async listEmployees(propertyId, options) {
      let query: any = client.from("employees")
        .select(select)
        .eq("property_id", propertyId)
        .order("employee_number");
      if (options?.active !== undefined) query = query.eq("is_active", options.active);
      if (options?.departmentId) query = query.eq("department_id", options.departmentId);
      if (options?.positionId) query = query.eq("position_id", options.positionId);
      if (options?.positionFamilyId) query = query.eq("position_family_id", options.positionFamilyId);
      if (options?.employmentStatus) query = query.eq("employment_status", options.employmentStatus);
      const search = options?.query ? safeSearch(options.query) : "";
      if (search) query = query.or(`employee_number.ilike.%${search}%,name_zh.ilike.%${search}%,name_en.ilike.%${search}%`);
      const { data, error } = await query;
      if (error) throw new Error(`无法读取员工主数据：${error.message}`);
      return (data ?? []).map(map);
    },
    async listEmployeesPage(propertyId, options: EmployeeDirectoryOptions = {}): Promise<EmployeeDirectoryPage> {
      const limit = Math.min(100, Math.max(1, options.limit ?? 25));
      const offset = Math.max(0, options.offset ?? 0);
      let query: any = client.from("employees")
        .select(select, { count: "exact" })
        .eq("property_id", propertyId)
        .order("employee_number")
        .range(offset, offset + limit - 1);
      if (options.active !== undefined) query = query.eq("is_active", options.active);
      if (options.departmentId) query = query.eq("department_id", options.departmentId);
      if (options.positionId) query = query.eq("position_id", options.positionId);
      if (options.positionFamilyId) query = query.eq("position_family_id", options.positionFamilyId);
      if (options.employmentStatus) query = query.eq("employment_status", options.employmentStatus);
      const search = options.query ? safeSearch(options.query) : "";
      if (search) {
        query = query.or(`employee_number.ilike.%${search}%,name_zh.ilike.%${search}%,name_en.ilike.%${search}%`);
      }
      const { data, count, error } = await query;
      if (error) throw new Error(`无法读取员工主数据：${error.message}`);
      return {
        rows: (data ?? []).map(map),
        total: Number(count ?? 0),
        refreshedAt: new Date().toISOString(),
      };
    },
    async listDepartmentEmployees(options: DepartmentEmployeeDirectoryOptions = {}) {
      const limit = Math.min(100, Math.max(1, options.limit ?? 25));
      const offset = Math.max(0, options.offset ?? 0);
      const { data, error } = await client.rpc("list_department_employee_directory", {
        p_search: options.query?.trim() || null,
        p_limit: limit,
        p_offset: offset,
      });
      if (error) throw new Error(`无法读取本部门员工：${error.message}`);
      const rows = (data ?? []).map(mapDepartment);
      return {
        rows,
        total: Number(data?.[0]?.total_count ?? 0),
        refreshedAt: new Date().toISOString(),
      };
    },
    async getEmployee(id) {
      const { data, error } = await client.from("employees").select(select).eq("id", id).maybeSingle();
      if (error) throw new Error(`无法读取员工：${error.message}`);
      return data ? map(data) : null;
    },
    async findByEmployeeNumber(propertyId, employeeNumber) {
      const { data, error } = await client.from("employees").select(select)
        .eq("property_id", propertyId)
        .eq("employee_number", employeeNumber)
        .maybeSingle();
      if (error) throw new Error(`无法查找员工编号：${error.message}`);
      return data ? map(data) : null;
    },
    async listExternalIdentifiers(employeeId) {
      const { data, error } = await client.from("employee_external_identifiers")
        .select("identifier_type,identifier_value,source_system,is_primary")
        .eq("employee_id", employeeId);
      if (error) throw new Error(`无法读取外部标识：${error.message}`);
      return (data ?? []).map((row: any) => ({
        type: row.identifier_type,
        value: row.identifier_value,
        sourceSystem: row.source_system,
        isPrimary: row.is_primary,
      }));
    },
  };
}
