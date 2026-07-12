import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppEnvironment } from "../environment.ts";

let browserClient: SupabaseClient | null = null;

export function createBrowserSupabaseClient(environment: AppEnvironment): SupabaseClient {
  if (!environment.supabaseUrl || !environment.supabasePublishableKey)
    throw new Error("当前数据模式缺少 Supabase 浏览器配置");
  browserClient ??= createClient(environment.supabaseUrl, environment.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return browserClient;
}
