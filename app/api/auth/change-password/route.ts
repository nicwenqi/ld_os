import { parseAppEnvironment } from "../../../lib/environment.ts";
import {
  createServerActorClient,
  createServerAdminClient,
  createServerPasswordClient,
} from "../../../lib/supabase/server-admin.ts";
import { expiredAuthCookies } from "../cookies.ts";
import { resolvePasswordChangeRequest } from "../../../services/request-authentication.ts";
import { validateUserSelectedPassword } from "../../../services/account-administration.ts";

export async function POST(request: Request) {
  try {
    const environment = parseAppEnvironment();
    if (environment.dataMode === "mock") {
      return failure(404, "本地验证账号不需要修改密码");
    }
    const resolved = await resolvePasswordChangeRequest(request);
    if (!resolved?.authUserId || !resolved.session.propertyId) {
      return failure(401, "登录已失效，请重新登录");
    }
    const body = await request.json() as Record<string, unknown>;
    const password = typeof body.password === "string" ? body.password : "";
    validateUserSelectedPassword(password);

    const actorClient = createServerActorClient(resolved.accessToken);
    const { data: preparation, error: preparationError } = await actorClient.rpc(
      "prepare_hotel_password_change",
      { p_hostname: resolved.hostname },
    );
    const accountVersion = readAccountVersion(preparation);
    if (preparationError || accountVersion === null) {
      return failure(403, "当前后台账号不可用");
    }

    if (!resolved.refreshToken) {
      return failure(401, "登录已失效，请重新登录");
    }
    const passwordClient = createServerPasswordClient();
    const { error: sessionError } = await passwordClient.auth.setSession({
      access_token: resolved.accessToken,
      refresh_token: resolved.refreshToken,
    });
    if (sessionError) return failure(401, "登录已失效，请重新登录");
    const { error: passwordError } = await passwordClient.auth.updateUser({ password });
    if (passwordError) throw new Error("密码更新失败，请重试");

    const admin = createServerAdminClient();
    const { error: completionError } = await admin.rpc(
      "complete_hotel_password_change",
      {
        p_auth_user_id: resolved.authUserId,
        p_property_id: resolved.session.propertyId,
        p_expected_account_version: accountVersion,
      },
    );
    if (completionError) {
      return failure(
        409,
        "密码已更新，但账号安全状态需要重新确认。请使用新密码重新登录后再试。",
        environment.appEnv !== "local",
      );
    }

    return success(environment.appEnv !== "local");
  } catch (error) {
    return failure(422, error instanceof Error ? error.message : "密码修改失败，请重试");
  }
}

function success(secure: boolean) {
  const headers = sessionClearHeaders(secure);
  return Response.json(
    { changed: true, reauthenticationRequired: true },
    { headers },
  );
}

function failure(status: number, message: string, secureSessionClear: boolean | null = null) {
  const headers = new Headers({ "Cache-Control": "no-store, private" });
  if (secureSessionClear !== null) {
    for (const value of expiredAuthCookies(secureSessionClear)) headers.append("Set-Cookie", value);
  }
  return Response.json(
    { message },
    { status, headers },
  );
}

function sessionClearHeaders(secure: boolean) {
  const headers = new Headers({ "Cache-Control": "no-store, private" });
  for (const value of expiredAuthCookies(secure)) headers.append("Set-Cookie", value);
  return headers;
}

function readAccountVersion(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const version = (value as { accountVersion?: unknown }).accountVersion;
  return typeof version === "number" && Number.isInteger(version) && version > 0
    ? version
    : null;
}
