import { resolveRequestId } from "../../../lib/neon/request-id.ts";
import { propertyErrorResponse, runAuthorizedNeonPropertyWrite } from "../../../services/neon-property-authorization.ts";

export async function PATCH(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    const body = await request.json() as Record<string, unknown>;
    const result = await runAuthorizedNeonPropertyWrite(request, requestId, repository => repository.saveBusinessRules({
      propertyId: "server",
      expectedVersion: integerValue(body.expectedVersion),
      newEmployeeDays: integerValue(body.newEmployeeDays),
      probationFieldMeaning: enumValue(body.probationFieldMeaning, ["probation_end_date", "confirmation_date", "unused"] as const),
      employeeStatusSource: enumValue(body.employeeStatusSource, ["excel_import", "manual", "future_hris"] as const),
      ctcMandatory: booleanValue(body.ctcMandatory),
      gtcMandatory: booleanValue(body.gtcMandatory),
    }));
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return propertyErrorResponse(error, requestId);
  }
}

function integerValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number)) throw new Error("酒店规则数值无效");
  return number;
}
function booleanValue(value: unknown) {
  if (typeof value !== "boolean") throw new Error("酒店规则开关无效");
  return value;
}
function enumValue<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error("酒店规则选项无效");
  return value;
}
