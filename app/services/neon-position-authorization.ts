import "server-only";

import { authCookies } from "../api/auth/cookies.ts";
import { withNeonResolvedActorContext } from "../lib/neon/actor-context.ts";
import { resolveNeonOrganizationPropertyScope } from "../lib/neon/organization-property.ts";
import { parseAppEnvironment } from "../lib/environment.ts";
import {
  createNeonPositionReadRepository,
  type NeonPositionReadRepository,
} from "../repositories/neon/position-read-repository.ts";
import {
  OrganizationApiError,
  organizationResponseHeaders,
} from "./neon-organization-authorization.ts";
import { mapOrganizationDatabaseError } from "./neon-organization-errors.ts";
import { resolveRequestAuthIdentity } from "./request-authentication.ts";

/** E4A dark read boundary; it is not wired into the Position registry. */
export async function runAuthorizedNeonPositionRead<T>(
  request: Request,
  requestId: string,
  operation: (repository: NeonPositionReadRepository, propertyId: string) => Promise<T>,
): Promise<{ data: T; headers: Headers }> {
  const environment = parseAppEnvironment();
  if (environment.dataMode !== "neon") {
    throw new OrganizationApiError(503, "Position Neon 数据源尚未启用");
  }

  const identity = await resolveRequestAuthIdentity(request);
  if (!identity) throw new OrganizationApiError(401, "登录状态已失效");

  const headers = organizationResponseHeaders(requestId);
  if (identity.refreshed) {
    for (const value of authCookies(
      identity.accessToken,
      identity.refreshToken,
      environment.appEnv !== "local",
    )) headers.append("Set-Cookie", value);
  }

  try {
    let propertyId: string | null = null;
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
        propertyId = property.propertyId;
        return property.propertyId;
      },
      database => {
        if (!propertyId) {
          throw new OrganizationApiError(403, "当前账号无权访问此酒店");
        }
        return operation(
          createNeonPositionReadRepository(database, identity.hostname),
          propertyId,
        );
      },
    );
    return { data, headers };
  } catch (error) {
    const mapped = mapOrganizationDatabaseError(error);
    throw new OrganizationApiError(mapped.status, mapped.message, headers);
  }
}
