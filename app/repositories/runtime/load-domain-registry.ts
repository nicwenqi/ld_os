import type { RuntimeDomainRegistry } from "./neon-domain-registry.ts";

type ModePayload = {
  source: "neon" | "supabase";
  domains: { organization: "neon" | "supabase"; people: "neon" | "supabase"; position: "neon" | "supabase"; property: "neon" | "supabase"; initialization: "neon" | "supabase"; import: "neon" | "supabase" };
};

let pending: Promise<RuntimeDomainRegistry> | null = null;

export function loadRuntimeDomainRegistry(): Promise<RuntimeDomainRegistry> {
  pending ??= load();
  return pending;
}

export function usesFallbackDomainRegistry(
  registry: RuntimeDomainRegistry,
): boolean {
  return registry.source !== "neon";
}

async function load(): Promise<RuntimeDomainRegistry> {
  const response = await fetch("/api/runtime/rehearsal-mode", {
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = await response.json() as ModePayload & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "运行时 rehearsal 配置不可用");
  if (
    payload.domains.organization !== payload.source ||
    payload.domains.people !== payload.source ||
    payload.domains.position !== payload.source ||
    payload.domains.property !== payload.source ||
    payload.domains.initialization !== payload.source
    || payload.domains.import !== payload.source
  ) throw new Error("运行时 rehearsal 数据源配置不一致");
  if (payload.source === "neon") {
    const { createNeonDomainRegistry } = await import("./neon-domain-registry.ts");
    return createNeonDomainRegistry({ appEnv: "preview", dataMode: "neon" });
  }
  const { createSupabaseDomainRegistry } = await import("./supabase-domain-registry.ts");
  return createSupabaseDomainRegistry();
}
