import { parseAppEnvironment } from "../../../lib/environment.ts";
import {
  resolveRuntimeRehearsalMode,
  runtimeDomainSource,
} from "../../../lib/runtime-rehearsal-mode.ts";

/** Public configuration observation only. It cannot mutate mode or authorize data access. */
export async function GET() {
  try {
    const environment = parseAppEnvironment();
    const source = runtimeDomainSource(resolveRuntimeRehearsalMode(environment));
    return Response.json(
      {
        source,
        domains: {
          organization: source,
          people: source,
          position: source,
          property: source,
          initialization: source,
        },
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
