"use client";

import Link from "next/link";
import { AppProviders } from "../providers";
import { homeForRole } from "../services/auth-routing";
import { useAuthSession } from "../state/auth-session";
import "../role-entry.css";

function AccessDeniedExperience() {
  const { session, status, logout } = useAuthSession();
  const hasWorkspace =
    status === "authenticated" &&
    (session.role === "property_ld_manager" ||
      session.role === "department_training_responsible");

  const signOut = async () => {
    await logout();
    window.location.assign("/login");
  };

  return (
    <main className="role-entry">
      <section className="role-entry-card">
        <span>访问受限 · ACCESS DENIED</span>
        <h1>{hasWorkspace ? "此页面不在您的授权范围内" : "当前账号没有可用的酒店后台角色"}</h1>
        <p>
          {status === "authenticated"
            ? `${session.displayName ?? "当前账号"} 已通过身份验证，但当前角色不能访问此页面。`
            : "当前会话尚未登录。"}
          {" "}权限由酒店成员资格、角色与部门范围共同决定，不能在页面中自行切换。
        </p>
        <div className="role-entry-actions">
          {hasWorkspace ? (
            <Link className="primary" href={homeForRole(session.role)}>
              返回我的工作台
            </Link>
          ) : status === "anonymous" ? (
            <Link className="primary" href="/login">返回登录</Link>
          ) : null}
          {status === "authenticated" && (
            <button onClick={() => void signOut()}>退出登录</button>
          )}
        </div>
        <small>如需调整授权，请联系当前酒店学习与发展经理。</small>
      </section>
    </main>
  );
}

export default function AccessDeniedPage() {
  return <AppProviders><AccessDeniedExperience/></AppProviders>;
}
