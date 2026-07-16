/* eslint-disable @typescript-eslint/no-explicit-any -- Dynamic Supabase relation rows are normalized at this repository boundary. */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  mapImportRepositoryError,
  type EmployeeUpdatePreview,
  type ImportBatch,
  type ImportMutationResult,
  type ImportRepository,
  type ImportRevertPreview,
  type ImportSourceLabelResolution,
} from "../contracts/import-repository.ts";

type Client = Pick<SupabaseClient, "from" | "storage" | "rpc">;

function commitRow(row: any) {
  return Array.isArray(row?.import_commits) ? row.import_commits[0] : row?.import_commits;
}

function mapBatch(row: any): ImportBatch {
  const commit = commitRow(row);
  const preview = row.preview_summary ?? {};
  return {
    id: row.id,
    tenantId: row.tenant_id,
    propertyId: row.property_id,
    fileName: row.sanitized_filename,
    status: row.status,
    version: Number(row.version),
    createdAt: row.created_at,
    summary: {
      inserted: Number(commit?.inserted_employee_count ?? preview.additions ?? 0),
      updated: Number(commit?.updated_employee_count ?? preview.updates ?? 0),
      unchanged: Number(commit?.unchanged_employee_count ?? preview.unchanged ?? 0),
      excluded: Number(commit?.excluded_row_count ?? preview.exclusions ?? row.excluded_rows ?? 0),
      blocked: Number(preview.blocked ?? row.error_rows ?? 0),
      unresolved: Number(commit?.unresolved_row_count ?? preview.unresolved ?? row.error_rows ?? 0),
    },
  };
}

async function rpc<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw mapImportRepositoryError(error);
  return data as T;
}

const batchSelect = "*,import_commits(inserted_employee_count,updated_employee_count,unchanged_employee_count,excluded_row_count,unresolved_row_count)";

export function createSupabaseImportRepository(client: Client): ImportRepository {
  return {
    async createBatch(input) {
      const id = crypto.randomUUID();
      const safe = input.fileName.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-");
      const path = `${input.tenantId}/${input.propertyId}/imports/${id}/${safe}`;
      const { data, error } = await client.from("import_batches").insert({
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
      }).select(batchSelect).single();
      if (error) throw mapImportRepositoryError(error);
      return mapBatch(data);
    },
    async uploadFileReference(batchId, file) {
      const { data: batch, error } = await client.from("import_batches").select("storage_object_path").eq("id", batchId).single();
      if (error) throw mapImportRepositoryError(error);
      const { error: uploadError } = await client.storage.from("property-import-files").upload(batch.storage_object_path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) throw mapImportRepositoryError(uploadError);
      return { objectPath: batch.storage_object_path };
    },
    async inspectWorkbook() {
      throw new Error("工作簿必须由可信服务器解析服务检查，浏览器不会直接读取源文件");
    },
    async getBatch(batchId) {
      const { data, error } = await client.from("import_batches").select(batchSelect).eq("id", batchId).maybeSingle();
      if (error) throw mapImportRepositoryError(error);
      return data ? mapBatch(data) : null;
    },
    async listSheets(batchId) {
      const { data, error } = await client.from("import_sheets").select("*").eq("import_batch_id", batchId).order("sheet_index");
      if (error) throw mapImportRepositoryError(error);
      return data ?? [];
    },
    async selectSheet(id, selected, headerRow) {
      const { error } = await client.from("import_sheets").update({
        selected_for_import: selected,
        detected_header_row: headerRow,
      }).eq("id", id);
      if (error) throw mapImportRepositoryError(error);
    },
    async saveFieldMappings(_batchId, mappings) {
      const { error } = await client.from("import_field_mappings").upsert(mappings as any);
      if (error) throw mapImportRepositoryError(error);
    },
    confirmFieldMappings(batchId, expectedVersion, mappings) {
      return rpc<ImportMutationResult>(client, "confirm_employee_import_field_mapping", {
        p_batch_id: batchId,
        p_expected_version: expectedVersion,
        p_mapping_decisions: mappings,
      });
    },
    async stageRows(_batchId, rows) {
      const { error } = await client.from("import_source_rows").insert(rows as any);
      if (error) throw mapImportRepositoryError(error);
    },
    async listDepartmentLabels(batchId) {
      return this.listSourceLabelResolutions(batchId, "department");
    },
    async listPositionLabels(batchId) {
      return this.listSourceLabelResolutions(batchId, "position");
    },
    async listSourceLabelResolutions(batchId, type) {
      const { data, error } = await client.from("import_source_label_resolutions")
        .select("source_label,affected_row_count,decision,target_entity_id")
        .eq("import_batch_id", batchId)
        .eq("resolution_type", type)
        .order("source_label");
      if (error) throw mapImportRepositoryError(error);
      return (data ?? []).map((row: any): ImportSourceLabelResolution => ({
        sourceValue: row.source_label,
        sourceRowCount: Number(row.affected_row_count),
        decision: row.decision,
        targetId: row.target_entity_id,
      }));
    },
    resolveSourceLabel(batchId, expectedVersion, type, sourceValue, targetId, decision) {
      return rpc<ImportMutationResult>(client, "resolve_employee_import_source_label", {
        p_batch_id: batchId,
        p_expected_version: expectedVersion,
        p_resolution_type: type,
        p_source_label: sourceValue,
        p_target_entity_id: targetId,
        p_decision: decision,
      });
    },
    async validateBatch(batchId) {
      const batch = await this.getBatch(batchId);
      if (!batch) throw new Error("员工资料更新批次不存在或无权访问");
      return batch;
    },
    async listIssues(batchId) {
      const { data, error } = await client.from("import_issues")
        .select("*,import_source_rows(source_row_number,import_sheets(sheet_name))")
        .eq("import_batch_id", batchId)
        .order("created_at");
      if (error) throw mapImportRepositoryError(error);
      return (data ?? []).map((row: any) => ({
        id: row.id,
        rowNumber: row.import_source_rows?.source_row_number ?? 0,
        sheetName: row.import_source_rows?.import_sheets?.sheet_name ?? "",
        type: row.issue_type,
        severity: row.severity,
        field: row.source_field,
        value: row.source_value,
        message: row.message,
        resolutionStatus: row.resolution_status,
      }));
    },
    resolveIssue(batchId, expectedVersion, issueId, resolution) {
      return rpc<ImportMutationResult>(client, "resolve_employee_import_issue", {
        p_batch_id: batchId,
        p_expected_version: expectedVersion,
        p_issue_id: issueId,
        p_resolution: resolution.status,
        p_resolution_payload: resolution.payload ?? {},
      });
    },
    preparePreview(batchId, expectedVersion, options) {
      return rpc<EmployeeUpdatePreview>(client, "prepare_employee_import_preview", {
        p_batch_id: batchId,
        p_expected_version: expectedVersion,
        p_options: options,
      });
    },
    async previewCommit(batchId) {
      const batch = await this.validateBatch(batchId);
      return batch.summary;
    },
    commitBatch(batchId, expectedVersion) {
      return rpc<string>(client, "commit_employee_import", {
        p_batch_id: batchId,
        p_expected_version: expectedVersion,
      });
    },
    previewRevert(batchId) {
      return rpc<ImportRevertPreview>(client, "preview_employee_import_revert", {
        p_batch_id: batchId,
      });
    },
    async revertBatch(batchId, token) {
      await rpc<unknown>(client, "revert_employee_import", {
        p_batch_id: batchId,
        p_preview_token: token,
      });
    },
    async listImportHistory(propertyId) {
      const { data, error } = await client.from("import_batches").select(batchSelect)
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false });
      if (error) throw mapImportRepositoryError(error);
      return (data ?? []).map(mapBatch);
    },
    async getBatchAudit(batchId) {
      const { data, error } = await client.from("import_commit_items")
        .select("*,import_commits!inner(import_batch_id,committed_at,committed_by)")
        .eq("import_commits.import_batch_id", batchId)
        .order("created_at");
      if (error) throw mapImportRepositoryError(error);
      return data ?? [];
    },
  };
}
