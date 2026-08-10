import { createServerActorClient } from "../../../lib/supabase/server-admin.ts";
import {
  AuthorizationError,
  requireProductionPropertyManager,
} from "../../../services/production-authorization.ts";
import { prepareEmployeeMasterStaging } from "../../../services/import/production-workbook-staging.ts";
import { parseAppEnvironment } from "../../../lib/environment.ts";
import { resolveRequestId } from "../../../lib/neon/request-id.ts";

const BUCKET = "property-import-files";

type ImportInspectionDependencies = {
  authorize: typeof requireProductionPropertyManager;
  actorClient: typeof createServerActorClient;
  prepare: typeof prepareEmployeeMasterStaging;
  randomUUID: () => string;
};

const defaultDependencies: ImportInspectionDependencies = {
  authorize: requireProductionPropertyManager,
  actorClient: createServerActorClient,
  prepare: prepareEmployeeMasterStaging,
  randomUUID: () => crypto.randomUUID(),
};

export function createImportInspectionHandler(
  dependencies: ImportInspectionDependencies = defaultDependencies,
) {
  return async function handleImportInspection(request: Request) {
    let actorClient: ReturnType<typeof createServerActorClient> | null = null;
    let objectPath: string | null = null;
    let objectUploaded = false;
    let databaseStaged = false;
    let batchId: string | null = null;

    try {
      const actor = await dependencies.authorize(request);
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return failure(400, "请选择工作簿");

      const mimeType = file.type || mimeFor(file.name);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const prepared = dependencies.prepare({
        fileName: file.name,
        mimeType,
        bytes,
      });
      batchId = dependencies.randomUUID();
      objectPath = [
        actor.tenantId,
        actor.propertyId,
        "imports",
        batchId,
        prepared.safeSummary.sanitizedFilename,
      ].join("/");
      actorClient = dependencies.actorClient(actor.accessToken);

      const { error: uploadError } = await actorClient.storage
        .from(BUCKET)
        .upload(objectPath, bytes, {
          contentType: mimeType,
          upsert: false,
        });
      if (uploadError) throw uploadError;
      objectUploaded = true;

      const sheets = prepared.inspection.sheets.map(sheet => ({
        id: dependencies.randomUUID(),
        name: sheet.name,
        index: sheet.index,
        headerRow: sheet.likelyHeaderRow,
        rowCount: sheet.rowCount,
        selected: sheet.name === prepared.safeSummary.selectedSheet,
        purpose:
          sheet.name === prepared.safeSummary.selectedSheet
            ? "employee_master"
            : "excluded",
      }));
      const selectedSheetId = sheets.find(sheet => sheet.selected)?.id;
      if (!selectedSheetId) throw new Error("未找到已选择的员工主数据工作表");

      const issues = prepared.sourceRows.flatMap(row => [
        ...row.validationSummary.blockingIssues.map(issueType =>
          issueRow(row.id, issueType, "error")
        ),
        ...row.validationSummary.warningIssues.map(issueType =>
          issueRow(row.id, issueType, "warning")
        ),
      ]);
      const sourceLabels = [
        ...prepared.sourceLabels.departments.map(label => ({
          resolutionType: "department",
          sourceLabel: label.sourceValue,
          normalizedSourceLabel: label.normalizedSourceValue,
          affectedRowCount: label.sourceRowCount,
        })),
        ...prepared.sourceLabels.positions.map(label => ({
          resolutionType: "position",
          sourceLabel: label.sourceValue,
          normalizedSourceLabel: label.normalizedSourceValue,
          affectedRowCount: label.sourceRowCount,
        })),
      ];
      const { data: staged, error: stagingError } = await actorClient.rpc(
        "stage_employee_import",
        {
          p_property_id: actor.propertyId,
          p_batch_id: batchId,
          p_staging: {
            batch: {
              originalFilename: file.name,
              sanitizedFilename: prepared.safeSummary.sanitizedFilename,
              storageObjectPath: objectPath,
              fileChecksum: prepared.inspection.checksum,
              fileSizeBytes: prepared.safeSummary.sizeBytes,
              mimeType,
              detectedSheetCount: sheets.length,
              totalSourceRows: prepared.sourceRows.length,
              validRows: prepared.sourceRows.filter(
                row => row.processingStatus !== "error",
              ).length,
              warningRows: prepared.sourceRows.filter(
                row => row.processingStatus === "warning",
              ).length,
              errorRows: prepared.sourceRows.filter(
                row => row.processingStatus === "error",
              ).length,
            },
            sheets,
            fieldMappings: prepared.fieldMappings.map(mapping => ({
              sheetId: selectedSheetId,
              sourceColumnName: mapping.sourceColumnName,
              sourceColumnIndex: mapping.sourceColumnIndex,
              targetField: mapping.targetField,
              transformationRule: mapping.transformationRule,
              isRequired: mapping.isRequired,
            })),
            rows: prepared.sourceRows.map(row => ({
              id: row.id,
              sheetId: selectedSheetId,
              sourceRowNumber: row.sourceRowNumber,
              rawValues: row.rawValues,
              normalizedValues: row.normalizedValues,
              rowFingerprint: row.rowFingerprint,
              processingStatus: row.processingStatus,
              proposedAction: row.proposedAction,
              validationSummary: row.validationSummary,
            })),
            issues,
            sourceLabels,
          },
        },
      );
      if (stagingError) throw stagingError;
      databaseStaged = true;

      const headers = new Headers({ "Cache-Control": "no-store, private" });
      for (const value of actor.refreshedCookies) {
        headers.append("Set-Cookie", value);
      }
      return Response.json(
        {
          batchId,
          status:
            typeof staged === "object" &&
              staged !== null &&
              "status" in staged &&
              staged.status === "mapping_required"
              ? staged.status
              : "mapping_required",
          ...browserSafeSummary(prepared.safeSummary),
        },
        { status: 201, headers },
      );
    } catch (error) {
      let cleanupFailed = false;
      if (
        actorClient &&
        objectPath &&
        objectUploaded &&
        !databaseStaged
      ) {
        cleanupFailed = !await removeUploadedObject(
          actorClient,
          objectPath,
        );
      }
      if (cleanupFailed) {
        return failure(
          500,
          "工作簿暂存失败，临时文件清理未完成，请联系管理员",
        );
      }
      if (error instanceof AuthorizationError) {
        return failure(error.status, error.message);
      }
      return failure(
        422,
        batchId
          ? "工作簿暂存失败，请重试"
          : error instanceof Error
            ? error.message
            : "工作簿检查失败",
      );
    }
  };
}

/**
 * Neon is an explicit runtime branch. The legacy Supabase handler remains
 * available only when APP_DATA_MODE is not neon; it is never a fallback after
 * a Neon request fails.
 */
export async function POST(request: Request) {
  const environment = parseAppEnvironment();
  if (environment.dataMode === "neon") {
    const requestId = resolveRequestId(request);
    const { importStagingErrorResponse } = await import("../../../services/neon-import-staging-authorization.ts");
    try {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return failure(400, "请选择工作簿");
      // Keep the server-only Neon boundary out of the legacy test/client
      // module graph; it is loaded only for an explicit Neon request.
      const { inspectAndStageWorkbookInNeon } = await import("../../../services/import/neon-import-inspection-boundary.ts");
      const result = await inspectAndStageWorkbookInNeon({ request, requestId, file });
      return Response.json(result.data, { status: 201, headers: result.headers });
    } catch (error) {
      return importStagingErrorResponse(error, requestId);
    }
  }
  return createImportInspectionHandler()(request);
}

async function removeUploadedObject(
  actorClient: ReturnType<typeof createServerActorClient>,
  objectPath: string,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await actorClient.storage
        .from(BUCKET)
        .remove([objectPath]);
      if (
        !error &&
        data?.some(object => object.name === objectPath)
      ) {
        return true;
      }
    } catch {
      // A bounded second attempt handles transient transport failures.
    }
  }
  return false;
}

function issueRow(
  sourceRowId: string,
  issueType: string,
  severity: "warning" | "error",
) {
  return {
    sourceRowId,
    issueType,
    severity,
    message: businessIssueMessage(issueType),
  };
}

function businessIssueMessage(issueType: string) {
  return ({
    missing_employee_number: "缺少员工编号",
    missing_name: "缺少员工姓名",
    unresolved_department: "缺少部门来源值",
    unresolved_position: "缺少职位来源值",
    invalid_date: "日期值需要人工确认",
    duplicate_employee_number_in_file: "工作簿内员工编号重复",
  } as Record<string, string>)[issueType] ?? "来源记录需要人工确认";
}

function browserSafeSummary(
  summary: ReturnType<typeof prepareEmployeeMasterStaging>["safeSummary"],
) {
  const {
    sanitizedFilename,
    checksumPrefix,
    sizeBytes,
    detectedSheets,
    selectedSheet,
    headerRow,
    sourceRows,
    structurallyValid,
    blockedRows,
    warningRows,
    uniqueDepartmentLabels,
    uniquePositionLabels,
    exclusions,
    excludedColumns,
    excludedSheets,
    warnings,
    employeesImported,
    trainingHistoryImported,
    ctcGtcImported,
  } = summary;
  return {
    sanitizedFilename,
    checksumPrefix,
    sizeBytes,
    detectedSheets,
    selectedSheet,
    headerRow,
    sourceRows,
    structurallyValid,
    blockedRows,
    warningRows,
    uniqueDepartmentLabels,
    uniquePositionLabels,
    exclusions,
    excludedColumns,
    excludedSheets,
    warnings,
    employeesImported,
    trainingHistoryImported,
    ctcGtcImported,
  };
}

function failure(status: number, message: string) {
  return Response.json(
    { message },
    {
      status,
      headers: { "Cache-Control": "no-store, private" },
    },
  );
}

function mimeFor(name: string) {
  const extension = name.split(".").at(-1)?.toLowerCase();
  return extension === "xls"
    ? "application/vnd.ms-excel"
    : extension === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv";
}
