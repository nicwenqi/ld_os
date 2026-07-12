import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ImportBatch,
  ImportRepository,
} from "../contracts/import-repository.ts";
type Client = Pick<SupabaseClient, "from" | "storage" | "rpc">;
function map(row: any): ImportBatch {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    propertyId: row.property_id,
    fileName: row.sanitized_filename,
    status: row.status,
    version: Number(row.version),
    createdAt: row.created_at,
    summary: {
      inserted: row.inserted_employee_count ?? 0,
      updated: row.updated_employee_count ?? 0,
      unchanged: row.unchanged_employee_count ?? 0,
      excluded: row.excluded_rows ?? 0,
      unresolved: row.error_rows ?? 0,
    },
  };
}
export function createSupabaseImportRepository(
  client: Client,
): ImportRepository {
  return {
    async createBatch(input) {
      const id = crypto.randomUUID();
      const safe = input.fileName
        .normalize("NFKC")
        .replace(/[^\p{L}\p{N}._-]+/gu, "-");
      const path = `${input.tenantId}/${input.propertyId}/imports/${id}/${safe}`;
      const { data, error } = await client
        .from("import_batches")
        .insert({
          id,
          tenant_id: input.tenantId,
          property_id: input.propertyId,
          source_system: input.sourceSystem,
          original_filename: input.fileName,
          sanitized_filename: safe,
          storage_object_path: path,
          file_checksum: input.checksum,
          file_size_bytes: input.sizeBytes,
          mime_type: input.mimeType,
        })
        .select("*")
        .single();
      if (error) throw new Error(`无法创建导入批次：${error.message}`);
      return map(data);
    },
    async uploadFileReference(batchId, file) {
      const { data: batch, error } = await client
        .from("import_batches")
        .select("storage_object_path")
        .eq("id", batchId)
        .single();
      if (error) throw new Error(`无法读取上传路径：${error.message}`);
      const { error: uploadError } = await client.storage
        .from("property-import-files")
        .upload(batch.storage_object_path, file, {
          contentType: file.type,
          upsert: false,
        });
      if (uploadError)
        throw new Error(`无法上传私有工作簿：${uploadError.message}`);
      return { objectPath: batch.storage_object_path };
    },
    async inspectWorkbook() {
      throw new Error(
        "工作簿必须由可信服务器解析服务检查，浏览器不会直接读取源文件",
      );
    },
    async listSheets(batchId) {
      const { data, error } = await client
        .from("import_sheets")
        .select("*")
        .eq("import_batch_id", batchId)
        .order("sheet_index");
      if (error) throw new Error(`无法读取工作表：${error.message}`);
      return data ?? [];
    },
    async selectSheet(id, selected, headerRow) {
      const { error } = await client
        .from("import_sheets")
        .update({
          selected_for_import: selected,
          detected_header_row: headerRow,
        })
        .eq("id", id);
      if (error) throw new Error(`无法保存工作表选择：${error.message}`);
    },
    async saveFieldMappings(batchId, mappings) {
      const { error } = await client
        .from("import_field_mappings")
        .upsert(mappings as any);
      if (error) throw new Error(`无法保存字段映射：${error.message}`);
    },
    async stageRows(_batchId, rows) {
      const { error } = await client
        .from("import_source_rows")
        .insert(rows as any);
      if (error) throw new Error(`无法暂存来源记录：${error.message}`);
    },
    async listDepartmentLabels(batchId) {
      const { data, error } = await client
        .from("import_source_rows")
        .select("normalized_values")
        .eq("import_batch_id", batchId);
      if (error) throw new Error(error.message);
      return [
        ...new Set(
          (data ?? [])
            .map((x: any) => x.normalized_values.department_source_label)
            .filter(Boolean),
        ),
      ];
    },
    async listPositionLabels(batchId) {
      const { data, error } = await client
        .from("import_source_rows")
        .select("normalized_values")
        .eq("import_batch_id", batchId);
      if (error) throw new Error(error.message);
      return [
        ...new Set(
          (data ?? [])
            .map((x: any) => x.normalized_values.position_source_label)
            .filter(Boolean),
        ),
      ];
    },
    async validateBatch(batchId) {
      const { data, error } = await client
        .from("import_batches")
        .select("*")
        .eq("id", batchId)
        .single();
      if (error) throw new Error(error.message);
      return map(data);
    },
    async listIssues(batchId) {
      const { data, error } = await client
        .from("import_issues")
        .select(
          "*,import_source_rows(source_row_number,import_sheets(sheet_name))",
        )
        .eq("import_batch_id", batchId);
      if (error) throw new Error(error.message);
      return (data ?? []).map((x: any) => ({
        id: x.id,
        rowNumber: x.import_source_rows?.source_row_number ?? 0,
        sheetName: x.import_source_rows?.import_sheets?.sheet_name ?? "",
        type: x.issue_type,
        severity: x.severity,
        field: x.source_field,
        value: x.source_value,
        message: x.message,
        resolutionStatus: x.resolution_status,
      }));
    },
    async resolveIssue(id, resolution) {
      const { error } = await client
        .from("import_issues")
        .update({
          resolution_status: resolution.status,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    async previewCommit(batchId) {
      const b = await this.validateBatch(batchId);
      return b.summary;
    },
    async commitBatch(id, version) {
      const { data, error } = await client.rpc("commit_employee_import", {
        p_batch_id: id,
        p_expected_version: version,
      });
      if (error) throw new Error(`导入提交被拒绝：${error.message}`);
      return data;
    },
    async previewRevert(id) {
      const { data, error } = await client.rpc(
        "preview_employee_import_revert",
        { p_batch_id: id },
      );
      if (error) throw new Error(`无法预览回滚：${error.message}`);
      return data as any;
    },
    async revertBatch(batchId) {
      const { error } = await client.rpc("revert_employee_import", {
        p_batch_id: batchId,
      });
      if (error) throw new Error(`无法安全回滚：${error.message}`);
    },
    async listImportHistory(propertyId) {
      const { data, error } = await client
        .from("import_batches")
        .select("*")
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map(map);
    },
    async getBatchAudit(batchId) {
      const { data, error } = await client
        .from("import_commit_items")
        .select("*,import_commits!inner(import_batch_id)")
        .eq("import_commits.import_batch_id", batchId);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  };
}
