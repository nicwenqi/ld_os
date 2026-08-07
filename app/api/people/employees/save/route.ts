import { resolveRequestId } from "../../../../lib/neon/request-id.ts";
import {
  EmployeeWriteApiError,
  employeeWriteErrorResponse,
  runAuthorizedNeonEmployeeWrite,
} from "../../../../services/neon-employee-write-authorization.ts";
import {
  EmployeeWriteInputError,
  parseSaveEmployeeWithIdentifiersInput,
} from "./input.ts";

/** Dark E5A command endpoint. Import, registry and UI remain unchanged. */
export async function POST(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    rejectQueryParameters(request);
    const body = await requestBody(request);
    const input = parseSaveEmployeeWithIdentifiersInput(body);
    const result = await runAuthorizedNeonEmployeeWrite(
      request,
      requestId,
      repository => repository.saveEmployeeWithIdentifiers(input),
    );
    return Response.json(result.data, {
      status: input.id === null ? 201 : 200,
      headers: result.headers,
    });
  } catch (error) {
    return employeeWriteErrorResponse(inputError(error), requestId);
  }
}

function rejectQueryParameters(request: Request) {
  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    throw new EmployeeWriteApiError(
      400,
      "员工保存请求不接受查询参数",
    );
  }
}

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new EmployeeWriteApiError(400, "员工保存请求格式无效");
  }
}

function inputError(error: unknown) {
  return error instanceof EmployeeWriteInputError
    ? new EmployeeWriteApiError(400, error.message)
    : error;
}
