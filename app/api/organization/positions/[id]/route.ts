import { resolveRequestId } from "../../../../lib/neon/request-id.ts";
import {
  OrganizationApiError,
  organizationErrorResponse,
} from "../../../../services/neon-organization-authorization.ts";
import { runAuthorizedNeonPositionWrite } from "../../../../services/neon-position-authorization.ts";
import {
  PositionInputError,
  parseSavePositionWithDepartmentsInput,
} from "../input.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = resolveRequestId(request);
  try {
    rejectQueryParameters(request);
    const { id } = await context.params;
    const body = await requestBody(request);
    const result = await runAuthorizedNeonPositionWrite(
      request,
      requestId,
      (repository, scope) => repository.savePositionWithDepartments(
        parseSavePositionWithDepartmentsInput(body, scope, canonicalId(id)),
      ),
    );
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return organizationErrorResponse(inputError(error), requestId);
  }
}

function canonicalId(value: string) {
  if (!UUID.test(value)) throw new OrganizationApiError(400, "职位标识无效");
  return value.toLowerCase();
}

function rejectQueryParameters(request: Request) {
  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    throw new OrganizationApiError(400, "职位保存请求不接受查询参数");
  }
}

async function requestBody(request: Request): Promise<unknown> {
  try { return await request.json(); }
  catch { throw new OrganizationApiError(400, "职位保存请求格式无效"); }
}

function inputError(error: unknown) {
  return error instanceof PositionInputError
    ? new OrganizationApiError(400, error.message)
    : error;
}
