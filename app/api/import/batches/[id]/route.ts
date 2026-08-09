import { resolveRequestId } from "../../../../lib/neon/request-id.ts";
import {
  importStagingErrorResponse,
  ImportStagingApiError,
  runAuthorizedNeonImportStaging,
} from "../../../../services/neon-import-staging-authorization.ts";
import { ImportBatchInputError, parseBatchId } from "../input.ts";

/** Dark E5B batch evidence endpoint; missing and cross-property are identical. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = resolveRequestId(request);
  try {
    if ([...new URL(request.url).searchParams.keys()].length) throw new ImportBatchInputError("导入批次详情不接受查询参数");
    const { id } = await context.params;
    const batchId = parseBatchId(id);
    const result = await runAuthorizedNeonImportStaging(request, requestId, async scope => {
      const value = await scope.repository.getWorkflow(batchId);
      if (!value) throw new ImportStagingApiError(404, "导入批次不存在或无权访问");
      return value;
    });
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return importStagingErrorResponse(inputError(error), requestId);
  }
}

function inputError(error: unknown) {
  return error instanceof ImportBatchInputError
    ? new ImportStagingApiError(400, error.message)
    : error;
}
