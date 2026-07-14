"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthSession } from "../../state/auth-session";
import { canRoleAccessPath, homeForRole } from "../../services/auth-routing.ts";

export function SessionGate({children}:{children:React.ReactNode}){const{session,status}=useAuthSession();const pathname=usePathname();const router=useRouter();useEffect(()=>{if(status==="loading")return;if(status==="anonymous"){router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);return}if(!canRoleAccessPath(session.role,pathname))router.replace(homeForRole(session.role))},[pathname,router,session.role,status]);if(status==="loading")return<div className="session-loading">正在验证账户与酒店访问权限…</div>;if(status==="anonymous"||!canRoleAccessPath(session.role,pathname))return<div className="session-loading">正在前往正确入口…</div>;return<>{children}</>}
