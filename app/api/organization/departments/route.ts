import { resolveRequestId } from "../../../lib/neon/request-id.ts";
import {
  OrganizationApiError,
  organizationErrorResponse,
  runAuthorizedNeonOrganizationRead,
} from "../../../services/neon-organization-authorization.ts";

export async function GET(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    rejectQueryParameters(request);
    const result = await runAuthorizedNeonOrganizationRead(
      request,
      requestId,
      repository => repository.listTree(),
    );
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return organizationErrorResponse(error, requestId);
  }
}

function rejectQueryParameters(request: Request) {
  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    throw new OrganizationApiError(400, "部门架构请求不接受查询参数");
  }
}
