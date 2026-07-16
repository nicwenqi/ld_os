import { parseAppEnvironment } from "../../../lib/environment.ts";
import { resolveRequestHostname } from "../../../lib/request-hostname.ts";
import { absolutePublicLogoUrl } from "../../../repositories/supabase/property-repository.ts";
import { createServerPasswordClient } from "../../../lib/supabase/server-admin.ts";
import { getMockPropertyContext } from "../../mock-property/store.ts";

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
  try {
    const client = createServerPasswordClient();
    const { data, error } = await client.rpc("resolve_property_context", { p_hostname: hostname });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return noStore({ configured: false });
    return noStore({
      configured: true,
      hostname: row.hostname,
      nameZh: row.name_zh,
      nameEn: row.name_en,
      shortName: row.short_name,
      logoUrl: absolutePublicLogoUrl(environment.supabaseUrl ?? "", row.logo_url),
    });
  } catch { return noStore({ configured: false }); }
}

function noStore(value: unknown) {
  return Response.json(value, { headers: { "Cache-Control": "no-store, private" } });
}
