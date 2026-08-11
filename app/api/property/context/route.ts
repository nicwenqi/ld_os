import { parseAppEnvironment } from "../../../lib/environment.ts";
import { resolveRequestHostname } from "../../../lib/request-hostname.ts";
import { getMockPropertyContext } from "../../mock-property/store.ts";
import { resolveNeonPublicPropertyContext } from "../../../lib/neon/property-context.ts";

export async function GET(request: Request) {
  const environment = parseAppEnvironment();
  const hostname = resolveRequestHostname(request, {
    appEnv: environment.appEnv,
    appBaseDomain: environment.appBaseDomain,
    localOverride: environment.appEnv === "local" ? environment.devPropertyHostname : environment.appEnv === "preview" ? environment.previewPropertyHostname : null,
  });
  if (!hostname) return noStore({ configured: false });
  if (environment.appEnv === "local" && environment.dataMode === "mock") {
    const context = getMockPropertyContext(hostname);
    return context
      ? noStore({
          configured: true,
          hostname: context.hostname,
          nameZh: context.nameZh,
          nameEn: context.nameEn,
          shortName: context.shortName,
          logoUrl: context.logoUrl,
        })
      : noStore({ configured: false });
  }
  if (environment.dataMode === "neon") {
    try {
      const context = await resolveNeonPublicPropertyContext(hostname);
      return context
        ? noStore({
            configured: true,
            tenantId: context.tenant_id,
            propertyId: context.property_id,
            hostname: context.hostname,
            nameZh: context.name_zh,
            nameEn: context.name_en ?? context.name_zh,
            shortName: context.short_name ?? context.name_zh,
            logoUrl: null,
          })
        : noStore({ configured: false });
    } catch {
      return noStore({ configured: false });
    }
  }
  return noStore({ configured: false });
}

function noStore(value: unknown) {
  return Response.json(value, { headers: { "Cache-Control": "no-store, private" } });
}
