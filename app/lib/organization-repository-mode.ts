import type { AppEnvironment } from "./environment.ts";

export type OrganizationRepositoryMode = "supabase" | "neon";

export function resolveOrganizationRepositoryMode(
  environment: Pick<AppEnvironment, "appEnv" | "dataMode">,
  requestedMode: string | undefined,
  vercelEnvironment: string | undefined,
): OrganizationRepositoryMode {
  const mode = requestedMode?.trim() || "supabase";
  if (mode !== "supabase" && mode !== "neon") {
    throw new Error("APP_ORGANIZATION_REPOSITORY must be supabase or neon");
  }
  if (mode === "supabase") return mode;
  if (environment.dataMode !== "neon") {
    throw new Error("Neon Organization rehearsal requires APP_DATA_MODE=neon");
  }
  if (environment.appEnv === "production" || vercelEnvironment === "production") {
    throw new Error("Neon Organization rehearsal is denied in production");
  }
  return mode;
}
