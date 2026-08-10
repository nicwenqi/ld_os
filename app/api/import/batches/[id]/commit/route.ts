import { resolveRequestId } from "../../../../../lib/neon/request-id.ts";
import { importStagingErrorResponse, ImportStagingApiError, runAuthorizedNeonImportStaging } from "../../../../../services/neon-import-staging-authorization.ts";
import { ImportCommitInputError, parseCommitInput, parseCommitBatchId } from "../../../commit-input.ts";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = resolveRequestId(request);
  try {
    const input = parseCommitInput(await request.json(), parseCommitBatchId((await context.params).id));
    const result = await runAuthorizedNeonImportStaging(request, requestId, scope => scope.commitRepository.commit(input));
    return Response.json(result.data, { status: 200, headers: result.headers });
  } catch (error) {
    return importStagingErrorResponse(error instanceof ImportCommitInputError ? new ImportStagingApiError(400, error.message) : error, requestId);
  }
}
