import { resolveRequestId } from "../../../lib/neon/request-id.ts";
import {
  OrganizationApiError,
  organizationErrorResponse,
  runAuthorizedNeonOrganizationRead,
  runAuthorizedNeonOrganizationWrite,
} from "../../../services/neon-organization-authorization.ts";
import {
  DepartmentInputError,
  parseCreateDepartmentInput,
} from "./input.ts";

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

export async function POST(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    rejectQueryParameters(request);
    const input = parseCreateDepartmentInput(await requestBody(request));
    const result = await runAuthorizedNeonOrganizationWrite(
      request,
      requestId,
      repository => repository.createNode(input),
    );
    return Response.json(result.data, {
      status: 201,
      headers: result.headers,
    });
  } catch (error) {
    return organizationErrorResponse(inputError(error), requestId);
  }
}

function rejectQueryParameters(request: Request) {
  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    throw new OrganizationApiError(400, "部门架构请求不接受查询参数");
  }
}

async function requestBody(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new OrganizationApiError(400, "部门创建请求格式无效");
  }
}

function inputError(error: unknown) {
  return error instanceof DepartmentInputError
    ? new OrganizationApiError(400, error.message)
    : error;
}
