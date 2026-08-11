import "server-only";

import { withNeonResolvedActorContext } from "../lib/neon/actor-context.ts";
import { resolveNeonOrganizationPropertyScope } from "../lib/neon/organization-property.ts";
import { parseAppEnvironment } from "../lib/environment.ts";
import {
  createNeonDepartmentReadRepository,
  type NeonDepartmentReadRepository,
} from "../repositories/neon/department-read-repository.ts";
import {
  createNeonDepartmentWriteRepository,
  type NeonDepartmentWriteRepository,
} from "../repositories/neon/department-write-repository.ts";
import {
  createNeonDepartmentAliasRepository,
  type NeonDepartmentAliasRepository,
} from "../repositories/neon/department-alias-repository.ts";
import {
  createNeonOperationalUnitRepository,
  type NeonOperationalUnitRepository,
} from "../repositories/neon/operational-unit-repository.ts";
import {
  mapOrganizationDatabaseError,
  type OrganizationHttpStatus,
} from "./neon-organization-errors.ts";
import { appendRefreshedAuthCookies, resolveRequestAuthIdentity } from "./request-authentication.ts";

export class OrganizationApiError extends Error {
  constructor(
    readonly status: OrganizationHttpStatus,
    message: string,
    readonly headers?: Headers,
  ) {
    super(message);
    this.name = "OrganizationApiError";
  }
}

export async function runAuthorizedNeonOrganizationWrite<T>(
  request: Request,
  requestId: string,
  operation: (
    repository: NeonDepartmentWriteRepository,
    scope: { tenantId: string; propertyId: string },
  ) => Promise<T>,
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
  if (identity.refreshed) appendRefreshedAuthCookies(headers, identity);

  try {
    let scope: { tenantId: string; propertyId: string } | null = null;
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
        scope = property;
        return property.propertyId;
      },
      database => {
        if (!scope) throw new OrganizationApiError(403, "当前账号无权访问此酒店");
        return operation(
          createNeonDepartmentWriteRepository(database, identity.hostname),
          scope,
        );
      },
    );

    return { data, headers };
  } catch (error) {
    const mapped = mapError(error);
    throw new OrganizationApiError(mapped.status, mapped.message, headers);
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
  if (identity.refreshed) appendRefreshedAuthCookies(headers, identity);

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

/** Alias routes remain dark until the Organization registry is explicitly activated. */
export async function runAuthorizedNeonOrganizationAliasRead<T>(
  request: Request,
  requestId: string,
  operation: (
    repository: NeonDepartmentAliasRepository,
    propertyId: string,
  ) => Promise<T>,
): Promise<{ data: T; headers: Headers }> {
  return runAuthorizedNeonOrganizationAliasOperation(
    request,
    requestId,
    operation,
  );
}

/** The database entry point repeats manager authorization before mutation. */
export async function runAuthorizedNeonOrganizationAliasWrite<T>(
  request: Request,
  requestId: string,
  operation: (
    repository: NeonDepartmentAliasRepository,
    propertyId: string,
  ) => Promise<T>,
): Promise<{ data: T; headers: Headers }> {
  return runAuthorizedNeonOrganizationAliasOperation(
    request,
    requestId,
    operation,
  );
}

async function runAuthorizedNeonOrganizationAliasOperation<T>(
  request: Request,
  requestId: string,
  operation: (
    repository: NeonDepartmentAliasRepository,
    propertyId: string,
  ) => Promise<T>,
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
  if (identity.refreshed) appendRefreshedAuthCookies(headers, identity);

  try {
    let resolvedPropertyId: string | null = null;
    const data = await withNeonResolvedActorContext(
      { authUserId: identity.userId, requestId },
      async database => {
        const property = await resolveNeonOrganizationPropertyScope(
          identity.hostname,
          database,
        );
        if (!property) {
          throw new OrganizationApiError(403, "当前账号无权访问此酒店");
        }
        resolvedPropertyId = property.propertyId;
        return resolvedPropertyId;
      },
      database => {
        if (!resolvedPropertyId) {
          throw new OrganizationApiError(403, "当前账号无权访问此酒店");
        }
        return operation(
          createNeonDepartmentAliasRepository(database, identity.hostname),
          resolvedPropertyId,
        );
      },
    );
    return { data, headers };
  } catch (error) {
    const mapped = mapError(error);
    throw new OrganizationApiError(mapped.status, mapped.message, headers);
  }
}

type OrganizationPropertyScope = { tenantId: string; propertyId: string };

export async function runAuthorizedNeonOrganizationOperationalUnitRead<T>(request: Request, requestId: string, operation: (repository: NeonOperationalUnitRepository, propertyId: string) => Promise<T>) {
  return runAuthorizedNeonOrganizationOperationalUnitOperation(
    request,
    requestId,
    (repository, scope) => operation(repository, scope.propertyId),
  );
}

export async function runAuthorizedNeonOrganizationOperationalUnitWrite<T>(request: Request, requestId: string, operation: (repository: NeonOperationalUnitRepository, scope: OrganizationPropertyScope) => Promise<T>) {
  return runAuthorizedNeonOrganizationOperationalUnitOperation(request, requestId, operation);
}

async function runAuthorizedNeonOrganizationOperationalUnitOperation<T>(request: Request, requestId: string, operation: (repository: NeonOperationalUnitRepository, scope: OrganizationPropertyScope) => Promise<T>) {
  const environment = parseAppEnvironment();
  if (environment.dataMode !== "neon") throw new OrganizationApiError(503, "Organization Neon 数据源尚未启用");
  const identity = await resolveRequestAuthIdentity(request);
  if (!identity) throw new OrganizationApiError(401, "登录状态已失效");
  const headers = organizationResponseHeaders(requestId);
  if (identity.refreshed) appendRefreshedAuthCookies(headers, identity);
  try {
    let scope: OrganizationPropertyScope | null = null;
    const data = await withNeonResolvedActorContext({ authUserId: identity.userId, requestId }, async database => {
      const property = await resolveNeonOrganizationPropertyScope(identity.hostname, database);
      if (!property) throw new OrganizationApiError(403, "当前账号无权访问此酒店");
      scope = property;
      return property.propertyId;
    }, database => {
      if (!scope) throw new OrganizationApiError(403, "当前账号无权访问此酒店");
      return operation(createNeonOperationalUnitRepository(database, identity.hostname), scope);
    });
    return { data, headers };
  } catch (error) {
    const mapped = mapError(error); throw new OrganizationApiError(mapped.status, mapped.message, headers);
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
  const mapped = mapOrganizationDatabaseError(error);
  return new OrganizationApiError(mapped.status, mapped.message);
}
