"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../../components/shell/AppShell";
import { DataStateBadge } from "../../components/operations/DataStateBadge";
import { ProtectedAppProviders } from "../../providers";
import { createRepositoryRegistry } from "../../repositories/registry.ts";
import {
  loadScopedDepartmentEmployees,
  type ScopedDepartmentEmployees,
} from "../../services/department-foundation.ts";
import { useAuthSession } from "../../state/auth-session";

function DepartmentEmployees() {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const { session } = useAuthSession();
  const scopes = session.departmentScopes;
  const [snapshot, setSnapshot] = useState<ScopedDepartmentEmployees | null>(null);
  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const employeeDataAvailable = Boolean(
    snapshot && snapshot.presentationState !== "unavailable",
  );

  useEffect(() => {
    let active = true;
    setLoadError(null);
    void loadScopedDepartmentEmployees(registry, session)
      .then(next => {
        if (active) setSnapshot(next);
      })
      .catch(reason => {
        if (!active) return;
        setLoadError(reason instanceof Error ? reason.message : "本部门员工读取失败");
      });
    return () => {
      active = false;
    };
  }, [attempt, registry, session]);

  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const employees = (snapshot?.employees ?? []).filter(employee => {
    if (!normalizedQuery) return true;
    return [
      employee.employeeNumber,
      employee.nameZh,
      employee.nameEn,
      employee.departmentName,
      employee.positionName,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("zh-CN")
      .includes(normalizedQuery);
  });
  const breadcrumb = scopes[0]?.breadcrumb.join(" › ") ?? "授权范围待确认";

  return (
    <AppShell>
      <div className="page-wrap department-employees-page">
        <nav className="page-breadcrumb" aria-label="面包屑导航">
          <Link href="/department">返回部门工作台</Link>
          <span aria-hidden="true">/</span>
          <span>本部门员工</span>
        </nav>

        <header className="department-employees-heading">
          <div>
            <span>AUTHORIZED EMPLOYEE FOUNDATION</span>
            <h1>本部门员工</h1>
            <p>{breadcrumb}</p>
          </div>
          <DataStateBadge
            state={snapshot?.presentationState ?? (loadError ? "failed" : "unavailable")}
          />
        </header>

        <section className="department-employee-boundary">
          <div>
            <span>授权范围</span>
            <strong>
              {scopes.length > 1 ? `${scopes.length} 个部门分支` : breadcrumb}
            </strong>
            <small>
              {scopes.some(scope => scope.includeDescendants)
                ? "包含明确授权的下级部门"
                : "仅限授权部门本级"}
            </small>
          </div>
          <div>
            <span>培训数据状态</span>
            <strong>培训历史尚未接入</strong>
            <small>不显示虚构完成率、培训时数或风险状态</small>
          </div>
        </section>

        <section className="scoped-employee-panel" aria-labelledby="employee-list-title">
          <header>
            <div>
              <span>范围内员工主数据</span>
              <h2 id="employee-list-title">
                {employeeDataAvailable
                  ? `${snapshot?.employees.length ?? 0} 条可见记录`
                  : snapshot?.presentationState === "unavailable"
                    ? "员工数据尚未接入"
                    : "正在确认可见记录"}
              </h2>
            </div>
            <label>
              <span>搜索范围内员工</span>
              <input
                type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                disabled={!employeeDataAvailable}
                placeholder={
                  employeeDataAvailable
                    ? "员工编号、姓名、部门或职位"
                    : "安全范围数据源接入后可搜索"
                }
              />
            </label>
          </header>

          {Boolean(loadError || snapshot?.errors.length) && (
            <div className="department-employee-error" role="alert">
              <div>
                <strong>部分员工基础事实暂时无法读取</strong>
                <span>未读取的记录不会被解释为零，也不会扩大授权范围。</span>
              </div>
              <button onClick={() => setAttempt(value => value + 1)}>重新读取</button>
            </div>
          )}

          {!snapshot && !loadError && (
            <div className="scoped-employee-empty" role="status">
              <strong>正在读取授权范围内的员工基础</strong>
              <span>只加载当前账号获准查看的部门分支。</span>
            </div>
          )}

          {snapshot?.presentationState === "unavailable" && (
            <div className="scoped-employee-empty">
              <strong>尚未接入安全的部门员工数据源</strong>
              <span>
                当前仅显示服务器确认的授权范围；系统不会读取全酒店组织与员工数据，也不会将缺失来源解释为零。
              </span>
            </div>
          )}

          {employeeDataAvailable && employees.length === 0 && (
            <div className="scoped-employee-empty">
              <strong>{normalizedQuery ? "没有匹配的范围内员工" : "当前范围没有可见员工记录"}</strong>
              <span>
                {normalizedQuery
                  ? "请调整搜索条件。"
                  : "这不是培训完成为零；这里只表示当前员工主数据中没有可见记录。"}
              </span>
            </div>
          )}

          {employees.length > 0 && (
            <div className="scoped-employee-list">
              <div className="scoped-employee-table-head" aria-hidden="true">
                <span>员工</span>
                <span>部门归属</span>
                <span>职位</span>
                <span>员工状态</span>
                <span>培训数据</span>
              </div>
              {employees.map(employee => (
                <article key={employee.id}>
                  <div className="employee-identity-cell">
                    <span aria-hidden="true">{(employee.nameZh ?? employee.nameEn ?? "员").slice(0, 1)}</span>
                    <div>
                      <strong>{employee.nameZh ?? employee.nameEn ?? "姓名未提供"}</strong>
                      <small>
                        {employee.employeeNumber}
                        {employee.nameZh && employee.nameEn ? ` · ${employee.nameEn}` : ""}
                      </small>
                    </div>
                  </div>
                  <div>
                    <strong>{employee.departmentName || "部门名称未提供"}</strong>
                    <small>{employee.operationalUnitName ?? "无运营单元"}</small>
                  </div>
                  <div>
                    <strong>{employee.positionName ?? "职位待确认"}</strong>
                    <small>{employee.positionFamilyName ?? "职位族待确认"}</small>
                  </div>
                  <div>
                    <strong>{employmentStatus(employee.employmentStatus)}</strong>
                    <small>{employee.isNewEmployee ? "新员工记录" : "在职员工记录"}</small>
                  </div>
                  <div>
                    <DataStateBadge state="unavailable" />
                    <small>培训历史尚未接入</small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className="department-employees-footer">
          <p>发现员工部门归属问题时，请联系酒店学习与发展经理进行基础数据维护。</p>
          <Link href="/department">返回部门工作台</Link>
        </footer>
      </div>
    </AppShell>
  );
}

function employmentStatus(status: string) {
  const labels: Record<string, string> = {
    active: "在职",
    inactive: "非在职",
    leave: "休假中",
    terminated: "已离职",
    unknown: "待确认",
  };
  return labels[status] ?? "待确认";
}

export default function DepartmentEmployeesPage() {
  return (
    <ProtectedAppProviders>
      <DepartmentEmployees />
    </ProtectedAppProviders>
  );
}
