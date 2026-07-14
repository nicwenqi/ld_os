import { createServerAdminClient } from "../../../lib/supabase/server-admin.ts";
import { AuthorizationError, requireProductionPropertyManager } from "../../../services/production-authorization.ts";
import { prepareEmployeeMasterStaging } from "../../../services/import/production-workbook-staging.ts";

const BUCKET = "property-import-files";

export async function POST(request: Request) {
  let objectPath: string | null = null;
  let batchId: string | null = null;
  const admin = createServerAdminClient();
  try {
    const actor = await requireProductionPropertyManager(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return failure(400, "请选择工作簿");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const prepared = prepareEmployeeMasterStaging({ fileName: file.name, mimeType: file.type || mimeFor(file.name), bytes });
    batchId = crypto.randomUUID();
    objectPath = `${actor.tenantId}/${actor.propertyId}/imports/${batchId}/${prepared.safeSummary.sanitizedFilename}`;

    const { error: batchError } = await admin.from("import_batches").insert({
      id: batchId, tenant_id: actor.tenantId, property_id: actor.propertyId, import_type: "employee_master", source_system: "hotel_workbook",
      original_filename: file.name, sanitized_filename: prepared.safeSummary.sanitizedFilename, storage_object_path: objectPath,
      file_checksum: prepared.safeSummary.checksum, file_size_bytes: prepared.safeSummary.sizeBytes, mime_type: file.type || mimeFor(file.name),
      status: "inspecting", detected_sheet_count: prepared.inspection.sheets.length, total_source_rows: prepared.sourceRows.length,
      valid_rows: prepared.sourceRows.filter(row => row.processingStatus !== "error").length,
      warning_rows: prepared.sourceRows.filter(row => row.processingStatus === "warning").length,
      error_rows: prepared.sourceRows.filter(row => row.processingStatus === "error").length,
      created_by: actor.authUserId, started_at: new Date().toISOString(),
    });
    if (batchError) throw batchError;
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(objectPath, bytes, { contentType: file.type || mimeFor(file.name), upsert: false });
    if (uploadError) throw uploadError;

    const sheets = prepared.inspection.sheets.map(sheet => ({
      id: crypto.randomUUID(), tenant_id: actor.tenantId, property_id: actor.propertyId, import_batch_id: batchId,
      sheet_name: sheet.name, sheet_index: sheet.index, detected_header_row: sheet.likelyHeaderRow, source_row_count: sheet.rowCount,
      selected_for_import: sheet.name === prepared.safeSummary.selectedSheet,
      inferred_purpose: sheet.name === prepared.safeSummary.selectedSheet ? "employee_master" : "excluded",
    }));
    const { error: sheetError } = await admin.from("import_sheets").insert(sheets);
    if (sheetError) throw sheetError;
    const selectedSheetId = sheets.find(sheet => sheet.selected_for_import)!.id;

    if (prepared.fieldMappings.length) {
      const { error } = await admin.from("import_field_mappings").insert(prepared.fieldMappings.map(mapping => ({
        tenant_id: actor.tenantId, property_id: actor.propertyId, import_batch_id: batchId, import_sheet_id: selectedSheetId,
        source_column_name: mapping.sourceColumnName, source_column_index: mapping.sourceColumnIndex, target_field: mapping.targetField,
        transformation_rule: mapping.transformationRule, is_required: mapping.isRequired, mapping_status: "suggested",
      })));
      if (error) throw error;
    }
    if (prepared.sourceRows.length) {
      const { error } = await admin.from("import_source_rows").insert(prepared.sourceRows.map(row => ({
        id: row.id, tenant_id: actor.tenantId, property_id: actor.propertyId, import_batch_id: batchId, import_sheet_id: selectedSheetId,
        source_row_number: row.sourceRowNumber, raw_values: row.rawValues, normalized_values: row.normalizedValues,
        row_fingerprint: row.rowFingerprint, processing_status: row.processingStatus, proposed_action: row.proposedAction,
        validation_summary: row.validationSummary,
      })));
      if (error) throw error;
    }
    const issues = prepared.sourceRows.flatMap(row => [
      ...row.validationSummary.blockingIssues.map(issueType => issueRow(actor, batchId!, row.id, issueType, "error")),
      ...row.validationSummary.warningIssues.map(issueType => issueRow(actor, batchId!, row.id, issueType, "warning")),
    ]);
    if (issues.length) {
      const { error } = await admin.from("import_issues").insert(issues);
      if (error) throw error;
    }
    const { error: updateError } = await admin.from("import_batches").update({ status: "mapping_required" }).eq("id", batchId).eq("property_id", actor.propertyId);
    if (updateError) throw updateError;
    const headers = new Headers({ "Cache-Control": "no-store, private" });
    for (const value of actor.refreshedCookies) headers.append("Set-Cookie", value);
    return Response.json({ batchId, status: "mapping_required", ...prepared.safeSummary }, { status: 201, headers });
  } catch (error) {
    if (objectPath) await admin.storage.from(BUCKET).remove([objectPath]);
    if (batchId) await admin.from("import_batches").delete().eq("id", batchId);
    if (error instanceof AuthorizationError) return failure(error.status, error.message);
    return failure(422, batchId ? "工作簿暂存失败，请重试" : error instanceof Error ? error.message : "工作簿检查失败");
  }
}

function issueRow(actor: { tenantId: string; propertyId: string }, batchId: string, sourceRowId: string, issueType: string, severity: "warning" | "error") {
  return { tenant_id: actor.tenantId, property_id: actor.propertyId, import_batch_id: batchId, import_source_row_id: sourceRowId,
    issue_type: issueType, severity, message: businessIssueMessage(issueType), resolution_status: "unresolved" };
}
function businessIssueMessage(issueType: string) {
  return ({ missing_employee_number: "缺少员工编号", missing_name: "缺少员工姓名", unresolved_department: "缺少部门来源值",
    unresolved_position: "缺少职位来源值", invalid_date: "日期值需要人工确认", duplicate_employee_number_in_file: "工作簿内员工编号重复" } as Record<string, string>)[issueType] ?? "来源记录需要人工确认";
}
function failure(status: number, message: string) { return Response.json({ message }, { status, headers: { "Cache-Control": "no-store, private" } }); }
function mimeFor(name: string) { const extension = name.split(".").at(-1)?.toLowerCase(); return extension === "xls" ? "application/vnd.ms-excel" : extension === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv"; }
