import { parseAppEnvironment } from "../../../lib/environment.ts";
import {
  resolveRuntimeDomainSelection,
} from "../../../lib/runtime-rehearsal-mode.ts";

/** Public configuration observation only. It cannot mutate mode or authorize data access. */
export async function GET() {
  try {
    const environment = parseAppEnvironment();
    const selection = resolveRuntimeDomainSelection(environment);
    return Response.json(
      {
        source: selection.source,
        domains: selection.domains,
      },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch {
    return Response.json(
      { message: "运行时 rehearsal 配置不可用" },
      { status: 503, headers: { "Cache-Control": "no-store, private" } },
    );
  }
}
