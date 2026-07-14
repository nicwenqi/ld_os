import type { EffectiveRole } from "../repositories/contracts/auth-repository.ts";

export type NavigationItem={icon:string;zh:string;en:string;href:string};
export type NavigationGroup={label:string;items:NavigationItem[]};
const managerMain:NavigationItem[]=[
  {icon:"⌂",zh:"学习与发展总览",en:"Executive overview",href:"/"},{icon:"◇",zh:"组织培训看板",en:"Organization",href:"/organization"},{icon:"□",zh:"培训日历",en:"Training calendar",href:"/calendar"},{icon:"◌",zh:"课程成效",en:"Course effectiveness",href:"/effectiveness"},{icon:"△",zh:"风险看板",en:"Risk overview",href:"/risk"},{icon:"♙",zh:"员工中心",en:"People",href:"/people"},{icon:"◎",zh:"KPI 目标中心",en:"KPI targets",href:"/kpi"},{icon:"↥",zh:"导入中心",en:"Import",href:"/import"},
];
const managerSettings:NavigationGroup[]=[
  {label:"酒店设置",items:[{icon:"◈",zh:"基本资料与业务规则",en:"Hotel settings",href:"/settings/hotel"},{icon:"✓",zh:"初始化检查",en:"Initialization review",href:"/initialize"}]},
  {label:"组织与人员基础",items:[{icon:"⌘",zh:"部门架构与运营单元",en:"Organization structure",href:"/permissions#organization"},{icon:"⌗",zh:"职位与职位族",en:"Positions",href:"/permissions#positions"},{icon:"↔",zh:"部门认领与映射",en:"Department mapping",href:"/permissions#department-mapping"},{icon:"↕",zh:"职位认领与映射",en:"Position mapping",href:"/permissions#position-mapping"}]},
  {label:"用户与权限",items:[{icon:"♙",zh:"酒店管理员",en:"Property administrators",href:"/permissions#property-admins"},{icon:"♙",zh:"部门培训管理员",en:"Department administrators",href:"/permissions#department-admins"},{icon:"◉",zh:"账号管理",en:"Accounts",href:"/permissions#accounts"},{icon:"◇",zh:"角色说明与权限范围",en:"Roles and scopes",href:"/permissions#roles"}]},
  {label:"数据管理",items:[{icon:"↥",zh:"员工数据导入",en:"Employee import",href:"/import"},{icon:"◷",zh:"导入历史与回滚记录",en:"History and rollback",href:"/import#history"},{icon:"!",zh:"问题队列",en:"Issue queue",href:"/import#issues"}]},
];

export function navigationForRole(role:EffectiveRole):{main:NavigationItem[];settings:NavigationGroup[]}{
  if(role==="property_ld_manager"||role==="tenant_admin"||role==="platform_admin")return{main:managerMain,settings:managerSettings};
  if(role==="department_training_admin")return{main:[{icon:"⌂",zh:"部门培训工作台",en:"Department workspace",href:"/department"}],settings:[]};
  if(role==="employee")return{main:[{icon:"⌂",zh:"我的学习",en:"My training",href:"/my-training"}],settings:[]};
  return{main:[],settings:[]};
}
