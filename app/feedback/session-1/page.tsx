"use client";

import { useState } from "react";
import { useEscapeDismiss } from "../../lib/use-escape-dismiss";

const employee = { employeeId: "CO-1802", nameZh: "林子轩", nameEn: "Leo Lin", department: "礼宾部", position: "礼宾专员" };

export default function Feedback() {
  const [step, setStep] = useState(1);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [query, setQuery] = useState("");
  const [rating, setRating] = useState({ satisfaction: 0, relevance: 0, trainer: 0 });
  useEscapeDismiss(alreadySubmitted, () => setAlreadySubmitted(false));
  const matchesEmployee = !query || `${employee.employeeId}${employee.nameZh}${employee.nameEn}`.toLowerCase().includes(query.toLowerCase());
  const ratingsComplete = Object.values(rating).every(value => value > 0);
  return <main className="mobile-flow">
    <header className="mobile-brand"><span>澜</span><div><strong>上海澜庭酒店</strong><small>Hotel Learning &amp; Development</small></div></header>
    <section className="mobile-session feedback"><span>课程反馈 · FEEDBACK</span><h1>消防安全与应急响应</h1><p>您的反馈将帮助我们持续改善培训体验</p></section>
    {step === 1 && <section className="mobile-card"><h2>选择员工</h2><p>Select employee</p><label className="mobile-search">⌕<input placeholder="搜索员工姓名或工号" value={query} onChange={event => setQuery(event.target.value)} /></label>{matchesEmployee && <button className="employee-card" onClick={() => setStep(2)}><span className="person-avatar">林</span><div><strong>林子轩 · Leo Lin</strong><small>CO-1802 · 礼宾部 · 礼宾专员</small></div><span>→</span></button>}<button className="already-link" onClick={() => setAlreadySubmitted(true)}>查看已提交状态</button></section>}
    {step === 2 && <section className="mobile-card confirm-card"><span className="person-large">林</span><h2>确认身份</h2><p>Confirm your identity</p><dl><div><dt>姓名</dt><dd>{employee.nameZh} · {employee.nameEn}</dd></div><div><dt>员工编号</dt><dd>{employee.employeeId}</dd></div><div><dt>部门 / 职位</dt><dd>{employee.department} · {employee.position}</dd></div></dl><button className="mobile-primary" onClick={() => setStep(3)}>确认并开始反馈</button><button className="mobile-secondary" onClick={() => setStep(1)}>不是我，重新选择</button></section>}
    {step === 3 && <section className="mobile-card rating-form"><h2>课程反馈</h2><p>Course feedback</p><Rating label="满意度" en="Overall satisfaction" value={rating.satisfaction} onChange={value => setRating({ ...rating, satisfaction: value })} /><Rating label="课程相关性" en="Course relevance" value={rating.relevance} onChange={value => setRating({ ...rating, relevance: value })} /><Rating label="培训师表现" en="Trainer performance" value={rating.trainer} onChange={value => setRating({ ...rating, trainer: value })} /><label className="comment-box">补充意见 <small>Additional comments</small><textarea placeholder="请分享本次培训中对您最有帮助的内容…" /></label><button className="mobile-primary" disabled={!ratingsComplete} title={!ratingsComplete ? "请先完成三项评分" : "提交课程反馈"} onClick={() => setStep(4)}>提交反馈</button>{!ratingsComplete && <small className="form-guidance">请完成满意度、课程相关性和培训师表现评分</small>}</section>}
    {step === 4 && <section className="mobile-card success-card"><span>✓</span><h2>提交成功</h2><p>Feedback submitted</p><strong>感谢您的反馈</strong><small>您的意见将用于改善后续培训</small></section>}
    {alreadySubmitted && <div className="mobile-overlay" onMouseDown={() => setAlreadySubmitted(false)}><section role="dialog" aria-modal="true" aria-label="反馈已提交" onMouseDown={event => event.stopPropagation()}><button onClick={() => setAlreadySubmitted(false)} aria-label="关闭已提交状态">×</button><span>✓</span><h2>反馈已提交</h2><p>Already submitted</p><small>提交时间 · 7 月 11 日 12:18</small></section></div>}
    <footer className="mobile-footer">反馈内容仅用于培训改进 · Your feedback is confidential</footer>
  </main>;
}

function Rating({ label, en, value, onChange }: { label: string; en: string; value: number; onChange: (value: number) => void }) { return <div className="rating-row"><div><strong>{label}</strong><small>{en}</small></div><div>{[1, 2, 3, 4, 5].map(score => <button aria-label={`${label} ${score} 分`} aria-pressed={value === score} className={value >= score ? "active" : ""} key={score} onClick={() => onChange(score)}>★</button>)}</div></div>; }
