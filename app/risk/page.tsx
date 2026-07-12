"use client";

import { useState } from "react";
import { AppShell } from "../components/shell/AppShell";
import { AppProviders } from "../providers";
import { useDepartmentScope } from "../state/department-scope";
import { usePrototypeFeedback } from "../state/prototype-feedback";

const risks = [
  { severity: "critical", label: "严重", title: "礼宾部消防安全培训逾期", department: "礼宾部", owner: "陈雅婷 · 部门培训员", due: "7 月 13 日", people: "3 人", action: "创建本周补训" },
  { severity: "warning", label: "预警", title: "前台新员工进度低于目标", department: "前台", owner: "唐宁 · 前厅部主管", due: "7 月 17 日", people: "2 人", action: "发送完成提醒" },
  { severity: "warning", label: "预警", title: "宴会部反馈回收率偏低", department: "宴会部", owner: "顾言 · 宴会培训员", due: "7 月 15 日", people: "8 人", action: "发送反馈提醒" },
  { severity: "low", label: "观察", title: "客房部培训员覆盖不足", department: "客房部", owner: "林静 · L&D 经理", due: "7 月 25 日", people: "1 个部门", action: "指派部门培训员" },
] as const;
const groups = [{ key: "critical", title: "严重风险", note: "48 小时内介入" }, { key: "warning", title: "预警风险", note: "本周完成处置" }, { key: "low", title: "观察项", note: "持续跟踪" }] as const;

function Page() {
  const [severityFilter, setSeverityFilter] = useState("all");
  const { departmentId, breadcrumb } = useDepartmentScope();
  const { showToast } = usePrototypeFeedback();
  const scoped = departmentId === "concierge" ? risks.slice(0, 1) : departmentId === "front-office" ? risks.slice(0, 2) : risks;
  const visibleGroups = severityFilter === "all" ? groups : groups.filter(group => group.key === severityFilter);
  const topRisk = scoped[0];
  return <AppShell><div className="page-wrap dashboard-page">
    <header className="dash-header"><div><span>{breadcrumb.map(item => item.nameZh).join(" › ")}</span><h1>培训风险看板</h1><p>Learning Risk Dashboard</p></div><button className="outline-action" onClick={() => showToast("风险周报已生成（原型）")}>生成风险周报</button></header>
    <section className="narrative-strip risk-narrative"><div><span>管理问题</span><h2>哪项风险需要立即行动？</h2><p>{topRisk.title}影响 {topRisk.people}，距离到期不足 3 天，建议立即创建补训。</p></div><button onClick={() => showToast("最高风险处置面板已打开")}>立即处理 →</button></section>
    <div className="risk-stats"><div><span className="critical" />严重风险<strong>{scoped.filter(risk => risk.severity === "critical").length}</strong><small>需 48 小时内介入</small></div><div><span className="warning" />预警风险<strong>{scoped.filter(risk => risk.severity === "warning").length}</strong><small>本周完成处置</small></div><div><span className="low" />观察项<strong>{scoped.filter(risk => risk.severity === "low").length}</strong><small>持续跟踪</small></div><div><span className="teal" />影响人数<strong>{departmentId === "concierge" ? 3 : departmentId === "front-office" ? 5 : 14}</strong><small>当前组织范围</small></div></div>
    <section className="risk-queue"><div className="queue-heading"><div><h3>风险处置队列</h3><p>Executive action queue</p></div><div className="severity-filter" aria-label="风险级别筛选"><button className={severityFilter === "all" ? "active" : ""} onClick={() => setSeverityFilter("all")}>全部 {scoped.length}</button><button className={severityFilter === "critical" ? "active" : ""} onClick={() => setSeverityFilter("critical")}>严重</button><button className={severityFilter === "warning" ? "active" : ""} onClick={() => setSeverityFilter("warning")}>预警</button><button className={severityFilter === "low" ? "active" : ""} onClick={() => setSeverityFilter("low")}>观察</button></div></div>
      {visibleGroups.map(group => { const items = scoped.filter(risk => risk.severity === group.key); if (!items.length) return null; return <section className={`severity-group ${group.key}`} key={group.key}><header><div><i /><h3>{group.title}</h3><span>{items.length}</span></div><small>{group.note}</small></header><div className="risk-card-list">{items.map(risk => <article className="executive-risk-card" key={risk.title}><span className="thin-accent" /><div className="risk-identity"><div><span className={`severity-badge ${risk.severity}`}><i />严重程度 · {risk.label}</span><span className="department-label">{risk.department}</span></div><h3>{risk.title}</h3><p>影响培训合规与部门目标完成，需要按期完成处置并持续跟踪。</p></div><div className="risk-details"><div><span>负责人</span><strong>{risk.owner}</strong></div><div><span>到期日</span><strong>{risk.due}</strong></div><div><span>影响人数</span><strong>{risk.people}</strong></div></div><div className="risk-action"><span>下一步行动</span><strong>{risk.action}</strong><button onClick={() => showToast(`${risk.action}面板已打开`)}>开始处理 <b>→</b></button></div></article>)}</div></section>; })}
      {visibleGroups.every(group => !scoped.some(risk => risk.severity === group.key)) && <div className="risk-empty"><strong>当前范围暂无此级别风险</strong><span>可切换其他级别继续查看。</span></div>}
    </section>
    <div className="two-panels"><section className="tailored-card"><div className="card-heading"><div><h3>风险来源分布</h3><p>Risk source mix</p></div></div><div className="risk-source"><div className="source-donut" /><ul><li><i className="critical" />必修培训 <b>42%</b></li><li><i className="warning" />新员工进度 <b>28%</b></li><li><i className="teal" />反馈与出席 <b>20%</b></li><li><i className="low" />培训员覆盖 <b>10%</b></li></ul></div></section><section className="tailored-card next-action"><div><h3>L&D 经理下一步</h3><p>Recommended intervention</p></div><strong>先处理严重风险，再将预警风险委派给对应部门培训管理员。</strong><button onClick={() => showToast("风险委派面板已打开")}>批量委派 →</button></section></div>
  </div></AppShell>;
}
export default function Risk() { return <AppProviders><Page /></AppProviders>; }
