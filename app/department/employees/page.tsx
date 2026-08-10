"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { DataStateBadge } from "../../components/operations/DataStateBadge";
import { EmployeeDirectory } from "../../components/people/EmployeeDirectory";
import { EmployeeProfileDrawer } from "../../components/people/EmployeeProfileDrawer";
import { AppShell } from "../../components/shell/AppShell";
import { ProtectedAppProviders } from "../../providers";
import type { EmployeeRecord } from "../../repositories/contracts/employee-repository";
import { RuntimeDomainRegistryBoundary } from "../../repositories/runtime/RuntimeDomainRegistryBoundary.tsx";
import type { RuntimeDomainRegistry } from "../../repositories/runtime/neon-domain-registry.ts";
import {
  loadScopedDepartmentEmployees,
  type ScopedDepartmentEmployees,
} from "../../services/department-foundation.ts";
import { useAuthSession } from "../../state/auth-session";

const PAGE_SIZE = 25;

function DepartmentEmployees({ registry }: { registry: RuntimeDomainRegistry }) {
  const { session } = useAuthSession();
  const [snapshot, setSnapshot] = useState<ScopedDepartmentEmployees | null>(null);
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<EmployeeRecord | null>(null);
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setSnapshot(null);
      setLoadError(null);
      try {
        const next = await loadScopedDepartmentEmployees(registry, session, {
          query: query || undefined,
          limit: PAGE_SIZE,
          offset,
        });
        if (active) setSnapshot(next);
      } catch (reason) {
        if (!active) return;
        setLoadError(
          reason instanceof Error ? reason.message : "本部门员工读取失败",
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt, offset, query, registry, session]);

  const scopes = snapshot ? snapshot.scopes : session.departmentScopes;
  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(queryDraft.trim());
    setOffset(0);
  };
  const clearSearch = () => {
    setQueryDraft("");
    setQuery("");
    setOffset(0);
  };
  const openProfile = useCallback(
    (employee: EmployeeRecord, trigger: HTMLElement) => {
      setSelected(employee);
      setReturnFocus(trigger);
    },
    [],
  );
  const closeProfile = useCallback(() => setSelected(null), []);
  const presentationState = loadError
    ? "failed"
    : snapshot?.presentationState ?? "unavailable";

  return (
    <AppShell>
      <div className="page-wrap department-employees-page">
        <nav className="page-breadcrumb" aria-label="页面面包屑">
          <Link href="/department">部门工作台</Link>
          <span aria-hidden="true">/</span>
          <span>本部门员工</span>
        </nav>

        <header className="department-employees-heading">
          <div>
            <span>AUTHORIZED EMPLOYEE DIRECTORY</span>
            <h1>本部门员工</h1>
            <p>只显示服务器为当前账号确认的部门分支及其员工主数据。</p>
          </div>
          <DataStateBadge state={presentationState} />
        </header>

        <section
          className="department-authorized-scope"
          aria-labelledby="authorized-scope-title"
        >
          <header>
            <div>
              <span>服务器确认范围</span>
              <h2 id="authorized-scope-title">授权部门范围</h2>
            </div>
            <strong>{scopes.length} 个授权分支</strong>
          </header>
          <div className="department-scope-list">
            {scopes.map(scope => (
              <article className="department-scope-card" key={scope.departmentId}>
                <nav aria-label={`${scope.departmentNameZh} 授权层级`}>
                  {scope.breadcrumb.map((part, index) => (
                    <span key={`${scope.departmentId}-${part}-${index}`}>
                      {part}
                      {index < scope.breadcrumb.length - 1 && (
                        <b aria-hidden="true">›</b>
                      )}
                    </span>
                  ))}
                </nav>
                <strong>{scope.departmentNameZh}</strong>
                <small>
                  {scope.includeDescendants
                    ? "包含此分支下明确授权的下级部门"
                    : "仅限此部门本级，不包含下级部门"}
                </small>
              </article>
            ))}
            {scopes.length === 0 && (
              <div className="scoped-employee-empty">
                <strong>授权范围尚未确认</strong>
                <span>请联系酒店学习与发展经理核对账号的部门授权。</span>
              </div>
            )}
          </div>
        </section>

        <section className="department-employee-boundary">
          <div>
            <span>授权范围内可见记录</span>
            <strong>{snapshot ? snapshot.total : "—"}</strong>
            <small>数量由服务器范围查询返回，不接受浏览器选择部门。</small>
          </div>
          <div>
            <span>资料边界</span>
            <strong>培训历史尚未接入</strong>
            <small>当前页面仅呈现获准查看的员工主数据字段。</small>
          </div>
        </section>

        <section
          className="scoped-employee-panel"
          aria-labelledby="employee-list-title"
        >
          <header>
            <div>
              <span>服务器范围搜索</span>
              <h2 id="employee-list-title">授权范围内员工目录</h2>
            </div>
            <form
              className="department-directory-search"
              aria-label="搜索授权范围内员工"
              onSubmit={applySearch}
            >
              <label>
                <span>员工编号或姓名</span>
                <input
                  type="search"
                  value={queryDraft}
                  onChange={event => setQueryDraft(event.target.value)}
                  placeholder="员工编号、中文名或英文名"
                />
              </label>
              <button type="submit">搜索</button>
              <button type="button" disabled={!query} onClick={clearSearch}>
                清除
              </button>
            </form>
          </header>

          {Boolean(loadError || snapshot?.errors.length) && (
            <div className="department-employee-error" role="alert">
              <div>
                <strong>授权范围内员工资料暂时无法完整读取</strong>
                <span>
                  未读取的记录不会显示为零，也不会扩大当前账号的可见范围。
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAttempt(value => value + 1)}
              >
                重新读取
              </button>
            </div>
          )}

          {!snapshot && !loadError && (
            <div className="scoped-employee-empty" role="status" aria-live="polite">
              <strong>正在读取授权范围内员工</strong>
              <span>搜索和分页均由服务器范围边界执行。</span>
            </div>
          )}

          {snapshot && snapshot.employees.length === 0 && (
            <div className="scoped-employee-empty">
              <strong>{query ? "没有匹配员工" : "当前授权范围没有可见员工"}</strong>
              <span>
                {query
                  ? "请调整搜索内容，搜索仍只在授权分支内执行。"
                  : "这里只表示员工主数据目录中没有可见记录。"}
              </span>
              {query && (
                <button type="button" onClick={clearSearch}>
                  清除搜索
                </button>
              )}
            </div>
          )}

          {snapshot && snapshot.employees.length > 0 && (
            <EmployeeDirectory
              audience="department"
              rows={snapshot.employees}
              total={snapshot.total}
              offset={offset}
              pageSize={PAGE_SIZE}
              onOpenProfile={openProfile}
              onPageChange={nextOffset => setOffset(Math.max(0, nextOffset))}
            />
          )}
        </section>

        <footer className="department-employees-footer">
          <p>发现员工归属问题时，请联系酒店学习与发展经理维护员工主数据。</p>
          <Link href="/department">返回部门工作台</Link>
        </footer>

        {selected && (
          <EmployeeProfileDrawer
            audience="department"
            employee={selected}
            sourceLabel="服务器授权的部门员工目录记录。"
            refreshedAt={snapshot?.refreshedAt ?? null}
            refreshState="ready"
            returnFocus={returnFocus}
            onClose={closeProfile}
          />
        )}
      </div>
    </AppShell>
  );
}

export default function DepartmentEmployeesPage() {
  return (
    <ProtectedAppProviders>
      <RuntimeDomainRegistryBoundary>
        {registry => <DepartmentEmployees registry={registry} />}
      </RuntimeDomainRegistryBoundary>
    </ProtectedAppProviders>
  );
}
