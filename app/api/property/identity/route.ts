import { resolveRequestId } from "../../../lib/neon/request-id.ts";
import { propertyErrorResponse, runAuthorizedNeonPropertyWrite } from "../../../services/neon-property-authorization.ts";

export async function PATCH(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    const body = await request.json() as Record<string, unknown>;
    const result = await runAuthorizedNeonPropertyWrite(request, requestId, repository => repository.saveIdentity({
      propertyId: "server",
      expectedUpdatedAt: stringValue(body.expectedUpdatedAt),
      code: stringValue(body.code), nameZh: stringValue(body.nameZh), nameEn: stringValue(body.nameEn),
      shortName: stringValue(body.shortName), brand: stringValue(body.brand), city: stringValue(body.city),
      countryRegion: stringValue(body.countryRegion), timezone: stringValue(body.timezone),
      defaultLanguage: stringValue(body.defaultLanguage),
    }));
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return propertyErrorResponse(error, requestId);
  }
}

function stringValue(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("酒店资料字段无效");
  return value;
}
