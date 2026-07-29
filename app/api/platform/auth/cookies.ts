const sessionName = "hotel_ld_platform_session";
const refreshName = "hotel_ld_platform_refresh";

export function readPlatformCookie(request: Request, name = sessionName) {
  const header = request.headers.get("cookie") ?? "";
  for (const item of header.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function platformAuthCookies(accessToken: string, refreshToken: string | null, secure: boolean) {
  return refreshToken
    ? [cookie(sessionName, accessToken, 3600, secure), cookie(refreshName, refreshToken, 43200, secure)]
    : [cookie(sessionName, accessToken, 3600, secure)];
}

export function expiredPlatformAuthCookies(secure: boolean) {
  return [expired(sessionName, secure), expired(refreshName, secure)];
}

function cookie(name: string, value: string, maxAge: number, secure: boolean) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function expired(name: string, secure: boolean) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}
