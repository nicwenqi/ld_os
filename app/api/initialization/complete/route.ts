import { resolveRequestId } from "../../../lib/neon/request-id.ts";
import { propertyErrorResponse, runAuthorizedNeonInitialization } from "../../../services/neon-property-authorization.ts";

export async function POST(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    const body = await request.json() as { expectedVersion?: unknown };
    const expectedVersion = typeof body.expectedVersion === "number" ? body.expectedVersion : Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion)) throw new Error("初始化版本无效");
    const result = await runAuthorizedNeonInitialization(request, requestId, repository => repository.complete("server", expectedVersion));
    return Response.json({ ok: true }, { headers: result.headers });
  } catch (error) {
    return propertyErrorResponse(error, requestId);
  }
}
