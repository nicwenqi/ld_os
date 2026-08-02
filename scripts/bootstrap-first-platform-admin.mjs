import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const CONFIRMATION = "I_UNDERSTAND_ONE_TIME_BOOTSTRAP";

export function validateBootstrapInput(input) {
  const email = String(input.email ?? "").trim().toLowerCase();
  const displayName = String(input.displayName ?? "").trim();
  const password = String(input.password ?? "");
  const confirmation = String(input.confirmation ?? "");
  if (!email || !email.includes("@")) throw new Error("bootstrap admin email is required");
  if (!displayName || displayName.length > 160) throw new Error("bootstrap admin display name is invalid");
  if (password.length < 12) throw new Error("bootstrap admin password must contain at least 12 characters");
  if (confirmation !== CONFIRMATION) throw new Error("explicit bootstrap confirmation is required");
  return { email, displayName, password };
}

export async function bootstrapFirstPlatformAdmin({
  supabaseUrl,
  secretKey,
  email,
  displayName,
  password,
  confirmation,
  requestId = randomUUID(),
}) {
  if (!supabaseUrl || !secretKey) throw new Error("server Supabase configuration is incomplete");
  const input = validateBootstrapInput({
    email,
    displayName,
    password,
    confirmation,
  });
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: auth, error: authError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    app_metadata: {
      hotel_ld_internal_account: true,
      bootstrap_role: "platform_admin",
    },
  });
  if (authError || !auth.user) throw new Error("无法创建平台管理员登录身份");

  try {
    const { data, error } = await admin.rpc("bootstrap_first_platform_admin", {
      p_auth_user_id: auth.user.id,
      p_email: input.email,
      p_display_name: input.displayName,
      p_request_id: requestId,
    });
    if (error || !data) {
      // The audit table deliberately has no service_role table grant. Try to
      // compensate the newly-created Auth row without reading business data;
      // if the RPC committed, its FK-protected profile/membership/audit rows
      // prevent deletion and preserve the successful bootstrap.
      await admin.auth.admin.deleteUser(auth.user.id);
      throw new Error(error?.message ?? "平台管理员授权绑定未完成");
    }
    return {
      ...data,
      authUserId: auth.user.id,
      requestId,
      propertyCreated: false,
      hotelManagerCreated: false,
      employeeFactsCreated: false,
      trainingFactsCreated: false,
    };
  } catch (error) {
    if (error instanceof Error && /平台管理员授权绑定未完成/.test(error.message)) throw error;
    throw new Error("平台管理员 bootstrap 未完成");
  }
}

async function main() {
  const result = await bootstrapFirstPlatformAdmin({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    secretKey: process.env.SUPABASE_SECRET_KEY,
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    displayName: process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    confirmation: process.env.FIRST_PLATFORM_ADMIN_BOOTSTRAP_CONFIRM,
    requestId: process.env.BOOTSTRAP_REQUEST_ID || randomUUID(),
  });
  console.log(JSON.stringify({ status: "completed", ...result }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.env.FIRST_PLATFORM_ADMIN_BOOTSTRAP_CONFIRM !== CONFIRMATION) {
      throw new Error("set FIRST_PLATFORM_ADMIN_BOOTSTRAP_CONFIRM explicitly before execution");
    }
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "platform bootstrap failed");
    process.exitCode = 1;
  }
}
