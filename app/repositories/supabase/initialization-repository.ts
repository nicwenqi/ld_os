import type { SupabaseClient } from "@supabase/supabase-js";
import type { InitializationRepository, SaveWizardStepInput } from "../contracts/initialization-repository.ts";
type Client = Pick<SupabaseClient, "from" | "rpc">;
export function createSupabaseInitializationRepository(client: Client): InitializationRepository { return {
  async getProgress(propertyId) { const { data, error } = await client.rpc("get_property_initialization_progress", { p_property_id: propertyId }); if (error) throw new Error(`无法读取初始化进度：${error.message}`); return data; },
  async saveStep(input: SaveWizardStepInput) { const { data, error } = await client.rpc("save_property_initialization_step", { p_property_id: input.propertyId, p_step_key: input.stepKey, p_last_active_step: input.lastActiveStep, p_explicitly_confirmed: input.explicitlyConfirmed ?? false, p_warning: input.warning ?? null, p_blocking_reason: input.blockingReason ?? null, p_expected_version: input.expectedVersion ?? null }); if (error) throw new Error(`无法保存初始化进度：${error.message}`); return data; },
  async complete(propertyId, expectedVersion) { const { error } = await client.rpc("complete_property_initialization", { p_property_id: propertyId, p_expected_version: expectedVersion ?? null }); if (error) throw new Error(`无法完成酒店初始化：${error.message}`); },
  async getAccessSummary(propertyId) { const response=await fetch(`/api/initialization/access?propertyId=${encodeURIComponent(propertyId)}`,{credentials:"same-origin",cache:"no-store"});const payload=await response.json();if(!response.ok)throw new Error(payload.message??"无法读取管理员状态");return payload; },
}; }
