"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ProtectedAppProviders } from "../providers";
import { homeForRole } from "../services/auth-routing.ts";
import { validateBackendPassword } from "../services/account-administration.ts";
import { useAuthSession } from "../state/auth-session";
import "./change-password.css";

function ChangePasswordExperience() {
  const { session } = useAuthSession();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const realPasswordSource = process.env.APP_DATA_MODE !== "mock";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      validateBackendPassword(password);
      if (password !== confirmation) throw new Error("两次输入的密码不一致");
      setSaving(true);
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      const payload = await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "密码修改失败，请重试");
      window.location.replace(homeForRole(session.role));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "密码修改失败，请重试");
      setSaving(false);
    }
  };

  if (!realPasswordSource) {
    return (
      <main className="password-change-screen">
        <section className="password-change-brand">
          <div aria-hidden="true">{session.propertyNameZh?.slice(0, 1) ?? "澜"}</div>
          <span>HOTEL L&amp;D OS</span>
          <strong>{session.propertyNameZh ?? "当前酒店"}</strong>
          <small>{session.propertyNameEn ?? "Hotel Learning & Development"}</small>
        </section>
        <section className="password-change-panel password-change-unavailable">
          <header>
            <span>LOCAL REVIEW BOUNDARY</span>
            <h1>本地验证不修改真实登录密码</h1>
            <p>当前账号与密码仅用于本地产品验证。真实酒店账号连接后，此处才会执行安全密码更新。</p>
          </header>
          <Link href={homeForRole(session.role)}>返回当前工作台</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="password-change-screen">
      <section className="password-change-brand">
        <div aria-hidden="true">{session.propertyNameZh?.slice(0, 1) ?? "澜"}</div>
        <span>HOTEL L&amp;D OS</span>
        <strong>{session.propertyNameZh ?? "当前酒店"}</strong>
        <small>{session.propertyNameEn ?? "Hotel Learning & Development"}</small>
      </section>
      <section className="password-change-panel">
        <header>
          <span>{session.mustChangePassword ? "首次登录安全检查" : "账号安全"}</span>
          <h1>{session.mustChangePassword ? "请先设置新的登录密码" : "修改我的登录密码"}</h1>
          <p>密码只用于当前后台账号。内部认证标识不会显示在页面中。</p>
        </header>
        <form onSubmit={submit}>
          <label>
            <span>新密码</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
              autoFocus
            />
            <small>至少 12 位，并同时包含字母和数字。</small>
          </label>
          <label>
            <span>再次输入新密码</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={confirmation}
              onChange={event => setConfirmation(event.target.value)}
              required
            />
          </label>
          {error && <div className="password-change-error" role="alert">{error}</div>}
          <button type="submit" disabled={saving}>
            {saving ? "正在更新密码…" : "保存新密码并继续"}
          </button>
        </form>
        <footer>如无法完成密码修改，请联系酒店学习与发展经理。</footer>
      </section>
    </main>
  );
}

export default function ChangePasswordPage() {
  return <ProtectedAppProviders><ChangePasswordExperience /></ProtectedAppProviders>;
}
