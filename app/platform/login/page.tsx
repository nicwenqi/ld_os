"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function PlatformLoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/platform/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const payload = await response.json() as { destination?: string; message?: string };
      if (!response.ok || !payload.destination) throw new Error(payload.message ?? "平台登录未完成");
      router.replace(payload.destination);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "平台登录未完成");
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="platform-shell"><section className="platform-frame"><div className="platform-brand"><span className="platform-mark">L&D</span><span>HOTEL L&D OS · PLATFORM PLANE</span></div><article className="platform-card narrow"><p className="platform-kicker">PLATFORM PROVISIONING ONLY</p><h1>平台开通</h1><p>仅用于创建酒店 Property 容器并完成首位学习与发展经理交接。这里不提供任何酒店培训业务操作。</p><form className="platform-login-form" onSubmit={submit}><div className="platform-field"><label htmlFor="platform-identifier">平台账号</label><input id="platform-identifier" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required /></div><div className="platform-field"><label htmlFor="platform-password">密码</label><input id="platform-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>{error ? <p className="platform-error" role="alert">{error}</p> : null}<div className="platform-actions"><button className="platform-primary" disabled={submitting} type="submit">{submitting ? "验证中…" : "进入开通控制台"}</button></div></form></article></section></main>;
}
