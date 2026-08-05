import { resolveRequestId } from "../../../../lib/neon/request-id.ts";
import {
  PeopleApiError,
  peopleErrorResponse,
  runAuthorizedNeonPeopleRead,
} from "../../../../services/neon-people-authorization.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = resolveRequestId(request);
  try {
    if ([...new URL(request.url).searchParams.keys()].length > 0) {
      throw new PeopleApiError(400, "员工详情请求不接受查询参数");
    }
    const { id } = await context.params;
    if (!UUID_PATTERN.test(id)) {
      throw new PeopleApiError(400, "员工记录标识无效");
    }
    const result = await runAuthorizedNeonPeopleRead(
      request,
      requestId,
      repository => repository.getManagerEmployee(id.toLowerCase()),
    );
    if (!result.data) {
      throw new PeopleApiError(404, "员工记录不存在");
    }
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return peopleErrorResponse(error, requestId);
  }
}
