import { resolveRequestId } from "../../lib/neon/request-id.ts";
import {
  propertyErrorResponse,
  runAuthorizedNeonPropertyRead,
} from "../../services/neon-property-authorization.ts";

export async function GET(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    const result = await runAuthorizedNeonPropertyRead(
      request,
      requestId,
      repository => repository.getProperty(""),
    );
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return propertyErrorResponse(error, requestId);
  }
}
