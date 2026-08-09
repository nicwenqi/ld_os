import { authCookies } from "../api/auth/cookies.ts";
import { withNeonResolvedActorContext } from "../lib/neon/actor-context.ts";
import { resolveNeonPropertyScope } from "../lib/neon/property-context.ts";
import { parseAppEnvironment } from "../lib/environment.ts";
import { createNeonInitializationRepository } from "../repositories/neon/initialization-repository.ts";
import { createNeonPropertyRepository } from "../repositories/neon/property-repository.ts";
import { resolveRequestAuthIdentity } from "./request-authentication.ts";

export class PropertyApiError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 503, message: string, readonly headers?: Headers) {
    super(message);
    this.name = "PropertyApiError";
  }
}

export async function runAuthorizedNeonPropertyRead<T>(
  request: Request,
  requestId: string,
  operation: (repository: ReturnType<typeof createNeonPropertyRepository>) => Promise<T>,
) {
  return runAuthorizedNeonPropertyOperation(request, requestId, operation, false);
}

export async function runAuthorizedNeonPropertyWrite<T>(
  request: Request,
  requestId: string,
  operation: (repository: ReturnType<typeof createNeonPropertyRepository>) => Promise<T>,
) {
  return runAuthorizedNeonPropertyOperation(request, requestId, operation, true);
}

export async function runAuthorizedNeonInitialization<T>(
  request: Request,
  requestId: string,
  operation: (repository: ReturnType<typeof createNeonInitializationRepository>) => Promise<T>,
) {
  const environment = parseAppEnvironment();
  if (environment.dataMode !== "neon") throw new PropertyApiError(503, "Neon Property 数据源尚未启用");
  const identity = await resolveRequestAuthIdentity(request);
  if (!identity) throw new PropertyApiError(401, "登录状态已失效");
  const headers = responseHeaders(requestId);
  appendRefresh(headers, identity, environment.appEnv !== "local");
  try {
    let scope: { tenantId: string; propertyId: string } | null = null;
    const data = await withNeonResolvedActorContext(
      { authUserId: identity.userId, requestId },
      async database => {
        scope = await resolveNeonPropertyScope(identity.hostname, database);
        if (!scope) throw new PropertyApiError(403, "当前账号无权访问此酒店");
        return scope.propertyId;
      },
      database => {
        if (!scope) throw new PropertyApiError(403, "当前账号无权访问此酒店");
        return operation(createNeonInitializationRepository(database, identity.hostname));
      },
    );
    return { data, headers };
  } catch (error) {
    const mapped = mapPropertyError(error, headers);
    throw mapped.headers ? mapped : new PropertyApiError(mapped.status, mapped.message, headers);
  }
}

async function runAuthorizedNeonPropertyOperation<T>(
  request: Request,
  requestId: string,
  operation: (repository: ReturnType<typeof createNeonPropertyRepository>) => Promise<T>,
  write: boolean,
) {
  const environment = parseAppEnvironment();
  if (environment.dataMode !== "neon") throw new PropertyApiError(503, "Neon Property 数据源尚未启用");
  const identity = await resolveRequestAuthIdentity(request);
  if (!identity) throw new PropertyApiError(401, "登录状态已失效");
  const headers = responseHeaders(requestId);
  appendRefresh(headers, identity, environment.appEnv !== "local");
  try {
    let scope: { tenantId: string; propertyId: string } | null = null;
    const data = await withNeonResolvedActorContext(
      { authUserId: identity.userId, requestId },
      async database => {
        scope = await resolveNeonPropertyScope(identity.hostname, database);
        if (!scope) throw new PropertyApiError(403, "当前账号无权访问此酒店");
        return scope.propertyId;
      },
      database => {
        if (!scope) throw new PropertyApiError(403, "当前账号无权访问此酒店");
        return operation(createNeonPropertyRepository(database, identity.hostname));
      },
    );
    return { data, headers };
  } catch (error) {
    const mapped = mapPropertyError(error, headers, write);
    throw mapped.headers ? mapped : new PropertyApiError(mapped.status, mapped.message, headers);
  }
}

export function propertyErrorResponse(error: unknown, requestId: string) {
  const mapped = error instanceof PropertyApiError ? error : mapPropertyError(error, responseHeaders(requestId));
  return Response.json({ message: mapped.message }, { status: mapped.status, headers: mapped.headers ?? responseHeaders(requestId) });
}

export function responseHeaders(requestId: string) {
  return new Headers({ "Cache-Control": "no-store, private", "X-Request-Id": requestId });
}

function appendRefresh(headers: Headers, identity: { refreshed: boolean; accessToken: string; refreshToken: string | null }, secure: boolean) {
  if (!identity.refreshed) return;
  for (const value of authCookies(identity.accessToken, identity.refreshToken, secure)) headers.append("Set-Cookie", value);
}

function mapPropertyError(error: unknown, _headers: Headers, _write = false): PropertyApiError {
  if (error instanceof PropertyApiError) return error;
  const code = databaseErrorCode(error);
  const message = error instanceof Error ? error.message : "";
  if (code === "40001" || /VERSION_CONFLICT|STALE/.test(message)) return new PropertyApiError(409, "酒店资料已被更新，请刷新后重试");
  if (code === "42501" || /DENIED|REQUIRED|CONTEXT_CHANGED/.test(message)) return new PropertyApiError(403, "当前账号没有酒店基础配置权限");
  if (code === "40400" || /NOT_FOUND/.test(message)) return new PropertyApiError(404, "酒店资料不存在");
  if (code === "22023") return new PropertyApiError(422, "酒店基础配置内容无效");
  return new PropertyApiError(503, "酒店基础服务暂时不可用");
}

function databaseErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
}
