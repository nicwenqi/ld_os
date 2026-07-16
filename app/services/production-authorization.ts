import { parseAppEnvironment } from "../lib/environment.ts";
import { resolveRequestHostname } from "../lib/request-hostname.ts";
import { createServerActorClient } from "../lib/supabase/server-admin.ts";
import { resolveAuthenticatedRequest } from "./request-authentication.ts";
import { authCookies } from "../api/auth/cookies.ts";

export type PropertyManagerActor = {
  authUserId: string;
  tenantId: string;
  propertyId: string;
  hostname: string;
  accessToken: string;
  refreshedCookies: string[];
};

export async function requirePropertyManager(request: Request): Promise<PropertyManagerActor> {
  const environment = parseAppEnvironment();
  if (environment.dataMode === "mock") {
    throw new AuthorizationError(404, "真实账号管理入口不可用");
  }
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
  if (!hostname) throw new AuthorizationError(403, "当前酒店域名无效");
  const resolved = await resolveAuthenticatedRequest(request);
  if (!resolved) throw new AuthorizationError(401, "登录已失效");
  const session = resolved.session;
  if (!session.authenticated || session.role !== "property_ld_manager" || !session.propertyId) throw new AuthorizationError(403, "仅酒店学习与发展经理可管理酒店后台设置");
  const actorClient = createServerActorClient(resolved.accessToken);
  const { data: property, error: propertyError } = await actorClient
    .from("properties")
    .select("tenant_id,status")
    .eq("id", session.propertyId)
    .maybeSingle();
  if (propertyError || !property || property.status !== "active") throw new AuthorizationError(403, "当前酒店不可用");
  return {
    authUserId: session.userId!,
    tenantId: property.tenant_id,
    propertyId: session.propertyId,
    hostname,
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
