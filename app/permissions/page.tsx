"use client";

import { useState } from "react";
import { AppShell } from "../components/shell/AppShell";
import { AppProviders } from "../providers";
import { usePrototypeFeedback } from "../state/prototype-feedback";

const branches = [
  { depth: 0, name: "房务部", en: "Rooms", people: 186, active: true },
  { depth: 1, name: "前厅部", en: "Front Office", people: 72 },
  { depth: 2, name: "礼宾部", en: "Concierge", people: 18 },
  { depth: 2, name: "前台", en: "Front Desk", people: 31 },
  { depth: 2, name: "宾客关系", en: "Guest Relations", people: 23 },
  { depth: 1, name: "客房部", en: "Housekeeping", people: 114 },
];

const trainers = [
  { name: "陈雅婷", en: "Amy Chen", branch: "前厅部 / 礼宾部", assignedBranch: "房务部 › 前厅部 › 礼宾部", coverage: 18, allowedActions: ["员工培训进度", "发送提醒", "考勤与反馈", "创建补训"], status: "运行正常", next: "查看范围" },
  { name: "赵思远", en: "Jason Zhao", branch: "客房部 / 公共区域", assignedBranch: "房务部 › 客房部 › 公共区域", coverage: 29, allowedActions: ["员工培训进度", "发送提醒", "考勤与反馈"], status: "运行正常", next: "调整范围" },
  { name: "周可欣", en: "Ivy Zhou", branch: "餐饮部 / 餐厅运营", assignedBranch: "餐饮部 › 餐厅运营", coverage: 46, allowedActions: ["员工培训进度", "发送提醒", "创建补训"], status: "待确认", next: "确认邀请" },
];

const positions = [
  ["礼宾专员", "Concierge Agent", "礼宾部", "12 人"],
  ["前台接待", "Front Desk Agent", "前台", "24 人"],
  ["宾客关系主任", "Guest Relations Officer", "宾客关系", "9 人"],
  ["客房服务员", "Room Attendant", "客房部", "68 人"],
];

function Page() {
  const [tab, setTab] = useState("trainers");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [role, setRole] = useState("manager");
  const { showToast } = usePrototypeFeedback();

  return <AppShell><div className="page-wrap permissions-page">
    <header className="ops-header control-header">
      <div><span>ORGANIZATION CONTROL</span><h1>组织与权限中心</h1><p>Organization &amp; Access Control</p></div>
      <div><button onClick={() => setScopeOpen(true)}>部门范围预览</button><button onClick={() => setInviteOpen(true)}>＋ 邀请账号</button></div>
    </header>

    <section className="control-narrative">
      <div><span>组织运营结论</span><h2>房务部已覆盖 <em>94%</em> 员工，客房部仍缺少 1 名部门培训员。</h2><p>部门层级决定员工、培训、提醒与报表的可见范围。</p></div>
      <div className="control-signals"><article><strong>12</strong><span>部门分支</span></article><article><strong>8</strong><span>培训员在岗</span></article><article><strong>94%</strong><span>员工覆盖</span></article><article className="attention"><strong>2</strong><span>待处理事项</span></article></div>
    </section>

    <section className="role-experience">
      <div><span>切换体验角色</span><strong>{role === "manager" ? "学习与发展经理" : "部门培训管理员"}</strong><small>{role === "manager" ? "可管理全酒店范围、KPI 目标、角色与账号" : "仅管理被分配部门的员工、考勤、反馈与补训"}</small></div>
      <div className="role-toggle"><button className={role === "manager" ? "active" : ""} onClick={() => { setRole("manager"); showToast("已切换为学习与发展经理视角"); }}>学习与发展经理</button><button className={role === "trainer" ? "active" : ""} onClick={() => { setRole("trainer"); showToast("已切换为部门培训管理员视角"); }}>部门培训管理员</button></div>
    </section>

    <nav className="control-tabs" aria-label="组织与权限模块">
      {[["tree", "多级部门架构", "Department tree"], ["positions", "岗位管理", "Positions"], ["trainers", "部门培训员", "Trainers"], ["roles", "角色与账号", "Roles & accounts"]].map(([key, zh, en]) => <button className={tab === key ? "active" : ""} onClick={() => setTab(key)} key={key}><strong>{zh}</strong><small>{en}</small></button>)}
    </nav>

    {tab === "trainers" && <section className="trainer-workspace">
      <div className="section-heading"><div><h3>部门培训员分配</h3><p>Trainer assignment · 以组织分支定义管理范围</p></div><button onClick={() => showToast("新增培训员分配面板已打开")}>＋ 新增分配</button></div>
      <div className="trainer-list">{trainers.map((trainer, index) => <article key={trainer.name} className={trainer.status === "待确认" ? "pending" : ""}>
        <div className="trainer-identity"><span>{trainer.name[0]}</span><div><strong>{trainer.name}</strong><small>{trainer.en}</small><em>{trainer.branch}</em></div></div>
        <div className="branch-cell"><small>分配部门分支</small><strong>{trainer.assignedBranch}</strong></div>
        <div className="coverage-cell"><small>覆盖员工</small><strong>{trainer.coverage}</strong><span>人</span></div>
        <div className="allowed-cell"><small>可执行事项</small><div>{trainer.allowedActions.map(action => <span key={action}>{action}</span>)}</div></div>
        <div className="trainer-action"><span className={trainer.status === "待确认" ? "wait" : "healthy"}><i />{trainer.status}</span><small>下一步行动</small><button onClick={() => index === 0 ? setScopeOpen(true) : showToast(`${trainer.name}：${trainer.next}面板已打开`)}>{trainer.next} →</button></div>
      </article>)}</div>
    </section>}

    {tab === "tree" && <section className="org-control-grid">
      <article className="branch-manager"><header><div><h3>多级部门架构</h3><p>以业务组织定义全部系统范围</p></div><button onClick={() => showToast("新增子部门面板已打开")}>＋ 新增子部门</button></header>{branches.map(branch => <button className={branch.active ? "active" : ""} key={branch.name} style={{ paddingLeft: 18 + branch.depth * 24 }} onClick={() => showToast(`已选择 ${branch.name}，范围摘要已更新`)}><i /> <span><strong>{branch.name}</strong><small>{branch.en}</small></span><em>{branch.people} 人</em></button>)}</article>
      <article className="branch-summary"><span>当前范围</span><h3>房务部 <small>Rooms</small></h3><p>包含前厅部、客房部及其全部下级部门。</p><dl><div><dt>员工</dt><dd>186</dd></div><div><dt>培训员</dt><dd>5 / 6</dd></div><div><dt>岗位</dt><dd>14</dd></div></dl><button onClick={() => setScopeOpen(true)}>查看范围影响</button><button onClick={() => showToast("部门编辑面板已打开")}>编辑部门资料</button></article>
    </section>}

    {tab === "positions" && <section className="position-workspace"><div className="section-heading"><div><h3>岗位管理</h3><p>Position management · 与部门范围保持一致</p></div><button onClick={() => showToast("新增岗位面板已打开")}>＋ 新增岗位</button></div><div className="position-grid">{positions.map(position => <article key={position[0]}><i /><div><strong>{position[0]}</strong><small>{position[1]}</small></div><span>{position[2]}</span><em>{position[3]}</em><button onClick={() => showToast(`${position[0]}编辑面板已打开`)}>管理 →</button></article>)}</div></section>}

    {tab === "roles" && <section className="role-workspace">
      <div className="role-comparison"><article className="primary-role"><span>全酒店运营负责人</span><h3>学习与发展经理</h3><small>L&amp;D Manager</small><ul><li>查看并管理全酒店所有部门</li><li>定义 KPI 目标与健康分权重</li><li>邀请账号并分配角色</li><li>管理全部培训计划与风险</li></ul><button onClick={() => showToast("学习与发展经理角色详情已打开")}>查看角色说明</button></article><article><span>部门执行负责人</span><h3>部门培训管理员</h3><small>Department Training Administrator</small><ul><li>仅查看被分配部门范围内员工</li><li>发送提醒、管理考勤与反馈</li><li>创建本部门补训安排</li><li>不可管理全局 KPI 或其他管理员</li></ul><button onClick={() => setScopeOpen(true)}>预览部门视角</button></article></div>
      <div className="account-strip"><div><strong>账号邀请</strong><small>使用业务角色与部门范围完成邀请</small></div><span>8 个活跃账号</span><span>1 个待接受邀请</span><button onClick={() => setInviteOpen(true)}>邀请新账号</button></div>
    </section>}

    {scopeOpen && <div className="drawer-backdrop" onMouseDown={() => setScopeOpen(false)}><aside className="scope-preview-drawer" onMouseDown={e => e.stopPropagation()}><header><div><span>部门范围预览</span><h2>{role === "manager" ? "学习与发展经理" : "部门培训管理员"}</h2><p>{role === "manager" ? "全酒店范围" : "房务部 › 前厅部 › 礼宾部"}</p></div><button onClick={() => setScopeOpen(false)}>×</button></header><div className="scope-map"><span>上海澜庭酒店</span><i /><span>房务部 Rooms</span><i /><strong>{role === "manager" ? "全部分支均可见" : "礼宾部 Concierge"}</strong></div><section><h3>在此范围内可以</h3>{(role === "manager" ? ["查看全部员工与培训数据", "管理全酒店 KPI 目标", "配置角色与账号", "查看所有风险与报表"] : ["查看礼宾部 18 名员工", "发送提醒与创建补训", "管理本部门考勤和反馈", "查看本部门培训报表"]).map(item => <p key={item}>✓ {item}</p>)}</section><section className="scope-boundary"><h3>范围边界</h3><p>{role === "manager" ? "作为超级管理员，可在全部部门层级间切换。" : "无法查看其他部门员工，不能修改全局 KPI，也不能管理其他管理员。"}</p></section><button onClick={() => { setScopeOpen(false); showToast("部门范围预览已确认"); }}>确认范围</button></aside></div>}

    {inviteOpen && <div className="dialog-backdrop"><div className="dialog invite-dialog"><header className="dialog-head"><div><span className="eyebrow">ACCOUNT INVITATION</span><h2>邀请账号</h2></div><button className="icon-button" onClick={() => setInviteOpen(false)}>×</button></header><p>选择业务角色和负责部门，系统将发送一封模拟邀请。</p><label>员工姓名<input defaultValue="徐婉宁 Wendy Xu" /></label><label>业务角色<select><option>部门培训管理员</option><option>学习与发展经理</option></select></label><label>负责部门<select><option>房务部 › 客房部</option><option>房务部 › 前厅部 › 礼宾部</option></select></label><div className="invite-note">此账号将仅能查看和操作所选部门分支。</div><footer><button onClick={() => setInviteOpen(false)}>取消</button><button onClick={() => { setInviteOpen(false); showToast("模拟邀请已发送给徐婉宁"); }}>发送邀请</button></footer></div></div>}
  </div></AppShell>;
}

export default function Permissions() { return <AppProviders><Page /></AppProviders>; }
