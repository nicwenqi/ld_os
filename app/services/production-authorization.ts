import { parseAppEnvironment } from "../lib/environment.ts";
import { resolveRequestHostname } from "../lib/request-hostname.ts";
import { createServerAdminClient } from "../lib/supabase/server-admin.ts";
import { resolveAuthenticatedRequest } from "./request-authentication.ts";
import { authCookies } from "../api/auth/cookies.ts";

export type ProductionPropertyManager = { authUserId: string; tenantId: string; propertyId: string; hostname: string; refreshedCookies: string[] };

export async function requireProductionPropertyManager(request: Request): Promise<ProductionPropertyManager> {
  const environment = parseAppEnvironment();
  if (environment.appEnv !== "production" || environment.dataMode !== "supabase") throw new AuthorizationError(404, "生产导入入口不可用");
  const hostname = resolveRequestHostname(request, { appEnv: environment.appEnv, appBaseDomain: environment.appBaseDomain });
  if (!hostname) throw new AuthorizationError(403, "当前酒店域名无效");
  const resolved = await resolveAuthenticatedRequest(request);
  if (!resolved) throw new AuthorizationError(401, "登录已失效");
  const session = resolved.session;
  if (!session.authenticated || session.role !== "property_ld_manager" || !session.propertyId) throw new AuthorizationError(403, "仅酒店学习与发展经理可处理工作簿");
  const admin = createServerAdminClient();
  const { data: property, error: propertyError } = await admin.from("properties").select("tenant_id,status").eq("id", session.propertyId).maybeSingle();
  if (propertyError || !property || property.status !== "active") throw new AuthorizationError(403, "当前酒店不可用");
  return { authUserId: session.userId!, tenantId: property.tenant_id, propertyId: session.propertyId, hostname, refreshedCookies: resolved.refreshed ? authCookies(resolved.accessToken, resolved.refreshToken, true) : [] };
}

export class AuthorizationError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
