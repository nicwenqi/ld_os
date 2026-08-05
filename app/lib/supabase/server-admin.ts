import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function serverAuthEnvironment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) throw new Error("服务端 Supabase 登录配置不完整");
  return { url, publishableKey };
}

function serverAdminEnvironment() {
  const environment = serverAuthEnvironment();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error("服务端 Supabase 管理配置不完整");
  return { ...environment, secretKey };
}

const serverAuthOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

export function createServerAdminClient(): SupabaseClient {
  const environment = serverAdminEnvironment();
  return createClient(environment.url, environment.secretKey, serverAuthOptions);
}

export function createServerPasswordClient(): SupabaseClient {
  const environment = serverAuthEnvironment();
  return createClient(environment.url, environment.publishableKey, serverAuthOptions);
}

export function createServerActorClient(accessToken: string): SupabaseClient {
  const token = accessToken.trim();
  if (!token) throw new Error("服务端用户访问令牌不可用");
  const environment = serverAuthEnvironment();
  return createClient(environment.url, environment.publishableKey, {
    ...serverAuthOptions,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
