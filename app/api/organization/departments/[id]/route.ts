import { resolveRequestId } from "../../../../lib/neon/request-id.ts";
import {
  OrganizationApiError,
  organizationErrorResponse,
  runAuthorizedNeonOrganizationRead,
} from "../../../../services/neon-organization-authorization.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = resolveRequestId(request);
  try {
    rejectQueryParameters(request);
    const id = await canonicalDepartmentId(context);
    const result = await runAuthorizedNeonOrganizationRead(
      request,
      requestId,
      async repository => {
        const node = await repository.getNode(id);
        if (!node) {
          throw new OrganizationApiError(404, "部门不存在");
        }
        return node;
      },
    );
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return organizationErrorResponse(error, requestId);
  }
}

async function canonicalDepartmentId(
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    throw new OrganizationApiError(400, "部门记录标识无效");
  }
  return id.toLowerCase();
}

function rejectQueryParameters(request: Request) {
  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    throw new OrganizationApiError(400, "部门详情请求不接受查询参数");
  }
}
