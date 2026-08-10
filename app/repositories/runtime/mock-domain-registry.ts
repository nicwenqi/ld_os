import { createRepositoryRegistry } from "../registry.ts";
import type { RuntimeDomainRegistry } from "./neon-domain-registry.ts";

/** Loaded only for the explicit local mock mode used by existing test fixtures. */
export function createMockDomainRegistry(): RuntimeDomainRegistry {
  const registry = createRepositoryRegistry();
  return {
    source: "mock",
    environment: registry.environment,
    department: registry.department,
    employee: registry.employee,
    peopleFacets: null,
    position: registry.position,
    property: registry.property,
    initialization: registry.initialization,
    import: registry.import,
  };
}
