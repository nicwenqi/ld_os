import "server-only";

import { authCookies } from "../api/auth/cookies.ts";
import { withNeonResolvedActorContext } from "../lib/neon/actor-context.ts";
import { resolveNeonOrganizationPropertyScope } from "../lib/neon/organization-property.ts";
import { parseAppEnvironment } from "../lib/environment.ts";
import {
  createNeonDepartmentReadRepository,
  type NeonDepartmentReadRepository,
} from "../repositories/neon/department-read-repository.ts";
import { resolveRequestAuthIdentity } from "./request-authentication.ts";

export class OrganizationApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 503,
    message: string,
    readonly headers?: Headers,
  ) {
    super(message);
    this.name = "OrganizationApiError";
  }
}

export async function runAuthorizedNeonOrganizationRead<T>(
  request: Request,
  requestId: string,
  operation: (repository: NeonDepartmentReadRepository) => Promise<T>,
): Promise<{ data: T; headers: Headers }> {
  const environment = parseAppEnvironment();
  if (environment.dataMode !== "neon") {
    throw new OrganizationApiError(503, "Organization Neon 数据源尚未启用");
  }

  const identity = await resolveRequestAuthIdentity(request);
  if (!identity) {
    throw new OrganizationApiError(401, "登录状态已失效");
  }

  const headers = organizationResponseHeaders(requestId);
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
    const data = await withNeonResolvedActorContext(
      {
        authUserId: identity.userId,
        requestId,
      },
      async database => {
        const property = await resolveNeonOrganizationPropertyScope(
          identity.hostname,
          database,
        );
        if (!property) {
          throw new OrganizationApiError(403, "当前账号无权访问此酒店");
        }
        return property.propertyId;
      },
      database => operation(
        createNeonDepartmentReadRepository(database, identity.hostname),
      ),
    );

    return { data, headers };
  } catch (error) {
    const mapped = mapError(error);
    throw new OrganizationApiError(mapped.status, mapped.message, headers);
  }
}

export function organizationErrorResponse(error: unknown, requestId: string) {
  const mapped = mapError(error);
  const headers = mapped.headers
    ? new Headers(mapped.headers)
    : organizationResponseHeaders(requestId);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Request-Id", requestId);
  return Response.json(
    { message: mapped.message },
    { status: mapped.status, headers },
  );
}

export function organizationResponseHeaders(requestId: string) {
  return new Headers({
    "Cache-Control": "private, no-store",
    "X-Request-Id": requestId,
  });
}

function mapError(error: unknown): OrganizationApiError {
  if (error instanceof OrganizationApiError) return error;

  const code = databaseErrorCode(error);
  const message = error instanceof Error ? error.message : "";
  if (
    code === "42501" &&
    /^NEON_ORGANIZATION_(?:PROPERTY_CONTEXT_CHANGED|READER_FORBIDDEN)$/.test(
      message,
    )
  ) {
    return new OrganizationApiError(
      403,
      "当前账号没有所请求的组织架构权限",
    );
  }
  return new OrganizationApiError(503, "组织架构服务暂时不可用");
}

function databaseErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}
