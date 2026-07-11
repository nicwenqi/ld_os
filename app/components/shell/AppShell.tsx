"use client";
import { useState } from "react";
import { DepartmentScopePicker } from "../hierarchy/DepartmentScopePicker";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { RoleSwitcher } from "./RoleSwitcher";
import { usePrototypeFeedback } from "../../state/prototype-feedback";
const navigation=[
  ["01","学习与发展总览","Executive Dashboard"],["02","组织培训看板","Organization"],["03","培训日历","Training Calendar"],["04","课程成效","Course Effectiveness"],["05","风险看板","Risk Dashboard"],
  ["06","员工中心","People Center"],["07","KPI 目标中心","KPI Targets"],["08","组织与权限","Organization & Access"],["09","导入中心","Import Center"],
];
export function AppShell({children}:{children:React.ReactNode}){const[createOpen,setCreateOpen]=useState(false);const[menuOpen,setMenuOpen]=useState(false);const{showToast}=usePrototypeFeedback();return <div className="app-shell">
  <aside className={`sidebar ${menuOpen?"open":""}`}><div className="brand"><div className="brand-mark"><span>H</span><i/></div><div><strong>酒店学习与发展</strong><small>Hotel L&amp;D OS</small></div></div><div className="nav-caption">OPERATIONS</div><nav aria-label="主导航">{navigation.map(([number,zh,en],index)=><a className={`nav-item ${index===0?"active":""}`} href={index===0?"/":"#coming-soon"} key={zh} onClick={(e)=>{if(index!==0){e.preventDefault();showToast(`${zh}将在下一检查点开放`)}}}><span>{number}</span><div><strong>{zh}</strong><small>{en}</small></div>{index===4&&<em>3</em>}</a>)}</nav><div className="sidebar-foot"><div className="hotel-card"><span>SH</span><div><strong>上海澜庭酒店</strong><small>Shanghai Lanting Hotel</small></div></div><RoleSwitcher/></div></aside>
  <div className="main-column"><header className="topbar"><button className="mobile-menu" onClick={()=>setMenuOpen(!menuOpen)} aria-label="打开导航">☰</button><DepartmentScopePicker/><div className="topbar-actions"><button className="round-button" onClick={()=>showToast("您目前没有新的系统通知")} aria-label="通知">♢<i/></button><Button className="primary" onClick={()=>setCreateOpen(true)}><span>＋</span>新建</Button><button className="avatar" onClick={()=>showToast("账户菜单已打开：林静 · 超级管理员")}>林<span>林静 · L&amp;D</span></button></div></header><main>{children}</main></div>
  <Dialog open={createOpen} title="快速新建" onClose={()=>setCreateOpen(false)}><div className="quick-grid">{[["培训场次","Training session","07 / 18"],["培训分配","Training assignment","12 people"],["员工档案","Employee profile","New hire"],["补训计划","Make-up training","3 risks"]].map(([zh,en,note])=><button key={zh} onClick={()=>{setCreateOpen(false);showToast(`${zh}创建面板已准备`)}}><span>↗</span><strong>{zh}</strong><small>{en}</small><em>{note}</em></button>)}</div></Dialog>
  </div>}
