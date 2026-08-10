import { parseAppEnvironment } from "../lib/environment.ts";
import { resolveRequestHostname } from "../lib/request-hostname.ts";
import { createServerPasswordClient } from "../lib/supabase/server-admin.ts";
import type { AuthSession } from "../repositories/contracts/auth-repository.ts";
import { resolveSessionForAuthUser } from "./authentication-service.ts";
import type { NeonAuthorizationRepository } from "./authentication-service.ts";
import { readCookie, readRefreshCookie } from "../api/auth/cookies.ts";

export type AuthenticatedRequest = {
  session: AuthSession;
  accessToken: string;
  refreshToken: string | null;
  refreshed: boolean;
};

export type RequestAuthIdentity = Omit<AuthenticatedRequest, "session"> & { userId: string; hostname: string };

type AuthOnlyClient = Readonly<{
  auth: Readonly<{
    getUser(accessToken: string): Promise<{ data: { user: { id: string } | null } }>;
  }>;
}>;

export type SessionResolutionDependencies = Readonly<{
  hostname: string;
  auth: AuthOnlyClient;
  neon: NeonAuthorizationRepository;
}>;

export type SessionResolution = (authUserId: string, hostname: string) => Promise<AuthSession>;

export function createSessionResolutionDependencies(): SessionResolution {
  return resolveSessionForAuthUser;
}

export async function resolveSessionWith(
  _dependencies: SessionResolutionDependencies,
): Promise<AuthSession> {
  throw new Error("NEON_SESSION_AUTHORIZATION_NOT_IMPLEMENTED");
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

export async function resolvePasswordChangeRequest(request: Request): Promise<AuthenticatedRequest | null> {
  return resolveBackendRequest(request, true);
}

async function resolveBackendRequest(
  request: Request,
  allowPasswordChangeRequired: boolean,
): Promise<AuthenticatedRequest | null> {
  const identity = await resolveRequestAuthIdentity(request);
  if (!identity) return null;
  const session = await resolveSessionForAuthUser(identity.userId, identity.hostname);
  if (!isApprovedBackendSession(session)) return null;
  if (!allowPasswordChangeRequired && session.mustChangePassword) return null;
  return { session, accessToken: identity.accessToken, refreshToken: identity.refreshToken, refreshed: identity.refreshed };
}
