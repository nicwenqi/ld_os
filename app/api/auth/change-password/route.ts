import { parseAppEnvironment } from "../../../lib/environment.ts";
import { createServerAdminClient } from "../../../lib/supabase/server-admin.ts";
import { authCookies } from "../cookies.ts";
import { resolvePasswordChangeRequest } from "../../../services/request-authentication.ts";
import { validateBackendPassword } from "../../../services/account-administration.ts";

export async function POST(request: Request) {
  try {
    const environment = parseAppEnvironment();
    if (environment.dataMode === "mock") {
      return failure(404, "本地验证账号不需要修改密码");
    }
    const resolved = await resolvePasswordChangeRequest(request);
    if (!resolved?.session.userId || !resolved.session.propertyId) {
      return failure(401, "登录已失效，请重新登录");
    }
    const body = await request.json() as Record<string, unknown>;
    const password = typeof body.password === "string" ? body.password : "";
    validateBackendPassword(password);

    const admin = createServerAdminClient();
    const { data: account, error: accountError } = await admin
      .from("user_accounts")
      .select("id,auth_user_id,version")
      .eq("user_id", resolved.session.userId)
      .eq("property_id", resolved.session.propertyId)
      .eq("account_status", "active")
      .maybeSingle();
    if (accountError || !account) return failure(403, "当前后台账号不可用");

    const { error: passwordError } = await admin.auth.admin.updateUserById(
      account.auth_user_id,
      { password },
    );
    if (passwordError) throw new Error("密码更新失败，请重试");

    const { data: updated, error: updateError } = await admin
      .from("user_accounts")
      .update({
        must_change_password: false,
        failed_login_count: 0,
        locked_until: null,
        version: Number(account.version) + 1,
      })
      .eq("id", account.id)
      .eq("version", account.version)
      .select("id")
      .maybeSingle();
    if (updateError || !updated) {
      throw new Error("密码已更新，请使用新密码重新登录；账号状态将在重新验证后同步");
    }

    const headers = new Headers({ "Cache-Control": "no-store, private" });
    if (resolved.refreshed) {
      for (const value of authCookies(
        resolved.accessToken,
        resolved.refreshToken,
        environment.appEnv !== "local",
      )) headers.append("Set-Cookie", value);
    }
    return Response.json({ changed: true }, { headers });
  } catch (error) {
    return failure(422, error instanceof Error ? error.message : "密码修改失败，请重试");
  }
}

function failure(status: number, message: string) {
  return Response.json(
    { message },
    { status, headers: { "Cache-Control": "no-store, private" } },
  );
}
