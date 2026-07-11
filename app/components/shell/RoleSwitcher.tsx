"use client";
import { useMockRole } from "../../state/mock-role";
export function RoleSwitcher(){const{role,setRole}=useMockRole();return <label className="role-switcher"><span>模拟角色</span><select value={role} onChange={(e)=>setRole(e.target.value as typeof role)}><option value="ld_manager">学习与发展经理</option><option value="department_admin">前厅部培训管理员</option></select></label>}
