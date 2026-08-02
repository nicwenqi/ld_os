import type { SupabaseClient } from "@supabase/supabase-js";
import { PlatformAccountApiError } from "./platform-property-accounts.ts";

/**
 * This server-only bridge is intentionally narrow: the authenticated Platform
 * actor has already prepared a reset through an audited RPC, and the server
 * needs the internal Auth identity solely to call Supabase Auth Admin. The
 * UUID never becomes part of an RPC response or browser payload.
 */
export async function resolvePlatformManagerAuthIdentity(
  admin: SupabaseClient,
  propertyId: string,
  accountId: string,
) {
  const { data, error } = await admin
    .from("user_accounts")
    .select("auth_user_id")
    .eq("id", accountId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (error || !data?.auth_user_id) {
    throw new PlatformAccountApiError({
      status: 500,
      code: "AUTH_IDENTITY_RESOLUTION_FAILED",
      message: "无法完成密码重置，请稍后重试。",
    });
  }
  return data.auth_user_id;
}

export async function recordPlatformManagerAuthCleanup(
  actorClient: SupabaseClient,
  input: {
    propertyId: string;
    authUserId: string;
    operation: "create" | "replace";
    succeeded: boolean;
    requestId: string;
    errorCode?: string;
  },
) {
  const { error } = await actorClient.rpc("platform_record_manager_auth_cleanup_result", {
    p_property_id: input.propertyId,
    p_target_auth_user_id: input.authUserId,
    p_operation: input.operation,
    p_succeeded: input.succeeded,
    p_request_id: input.requestId,
    p_error_code: input.errorCode ?? null,
  });
  if (error) {
    throw new PlatformAccountApiError({
      status: 500,
      code: "AUTH_CLEANUP_AUDIT_UNAVAILABLE",
      message: "经理账号建立未完成，清理状态需要平台管理员复核。",
    });
  }
}
