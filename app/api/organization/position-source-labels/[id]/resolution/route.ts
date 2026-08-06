import { resolveRequestId } from "../../../../../lib/neon/request-id.ts";
import {
  OrganizationApiError,
  organizationErrorResponse,
} from "../../../../../services/neon-organization-authorization.ts";
import { runAuthorizedNeonPositionMapping } from "../../../../../services/neon-position-authorization.ts";
import { PositionMappingInputError, parsePositionMappingInput } from "./input.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = resolveRequestId(request);
  try {
    if ([...new URL(request.url).searchParams.keys()].length > 0) {
      throw new OrganizationApiError(400, "职位来源标签处理请求不接受查询参数");
    }
    const { id } = await context.params;
    const input = parsePositionMappingInput(await body(request));
    const result = await runAuthorizedNeonPositionMapping(
      request,
      requestId,
      repository => repository.approvePositionMapping({ sourceLabelId: canonicalId(id), ...input }),
    );
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return organizationErrorResponse(
      error instanceof PositionMappingInputError ? new OrganizationApiError(400, error.message) : error,
      requestId,
    );
  }
}

async function body(request: Request): Promise<unknown> {
  try { return await request.json(); }
  catch { throw new OrganizationApiError(400, "职位来源标签处理请求格式无效"); }
}
function canonicalId(value: string) { if (!UUID.test(value)) throw new OrganizationApiError(400, "职位来源标签标识无效"); return value.toLowerCase(); }
