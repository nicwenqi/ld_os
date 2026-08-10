import { parseAppEnvironment } from "../lib/environment.ts";
import { resolveRequestHostname } from "../lib/request-hostname.ts";
import type { AppDataMode, AppEnvironmentName } from "../lib/environment.ts";
import type { AuthenticatedAuthorizationRequest } from "./request-authentication.ts";
import { resolveAuthenticatedRequestWithAuthority } from "./request-authentication.ts";
import { authCookies } from "../api/auth/cookies.ts";

export type PropertyManagerActor = {
  authUserId: string;
  tenantId: string;
  propertyId: string;
  hostname: string;
  accessToken: string;
  refreshedCookies: string[];
};

export type PropertyManagerAuthorizationRequest = Readonly<{
  hostname: string | null;
  environment: Readonly<{ appEnv: AppEnvironmentName; dataMode: AppDataMode }>;
  resolved: AuthenticatedAuthorizationRequest | null;
}>;

export async function requirePropertyManager(request: Request): Promise<PropertyManagerActor> {
  const environment = parseAppEnvironment();
  const hostname = resolveRequestHostname(request, {
    appEnv: environment.appEnv,
    appBaseDomain: environment.appBaseDomain,
    localOverride:
      environment.appEnv === "local"
        ? environment.devPropertyHostname
        : environment.appEnv === "preview"
          ? environment.previewPropertyHostname
          : null,
  });
  const resolved = await resolveAuthenticatedRequestWithAuthority(request);
  return requirePropertyManagerWith({ hostname, environment, resolved });
}

export async function requirePropertyManagerWith(
  input: PropertyManagerAuthorizationRequest,
): Promise<PropertyManagerActor> {
  if (input.environment.dataMode === "mock") throw new AuthorizationError(404, "真实账号管理入口不可用");
  if (!input.hostname) throw new AuthorizationError(403, "当前酒店域名无效");
  const resolved = input.resolved;
  if (!resolved) throw new AuthorizationError(401, "登录已失效");
  const session = resolved.session;
  if (!session.authenticated || session.role !== "property_ld_manager" || !session.userId || !session.propertyId || !resolved.tenantId) {
    throw new AuthorizationError(403, "仅酒店学习与发展经理可管理酒店后台设置");
  }
  return {
    authUserId: session.userId,
    tenantId: resolved.tenantId,
    propertyId: session.propertyId,
    hostname: input.hostname,
    accessToken: resolved.accessToken,
    refreshedCookies: resolved.refreshed
      ? authCookies(
          resolved.accessToken,
          resolved.refreshToken,
          environment.appEnv !== "local",
        )
      : [],
  };
}

export async function requireProductionPropertyManager(
  request: Request,
): Promise<PropertyManagerActor> {
  const environment = parseAppEnvironment();
  if (environment.appEnv !== "production" || environment.dataMode !== "supabase") {
    throw new AuthorizationError(404, "生产导入入口不可用");
  }
  return requirePropertyManager(request);
}

export class AuthorizationError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
