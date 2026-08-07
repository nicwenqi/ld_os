import "server-only";

import { authCookies } from "../api/auth/cookies.ts";
import { withNeonResolvedActorContext } from "../lib/neon/actor-context.ts";
import { resolveNeonPeoplePropertyScope } from "../lib/neon/people-property.ts";
import { parseAppEnvironment } from "../lib/environment.ts";
import {
  createNeonEmployeeWriteRepository,
} from "../repositories/neon/employee-write-repository.ts";
import { peopleResponseHeaders } from "./neon-people-authorization.ts";
import { resolveRequestAuthIdentity } from "./request-authentication.ts";

type EmployeeWriteRepository = ReturnType<
  typeof createNeonEmployeeWriteRepository
>;
type EmployeeWriteHttpStatus = 400 | 401 | 403 | 404 | 409 | 422 | 503;

export class EmployeeWriteApiError extends Error {
  constructor(
    readonly status: EmployeeWriteHttpStatus,
    message: string,
    readonly headers?: Headers,
  ) {
    super(message);
    this.name = "EmployeeWriteApiError";
  }
}

export async function runAuthorizedNeonEmployeeWrite<T>(
  request: Request,
  requestId: string,
  operation: (
    repository: EmployeeWriteRepository,
  ) => Promise<T>,
): Promise<{ data: T; headers: Headers }> {
  const environment = parseAppEnvironment();
  if (environment.dataMode !== "neon") {
    throw new EmployeeWriteApiError(503, "Employee Neon 写入尚未启用");
  }

  const identity = await resolveRequestAuthIdentity(request);
  if (!identity) {
    throw new EmployeeWriteApiError(401, "登录状态已失效");
  }

  const headers = peopleResponseHeaders(requestId);
  if (identity.refreshed) {
    for (const value of authCookies(
      identity.accessToken,
      identity.refreshToken,
      environment.appEnv !== "local",
    )) {
      headers.append("Set-Cookie", value);
    }
  }

  try {
    let trustedScope: { tenantId: string; propertyId: string } | null = null;
    const data = await withNeonResolvedActorContext(
      { authUserId: identity.userId, requestId },
      async database => {
        const property = await resolveNeonPeoplePropertyScope(
          identity.hostname,
          database,
        );
        if (!property) {
          throw new EmployeeWriteApiError(
            403,
            "当前账号无权访问此酒店",
            headers,
          );
        }
        trustedScope = property;
        return property.propertyId;
      },
      database => {
        if (!trustedScope) {
          throw new EmployeeWriteApiError(
            403,
            "当前账号无权访问此酒店",
            headers,
          );
        }
        return operation(createNeonEmployeeWriteRepository(
          database,
          identity.hostname,
          trustedScope,
        ));
      },
    );
    return { data, headers };
  } catch (error) {
    const mapped = mapEmployeeWriteError(error);
    throw new EmployeeWriteApiError(mapped.status, mapped.message, headers);
  }
}

export function employeeWriteErrorResponse(
  error: unknown,
  requestId: string,
): Response {
  const mapped = mapEmployeeWriteError(error);
  return Response.json(
    { message: mapped.message },
    {
      status: mapped.status,
      headers: mapped.headers ?? peopleResponseHeaders(requestId),
    },
  );
}

function mapEmployeeWriteError(error: unknown): {
  status: EmployeeWriteHttpStatus;
  message: string;
  headers?: Headers;
} {
  if (error instanceof EmployeeWriteApiError) return error;

  const code = databaseErrorCode(error);
  const message = error instanceof Error ? error.message : objectMessage(error);
  if (
    code === "42501"
    && /^NEON_(?:PEOPLE|EMPLOYEE_WRITE)_(?:PROPERTY_CONTEXT_CHANGED|MANAGER_FORBIDDEN|RUNTIME_FORBIDDEN|PROPERTY_FORBIDDEN)$/.test(message)
  ) {
    return { status: 403, message: "当前账号没有员工写入权限" };
  }
  if (code === "P2000" || message === "NEON_EMPLOYEE_WRITE_NOT_FOUND") {
    return { status: 404, message: "员工记录不存在" };
  }
  if (
    code === "P2002"
    || code === "23505"
    || code === "40001"
    || code === "40P01"
  ) {
    return { status: 409, message: "员工资料或外部标识已更新，请刷新后重试" };
  }
  if (
    code === "P2006"
    || code === "23514"
    || code === "23502"
    || code === "22P02"
    || code === "22001"
  ) {
    return { status: 422, message: "员工资料不符合当前业务规则" };
  }
  return { status: 503, message: "员工写入服务暂时不可用" };
}

function databaseErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function objectMessage(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error)) return "";
  return typeof error.message === "string" ? error.message : "";
}
