import type { AppEnvironmentName } from "./environment.ts";

type HostnameResolutionOptions = {
  appEnv: AppEnvironmentName;
  appBaseDomain: string;
  localOverride?: string | null;
};

export function resolveRequestHostname(request: Request, options: HostnameResolutionOptions): string | null {
  if (options.appEnv !== "production" && options.localOverride) return normalizeHostname(options.localOverride);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const hostname = normalizeHostname(forwardedHost || request.headers.get("host") || new URL(request.url).host);
  if (!hostname) return null;
  if (options.appEnv === "production") {
    const baseDomain = normalizeHostname(options.appBaseDomain);
    if (!baseDomain || hostname === "localhost" || hostname === "127.0.0.1" ||
      (hostname !== baseDomain && !hostname.endsWith(`.${baseDomain}`))) return null;
  }
  return hostname;
}

export function normalizeHostname(value: string): string | null {
  const candidate = value.trim().toLowerCase();
  if (!candidate || candidate.includes("/") || candidate.includes("@")) return null;
  try {
    const hostname = new URL(`http://${candidate}`).hostname.toLowerCase();
    if (!hostname || (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname) && hostname !== "localhost" && hostname !== "127.0.0.1")) return null;
    return hostname;
  } catch { return null; }
}
