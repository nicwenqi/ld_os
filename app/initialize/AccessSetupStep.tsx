"use client";
import Link from "next/link";
import type { InitializationAccessSummary } from "../repositories/contracts/initialization-repository.ts";

type Props={summary:InitializationAccessSummary|null;loading:boolean;complete:boolean;onReload:()=>Promise<void>;onConfirm:()=>Promise<void>};
export function AccessSetupStep({summary,loading,complete,onReload,onConfirm}:Props){
  return <section className="wizard-card"><header className="wizard-intro"><h3>确认酒店后台管理员账号</h3><p>账号、酒店成员资格、角色和部门范围分别保存。普通员工不会因为存在员工记录而自动获得后台账号。</p></header>
    {loading?<div className="wizard-loading compact">正在核验管理员状态…</div>:<div className="wizard-access"><article><span>当前酒店学习与发展经理</span><strong>{summary?.currentManager?.displayName??"未识别当前管理员"}</strong><small>{summary?.currentManager?`用户 ID：${summary.currentManager.loginId} · 账号状态正常`:"请检查当前账号与酒店成员资格"}</small></article><article><span>活动酒店学习与发展经理</span><strong>{summary?.activePropertyManagers??0} 人</strong><small>至少需要一位活动经理；最后一位活动经理受保护。</small></article><article><span>部门培训负责人</span><strong>{summary?.activeDepartmentAdministrators??0} 人</strong><small>启用时可选；后续只可管理明确分配的正式部门范围。</small></article><article><span>已配置明确范围</span><strong>{summary?.activeDepartmentAdministratorsWithScope??0} 人</strong><small>{summary?.activeDepartmentAdministrators?summary.departmentScopesResolved?"所有活动部门培训负责人均有明确范围。":"存在未能解析范围的部门负责人。":"尚未委派部门负责人，不阻塞员工基线。"}</small></article></div>}
    <div className="wizard-operational-note"><strong>权限说明</strong><p>部门培训负责人只能在获分配的部门范围工作，不能维护酒店身份、全局职位、员工资料文件或后台角色。</p><button onClick={()=>void onReload()}>重新核验管理员状态</button><Link href="/accounts">管理后台账号</Link></div>
    <footer><span className={`wizard-validation ${complete?"good":""}`}>{summary?.canConfirm?"✓ 已找到活动酒店学习与发展经理":"! 尚未找到活动酒店学习与发展经理"}</span><button className="wizard-primary" disabled={!summary?.canConfirm||loading} onClick={()=>void onConfirm()}>确认管理员账号并继续</button></footer>
  </section>;
}
