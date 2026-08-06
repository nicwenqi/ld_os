import type { AppEnvironment } from "./environment.ts";

export type RuntimeRehearsalMode = "disabled" | "enabled";
export type RuntimeDomainSource = "neon" | "supabase";

export function resolveRuntimeRehearsalMode(
  environment: Pick<AppEnvironment, "appEnv" | "dataMode">,
  input: {
    APP_RUNTIME_REHEARSAL?: string;
    APP_DATA_MODE?: string;
    VERCEL_ENV?: string;
  } = runtimeInput(),
): RuntimeRehearsalMode {
  const requested = input.APP_RUNTIME_REHEARSAL?.trim() || "disabled";
  if (requested !== "disabled" && requested !== "enabled") {
    throw new Error("APP_RUNTIME_REHEARSAL must be disabled or enabled");
  }
  if (requested === "disabled") return "disabled";
  if (environment.dataMode !== "neon" || input.APP_DATA_MODE === "supabase") {
    throw new Error("Neon runtime rehearsal requires APP_DATA_MODE=neon");
  }
  if (environment.appEnv === "production" || input.VERCEL_ENV === "production") {
    throw new Error("Neon runtime rehearsal is denied in production");
  }
  return "enabled";
}

export function runtimeDomainSource(
  mode: RuntimeRehearsalMode,
): RuntimeDomainSource {
  return mode === "enabled" ? "neon" : "supabase";
}

function runtimeInput() {
  return {
    APP_RUNTIME_REHEARSAL: process.env.APP_RUNTIME_REHEARSAL,
    APP_DATA_MODE: process.env.APP_DATA_MODE,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
}
