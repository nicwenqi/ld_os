import { withNeonResolvedActorContext } from "../lib/neon/actor-context.ts";
import { resolveNeonPeoplePropertyScope } from "../lib/neon/people-property.ts";
import { parseAppEnvironment } from "../lib/environment.ts";
import { createNeonEmployeeReadRepository } from "../repositories/neon/employee-read-repository.ts";
import { appendRefreshedAuthCookies, resolveRequestAuthIdentity } from "./request-authentication.ts";

type NeonPeopleRepository = ReturnType<typeof createNeonEmployeeReadRepository>;

export class PeopleApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 503,
    message: string,
  ) {
    super(message);
    this.name = "PeopleApiError";
  }
}

export async function runAuthorizedNeonPeopleRead<T>(
  request: Request,
  requestId: string,
  operation: (repository: NeonPeopleRepository) => Promise<T>,
) {
  const environment = parseAppEnvironment();
  if (environment.dataMode !== "neon") {
    throw new PeopleApiError(503, "People Neon 数据源尚未启用");
  }

  const identity = await resolveRequestAuthIdentity(request);
  if (!identity) {
    throw new PeopleApiError(401, "登录状态已失效");
  }

  const data = await withNeonResolvedActorContext(
    {
      authUserId: identity.userId,
      requestId,
    },
    async database => {
      const property = await resolveNeonPeoplePropertyScope(
        identity.hostname,
        database,
      );
      if (!property) {
        throw new PeopleApiError(403, "当前账号无权访问此酒店");
      }
      return property.propertyId;
    },
    database => operation(
      createNeonEmployeeReadRepository(database, identity.hostname),
    ),
  );

  const headers = peopleResponseHeaders(requestId);
  if (identity.refreshed) appendRefreshedAuthCookies(headers, identity);

  return { data, headers };
}

export function peopleErrorResponse(error: unknown, requestId: string) {
  const mapped = mapError(error);
  return Response.json(
    { message: mapped.message },
    { status: mapped.status, headers: peopleResponseHeaders(requestId) },
  );
}

export function peopleResponseHeaders(requestId: string) {
  return new Headers({
    "Cache-Control": "no-store, private",
    "X-Request-Id": requestId,
  });
}

function mapError(error: unknown): PeopleApiError {
  if (error instanceof PeopleApiError) return error;

  const code = databaseErrorCode(error);
  const message = error instanceof Error ? error.message : "";
  if (
    code === "42501" &&
    /^NEON_PEOPLE_(?:PROPERTY_CONTEXT_CHANGED|MANAGER_FORBIDDEN|DEPARTMENT_FORBIDDEN)$/.test(
      message,
    )
  ) {
    return new PeopleApiError(403, "当前账号没有所请求的员工目录权限");
  }
  return new PeopleApiError(503, "员工目录服务暂时不可用");
}

function databaseErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}
