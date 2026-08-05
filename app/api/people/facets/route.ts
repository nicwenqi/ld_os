import { resolveRequestId } from "../../../lib/neon/request-id.ts";
import {
  PeopleApiError,
  peopleErrorResponse,
  runAuthorizedNeonPeopleRead,
} from "../../../services/neon-people-authorization.ts";

export async function GET(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].length > 0) {
      throw new PeopleApiError(400, "筛选选项请求不接受参数");
    }
    const result = await runAuthorizedNeonPeopleRead(
      request,
      requestId,
      repository => repository.listManagerFacets(),
    );
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return peopleErrorResponse(error, requestId);
  }
}
