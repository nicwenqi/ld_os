"use client";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createRepositoryRegistry } from "../../repositories/registry.ts";
import { useMockRole } from "../../state/mock-role";
export function InitializationGuard({ children }: { children: React.ReactNode }) {
  const registry = useMemo(() => createRepositoryRegistry(), []); const pathname = usePathname(); const router = useRouter(); const { role } = useMockRole(); const [state, setState] = useState<"checking" | "ready" | "denied">("checking");
  useEffect(() => { let active = true; const check = async () => { try { const hostname = registry.environment.dataMode === "mock" ? "training-demo.example.test" : registry.environment.devPropertyHostname ?? registry.environment.previewPropertyHostname ?? window.location.hostname; const context = await registry.property.resolveContext(hostname); if (!context) throw new Error("酒店上下文未配置"); const progress = await registry.initialization.getProgress(context.propertyId); if (progress.completedAt) { if (active) setState("ready"); return; } if (role !== "ld_manager") { if (active) setState("denied"); return; } router.replace(`/initialize?resume=${progress.lastActiveStep}`); } catch { if (active) setState("denied"); } }; void check(); return () => { active = false; }; }, [registry, role, router, pathname]);
  if (state === "checking") return <div className="init-guard-loading">正在检查酒店初始化状态…</div>;
  if (state === "denied") return <div className="init-guard-denied"><span>酒店尚未完成初始化</span><h1>当前账户尚不能进入酒店运营系统</h1><p>请联系酒店学习与发展管理员完成初始化，或确认您已被授予当前酒店访问权限。</p></div>;
  return <>{children}</>;
}
