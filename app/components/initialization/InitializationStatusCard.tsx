"use client";

import { useEffect, useState } from "react";
import type { RuntimeDomainRegistry } from "../../repositories/runtime/neon-domain-registry.ts";
import { useRuntimeDomainRegistry } from "../../repositories/runtime/use-runtime-domain-registry.ts";
import { deriveWizardState } from "../../services/initialization-wizard-service.ts";
import { useAuthSession } from "../../state/auth-session.tsx";
import "./initialization-status-card.css";

export function InitializationStatusCard() {
  const { registry, error, loading, retry } = useRuntimeDomainRegistry();

  if (loading) return null;
  if (!registry) {
    return (
      <section className="initialization-status-card minimum-blocked" role="alert">
        <strong>初始化状态暂时不可用</strong>
        <p>{error?.message ?? "运行时业务来源不可用"}</p>
        <button onClick={retry}>重新连接</button>
      </section>
    );
  }
  return <LoadedInitializationStatusCard registry={registry} />;
}

function LoadedInitializationStatusCard({ registry }: { registry: RuntimeDomainRegistry }) {
  const { session } = useAuthSession();
  const [state, setState] = useState<ReturnType<typeof deriveWizardState> | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const propertyId = registry.environment.dataMode === "mock"
        ? (await registry.property.resolveContext("training-demo.example.test"))?.propertyId
        : session.propertyId;
      if (!propertyId) return;
      const [record, tree, positions, aliases, positionLabels, progress, batches] = await Promise.all([
        registry.property.getProperty(propertyId),
        registry.department.listTree(propertyId),
        registry.position.listPositions(propertyId),
        registry.department.listAliases(propertyId),
        registry.position.listSourceLabels(propertyId),
        registry.initialization.getProgress(propertyId),
        registry.import.listImportHistory(propertyId),
      ]);
      if (!active) return;
      setState(deriveWizardState({
        identity: record.identity,
        rules: record.settings,
        activeDepartments: tree.filter(node => node.isActive).length,
        activePositions: positions.filter(position => position.isActive).length,
        inspectedEmployeeMaster: batches.some(batch => [
          "mapping_required", "validating", "ready_for_review", "importing", "completed", "completed_with_warnings",
        ].includes(batch.status)),
        unresolvedDepartmentLabels: aliases.filter(alias => alias.resolutionType === "deferred").length,
        unresolvedPositionLabels: positionLabels.filter(label => label.resolutionStatus === "deferred").length,
        activePropertyAdministrator: true,
        progress,
      }));
    })().catch(() => {});
    return () => { active = false; };
  }, [registry, session.propertyId]);

  if (!state) return null;
  if (collapsed && state.minimumReady) {
    return <button className="setup-card-collapsed" onClick={() => setCollapsed(false)}>初始化 {state.progressPercent}% · 查看运营准备状态</button>;
  }
  return (
    <section className={`initialization-status-card ${state.minimumReady ? "minimum-ready" : "minimum-blocked"}`}>
      <div className="setup-score"><strong>{state.progressPercent}<small>%</small></strong><span>整体初始化</span></div>
      <div className="setup-narrative">
        <span>{state.minimumReady ? "酒店基础已可用" : "酒店基础尚未就绪"}</span>
        <h2>{state.operationalReady ? "运营准备已完成" : "正常工作台已开放，部分真实数据能力仍待准备"}</h2>
        <p>{state.operationalReady ? "所有初始化检查均已完成，可继续日常维护。" : state.operationalBlockingReasons.slice(0, 3).join(" · ") || "请完成酒店身份、业务规则、正式部门及管理员配置。"}</p>
        <div><em className={state.minimumReady ? "good" : "risk"}>最低可用：{state.minimumReady ? "已满足" : "待完成"}</em><em className={state.operationalReady ? "good" : "watch"}>运营就绪：{state.operationalReady ? "已完成" : "进行中"}</em></div>
      </div>
      <nav><a className="primary" href="/initialize">继续初始化</a><a href="/settings/hotel">查看酒店设置</a><a href="/organization">查看组织架构</a><a href="/import">上传员工数据</a></nav>
      {state.minimumReady && <button className="setup-collapse" onClick={() => setCollapsed(true)} aria-label="收起初始化状态">收起</button>}
    </section>
  );
}
