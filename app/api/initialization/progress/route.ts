import { resolveRequestId } from "../../../lib/neon/request-id.ts";
import { propertyErrorResponse, runAuthorizedNeonInitialization } from "../../../services/neon-property-authorization.ts";

export async function GET(request: Request) {
  return handle(request, "get");
}

export async function PATCH(request: Request) {
  return handle(request, "patch");
}

async function handle(request: Request, mode: "get" | "patch") {
  const requestId = resolveRequestId(request);
  try {
    if (mode === "get") {
      const result = await runAuthorizedNeonInitialization(request, requestId, repository => repository.getProgress("server"));
      return Response.json(result.data, { headers: result.headers });
    }
    const body = await request.json() as Record<string, unknown>;
    const action = body.action;
    const result = await runAuthorizedNeonInitialization(request, requestId, repository => {
      if (action === "navigation") {
        return repository.saveNavigation("server", integer(body.lastActiveStep), integer(body.expectedVersion));
      }
      if (action === "step") {
        return repository.saveStep({
          propertyId: "server",
          stepKey: stringValue(body.stepKey) as never,
          lastActiveStep: integer(body.lastActiveStep),
          explicitlyConfirmed: body.explicitlyConfirmed === true,
          warning: nullableString(body.warning),
          blockingReason: nullableString(body.blockingReason),
          expectedVersion: integer(body.expectedVersion),
        });
      }
      throw new Error("初始化操作无效");
    });
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return propertyErrorResponse(error, requestId);
  }
}

function integer(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number)) throw new Error("初始化版本或步骤无效");
  return number;
}
function stringValue(value: unknown) { if (typeof value !== "string" || !value.trim()) throw new Error("初始化字段无效"); return value; }
function nullableString(value: unknown) { return value == null ? null : stringValue(value); }
