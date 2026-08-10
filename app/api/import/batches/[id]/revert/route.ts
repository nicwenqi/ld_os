import { resolveRequestId } from "../../../../../lib/neon/request-id.ts";
import { importStagingErrorResponse, ImportStagingApiError, runAuthorizedNeonImportStaging } from "../../../../../services/neon-import-staging-authorization.ts";
import { ImportCommitInputError, parseCommitBatchId, parseRevertInput } from "../../../commit-input.ts";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = resolveRequestId(request);
  try {
    if ([...new URL(request.url).searchParams.keys()].length) throw new ImportCommitInputError("撤销预览不接受查询参数");
    const batchId = parseCommitBatchId((await context.params).id);
    const result = await runAuthorizedNeonImportStaging(request, requestId, scope => scope.commitRepository.previewRevert(batchId));
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return importStagingErrorResponse(error instanceof ImportCommitInputError ? new ImportStagingApiError(400, error.message) : error, requestId);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = resolveRequestId(request);
  try {
    const input = parseRevertInput(await request.json(), parseCommitBatchId((await context.params).id));
    const result = await runAuthorizedNeonImportStaging(request, requestId, scope => scope.commitRepository.revert(input));
    return Response.json(result.data, { status: 200, headers: result.headers });
  } catch (error) {
    return importStagingErrorResponse(error instanceof ImportCommitInputError ? new ImportStagingApiError(400, error.message) : error, requestId);
  }
}
