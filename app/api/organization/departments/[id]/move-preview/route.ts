import { resolveRequestId } from "../../../../../lib/neon/request-id.ts";
import {
  OrganizationApiError,
  organizationErrorResponse,
  runAuthorizedNeonOrganizationWrite,
} from "../../../../../services/neon-organization-authorization.ts";
import {
  DepartmentInputError,
  parseMovePreviewDepartmentInput,
} from "../../input.ts";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = resolveRequestId(request);
  try {
    rejectQueryParameters(request);
    const { id } = await context.params;
    const input = parseMovePreviewDepartmentInput(
      id,
      await requestBody(request),
    );
    const result = await runAuthorizedNeonOrganizationWrite(
      request,
      requestId,
      repository => repository.previewMove(input.id, input.newParentId),
    );
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return organizationErrorResponse(inputError(error), requestId);
  }
}

function rejectQueryParameters(request: Request) {
  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    throw new OrganizationApiError(400, "部门移动预览请求不接受查询参数");
  }
}

async function requestBody(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new OrganizationApiError(400, "部门移动预览请求格式无效");
  }
}

function inputError(error: unknown) {
  return error instanceof DepartmentInputError
    ? new OrganizationApiError(400, error.message)
    : error;
}
