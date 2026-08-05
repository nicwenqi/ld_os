import { resolveRequestId } from "../../../../lib/neon/request-id.ts";
import {
  OrganizationApiError,
  organizationErrorResponse,
  runAuthorizedNeonOrganizationAliasRead,
} from "../../../../services/neon-organization-authorization.ts";

export async function GET(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    if ([...new URL(request.url).searchParams.keys()].length > 0) {
      throw new OrganizationApiError(400, "部门来源标签请求不接受查询参数");
    }
    const result = await runAuthorizedNeonOrganizationAliasRead(
      request,
      requestId,
      (repository, propertyId) => repository.listAliases(propertyId),
    );
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return organizationErrorResponse(error, requestId);
  }
}
