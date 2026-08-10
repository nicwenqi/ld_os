import { resolveRequestId } from "../../../../../lib/neon/request-id.ts";
import {
  importStagingErrorResponse,
  ImportStagingApiError,
  runAuthorizedNeonImportStaging,
} from "../../../../../services/neon-import-staging-authorization.ts";
import { ImportMappingInputError, parseDecisionBody, parseMappingBatchId } from "../../../mapping-input.ts";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = resolveRequestId(request);
  try {
    if ([...new URL(request.url).searchParams.keys()].length) throw new ImportMappingInputError("字段映射查询不接受参数");
    const batchId = parseMappingBatchId((await context.params).id);
    const result = await runAuthorizedNeonImportStaging(request, requestId, async scope => {
      const value = await scope.mappingRepository.getWorkflow(batchId);
      if (!value) throw new ImportStagingApiError(404, "导入批次不存在或无权访问");
      return value;
    });
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return importStagingErrorResponse(inputError(error), requestId);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = resolveRequestId(request);
  try {
    const batchId = parseMappingBatchId((await context.params).id);
    const body = await parseDecisionBody(request);
    const result = await runAuthorizedNeonImportStaging(request, requestId, scope => scope.mappingRepository.saveFieldMappingDecisions({ batchId, ...body }));
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return importStagingErrorResponse(inputError(error), requestId);
  }
}

function inputError(error: unknown) {
  return error instanceof ImportMappingInputError ? new ImportStagingApiError(400, error.message) : error;
}
