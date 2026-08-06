import type { RuntimeDomainRegistry } from "./neon-domain-registry.ts";

/** Loaded only after an explicit non-rehearsal source selection. */
export async function createSupabaseDomainRegistry(): Promise<RuntimeDomainRegistry> {
  const { createRepositoryRegistry } = await import("../registry.ts");
  const registry = createRepositoryRegistry();
  return {
    source: "supabase",
    environment: registry.environment,
    department: registry.department,
    employee: registry.employee,
    peopleFacets: registry.peopleFacets,
    position: registry.position,
    property: registry.property,
  };
}
