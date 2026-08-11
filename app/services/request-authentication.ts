import { parseAppEnvironment } from "../lib/environment.ts";
import { resolveRequestHostname } from "../lib/request-hostname.ts";
import type { AuthSession } from "../repositories/contracts/auth-repository.ts";
import { resolveNeonAuthorizationForAuthUser, resolveSessionForAuthUser } from "./authentication-service.ts";
import type { NeonAuthorizationFacts, NeonAuthorizationRepository } from "./authentication-service.ts";

export type AuthenticatedRequest = {
  session: AuthSession;
  refreshedCookies: string[];
  refreshed: boolean;
};

export type AuthenticatedAuthorizationRequest = AuthenticatedRequest & Pick<NeonAuthorizationFacts, "tenantId">;

export type RequestAuthIdentity = Readonly<{
  userId: string;
  hostname: string;
  refreshedCookies: string[];
  refreshed: boolean;
}>;

export function appendRefreshedAuthCookies(headers: Headers, identity: Pick<RequestAuthIdentity, "refreshedCookies">) {
  for (const value of identity.refreshedCookies) headers.append("Set-Cookie", value);
}

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

function isApprovedBackendSession(session: AuthSession) {
  return Boolean(
    session.authenticated &&
      session.propertyId &&
      (session.role === "property_ld_manager" ||
        session.role === "department_training_responsible"),
  );
}

// Better Auth session cookies are opaque and HttpOnly. This name is retained
// only for UI capability checks; no bearer token is released to the browser.
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
  const identity = await (await import("./better-auth-session.ts")).resolveBetterAuthIdentity(request);
  if (!identity) return null;
  return {
    userId: identity.userId,
    hostname,
    refreshedCookies: identity.refreshedCookies,
    refreshed: identity.refreshedCookies.length > 0,
  };
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
    refreshedCookies: identity.refreshedCookies,
    refreshed: identity.refreshed,
  };
}
