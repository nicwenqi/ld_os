"use client";

import { useState } from "react";
import { AppShell } from "../components/shell/AppShell";
import { AppProviders } from "../providers";
import { useEscapeDismiss } from "../lib/use-escape-dismiss";
import { useDepartmentScope } from "../state/department-scope";
import { usePrototypeFeedback } from "../state/prototype-feedback";

const events = [
  { day: 3, time: "09:00", title: "酒店文化与服务承诺", dept: "人力资源部", status: "已发布", tone: "published", trainer: "沈悦", type: "入职", mandatory: "必修" },
  { day: 7, time: "14:00", title: "奢华服务沟通", dept: "前厅部", status: "已通知", tone: "notified", trainer: "唐宁", type: "服务", mandatory: "选修" },
  { day: 11, time: "10:00", title: "消防安全与应急响应", dept: "房务部", status: "签到开放", tone: "checkin", trainer: "沈悦", type: "必修", mandatory: "必修" },
  { day: 16, time: "13:30", title: "宾客投诉处理", dept: "前厅部", status: "待反馈", tone: "feedback", trainer: "唐宁", type: "服务", mandatory: "必修" },
  { day: 18, time: "15:00", title: "礼宾服务动线演练", dept: "礼宾部", status: "已发布", tone: "published", trainer: "陈雅婷", type: "岗位", mandatory: "必修" },
  { day: 21, time: "09:30", title: "食品卫生与 HACCP", dept: "餐饮部", status: "已发布", tone: "published", trainer: "沈悦", type: "必修", mandatory: "必修" },
  { day: 25, time: "15:00", title: "一线主管领导力", dept: "全酒店", status: "草稿", tone: "draft", trainer: "沈悦", type: "领导力", mandatory: "选修" },
  { day: 29, time: "10:00", title: "部门培训员认证", dept: "人力资源部", status: "已完成", tone: "done", trainer: "沈悦", type: "认证", mandatory: "必修" },
];

const scopeDepartments: Record<string, string[]> = {
  rooms: ["房务部", "前厅部", "礼宾部"],
  "front-office": ["前厅部", "礼宾部"],
  concierge: ["礼宾部"],
};

function Page() {
  const [view, setView] = useState("month");
  const [create, setCreate] = useState(false);
  const [trainer, setTrainer] = useState("全部培训师");
  const [status, setStatus] = useState("全部状态");
  const [courseType, setCourseType] = useState("全部类型");
  const [mandatory, setMandatory] = useState("全部");
  const { departmentId, breadcrumb } = useDepartmentScope();
  const { showToast } = usePrototypeFeedback();
  const closeCreate = () => setCreate(false);
  useEscapeDismiss(create, closeCreate);
  const current = breadcrumb.at(-1)!;
  const allowedDepartments = scopeDepartments[departmentId] ?? [current.nameZh];
  const scopedEvents = events.filter(event =>
    (event.dept === "全酒店" || allowedDepartments.includes(event.dept)) &&
    (trainer === "全部培训师" || event.trainer === trainer) &&
    (status === "全部状态" || event.status === status) &&
    (courseType === "全部类型" || event.type === courseType) &&
    (mandatory === "全部" || event.mandatory === mandatory)
  );
  const saveDraft = () => { setCreate(false); showToast("培训场次已保存为草稿"); };
  const publishSession = () => { setCreate(false); showToast("培训场次已发布，签到与反馈二维码已生成"); };

  return <AppShell><div className="page-wrap calendar-page">
    <header className="calendar-head"><div><span>2026 年 7 月 · {breadcrumb.map(item => item.nameZh).join(" › ")}</span><h1>培训日历</h1><p>Training Operations Calendar</p></div><div><button onClick={() => showToast("已回到今天 · 7 月 12 日")}>今天</button><button className="primary-small" onClick={() => setCreate(true)}>＋ 创建培训场次</button></div></header>
    <section className="calendar-controls"><div className="view-tabs"><button className={view === "month" ? "active" : ""} onClick={() => setView("month")}>月视图</button><button className={view === "week" ? "active" : ""} onClick={() => setView("week")}>周视图</button><button className={view === "day" ? "active" : ""} onClick={() => setView("day")}>日视图</button></div><div className="calendar-filters"><label>部门筛选 · 当前范围<select value={current.nameZh} onChange={() => showToast("请从顶部组织范围切换部门")}><option>{current.nameZh}</option></select></label><label>培训师筛选<select value={trainer} onChange={event => setTrainer(event.target.value)}><option>全部培训师</option><option>沈悦</option><option>唐宁</option><option>陈雅婷</option></select></label><label>状态筛选<select value={status} onChange={event => setStatus(event.target.value)}><option>全部状态</option><option>已发布</option><option>签到开放</option><option>待反馈</option></select></label><label>课程类型<select value={courseType} onChange={event => setCourseType(event.target.value)}><option>全部类型</option><option>必修</option><option>服务</option><option>岗位</option></select></label><label>必修 / 选修<select value={mandatory} onChange={event => setMandatory(event.target.value)}><option>全部</option><option>必修</option><option>选修</option></select></label></div></section>
    {view === "month" ? <Month onCreate={() => setCreate(true)} events={scopedEvents} /> : view === "week" ? <Week onCreate={() => setCreate(true)} scope={current.nameZh} /> : <Day onCreate={() => setCreate(true)} scope={current.nameZh} />}
    {!scopedEvents.length && view === "month" && <div className="calendar-empty"><strong>当前筛选下暂无培训场次</strong><span>可调整筛选条件，或为{current.nameZh}创建新的培训场次。</span><button onClick={() => setCreate(true)}>创建培训场次</button></div>}
    <div className="calendar-legend"><span><i className="draft" />草稿</span><span><i className="published" />已发布</span><span><i className="notified" />已通知</span><span><i className="checkin" />签到开放</span><span><i className="feedback" />待反馈</span><span><i className="done" />已完成</span></div>
    {create && <div className="panel-backdrop" onMouseDown={closeCreate}><aside className="create-session" role="dialog" aria-modal="true" aria-label="创建培训场次" onMouseDown={event => event.stopPropagation()}><header><div><span>NEW SESSION</span><h2>创建培训场次</h2><p>快速安排课程、受众与签到反馈</p></div><button onClick={closeCreate} aria-label="关闭创建场次面板">×</button></header><div className="form-grid"><label className="wide">选择课程<select><option>消防安全与应急响应</option><option>奢华服务沟通</option></select></label><label>部门 / 目标受众<select defaultValue={current.nameZh}><option>{current.nameZh}</option><option>房务部 · 全部员工</option><option>前厅部</option><option>礼宾部</option></select></label><label>培训师<select><option>沈悦 · 内部培训师</option><option>唐宁</option></select></label><label>日期<input value="2026-07-18" readOnly /></label><label>时间<input value="14:00 — 16:00" readOnly /></label><label>地点<input value="三楼培训室" readOnly /></label><label>容量<input value="24 人" readOnly /></label><label>培训性质<select><option>必修</option><option>选修</option></select></label></div><div className="qr-options"><button onClick={() => showToast("签到二维码将在发布后生成")}>▦ 生成 QR 签到</button><button onClick={() => showToast("反馈二维码将在发布后生成")}>▦ 生成 QR 反馈</button></div><footer><button onClick={saveDraft}>保存为草稿</button><button className="primary-small" onClick={publishSession}>发布场次</button></footer></aside></div>}
  </div></AppShell>;
}

function Month({ onCreate, events: visibleEvents }: { onCreate: () => void; events: typeof events }) { return <section className="month-calendar"><div className="weekdays">{["一 MON", "二 TUE", "三 WED", "四 THU", "五 FRI", "六 SAT", "日 SUN"].map(item => <span key={item}>{item}</span>)}</div><div className="month-grid">{Array.from({ length: 35 }, (_, index) => { const day = index - 1; const items = visibleEvents.filter(event => event.day === day); return <button className={`date-cell ${day === 11 ? "today" : ""}`} key={index} onClick={() => items.length ? location.href = "/sessions/session-1" : onCreate()} aria-label={items.length ? `${day} 日，打开${items[0].title}` : `${day} 日，创建培训场次`}><span>{day > 0 && day <= 31 ? day : ""}</span>{items.map(event => <div className={`event ${event.tone}`} key={event.title}><strong>{event.time} · {event.title}</strong><small>{event.dept} · {event.status}</small></div>)}</button>; })}</div></section>; }
function Week({ onCreate, scope }: { onCreate: () => void; scope: string }) { return <section className="week-calendar"><div className="time-column">{["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"].map(time => <span key={time}>{time}</span>)}</div>{["周一 13", "周二 14", "周三 15", "周四 16", "周五 17"].map((day, index) => <button key={day} onClick={onCreate} aria-label={`${day}，为${scope}创建培训场次`}><strong>{day}</strong>{index === 3 && <div className="week-event">13:30 宾客投诉处理<small>{scope} · 待反馈</small></div>}</button>)}</section>; }
function Day({ onCreate, scope }: { onCreate: () => void; scope: string }) { return <section className="day-calendar"><header>7 月 16 日 · 星期四 · {scope}</header>{["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"].map(time => <button key={time} onClick={onCreate} aria-label={`${time}，为${scope}创建培训场次`}><span>{time}</span>{time === "14:00" && <div>宾客投诉处理<small>13:30—15:30 · {scope} · 三楼培训室</small></div>}</button>)}</section>; }
export default function Calendar() { return <AppProviders><Page /></AppProviders>; }
