import { resolveRequestId } from "../../../lib/neon/request-id.ts";
import {
  OrganizationApiError,
  organizationErrorResponse,
} from "../../../services/neon-organization-authorization.ts";
import {
  runAuthorizedNeonPositionRead,
  runAuthorizedNeonPositionWrite,
} from "../../../services/neon-position-authorization.ts";
import {
  PositionInputError,
  parseSavePositionWithDepartmentsInput,
} from "./input.ts";

/** Dark E4A endpoint. The Position registry remains on Supabase. */
export async function GET(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    rejectQueryParameters(request);
    const result = await runAuthorizedNeonPositionRead(
      request,
      requestId,
      (repository, propertyId) => repository.listPositions(propertyId),
    );
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return organizationErrorResponse(error, requestId);
  }
}

/** Dark E4B atomic mutation endpoint; no standalone assignment route exists. */
export async function POST(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    rejectQueryParameters(request);
    const body = await requestBody(request);
    const result = await runAuthorizedNeonPositionWrite(
      request,
      requestId,
      (repository, scope) => repository.savePositionWithDepartments(
        parseSavePositionWithDepartmentsInput(body, scope),
      ),
    );
    return Response.json(result.data, { status: 201, headers: result.headers });
  } catch (error) {
    return organizationErrorResponse(inputError(error), requestId);
  }
}

function rejectQueryParameters(request: Request) {
  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    throw new OrganizationApiError(400, "职位目录请求不接受查询参数");
  }
}

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new OrganizationApiError(400, "职位保存请求格式无效");
  }
}

function inputError(error: unknown) {
  return error instanceof PositionInputError
    ? new OrganizationApiError(400, error.message)
    : error;
}
