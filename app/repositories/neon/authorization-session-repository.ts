import "server-only";

import { withNeonResolvedActorContext } from "../../lib/neon/actor-context.ts";
import { resolveNeonPropertyScope } from "../../lib/neon/property-context.ts";
import {
  anonymousSession,
  type AuthSession,
  type AuthorizedDepartmentScope,
  type EffectiveRole,
} from "../contracts/auth-repository.ts";

export type NeonAuthorizationFacts = Readonly<{
  session: AuthSession;
  tenantId: string | null;
}>;

type AuthorizationRow = {
  authorization_session: unknown;
};

export async function resolveNeonAuthorizationForAuthUser(
  authUserId: string,
  hostname: string,
  requestId: string,
): Promise<NeonAuthorizationFacts> {
  return withNeonResolvedActorContext(
    { authUserId, requestId },
    async database => {
      const scope = await resolveNeonPropertyScope(hostname, database);
      if (!scope) throw new Error("NEON_AUTHORIZATION_PROPERTY_NOT_FOUND");
      return scope.propertyId;
    },
    async database => {
      const result = await database.query<AuthorizationRow>(
        "select public.read_neon_authorization_session($1::text) as authorization_session",
        [hostname],
      );
      return mapAuthorizationFacts(result.rows[0]?.authorization_session);
    },
  );
}

function mapAuthorizationFacts(value: unknown): NeonAuthorizationFacts {
  if (!isRecord(value) || !isRecord(value.session)) return unauthorizedFacts();
  const session = value.session;
  const departmentScopes = Array.isArray(session.departmentScopes)
    ? session.departmentScopes.map(mapDepartmentScope).filter((scope): scope is AuthorizedDepartmentScope => scope !== null)
    : [];
  const role = validRole(session.role) ? session.role : "unauthorized";
  const authenticated = session.authenticated === true
    && typeof session.userId === "string"
    && typeof session.propertyId === "string"
    && role !== "unauthorized";
  if (!authenticated) return unauthorizedFacts();
  return {
    tenantId: typeof value.tenantId === "string" ? value.tenantId : null,
    session: {
      authenticated: true,
      userId: session.userId,
      displayName: nullableString(session.displayName),
      propertyId: session.propertyId,
      propertyNameZh: nullableString(session.propertyNameZh),
      propertyNameEn: nullableString(session.propertyNameEn),
      propertyLogoUrl: nullableString(session.propertyLogoUrl),
      role,
      departmentScopes,
      mustChangePassword: session.mustChangePassword === true,
    },
  };
}

function mapDepartmentScope(value: unknown): AuthorizedDepartmentScope | null {
  if (!isRecord(value)
    || typeof value.departmentId !== "string"
    || typeof value.departmentNameZh !== "string"
    || !Array.isArray(value.breadcrumb)
    || !Array.isArray(value.breadcrumbEn)
    || typeof value.includeDescendants !== "boolean"
    || !value.breadcrumb.every(item => typeof item === "string")
    || !value.breadcrumbEn.every(item => typeof item === "string")) return null;
  const departmentNameEn = nullableString(value.departmentNameEn);
  return {
    departmentId: value.departmentId,
    departmentNameZh: value.departmentNameZh,
    departmentNameEn,
    breadcrumb: value.breadcrumb,
    breadcrumbEn: value.breadcrumbEn,
    includeDescendants: value.includeDescendants,
  };
}

function validRole(value: unknown): value is Exclude<EffectiveRole, "unauthorized"> {
  return value === "property_ld_manager" || value === "department_training_responsible";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unauthorizedFacts(): NeonAuthorizationFacts {
  return { tenantId: null, session: anonymousSession };
}
