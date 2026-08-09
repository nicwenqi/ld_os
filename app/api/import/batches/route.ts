import { resolveRequestId } from "../../../lib/neon/request-id.ts";
import {
  importStagingErrorResponse,
  ImportStagingApiError,
  runAuthorizedNeonImportStaging,
} from "../../../services/neon-import-staging-authorization.ts";
import { ImportBatchInputError, parseHistoryQuery } from "./input.ts";

/** Dark E5B history endpoint; registry activation remains unchanged. */
export async function GET(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    const { limit, offset } = parseHistoryQuery(request);
    const result = await runAuthorizedNeonImportStaging(request, requestId, async context => {
      const rows = await context.repository.listHistory();
      const items = rows.slice(offset, offset + limit);
      return { items, limit, offset, hasMore: offset + limit < rows.length };
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
