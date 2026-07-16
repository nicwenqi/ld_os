"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "./components/shell/AppShell";
import { DataStateBadge } from "./components/operations/DataStateBadge";
import { ProtectedAppProviders } from "./providers";
import { createRepositoryRegistry } from "./repositories/registry.ts";
import {
  formatFoundationCount,
  loadFoundationReadiness,
  organizationConfirmationDetail,
  type FoundationReadinessSnapshot,
} from "./services/foundation-readiness.ts";
import { useAuthSession } from "./state/auth-session";

const unavailableModules = [
  ["培训日历与场次", "真实培训场次、培训师、场地与受众尚未接入。", "/calendar"],
  ["出勤与反馈", "尚无可信签到、出勤关闭或反馈回收事实。", "/attendance-feedback"],
  ["KPI、轨迹与预测", "目标实际、所需速度和预测结果当前无法计算。", "/kpi"],
  ["部门表现", "没有真实训练事实时，不生成部门排名或健康结论。", "/department-performance"],
  ["干预与提醒", "真实风险与行动生命周期尚未建立，不生成假任务。", "/interventions"],
  ["课程成效", "反馈样本、满意度和课程应用证据尚未接入。", "/effectiveness"],
] as const;

function ManagerCommandCenter() {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const { session } = useAuthSession();
  const [snapshot, setSnapshot] = useState<FoundationReadinessSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void loadFoundationReadiness(registry, session)
      .then(next => {
        if (active) setSnapshot(next);
      })
      .catch(reason => {
        if (active) setLoadError(reason instanceof Error ? reason.message : "酒店基础状态读取失败");
      });
    return () => {
      active = false;
    };
  }, [attempt, registry, session]);

  const retry = () => {
    setLoadError(null);
    setAttempt(value => value + 1);
  };

  if (!snapshot && !loadError) {
    return (
      <AppShell>
        <div className="page-wrap manager-command-center manager-loading" role="status">
          <span>正在读取酒店基础事实</span>
          <h1>运营工作台</h1>
          <p>系统只会在来源确认后显示结果。</p>
        </div>
      </AppShell>
    );
  }

  if (!snapshot) {
    return (
      <AppShell>
        <div className="page-wrap manager-command-center">
          <section className="source-load-failure" role="alert">
            <DataStateBadge state="failed" />
            <h1>酒店基础状态暂时无法读取</h1>
            <p>{loadError}。系统没有用零值或演示指标替代失败的来源。</p>
            <button onClick={retry}>重新读取</button>
          </section>
        </div>
      </AppShell>
    );
  }

  const refreshedAt = formatTimestamp(snapshot.refreshedAt, snapshot.hotel.timezone);
  const readinessLabel =
    snapshot.readiness.minimumReady === null
      ? "无法判断"
      : snapshot.readiness.minimumReady
        ? "最低可用条件已满足"
        : "最低可用条件待完成";
  const verifiedPositive =
    snapshot.presentationState === "real" && snapshot.readiness.minimumReady === true;
  const operatingBoundaryTitle =
    snapshot.readiness.minimumReady === true
      ? "酒店基础管理已可使用，培训运营判断等待真实事实"
      : snapshot.readiness.minimumReady === false
        ? "酒店基础仍在准备，培训运营判断等待真实事实"
        : "酒店基础状态不完整，培训运营判断暂不可用";

  return (
    <AppShell>
      <div className="page-wrap manager-command-center">
        <header className="manager-page-heading">
          <div>
            <span>{snapshot.hotel.nameZh} · HOTEL TRAINING OPERATIONS</span>
            <h1>运营工作台</h1>
            <p>判断在前，事实为证；当前只呈现已经连接并可追溯的酒店基础数据。</p>
          </div>
          <div className="source-summary">
            <DataStateBadge state={snapshot.presentationState} />
            <small>数据更新于 {refreshedAt}</small>
          </div>
        </header>

        {snapshot.errors.length > 0 && (
          <section className="partial-source-notice" role="alert">
            <div>
              <strong>部分酒店基础来源读取失败</strong>
              <span>受影响的项目显示为“—”，不会被解释为零或正常。</span>
            </div>
            <button onClick={retry}>重新读取</button>
          </section>
        )}

        <section className="operating-verdict">
          <div className="verdict-copy">
            <DataStateBadge state="unavailable" />
            <span className="verdict-kicker">当前数据边界</span>
            <h2>{operatingBoundaryTitle}</h2>
            <p>
              酒店身份、组织、职位与员工主数据可用于基础管理；真实培训计划、场次、出勤、反馈与 KPI
              实际尚未接入，因此不显示健康分、风险、预测或干预结果。
            </p>
            <Link href="/data-quality">查看数据接入边界</Link>
          </div>
          <aside className="next-foundation-action">
            <span>下一步</span>
            <h3>{snapshot.readiness.nextAction.title}</h3>
            <p>{snapshot.readiness.nextAction.detail}</p>
            <Link href={snapshot.readiness.nextAction.href}>前往处理</Link>
          </aside>
        </section>

        <section className="foundation-section" aria-labelledby="foundation-heading">
          <header className="section-title-row">
            <div>
              <span>酒店基础准备</span>
              <h2 id="foundation-heading">现在可以信任的管理基础</h2>
            </div>
            <span className={`readiness-label ${verifiedPositive ? "verified" : ""}`}>
              {readinessLabel}
            </span>
          </header>
          <div className="foundation-facts-grid">
            <FactCard
              value={formatFoundationCount(snapshot.facts.activeDepartments)}
              label="有效正式部门"
              detail={organizationConfirmationDetail(
                snapshot.facts.activeDepartments,
                snapshot.readiness.organizationConfirmed,
              )}
            />
            <FactCard
              value={formatFoundationCount(snapshot.facts.activeEmployees)}
              label="在职员工主数据"
              detail={factDetail(snapshot.facts.activeEmployees, "员工是业务记录，不是登录账号")}
            />
            <FactCard
              value={formatFoundationCount(snapshot.facts.activePositions)}
              label="有效正式职位"
              detail={factDetail(snapshot.facts.activePositions, "用于职位归属与后续培训对象")}
            />
            <FactCard
              value={formatFoundationCount(snapshot.facts.unresolvedMappings)}
              label="待确认归属"
              detail={factDetail(snapshot.facts.unresolvedMappings, "部门与职位来源标签")}
            />
          </div>
          <div className="foundation-context-row">
            <article>
              <span>最近员工资料更新</span>
              <strong>
                {snapshot.facts.latestEmployeeUpdate
                  ? importStatus(snapshot.facts.latestEmployeeUpdate.status)
                  : "尚无更新记录"}
              </strong>
              <small>
                {snapshot.facts.latestEmployeeUpdate
                  ? formatTimestamp(
                      snapshot.facts.latestEmployeeUpdate.createdAt,
                      snapshot.hotel.timezone,
                    )
                  : "可从“员工资料更新”开始文件检查"}
              </small>
            </article>
            <article>
              <span>有效酒店学习与发展经理</span>
              <strong>{formatFoundationCount(snapshot.facts.activeManagers)}</strong>
              <small>
                {snapshot.facts.activeManagers === null
                  ? "账号来源无法读取"
                  : "仅后台授权账号，不为普通员工创建账户"}
              </small>
            </article>
            <article>
              <span>启用与系统检查</span>
              <strong>
                {snapshot.readiness.foundationReady === null
                  ? "无法判断"
                  : snapshot.readiness.foundationReady
                    ? "已完成"
                    : "仍有可选准备项"}
              </strong>
              <small>不会阻挡经理返回日常运营首页</small>
            </article>
          </div>
        </section>

        <section className="availability-section" aria-labelledby="availability-heading">
          <header className="section-title-row">
            <div>
              <span>运营数据边界</span>
              <h2 id="availability-heading">尚未接入的培训运营事实</h2>
              <p>每项均标记为“尚未接入真实数据”，保留清晰入口与所需证据，但不会展示演示指标或执行假动作。</p>
            </div>
          </header>
          <div className="availability-grid">
            {unavailableModules.map(([title, detail, href]) => (
              <Link href={href} key={title}>
                <DataStateBadge state="unavailable" />
                <h3>{title}</h3>
                <p>{detail}</p>
                <span>查看接入要求</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="foundation-work-links">
          <div>
            <span>基础管理</span>
            <h2>继续真实可用的酒店准备工作</h2>
          </div>
          <nav aria-label="酒店基础管理快捷入口">
            <Link href="/settings/hotel">酒店设置</Link>
            <Link href="/organization">组织架构</Link>
            <Link href="/positions">职位体系</Link>
            <Link href="/import">员工资料更新</Link>
            <Link href="/people">员工主数据</Link>
          </nav>
        </section>
      </div>
    </AppShell>
  );
}

function FactCard({ value, label, detail }: { value: string; label: string; detail: string }) {
  return (
    <article>
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{detail}</small>
    </article>
  );
}

function factDetail(value: number | null, detail: string) {
  return value === null ? "当前来源无法读取" : detail;
}

function formatTimestamp(value: string, timezone: string) {
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

function importStatus(status: string) {
  const labels: Record<string, string> = {
    completed: "已完成",
    completed_with_warnings: "已完成，存在提示",
    ready_for_review: "等待更新预览",
    mapping_required: "等待归属确认",
    validating: "正在检查",
    importing: "正在更新",
  };
  return labels[status] ?? "已记录";
}

export default function Home() {
  return (
    <ProtectedAppProviders>
      <ManagerCommandCenter />
    </ProtectedAppProviders>
  );
}
