"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DataStateBadge } from "../components/operations/DataStateBadge";
import { AppShell } from "../components/shell/AppShell";
import { useEscapeDismiss } from "../lib/use-escape-dismiss";
import { ProtectedAppProviders } from "../providers";
import type { EmployeeRecord } from "../repositories/contracts/employee-repository";
import { createRepositoryRegistry } from "../repositories/registry";
import { useAuthSession } from "../state/auth-session";

type LoadState = "loading" | "ready" | "error";

function Page() {
  const repository = useMemo(() => createRepositoryRegistry(), []);
  const { session } = useAuthSession();
  const [employees, setEmployees] = useState<readonly EmployeeRecord[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<EmployeeRecord | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [attempt, setAttempt] = useState(0);

  useEscapeDismiss(Boolean(selected), () => setSelected(null));

  useEffect(() => {
    let active = true;
    void (async () => {
      const propertyId =
        repository.environment.dataMode === "mock"
          ? (await repository.property.resolveContext("training-demo.example.test"))
              ?.propertyId
          : session.propertyId;

      if (!propertyId) throw new Error("当前账号尚未解析到有效酒店范围");
      return repository.employee.listEmployees(propertyId);
    })()
      .then(next => {
        if (!active) return;
        setEmployees(next);
        setLoadState("ready");
      })
      .catch(() => {
        if (active) setLoadState("error");
      });

    return () => {
      active = false;
    };
  }, [attempt, repository, session.propertyId]);

  const retry = () => {
    setLoadState("loading");
    setEmployees([]);
    setSelected(null);
    setAttempt(value => value + 1);
  };

  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const filteredEmployees = employees.filter(employee =>
    `${employee.employeeNumber}${employee.nameZh ?? ""}${employee.nameEn ?? ""}`
      .toLocaleLowerCase("zh-CN")
      .includes(normalizedQuery),
  );
  const sourceState = repository.environment.dataMode === "mock" ? "demo" : "real";
  const sourceDescription =
    sourceState === "demo"
      ? "本地验证环境使用合成员工资料，不会用于生产运营判断。"
      : "员工资料来自当前登录账号所属酒店的真实数据范围。";
  const employeeCount = loadState === "ready" ? String(employees.length) : "—";
  const newEmployeeCount =
    loadState === "ready"
      ? String(employees.filter(employee => employee.isNewEmployee).length)
      : "—";

  return (
    <AppShell>
      <div className="page-wrap people-page real-master-page">
        <header className="ops-header">
          <div>
            <span>员工主数据 · EMPLOYEE MASTER</span>
            <h1>员工中心</h1>
            <p>查看当前酒店员工身份与组织归属；员工不是后台登录账号。</p>
          </div>
          <div>
            {loadState === "ready" ? (
              <DataStateBadge state={sourceState} />
            ) : loadState === "error" ? (
              <DataStateBadge state="failed" />
            ) : (
              <span role="status">正在确认数据来源…</span>
            )}
            <Link className="people-import-link" href="/import">
              员工资料更新
            </Link>
          </div>
        </header>

        <section className="people-insight truthful-insight">
          <div>
            <span>{session.propertyNameZh ?? "当前酒店"} · 当前数据边界</span>
            <h2>
              员工身份与组织资料已接入；<em>培训数据尚未接入</em>
              ，不会把模拟培训历史合并到员工档案。
            </h2>
            <p>{sourceDescription}</p>
          </div>
          <div>
            <strong>{employeeCount}</strong>
            <span>员工主数据</span>
          </div>
          <div>
            <strong>{newEmployeeCount}</strong>
            <span>新员工</span>
          </div>
          <div>
            <strong>—</strong>
            <span>培训完成状态</span>
          </div>
        </section>

        <section className="people-tools" aria-label="员工搜索">
          <label className="people-search">
            <input
              aria-label="搜索员工编号、中文名或英文名"
              placeholder="搜索员工编号、中文名或英文名"
              value={query}
              onChange={event => setQuery(event.target.value)}
              disabled={loadState !== "ready"}
            />
          </label>
        </section>

        {loadState === "loading" && (
          <div className="people-empty" role="status" aria-live="polite">
            <strong>正在读取员工主数据</strong>
            <span>系统只会在当前酒店范围确认后显示员工资料。</span>
          </div>
        )}

        {loadState === "error" && (
          <div className="people-empty" role="alert">
            <strong>员工资料暂时无法读取</strong>
            <span>系统没有用零值或演示记录替代失败的数据来源。</span>
            <button
              className="people-import-link"
              onClick={retry}
            >
              重新读取
            </button>
          </div>
        )}

        {loadState === "ready" && filteredEmployees.length > 0 && (
          <>
            <div className="people-table-head" aria-hidden="true">
              <span />
              <span>员工身份</span>
              <span>部门与职位</span>
              <span>入职资料</span>
              <span>数据接入状态</span>
              <span>档案</span>
            </div>
            <section className="people-list" aria-label="员工主数据列表">
              {filteredEmployees.map(employee => (
                <article key={employee.id}>
                  <span aria-hidden="true" />
                  <button
                    className="identity-cell"
                    onClick={() => setSelected(employee)}
                  >
                    <span>{employee.nameZh?.[0] ?? "员"}</span>
                    <div>
                      <strong>
                        {employee.nameZh ?? "中文名待补充"} <small>{employee.nameEn}</small>
                      </strong>
                      <em>
                        {employee.employeeNumber}
                        {employee.isNewEmployee && <b>新员工</b>}
                      </em>
                    </div>
                  </button>
                  <div className="dept-cell">
                    <strong>{employee.departmentName}</strong>
                    <small>
                      {employee.positionName ?? "职位待确认"} ·{" "}
                      {employee.positionFamilyName ?? "职位族待确认"}
                    </small>
                  </div>
                  <div className="training-cell">
                    <strong>{employee.hireDate ?? "日期待补充"}</strong>
                    <small>
                      {employee.gradeOrBand ?? "未设置职级"} ·{" "}
                      {employee.isActive ? "在职" : "非在职"}
                    </small>
                  </div>
                  <div className="risk-tags">
                    <span className="not-connected">培训历史 · 尚未接入</span>
                    <small>仅显示已连接的员工主数据</small>
                  </div>
                  <button className="next-cell" onClick={() => setSelected(employee)}>
                    查看员工档案
                  </button>
                </article>
              ))}
            </section>
          </>
        )}

        {loadState === "ready" && filteredEmployees.length === 0 && (
          <div className="people-empty">
            <strong>{query ? "没有匹配员工" : "尚无员工资料"}</strong>
            <span>
              {query
                ? "请调整搜索内容；搜索不会跨越当前酒店范围。"
                : "可从员工资料更新流程检查文件、归属与待处理问题。"}
            </span>
            {query ? (
              <button className="people-import-link" onClick={() => setQuery("")}>
                清除搜索
              </button>
            ) : (
              <Link className="people-import-link" href="/import">
                前往员工资料更新
              </Link>
            )}
          </div>
        )}

        {selected && (
          <div className="drawer-backdrop" onMouseDown={() => setSelected(null)}>
            <aside
              className="profile-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="员工档案"
              onMouseDown={event => event.stopPropagation()}
            >
              <header>
                <div className="profile-avatar">{selected.nameZh?.[0] ?? "员"}</div>
                <div>
                  <span>{selected.employeeNumber}</span>
                  <h2>
                    {selected.nameZh ?? "中文名待补充"} <small>{selected.nameEn}</small>
                  </h2>
                  <p>
                    {selected.departmentName} · {selected.positionName ?? "职位待确认"}
                  </p>
                </div>
                <button onClick={() => setSelected(null)} aria-label="关闭员工档案">
                  关闭
                </button>
              </header>
              <section>
                <h3>员工档案</h3>
                <dl>
                  <div>
                    <dt>正式部门</dt>
                    <dd>{selected.departmentName}</dd>
                  </div>
                  <div>
                    <dt>职位 / 职位族</dt>
                    <dd>
                      {selected.positionName ?? "待确认"} /{" "}
                      {selected.positionFamilyName ?? "待确认"}
                    </dd>
                  </div>
                  <div>
                    <dt>入职 / 转正日期</dt>
                    <dd>
                      {selected.hireDate ?? "待补充"} /{" "}
                      {selected.probationOrConfirmationDate ?? "待补充"}
                    </dd>
                  </div>
                  <div>
                    <dt>外部资料标识</dt>
                    <dd>
                      {selected.externalIdentifierTypes.join("、") || "尚未连接"}
                    </dd>
                  </div>
                </dl>
                <p>员工资料维护统一从“员工资料更新”流程进入并保留更新记录。</p>
                <Link className="people-import-link" href="/import">
                  前往员工资料更新
                </Link>
              </section>
              <section className="truthful-empty">
                <h3>培训历史</h3>
                <p>
                  尚未接入真实数据。当前员工中心只读取员工主数据，不导入或生成培训完成记录、出勤、反馈或风险标签。
                </p>
              </section>
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function People() {
  return (
    <ProtectedAppProviders>
      <Page />
    </ProtectedAppProviders>
  );
}
