"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { normalizePlatformManagerDraft, type PlatformManagerAccount } from "../../../services/platform-property-accounts.ts";

type FormState = { displayName: string; loginId: string };
const emptyForm: FormState = { displayName: "", loginId: "" };

export default function PropertyAccountsPage() {
  const router = useRouter();
  const params = useParams<{ propertyId: string }>();
  const propertyId = params.propertyId;
  const [accounts, setAccounts] = useState<PlatformManagerAccount[] | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [replaceFor, setReplaceFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issuedTemporaryPassword, setIssuedTemporaryPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/platform/auth/session", { cache: "no-store" }).then(async sessionResponse => {
      const session = await sessionResponse.json() as { authenticated?: boolean };
      if (!session.authenticated) { router.replace("/platform/login"); return null; }
      return loadAccounts(propertyId);
    }).then(result => { if (result) setAccounts(result); }).catch(reason => setError(reason instanceof Error ? reason.message : "账号资料暂时不可用"));
  }, [propertyId, router]);

  async function loadAccounts(id: string) {
    const response = await fetch(`/api/platform/properties/${id}/accounts`, { cache: "no-store" });
    const payload = await response.json() as { accounts?: PlatformManagerAccount[]; message?: string };
    if (!response.ok) throw new Error(payload.message ?? "账号资料暂时不可用");
    return payload.accounts ?? [];
  }

  async function saveManager(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    try {
      const draft = normalizePlatformManagerDraft(form);
      const response = await fetch(`/api/platform/properties/${propertyId}/accounts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(replaceFor ? { operation: "replace", oldAccountId: replaceFor, ...draft } : draft) });
      const payload = await response.json() as { account?: PlatformManagerAccount; replacement?: { newManager?: PlatformManagerAccount }; issuedTemporaryPassword?: string; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "账号操作未完成");
      setForm(emptyForm); setReplaceFor(null); setIssuedTemporaryPassword(payload.issuedTemporaryPassword ?? null); setNotice(replaceFor ? "新经理已建立，原经理已停用。请立即通过受控交接发放系统生成的临时密码。" : "经理账号已建立。请立即通过受控交接发放系统生成的临时密码。");
      setAccounts(await loadAccounts(propertyId));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "账号操作未完成"); }
    finally { setBusy(false); }
  }

  async function changeStatus(account: PlatformManagerAccount) {
    const next = account.status === "active" ? "disabled" : "active";
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/platform/properties/${propertyId}/accounts`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: account.accountId, expectedVersion: account.version, status: next }) });
      const payload = await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "账号状态更新失败");
      setNotice(next === "active" ? "经理账号已启用。" : "经理账号已禁用。"); setAccounts(await loadAccounts(propertyId));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "账号状态更新失败"); }
    finally { setBusy(false); }
  }

  async function resetPassword(account: PlatformManagerAccount) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/platform/properties/${propertyId}/accounts`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: account.accountId, expectedVersion: account.version }) });
      const payload = await response.json() as { issuedTemporaryPassword?: string; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "密码重置失败");
      setIssuedTemporaryPassword(payload.issuedTemporaryPassword ?? null); setNotice("系统已生成新的临时密码；经理下次登录需要修改密码。"); setAccounts(await loadAccounts(propertyId));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "密码重置失败"); }
    finally { setBusy(false); }
  }

  async function logout() { await fetch("/api/platform/auth/logout", { method: "POST" }); router.replace("/platform/login"); }

  if (!accounts && !error) return <main className="platform-shell" aria-live="polite"><section className="platform-frame"><p className="platform-loading">正在读取 Property 账号…</p></section></main>;
  return <main className="platform-shell"><section className="platform-frame"><div className="platform-topline"><div className="platform-brand"><span className="platform-mark">L&D</span><span><strong>Property 账号管理</strong><small>只显示运维所需的经理账号健康信息，不显示内部 Auth 邮箱</small></span></div><button className="platform-link" type="button" onClick={logout}>退出平台</button></div><div className="platform-breadcrumb"><Link href="/platform/properties">已有 Property</Link><span aria-hidden="true">/</span><span>账号管理</span></div><article className="platform-card"><header className="platform-page-heading"><div><p className="platform-kicker">HOTEL ACCOUNT LIFECYCLE</p><h1>Hotel L&D Manager</h1><p>在这里邀请、重置、启用或停用酒店学习与发展经理。部门负责人和酒店业务数据由酒店经理在酒店工作区管理。</p></div></header>{error ? <p className="platform-error" role="alert">{error}</p> : null}{notice ? <p className="platform-notice" role="status">{notice}</p> : null}{issuedTemporaryPassword ? <section className="platform-success" aria-live="assertive"><strong>请立即安全发放临时密码</strong><p>系统只在本次操作后显示一次；经理首次登录必须修改密码。</p><output>{issuedTemporaryPassword}</output></section> : null}<section className="platform-section"><div className="platform-section-heading"><div><h2>当前经理账号</h2><p>账号状态、首次登录要求和最近登录时间均来自服务器重新读取结果。</p></div><span className="platform-muted">{accounts?.length ?? 0} 个账号</span></div><div className="platform-account-list">{accounts?.length ? accounts.map(account => <AccountCard account={account} busy={busy} onStatus={changeStatus} onReset={resetPassword} onReplace={() => { setReplaceFor(account.accountId); setForm(emptyForm); window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); }} key={account.accountId} />) : <div className="platform-empty"><strong>尚未建立经理账号</strong><p>请从下方建立首位酒店学习与发展经理。</p></div>}</div></section><section className="platform-section platform-manager-form-section"><h2>{replaceFor ? "更换 Property Manager" : "创建或邀请经理"}</h2><p>{replaceFor ? "新经理建立成功后，现任经理会被安全停用；历史审计会保留。" : "用户 ID 在全平台唯一。内部 Auth 邮箱由系统生成并不会展示给浏览器或酒店用户。"}</p><form className="platform-form" onSubmit={saveManager}><div className="platform-form-grid"><Field label="经理姓名" value={form.displayName} onChange={value => setForm({ ...form, displayName: value })} /><Field label="用户 ID（全平台唯一）" value={form.loginId} onChange={value => setForm({ ...form, loginId: value })} /></div><p className="platform-muted">系统会在建立或更换经理时生成 12 位随机临时密码，并只在成功后显示一次。</p><div className="platform-actions"><button className="platform-secondary" type="button" onClick={() => { setReplaceFor(null); setForm(emptyForm); }} disabled={busy}>清空</button><button className="platform-primary" type="submit" disabled={busy}>{busy ? "处理中…" : replaceFor ? "确认更换经理" : "建立经理账号"}</button></div></form></section></article></section></main>;
}

function AccountCard({ account, busy, onStatus, onReset, onReplace }: { account: PlatformManagerAccount; busy: boolean; onStatus: (account: PlatformManagerAccount) => void; onReset: (account: PlatformManagerAccount) => void; onReplace: () => void }) {
  return <article className="platform-account-card"><div className="platform-account-card-main"><div><div className="platform-account-name"><h3>{account.displayName}</h3><span className={`platform-status-chip ${account.status !== "active" ? "muted" : "positive"}`}>{account.status === "active" ? "已启用" : account.status === "disabled" ? "已停用" : "暂缓"}</span></div><p className="platform-account-login">用户 ID：{account.loginId}</p></div><dl><div><dt>首次登录</dt><dd>{account.mustChangePassword ? "需要修改密码" : "已完成"}</dd></div><div><dt>最近登录</dt><dd>{formatDate(account.lastLoginAt)}</dd></div><div><dt>资料更新</dt><dd>{formatDate(account.updatedAt)}</dd></div></dl></div><div className="platform-account-actions"><button className="platform-secondary" type="button" disabled={busy} onClick={() => onReset(account)}>重置密码</button><button className="platform-secondary" type="button" disabled={busy} onClick={() => onStatus(account)}>{account.status === "active" ? "禁用账号" : "启用账号"}</button><button className="platform-link-action" type="button" disabled={busy} onClick={onReplace}>更换管理员</button></div></article>;
}

function Field({ label, value, onChange, type = "text", hint }: { label: string; value: string; onChange: (value: string) => void; type?: string; hint?: string }) { const id = `platform-account-${label}`; return <div className="platform-field"><label htmlFor={id}>{label}</label><input id={id} type={type} required value={value} onChange={event => onChange(event.target.value)} autoComplete={type === "password" ? "new-password" : "off"} />{hint ? <small>{hint}</small> : null}</div>; }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" }) : "尚无记录"; }
