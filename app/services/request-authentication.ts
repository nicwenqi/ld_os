import { parseAppEnvironment } from "../lib/environment.ts";
import { resolveRequestHostname } from "../lib/request-hostname.ts";
import { createServerPasswordClient } from "../lib/supabase/server-admin.ts";
import type { AuthSession } from "../repositories/contracts/auth-repository.ts";
import { resolveNeonAuthorizationForAuthUser, resolveSessionForAuthUser } from "./authentication-service.ts";
import type { NeonAuthorizationFacts, NeonAuthorizationRepository } from "./authentication-service.ts";
import { readCookie, readRefreshCookie } from "../api/auth/cookies.ts";

export type AuthenticatedRequest = {
  session: AuthSession;
  accessToken: string;
  refreshToken: string | null;
  refreshed: boolean;
};

export type AuthenticatedAuthorizationRequest = AuthenticatedRequest & Pick<NeonAuthorizationFacts, "tenantId">;

export type RequestAuthIdentity = Omit<AuthenticatedRequest, "session"> & { userId: string; hostname: string };

type AuthOnlyClient = Readonly<{
  auth: Readonly<{
    getUser(accessToken: string): Promise<{ data: { user: { id: string } | null } }>;
    refreshSession(input: { refresh_token: string }): Promise<{
      data: {
        user: { id: string } | null;
        session: { access_token: string; refresh_token: string } | null;
      };
      error: unknown;
    }>;
  }>;
}>;

export type SessionResolutionDependencies = Readonly<{
  authUserId: string;
  hostname: string;
  neon: NeonAuthorizationRepository;
  requestId?: string;
}>;

export type SessionResolution = (authUserId: string, hostname: string) => Promise<AuthSession>;

export function createSessionResolutionDependencies(): SessionResolution {
  return resolveSessionForAuthUser;
}

export async function resolveSessionWith(
  dependencies: SessionResolutionDependencies,
): Promise<NeonAuthorizationFacts> {
  return dependencies.neon.resolveAuthorizationForAuthUser(
    dependencies.authUserId,
    dependencies.hostname,
    dependencies.requestId ?? crypto.randomUUID(),
  );
}

export type RefreshRequestResolutionDependencies = Readonly<{
  hostname: string;
  accessToken: string | null;
  refreshToken: string | null;
  auth: AuthOnlyClient;
  neon: NeonAuthorizationRepository;
  requestId?: string;
}>;

export async function resolveRequestWithRefresh(
  dependencies: RefreshRequestResolutionDependencies,
): Promise<AuthenticatedRequest | null> {
  let accessToken = dependencies.accessToken;
  let refreshToken = dependencies.refreshToken;
  let refreshed = false;
  let user = accessToken ? (await dependencies.auth.auth.getUser(accessToken)).data.user : null;
  if (!user && refreshToken) {
    const { data, error } = await dependencies.auth.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.user || !data.session) return null;
    user = data.user;
    accessToken = data.session.access_token;
    refreshToken = data.session.refresh_token;
    refreshed = true;
  }
  if (!user || !accessToken) return null;
  const authorization = await resolveSessionWith({
    authUserId: user.id,
    hostname: dependencies.hostname,
    neon: dependencies.neon,
    requestId: dependencies.requestId,
  });
  if (!isApprovedBackendSession(authorization.session)) return null;
  return { session: authorization.session, accessToken, refreshToken, refreshed };
}

function isApprovedBackendSession(session: AuthSession) {
  return Boolean(
    session.authenticated &&
      session.propertyId &&
      (session.role === "property_ld_manager" ||
        session.role === "department_training_responsible"),
  );
}

export function canReleaseBrowserAccessToken(session: AuthSession) {
  return isApprovedBackendSession(session) && !session.mustChangePassword;
}

export async function resolveRequestAuthIdentity(request: Request): Promise<RequestAuthIdentity | null> {
  const environment = parseAppEnvironment();
  if (environment.appEnv === "local" && environment.dataMode === "mock") return null;
  const hostname = resolveRequestHostname(request, {
    appEnv: environment.appEnv,
    appBaseDomain: environment.appBaseDomain,
    localOverride: environment.appEnv === "local" ? environment.devPropertyHostname : environment.appEnv === "preview" ? environment.previewPropertyHostname : null,
  });
  if (!hostname) return null;

  const client = createServerPasswordClient();
  let accessToken = readCookie(request);
  let refreshToken = readRefreshCookie(request);
  let refreshed = false;
  let user = accessToken ? (await client.auth.getUser(accessToken)).data.user : null;

  if (!user && refreshToken) {
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.user || !data.session) return null;
    user = data.user;
    accessToken = data.session.access_token;
    refreshToken = data.session.refresh_token;
    refreshed = true;
  }
  if (!user || !accessToken) return null;

  return { userId: user.id, hostname, accessToken, refreshToken, refreshed };
}

export async function resolveAuthenticatedRequest(request: Request): Promise<AuthenticatedRequest | null> {
  return resolveBackendRequest(request, false);
}

export async function resolveAuthenticatedRequestWithAuthority(
  request: Request,
): Promise<AuthenticatedAuthorizationRequest | null> {
  return resolveBackendAuthorizationRequest(request, false);
}

export async function resolvePasswordChangeRequest(request: Request): Promise<AuthenticatedRequest | null> {
  return resolveBackendRequest(request, true);
}

async function resolveBackendRequest(
  request: Request,
  allowPasswordChangeRequired: boolean,
): Promise<AuthenticatedRequest | null> {
  const resolved = await resolveBackendAuthorizationRequest(request, allowPasswordChangeRequired);
  if (!resolved) return null;
  const { tenantId: _tenantId, ...requestWithoutAuthority } = resolved;
  return requestWithoutAuthority;
}

async function resolveBackendAuthorizationRequest(
  request: Request,
  allowPasswordChangeRequired: boolean,
): Promise<AuthenticatedAuthorizationRequest | null> {
  const identity = await resolveRequestAuthIdentity(request);
  if (!identity) return null;
  const authorization = await resolveNeonAuthorizationForAuthUser(
    identity.userId,
    identity.hostname,
    crypto.randomUUID(),
  );
  if (!isApprovedBackendSession(authorization.session)) return null;
  if (!allowPasswordChangeRequired && authorization.session.mustChangePassword) return null;
  return {
    session: authorization.session,
    tenantId: authorization.tenantId,
    accessToken: identity.accessToken,
    refreshToken: identity.refreshToken,
    refreshed: identity.refreshed,
  };
}
