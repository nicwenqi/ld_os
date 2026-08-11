import type { AppEnvironment } from "./environment.ts";

export type RuntimeRehearsalMode = "disabled" | "enabled";
export type RuntimeDomainSource = "mock" | "neon";
export type RuntimeBusinessDomain =
  | "organization"
  | "people"
  | "position"
  | "employee"
  | "import"
  | "property"
  | "initialization";

export type RuntimeDomainSelection = {
  source: RuntimeDomainSource;
  domains: Record<RuntimeBusinessDomain, RuntimeDomainSource>;
};

const runtimeDomains: readonly RuntimeBusinessDomain[] = [
  "organization",
  "people",
  "position",
  "employee",
  "import",
  "property",
  "initialization",
];

export function resolveRuntimeRehearsalMode(
  environment: Pick<AppEnvironment, "appEnv" | "dataMode">,
  input: {
    APP_RUNTIME_REHEARSAL?: string;
    APP_DATA_MODE?: string;
    VERCEL_ENV?: string;
  } = runtimeInput(),
): RuntimeRehearsalMode {
  return resolveRuntimeDomainSelection(environment, input).source === "neon"
    ? "enabled"
    : "disabled";
}

export function runtimeDomainSource(
  mode: RuntimeRehearsalMode,
): RuntimeDomainSource {
  return mode === "enabled" ? "neon" : "mock";
}

export function resolveRuntimeDomainSelection(
  environment: Pick<AppEnvironment, "appEnv" | "dataMode">,
  input: {
    APP_RUNTIME_REHEARSAL?: string;
    APP_DATA_MODE?: string;
    VERCEL_ENV?: string;
  } = runtimeInput(),
): RuntimeDomainSelection {
  const requested = input.APP_RUNTIME_REHEARSAL?.trim() || "disabled";
  if (requested !== "disabled" && requested !== "enabled") {
    throw new Error("APP_RUNTIME_REHEARSAL must be disabled or enabled");
  }
  if (environment.dataMode === "neon") {
    if (requested !== "enabled") {
      throw new Error("Neon runtime requires APP_RUNTIME_REHEARSAL=enabled");
    }
    if (environment.appEnv === "production" || input.VERCEL_ENV === "production") {
      throw new Error("Neon runtime rehearsal is denied in production");
    }
    return selection("neon");
  }
  if (requested === "enabled") {
    throw new Error("Neon runtime rehearsal requires APP_DATA_MODE=neon");
  }
  return selection("mock");
}

function selection(source: RuntimeDomainSource): RuntimeDomainSelection {
  return {
    source,
    domains: Object.fromEntries(runtimeDomains.map(domain => [domain, source])) as Record<
      RuntimeBusinessDomain,
      RuntimeDomainSource
    >,
  };
}

function runtimeInput() {
  return {
    APP_RUNTIME_REHEARSAL: process.env.APP_RUNTIME_REHEARSAL,
    APP_DATA_MODE: process.env.APP_DATA_MODE,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
}
