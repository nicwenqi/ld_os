"use client";

import type { ReactNode } from "react";
import type { RuntimeDomainRegistry } from "./neon-domain-registry.ts";
import { useRuntimeDomainRegistry } from "./use-runtime-domain-registry.ts";

export function RuntimeDomainRegistryBoundary({
  children,
}: {
  children: (registry: RuntimeDomainRegistry) => ReactNode;
}) {
  const { registry, error, loading, retry } = useRuntimeDomainRegistry();

  if (loading) {
    return <div className="runtime-domain-registry-loading" role="status">正在确认业务数据来源</div>;
  }
  if (!registry) {
    return (
      <section className="runtime-domain-registry-error" role="alert">
        <strong>业务数据来源暂时不可用</strong>
        <p>{error?.message ?? "运行时业务来源不可用"}</p>
        <button onClick={retry}>重新连接</button>
      </section>
    );
  }
  return <>{children(registry)}</>;
}
