import { resolveRequestId } from "../../../lib/neon/request-id.ts";
import {
  OrganizationApiError,
  organizationErrorResponse,
} from "../../../services/neon-organization-authorization.ts";
import { runAuthorizedNeonPositionMapping } from "../../../services/neon-position-authorization.ts";

/** Neon E4C mapping endpoint. */
export async function GET(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    rejectQueryParameters(request);
    const result = await runAuthorizedNeonPositionMapping(
      request,
      requestId,
      (repository, propertyId) => repository.listSourceLabels(propertyId),
    );
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return organizationErrorResponse(error, requestId);
  }
}

function rejectQueryParameters(request: Request) {
  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    throw new OrganizationApiError(400, "职位来源标签请求不接受查询参数");
  }
}
