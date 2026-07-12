"use client";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/shell/AppShell";
import { AppProviders } from "../providers";
import { createRepositoryRegistry } from "../repositories/registry";
import type { EmployeeRecord } from "../repositories/contracts/employee-repository";
import { usePrototypeFeedback } from "../state/prototype-feedback";
import { useDepartmentScope } from "../state/department-scope";
import { useEscapeDismiss } from "../lib/use-escape-dismiss";
function Page() {
  const repo = useMemo(() => createRepositoryRegistry(), []),
    [employees, setEmployees] = useState<readonly EmployeeRecord[]>([]),
    [q, setQ] = useState(""),
    [selected, setSelected] = useState<EmployeeRecord | null>(null),
    [loading, setLoading] = useState(true);
  const { showToast } = usePrototypeFeedback();
  const { departmentId } = useDepartmentScope();
  useEscapeDismiss(Boolean(selected), () => setSelected(null));
  useEffect(() => {
    repo.employee
      .listEmployees("synthetic-property-a1", {
        departmentId: departmentId === "rooms" ? undefined : departmentId,
      })
      .then(setEmployees)
      .finally(() => setLoading(false));
  }, [repo, departmentId]);
  const filteredEmployees = employees.filter((e) =>
    `${e.employeeNumber}${e.nameZh}${e.nameEn}`
      .toLowerCase()
      .includes(q.toLowerCase()),
  );
  return (
    <AppShell>
      <div className="page-wrap people-page real-master-page">
        <header className="ops-header">
          <div>
            <span>员工主数据 · Employee Master</span>
            <h1>员工运营中心</h1>
            <p>People Operations Command Center</p>
          </div>
          <div>
            <a className="people-import-link" href="/import">
              导入员工
            </a>
            <button onClick={() => showToast("分配培训将在培训模块接入后开放")}>
              ＋ 分配培训
            </button>
          </div>
        </header>
        <section className="people-insight truthful-insight">
          <div>
            <span>当前数据边界</span>
            <h2>
              员工身份与组织资料已接入；<em>培训数据尚未接入</em>
              ，不会把模拟培训历史合并到真实员工。
            </h2>
          </div>
          <div>
            <strong>{employees.length}</strong>
            <span>员工主数据</span>
          </div>
          <div>
            <strong>{employees.filter((x) => x.isNewEmployee).length}</strong>
            <span>新员工</span>
          </div>
          <div>
            <strong>—</strong>
            <span>必修培训状态</span>
          </div>
        </section>
        <section className="people-tools">
          <label className="people-search">
            ⌕
            <input
              aria-label="搜索员工编号、中文名或英文名"
              placeholder="搜索员工编号、中文名或英文名"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <label>
            部门层级筛选
            <select onChange={() => showToast("部门范围已更新")}>
              <option>全部正式部门</option>
              <option>房务部 › 前厅部</option>
              <option>工程部</option>
            </select>
          </label>
          <label>
            在职状态
            <select>
              <option>全部状态</option>
              <option>在职</option>
              <option>停用</option>
            </select>
          </label>
        </section>
        <div className="people-table-head">
          <span />
          <span>员工身份</span>
          <span>部门与职位</span>
          <span>入职资料</span>
          <span>数据接入状态</span>
          <span>下一步行动</span>
        </div>
        <section className="people-list">
          {loading && <div className="people-empty">正在读取员工主数据…</div>}
          {filteredEmployees.map((e) => (
            <article key={e.id}>
              <input type="checkbox" aria-label={`选择${e.nameZh}`} />
              <button className="identity-cell" onClick={() => setSelected(e)}>
                <span>{e.nameZh?.[0] ?? "员"}</span>
                <div>
                  <strong>
                    {e.nameZh} <small>{e.nameEn}</small>
                  </strong>
                  <em>
                    {e.employeeNumber}
                    {e.isNewEmployee && <b>新员工</b>}
                  </em>
                </div>
              </button>
              <div className="dept-cell">
                <strong>{e.departmentName}</strong>
                <small>
                  {e.positionName ?? "职位待确认"} ·{" "}
                  {e.positionFamilyName ?? "职位族待确认"}
                </small>
                <button onClick={() => showToast("编辑部门与职位面板已打开")}>
                  编辑部门与职位
                </button>
              </div>
              <div className="training-cell">
                <strong>{e.hireDate ?? "日期待补充"}</strong>
                <small>
                  {e.gradeOrBand ?? "未设置职级"} ·{" "}
                  {e.isActive ? "在职" : "停用"}
                </small>
              </div>
              <div className="risk-tags">
                <span className="not-connected">培训历史 · 尚未接入</span>
                <small>风险标签 · 尚未接入</small>
              </div>
              <button className="next-cell" onClick={() => setSelected(e)}>
                查看员工档案 →
              </button>
            </article>
          ))}
        </section>
        {!loading && !filteredEmployees.length && (
          <div className="people-empty">
            <strong>没有匹配员工</strong>
            <span>请调整搜索条件或在导入中心检查未解决记录。</span>
          </div>
        )}
        <section className="people-batch-actions">
          <span>批量操作</span>
          <button onClick={() => showToast("批量员工状态面板已打开")}>
            批量操作
          </button>
          <button onClick={() => showToast("创建补训需等待培训模块接入")}>
            创建补训
          </button>
        </section>
        {selected && (
          <div
            className="drawer-backdrop"
            onMouseDown={() => setSelected(null)}
          >
            <aside
              className="profile-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="员工档案"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <header>
                <div className="profile-avatar">{selected.nameZh?.[0]}</div>
                <div>
                  <span>{selected.employeeNumber}</span>
                  <h2>
                    {selected.nameZh} <small>{selected.nameEn}</small>
                  </h2>
                  <p>
                    {selected.departmentName} · {selected.positionName}
                  </p>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  aria-label="关闭员工档案"
                >
                  ×
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
                      {selected.positionName} / {selected.positionFamilyName}
                    </dd>
                  </div>
                  <div>
                    <dt>入职 / 转正日期</dt>
                    <dd>
                      {selected.hireDate} /{" "}
                      {selected.probationOrConfirmationDate}
                    </dd>
                  </div>
                  <div>
                    <dt>外部标识</dt>
                    <dd>
                      {selected.externalIdentifierTypes.join("、") ||
                        "尚未连接"}
                    </dd>
                  </div>
                </dl>
                <button onClick={() => showToast("员工基本资料编辑已打开")}>
                  编辑员工信息
                </button>
              </section>
              <section className="truthful-empty">
                <h3>培训历史</h3>
                <p>
                  尚未接入。2C-C 仅处理员工主数据，不导入培训历史、CTC/GTC
                  完成记录或风险标签。
                </p>
              </section>
              <footer>
                <button disabled title="培训模块尚未接入">
                  分配培训
                </button>
                <button disabled title="培训模块尚未接入">
                  创建补训
                </button>
              </footer>
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}
export default function People() {
  return (
    <AppProviders>
      <Page />
    </AppProviders>
  );
}
