"use client";
import type { InitializationAccessSummary } from "../repositories/contracts/initialization-repository.ts";

type Props={summary:InitializationAccessSummary|null;loading:boolean;complete:boolean;onReload:()=>Promise<void>;onConfirm:()=>Promise<void>};
export function AccessSetupStep({summary,loading,complete,onReload,onConfirm}:Props){
  return <section className="wizard-card"><header className="wizard-intro"><h3>确认真实管理员与权限边界</h3><p>账号身份、酒店成员资格和角色分配分别保存；当前步骤只读取已持久化的活动账号，不创建共享管理员。</p></header>
    {loading?<div className="wizard-loading compact">正在核验管理员状态…</div>:<div className="wizard-access"><article><span>当前酒店管理员</span><strong>{summary?.currentManager?.displayName??"未识别当前管理员"}</strong><small>{summary?.currentManager?`用户 ID：${summary.currentManager.loginId} · 账号状态正常`:"请检查当前账号与酒店成员资格"}</small></article><article><span>活动 Property L&amp;D Manager</span><strong>{summary?.activePropertyManagers??0} 人</strong><small>至少需要一位活动酒店学习与发展经理。</small></article><article><span>部门培训管理员</span><strong>{summary?.activeDepartmentAdministrators??0} 人</strong><small>首次完成时可选；后续按正式部门分支配置权限范围。</small></article></div>}
    <div className="wizard-operational-note"><strong>权限说明</strong><p>部门培训管理员只能在获分配的部门范围工作，不能维护酒店身份、全局职位、来源工作簿或管理员角色。</p><button onClick={()=>void onReload()}>重新核验管理员状态</button></div>
    <footer><span className={`wizard-validation ${complete?"good":""}`}>{summary?.canConfirm?complete?"✓ 管理员访问安排已确认":"! 已找到活动酒店管理员，请明确确认":"! 尚未找到活动酒店管理员"}</span><button className="wizard-primary" disabled={!summary?.canConfirm||loading} onClick={()=>void onConfirm()}>确认访问安排并继续</button></footer>
  </section>;
}
