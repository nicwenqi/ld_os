import { resolveRequestId } from "../../../lib/neon/request-id.ts";
import {
  OrganizationApiError,
  organizationErrorResponse,
} from "../../../services/neon-organization-authorization.ts";
import { runAuthorizedNeonPositionRead } from "../../../services/neon-position-authorization.ts";

/** Dark E4A endpoint. The Position registry remains on Supabase. */
export async function GET(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    rejectQueryParameters(request);
    const result = await runAuthorizedNeonPositionRead(
      request,
      requestId,
      (repository, propertyId) => repository.listPositionFamilies(propertyId),
    );
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return organizationErrorResponse(error, requestId);
  }
}

function rejectQueryParameters(request: Request) {
  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    throw new OrganizationApiError(400, "职位族目录请求不接受查询参数");
  }
}
