"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/shell/AppShell";
import { DataStateBadge } from "../components/operations/DataStateBadge";
import { ProtectedAppProviders } from "../providers";
import { RuntimeDomainRegistryBoundary } from "../repositories/runtime/RuntimeDomainRegistryBoundary.tsx";
import type { RuntimeDomainRegistry } from "../repositories/runtime/neon-domain-registry.ts";
import {
  loadScopedDepartmentEmployees,
  type ScopedDepartmentEmployees,
} from "../services/department-foundation.ts";
import { useAuthSession } from "../state/auth-session";

const unavailableOperations = [
  {
    title: "培训日历与场次",
    detail: "培训场次、培训师、场地和受众事实尚未连接。",
    href: "/department/calendar",
  },
  {
    title: "出勤与反馈",
    detail: "签到、出勤关闭和反馈回收事实尚未连接。",
    href: "/department/attendance-feedback",
  },
  {
    title: "补训与提醒",
    detail: "没有真实例外与行动状态时，不生成假提醒。",
    href: "/department/remediation",
  },
  {
    title: "部门培训数据",
    detail: "培训时数、完成轨迹和目标差距当前无法计算。",
    href: "/department/data",
  },
] as const;

function DepartmentCommandCenter({ registry }: { registry: RuntimeDomainRegistry }) {
  const { session } = useAuthSession();
  const [snapshot, setSnapshot] = useState<ScopedDepartmentEmployees | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const scopes = session.departmentScopes;
  const includeDescendants = scopes.some(scope => scope.includeDescendants);
  const employeeDataAvailable = Boolean(
    snapshot && snapshot.presentationState !== "unavailable",
  );

  useEffect(() => {
    let active = true;
    void loadScopedDepartmentEmployees(registry, session)
      .then(next => {
        if (active) setSnapshot(next);
      })
      .catch(reason => {
        if (!active) return;
        setLoadError(reason instanceof Error ? reason.message : "部门基础数据读取失败");
      });
    return () => {
      active = false;
    };
  }, [attempt, registry, session]);

  const retry = () => {
    setLoadError(null);
    setAttempt(value => value + 1);
  };

  const primaryScope = scopes[0] ?? null;
  const scopeTitle =
    scopes.length > 1
      ? `${scopes.length} 个授权部门分支`
      : primaryScope?.departmentNameZh ?? "授权范围待确认";
  const scopeBreadcrumb =
    primaryScope?.breadcrumb.join(" › ") ?? "请联系学习与发展经理确认部门授权";

  return (
    <AppShell>
      <div className="page-wrap department-command-center">
        <header className="department-page-heading">
          <div>
            <span>DEPARTMENT TRAINING OPERATIONS</span>
            <h1>部门工作台</h1>
            <p>仅呈现服务器为当前账号解析的部门分支，以及该范围内已经连接的可信事实。</p>
          </div>
          <DataStateBadge
            state={snapshot?.presentationState ?? (loadError ? "failed" : "unavailable")}
          />
        </header>

        <section className="department-scope-hero" aria-labelledby="scope-title">
          <div className="department-scope-copy">
            <span>授权部门范围</span>
            <h2 id="scope-title">{scopeTitle}</h2>
            <nav aria-label="当前授权部门层级">
              {scopeBreadcrumb.split(" › ").map((part, index, parts) => (
                <span key={`${part}-${index}`}>
                  {part}
                  {index < parts.length - 1 && <b aria-hidden="true">›</b>}
                </span>
              ))}
            </nav>
            <p>
              {includeDescendants
                ? "授权包含所列部门分支的下级部门；页面与直接链接使用同一范围边界。"
                : "授权仅包含所列部门本级，不包含下级部门。"}
            </p>
          </div>
          <div className="department-scope-facts">
            <article>
              <span>授权分支</span>
              <strong>{scopes.length || "—"}</strong>
              <small>由账号角色与部门范围共同决定</small>
            </article>
            <article>
              <span>范围内在职员工</span>
              <strong>
                {employeeDataAvailable ? (snapshot?.employees.length ?? "—") : "—"}
              </strong>
              <small>
                {employeeDataAvailable
                  ? "员工主数据记录，不代表登录账号"
                  : "安全范围数据源接入后显示"}
              </small>
            </article>
          </div>
        </section>

        {Boolean(loadError || snapshot?.errors.length) && (
          <section className="department-source-notice" role="alert">
            <div>
              <strong>部分部门基础事实暂时无法读取</strong>
              <span>受影响项目显示为“—”，不会被解释为零或正常。</span>
            </div>
            <button onClick={retry}>重新读取</button>
          </section>
        )}

        <section className="department-operating-verdict">
          <div>
            <DataStateBadge state="unavailable" />
            <span>当前部门运营判断</span>
            <h2>部门运营暂时无法判断</h2>
            <p>
              {employeeDataAvailable
                ? "当前可确认授权范围和范围内员工基础；"
                : "当前可确认服务器授权范围；本部门员工安全数据源尚未接入。"}
              培训计划、场次、出勤、反馈与目标实际尚未接入，因此不显示完成率、风险、预测或行动结果。
            </p>
          </div>
          <aside>
            <span>{employeeDataAvailable ? "现在可用" : "授权范围已确认"}</span>
            <h3>{employeeDataAvailable ? "核对本部门员工基础" : "查看员工数据接入状态"}</h3>
            <p>
              {employeeDataAvailable
                ? "确认当前授权分支内员工的部门和职位归属，为后续培训运营事实建立可信范围。"
                : "员工记录只会在安全的部门范围数据源接入后显示，不会以全酒店数据或零值替代。"}
            </p>
            <Link href="/department/employees">
              {employeeDataAvailable ? "查看本部门员工" : "查看接入说明"}
            </Link>
          </aside>
        </section>

        <section className="department-foundation-section" aria-labelledby="department-foundation-title">
          <header>
            <div>
              <span>当前访问能力</span>
              <h2 id="department-foundation-title">在授权范围内继续工作</h2>
              <p>
                {employeeDataAvailable
                  ? "员工基础可核对；缺少真实来源的运营模块保留清晰入口与接入说明。"
                  : "授权范围可确认；尚未建立安全来源的员工与培训模块只显示接入说明。"}
              </p>
            </div>
          </header>
          <div className="department-foundation-grid">
            <Link className="department-foundation-available" href="/department/employees">
              <DataStateBadge state={snapshot?.presentationState ?? "unavailable"} />
              <h3>本部门员工</h3>
              <p>
                {employeeDataAvailable
                  ? "查看服务器授权分支内已经连接的员工主数据，不展示未接入的培训历史。"
                  : "安全的部门员工来源尚未接入；不会下载全酒店组织或把缺失来源显示为零。"}
              </p>
              <span>{employeeDataAvailable ? "进入员工视图" : "查看接入要求"}</span>
            </Link>
            {unavailableOperations.map(item => (
              <Link href={item.href} key={item.title}>
                <DataStateBadge state="unavailable" />
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
                <span>查看接入要求</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="department-data-boundary">
          <div>
            <span>数据边界</span>
            <strong>尚未接入真实数据</strong>
          </div>
          <p>
            缺少培训事实时，系统不会使用演示指标、零值或其他部门数据替代，也不会生成虚假提醒。
          </p>
        </section>
      </div>
    </AppShell>
  );
}

export default function DepartmentHomePage() {
  return (
    <ProtectedAppProviders>
      <RuntimeDomainRegistryBoundary>
        {registry => <DepartmentCommandCenter registry={registry} />}
      </RuntimeDomainRegistryBoundary>
    </ProtectedAppProviders>
  );
}
