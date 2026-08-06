import { resolveRequestId } from "../../../../../lib/neon/request-id.ts";
import {
  OrganizationApiError,
  organizationErrorResponse,
} from "../../../../../services/neon-organization-authorization.ts";
import { runAuthorizedNeonPositionMapping } from "../../../../../services/neon-position-authorization.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = resolveRequestId(request);
  try {
    if ([...new URL(request.url).searchParams.keys()].length > 0) {
      throw new OrganizationApiError(400, "职位来源影响请求不接受查询参数");
    }
    const { id } = await context.params;
    const result = await runAuthorizedNeonPositionMapping(
      request,
      requestId,
      repository => repository.previewSourceImpact(canonicalId(id)),
    );
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return organizationErrorResponse(error, requestId);
  }
}

function canonicalId(value: string) {
  if (!UUID.test(value)) throw new OrganizationApiError(400, "职位来源标签标识无效");
  return value.toLowerCase();
}
