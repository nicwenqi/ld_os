import type { RuntimeDomainRegistry } from "./neon-domain-registry.ts";

type ModePayload = {
  source: "mock" | "neon";
  domains: {
    organization: "mock" | "neon";
    people: "mock" | "neon";
    position: "mock" | "neon";
    employee: "mock" | "neon";
    import: "mock" | "neon";
    property: "mock" | "neon";
    initialization: "mock" | "neon";
  };
};

const loadCachedRuntimeDomainRegistry = createRetriableRuntimeDomainRegistryLoader(load);

export function loadRuntimeDomainRegistry(): Promise<RuntimeDomainRegistry> {
  return loadCachedRuntimeDomainRegistry();
}

export function usesFallbackDomainRegistry(
  registry: RuntimeDomainRegistry,
): boolean {
  return registry.source !== "neon";
}

async function load(): Promise<RuntimeDomainRegistry> {
  return loadRuntimeDomainRegistryWith({
    fetchMode: () => fetch("/api/runtime/rehearsal-mode", {
      credentials: "same-origin",
      cache: "no-store",
    }),
    createNeon: async () => {
      const { createNeonDomainRegistry } = await import("./neon-domain-registry.ts");
      return createNeonDomainRegistry({ appEnv: "preview", dataMode: "neon" });
    },
    createMock: async () => {
      const { createMockDomainRegistry } = await import("./mock-domain-registry.ts");
      return createMockDomainRegistry();
    },
  });
}

type ModeResponse = Pick<Response, "ok" | "json">;

type RuntimeDomainRegistryLoaders = {
  fetchMode: () => Promise<ModeResponse>;
  createNeon: () => Promise<RuntimeDomainRegistry>;
  createMock: () => Promise<RuntimeDomainRegistry>;
};

export async function loadRuntimeDomainRegistryWith(
  loaders: RuntimeDomainRegistryLoaders,
): Promise<RuntimeDomainRegistry> {
  const response = await loaders.fetchMode();
  const payload = await response.json() as ModePayload & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "运行时 rehearsal 配置不可用");
  if (
    payload.domains.organization !== payload.source ||
    payload.domains.people !== payload.source ||
    payload.domains.position !== payload.source ||
    payload.domains.employee !== payload.source ||
    payload.domains.property !== payload.source ||
    payload.domains.initialization !== payload.source
    || payload.domains.import !== payload.source
  ) throw new Error("运行时 rehearsal 数据源配置不一致");
  if (payload.source === "neon") {
    return loaders.createNeon();
  }
  if (payload.source === "mock") {
    return loaders.createMock();
  }
  throw new Error("运行时只能选择 mock 或 Neon 数据源");
}

export function createRetriableRuntimeDomainRegistryLoader(
  loader: () => Promise<RuntimeDomainRegistry>,
) {
  let pending: Promise<RuntimeDomainRegistry> | null = null;
  return () => {
    pending ??= Promise.resolve()
      .then(loader)
      .catch(error => {
        pending = null;
        throw error;
      });
    return pending;
  };
}
