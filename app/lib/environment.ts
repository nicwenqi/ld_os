export type AppEnvironmentName = "local" | "preview" | "production";
export type AppDataMode = "mock" | "hybrid" | "supabase";

export type AppEnvironment = {
  appEnv: AppEnvironmentName;
  dataMode: AppDataMode;
  appBaseDomain: string;
  devPropertyHostname: string | null;
  previewPropertyHostname: string | null;
  supabaseUrl: string | null;
  supabasePublishableKey: string | null;
};

type EnvironmentInput = Record<string, string | undefined>;

const appEnvironments = new Set<AppEnvironmentName>(["local", "preview", "production"]);
const dataModes = new Set<AppDataMode>(["mock", "hybrid", "supabase"]);

export function parseAppEnvironment(input: EnvironmentInput = process.env): AppEnvironment {
  for (const [name, value] of Object.entries(input)) {
    if (name.startsWith("NEXT_PUBLIC_") && /(SERVICE_ROLE|SECRET)/i.test(name) && clean(value))
      throw new Error(`${name} must never be browser-visible`);
  }

  const appEnv = (input.APP_ENV || "local") as AppEnvironmentName;
  const dataMode = (input.APP_DATA_MODE || "mock") as AppDataMode;
  if (!appEnvironments.has(appEnv)) throw new Error("APP_ENV must be local, preview, or production");
  if (!dataModes.has(dataMode)) throw new Error("APP_DATA_MODE must be mock, hybrid, or supabase");

  const appBaseDomain = validateHostname("APP_BASE_DOMAIN", input.APP_BASE_DOMAIN || "ldchub.cn", false)!;
  const devPropertyHostname = validateHostname("DEV_PROPERTY_HOSTNAME", input.DEV_PROPERTY_HOSTNAME);
  const previewPropertyHostname = validateHostname("PREVIEW_PROPERTY_HOSTNAME", input.PREVIEW_PROPERTY_HOSTNAME);
  const supabaseUrl = optionalUrl("NEXT_PUBLIC_SUPABASE_URL", input.NEXT_PUBLIC_SUPABASE_URL);
  const supabasePublishableKey = clean(input.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

  if (dataMode !== "mock") {
    if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required outside mock mode");
    if (!supabasePublishableKey) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required outside mock mode");
    if (appEnv === "local" && !devPropertyHostname)
      throw new Error("DEV_PROPERTY_HOSTNAME is required for local real-data modes");
    if (appEnv === "preview" && !previewPropertyHostname)
      throw new Error("PREVIEW_PROPERTY_HOSTNAME is required for preview real-data modes");
  }

  return {
    appEnv,
    dataMode,
    appBaseDomain,
    devPropertyHostname,
    previewPropertyHostname,
    supabaseUrl,
    supabasePublishableKey,
  };
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function optionalUrl(name: string, value: string | undefined): string | null {
  const normalized = clean(value);
  if (!normalized) return null;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error(`${name} must be a valid HTTPS URL`);
  return parsed.toString().replace(/\/$/, "");
}

function validateHostname(name: string, value: string | undefined, optional = true): string | null {
  const hostname = clean(value)?.toLowerCase();
  if (!hostname) {
    if (optional) return null;
    throw new Error(`${name} is required`);
  }
  if (
    hostname.includes("://") || hostname.includes("/") || hostname.includes(":") ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)
  ) throw new Error(`${name} must be a hostname without protocol, path, or port`);
  return hostname;
}
