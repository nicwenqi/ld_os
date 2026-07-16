"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/shell/AppShell";
import { DataStateBadge } from "../components/operations/DataStateBadge";
import { ProtectedAppProviders } from "../providers";
import { createRepositoryRegistry } from "../repositories/registry.ts";
import {
  formatFoundationCount,
  loadFoundationReadiness,
  type FoundationReadinessSnapshot,
} from "../services/foundation-readiness.ts";
import { useAuthSession } from "../state/auth-session";

function DataQualityContent() {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const { session } = useAuthSession();
  const [snapshot, setSnapshot] = useState<FoundationReadinessSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setSnapshot(null);
    setError(null);
    setAttempt(value => value + 1);
  };

  useEffect(() => {
    let active = true;
    void loadFoundationReadiness(registry, session)
      .then(result => {
        if (active) setSnapshot(result);
      })
      .catch(reason => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "酒店基础来源读取失败");
        }
      });
    return () => {
      active = false;
    };
  }, [attempt, registry, session]);

  if (!snapshot && !error) {
    return (
      <AppShell>
        <div className="page-wrap data-quality-page data-quality-loading" role="status">
          <span>DATA READINESS</span>
          <h1>正在核对酒店数据来源</h1>
          <p>只有可追溯的来源会被标记为可用。</p>
        </div>
      </AppShell>
    );
  }

  if (!snapshot) {
    return (
      <AppShell>
        <div className="page-wrap data-quality-page">
          <section className="data-quality-failure" role="alert">
            <DataStateBadge state="failed" />
            <h1>数据质量状态暂时无法读取</h1>
            <p>{error}。系统没有用零值或演示事实替代失败来源。</p>
            <button onClick={retry}>重新读取</button>
            <Link href="/">返回运营工作台</Link>
          </section>
        </div>
      </AppShell>
    );
  }

  const trainingUnavailable = [
    "培训计划与课程",
    "培训场次与日历",
    "签到、出勤与反馈",
    "KPI 实际与目标轨迹",
    "风险、预测与干预结果",
    "课程及培训师成效",
  ];

  return (
    <AppShell>
      <div className="page-wrap data-quality-page">
        <header className="data-quality-heading">
          <div>
            <span>TRUSTED DATA READINESS</span>
            <h1>数据质量</h1>
            <p>区分已经连接的酒店基础、读取不完整的来源与尚未接入的训练运营事实。</p>
          </div>
          <div>
            <DataStateBadge state={snapshot.presentationState} />
            <small>数据更新于 {formatUpdatedAt(snapshot.refreshedAt, snapshot.hotel.timezone)}</small>
          </div>
        </header>

        <section className="data-quality-verdict">
          <div>
            <span>当前数据判断</span>
            <h2>基础管理可以继续，训练运营结论仍无法计算</h2>
            <p>
              {snapshot.hotel.nameZh} 的酒店身份、组织、职位与员工主数据来源已经建立；
              训练计划、场次、出勤、反馈及 KPI 实际尚未连接，因此不会生成健康、风险或预测结论。
            </p>
          </div>
          <aside>
            <strong>{snapshot.errors.length ? "部分基础来源需检查" : "基础来源已完成本次读取"}</strong>
            <p>
              {snapshot.errors.length
                ? "读取失败的项目显示为“—”，不会被解释为零。"
                : "来源可读取不等于训练运营已经就绪。"}
            </p>
            {snapshot.errors.length > 0 && (
              <button onClick={retry}>重新读取</button>
            )}
          </aside>
        </section>

        <section className="data-source-section" aria-labelledby="foundation-sources-heading">
          <header>
            <div>
              <span>CONNECTED FOUNDATIONS</span>
              <h2 id="foundation-sources-heading">酒店基础来源</h2>
            </div>
            <DataStateBadge state={snapshot.presentationState} />
          </header>
          <div className="foundation-source-grid">
            <SourceFact label="正式部门" value={snapshot.facts.activeDepartments} detail="有效部门及其层级" />
            <SourceFact label="正式职位" value={snapshot.facts.activePositions} detail="有效职位与职位归属" />
            <SourceFact label="在职员工" value={snapshot.facts.activeEmployees} detail="员工主数据记录" />
            <SourceFact label="待确认归属" value={snapshot.facts.unresolvedMappings} detail="部门与职位来源标签" />
            <SourceFact label="有效经理账号" value={snapshot.facts.activeManagers} detail="酒店后台授权账号" />
          </div>
          <nav aria-label="酒店基础数据处理入口">
            <Link href="/people">查看员工主数据</Link>
            <Link href="/import">员工资料更新</Link>
            <Link href="/permissions?section=organization">维护组织与职位</Link>
          </nav>
        </section>

        <section className="data-source-section unavailable-sources" aria-labelledby="unavailable-sources-heading">
          <header>
            <div>
              <span>NOT CONNECTED</span>
              <h2 id="unavailable-sources-heading">尚未接入的训练运营事实</h2>
            </div>
            <DataStateBadge state="unavailable" />
          </header>
          <ul>
            {trainingUnavailable.map(source => (
              <li key={source}>
                <strong>{source}</strong>
                <span>尚未接入真实数据</span>
              </li>
            ))}
          </ul>
          <p>这些来源接入前，不显示零值、演示值、健康分、排名、趋势、风险、预测或行动结果。</p>
        </section>

        <footer className="data-quality-return">
          <div>
            <span>OPERATIONS HOME</span>
            <strong>返回整体酒店准备状态</strong>
          </div>
          <Link href="/">返回运营工作台</Link>
        </footer>
      </div>
    </AppShell>
  );
}

function SourceFact({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return (
    <article>
      <strong>{formatFoundationCount(value)}</strong>
      <span>{label}</span>
      <small>{value === null ? "当前来源无法读取" : detail}</small>
    </article>
  );
}

function formatUpdatedAt(value: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return "更新时间不可用";
  }
}

export default function DataQualityPage() {
  return (
    <ProtectedAppProviders>
      <DataQualityContent />
    </ProtectedAppProviders>
  );
}
