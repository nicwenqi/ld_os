import { resolveRequestId } from "../../../../../../lib/neon/request-id.ts";
import {
  OrganizationApiError,
  organizationErrorResponse,
  runAuthorizedNeonOrganizationAliasWrite,
} from "../../../../../../services/neon-organization-authorization.ts";
import {
  AliasResolutionInputError,
  parseAliasResolutionInput,
} from "./input.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = resolveRequestId(request);
  try {
    if ([...new URL(request.url).searchParams.keys()].length > 0) {
      throw new OrganizationApiError(400, "部门来源标签处理请求不接受查询参数");
    }
    const { id } = await context.params;
    const aliasId = canonicalUuid(id, "部门来源标签标识无效");
    const input = parseAliasResolutionInput(await requestBody(request));
    const result = await runAuthorizedNeonOrganizationAliasWrite(
      request,
      requestId,
      repository => repository.approveMapping({ aliasId, ...input }),
    );
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return organizationErrorResponse(
      error instanceof AliasResolutionInputError
        ? new OrganizationApiError(400, error.message)
        : error,
      requestId,
    );
  }
}

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new OrganizationApiError(400, "部门来源标签处理请求格式无效");
  }
}

function canonicalUuid(value: unknown, message: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new OrganizationApiError(400, message);
  }
  return value.toLowerCase();
}
