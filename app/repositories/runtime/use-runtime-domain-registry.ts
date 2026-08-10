"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadRuntimeDomainRegistry,
} from "./load-domain-registry.ts";
import type { RuntimeDomainRegistry } from "./neon-domain-registry.ts";

export type RuntimeDomainRegistryState = {
  registry: RuntimeDomainRegistry | null;
  error: Error | null;
};

type RegistryLoader = () => Promise<RuntimeDomainRegistry>;

export async function resolveRuntimeDomainRegistryState(
  loader: RegistryLoader = loadRuntimeDomainRegistry,
): Promise<RuntimeDomainRegistryState> {
  try {
    return { registry: await loader(), error: null };
  } catch (reason) {
    return {
      registry: null,
      error: reason instanceof Error ? reason : new Error("运行时业务来源不可用"),
    };
  }
}

export function useRuntimeDomainRegistry() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<RuntimeDomainRegistryState>({
    registry: null,
    error: null,
  });
  const [loading, setLoading] = useState(true);
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void resolveRuntimeDomainRegistryState()
      .then(next => {
        if (active) setState(next);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  return { ...state, loading, retry };
}
