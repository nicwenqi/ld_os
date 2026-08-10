import { resolveRequestId } from "../../../lib/neon/request-id.ts";
import { propertyErrorResponse, runAuthorizedNeonInitialization } from "../../../services/neon-property-authorization.ts";

export async function GET(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    const result = await runAuthorizedNeonInitialization(
      request,
      requestId,
      repository => repository.getAccessSummary("server"),
    );
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return propertyErrorResponse(error, requestId);
  }
}
