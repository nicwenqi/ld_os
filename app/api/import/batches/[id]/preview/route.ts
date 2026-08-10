import { resolveRequestId } from "../../../../../lib/neon/request-id.ts";
import {
  importStagingErrorResponse,
  ImportStagingApiError,
  runAuthorizedNeonImportStaging,
} from "../../../../../services/neon-import-staging-authorization.ts";
import { ImportMappingInputError, parseDecisionVersion, parseMappingBatchId } from "../../../mapping-input.ts";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = resolveRequestId(request);
  try {
    const batchId = parseMappingBatchId((await context.params).id);
    const decisionVersion = parseDecisionVersion(request);
    const result = await runAuthorizedNeonImportStaging(request, requestId, async scope => {
      const value = await scope.mappingRepository.preview(batchId, decisionVersion);
      return value;
    });
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return importStagingErrorResponse(inputError(error), requestId);
  }
}

function inputError(error: unknown) {
  return error instanceof ImportMappingInputError ? new ImportStagingApiError(400, error.message) : error;
}
