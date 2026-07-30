"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { NormalizedPropertyProvisioningDraft, PropertyProvisioningDraft } from "../../../services/platform-property-provisioning.ts";

type Session = { authenticated: boolean; displayName?: string };
type Preview = { token: string; expiresAt: string; normalized: NormalizedPropertyProvisioningDraft };
type Handoff = { hostname: string; managerDisplayName: string; passwordChangeRequired: boolean; handoffState: string; initializationState: string };

const initialDraft: PropertyProvisioningDraft = {
  tenantId: "", propertyCode: "", preliminaryNameZh: "", preliminaryNameEn: "", brand: "", city: "", countryRegion: "CN", timezone: "Asia/Shanghai", defaultLanguage: "zh-CN", hostname: "", managerLoginId: "", managerDisplayName: "", temporaryPassword: "",
};

export default function NewPropertyProvisioningPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [draft, setDraft] = useState(initialDraft);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/platform/auth/session", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as Session;
      if (!payload.authenticated) router.replace("/platform/login"); else setSession(payload);
    }).catch(() => router.replace("/platform/login"));
  }, [router]);

  function setField<K extends keyof PropertyProvisioningDraft>(key: K, value: PropertyProvisioningDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setPreview(null);
    setHandoff(null);
    setNotice(null);
  }

  async function previewProvisioning(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submit("preview");
  }

  async function submit(operation: "preview" | "commit") {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/platform/properties", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, draft, previewToken: preview?.token }) });
      const payload = await response.json() as { preview?: Preview; handoff?: Handoff; notice?: string; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Property 开通未完成");
      if (operation === "preview" && payload.preview) setPreview(payload.preview);
      if (operation === "commit" && payload.handoff) { setHandoff(payload.handoff); setNotice(payload.notice ?? null); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Property 开通未完成");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await fetch("/api/platform/auth/logout", { method: "POST" });
    router.replace("/platform/login");
  }

  if (!session) return <main className="platform-shell" aria-live="polite">正在验证平台开通权限…</main>;
  return <main className="platform-shell"><section className="platform-frame"><div className="platform-topline"><div className="platform-brand"><span className="platform-mark">L&D</span><span><strong>{session.displayName}</strong><small>平台开通控制面 · 不进入酒店业务空间</small></span></div><button className="platform-link" type="button" onClick={logout}>退出平台开通</button></div><article className="platform-card"><header><p className="platform-kicker">C1 · PROPERTY PROVISIONING</p><h1>创建 Pilot Property</h1><p>此步骤只建立酒店容器、初始技术上下文与首位学习与发展经理交接。组织、员工与所有培训业务事实均不在此创建。</p></header><form className="platform-form" onSubmit={previewProvisioning}><section className="platform-section"><h2>Property 容器</h2><p>填写经批准的 Pilot 酒店基础身份。确认前仅生成可复核预览。</p><div className="platform-form-grid"><TextField label="Tenant 标识" name="tenantId" value={draft.tenantId} onChange={setField} /><TextField label="Property code" name="propertyCode" value={draft.propertyCode} onChange={setField} /><TextField label="酒店中文名称" name="preliminaryNameZh" value={draft.preliminaryNameZh} onChange={setField} /><TextField label="酒店英文名称" name="preliminaryNameEn" value={draft.preliminaryNameEn} onChange={setField} /><TextField label="品牌" name="brand" value={draft.brand} onChange={setField} /><TextField label="城市" name="city" value={draft.city} onChange={setField} /><TextField label="国家或地区" name="countryRegion" value={draft.countryRegion} onChange={setField} /><TextField label="酒店域名" name="hostname" value={draft.hostname} onChange={setField} /></div><div className="platform-form-grid"><SelectField label="时区" name="timezone" value={draft.timezone} onChange={setField} values={["Asia/Shanghai"]} /><SelectField label="默认语言" name="defaultLanguage" value={draft.defaultLanguage} onChange={setField} values={["zh-CN", "en-US"]} /></div></section><section className="platform-section"><h2>首位学习与发展经理交接</h2><p>创建后经理必须使用临时密码完成首次密码更新，才可进入酒店管理空间。</p><div className="platform-form-grid"><TextField label="经理用户 ID" name="managerLoginId" value={draft.managerLoginId} onChange={setField} /><TextField label="经理姓名" name="managerDisplayName" value={draft.managerDisplayName} onChange={setField} /></div><TextField label="临时密码" name="temporaryPassword" type="password" value={draft.temporaryPassword} onChange={setField} hint="只用于受控首登交接；预览和结果均不会显示密码。" /></section>{error ? <p className="platform-error" role="alert">{error}</p> : null}<div className="platform-actions"><button className="platform-primary" type="submit" disabled={saving || Boolean(handoff)}>{saving ? "处理中…" : "预览开通内容"}</button></div></form>{preview ? <section className="platform-preview" aria-live="polite"><h2>开通预览</h2><p>确认以下内容后才会执行受控开通；预览将在 {new Date(preview.expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 失效。</p><PreviewDetails value={preview.normalized} /><div className="platform-actions"><button className="platform-secondary" type="button" onClick={() => setPreview(null)} disabled={saving}>返回修改</button><button className="platform-primary" type="button" onClick={() => submit("commit")} disabled={saving}>{saving ? "创建中…" : "确认创建 Property 并发出经理交接"}</button></div></section> : null}{handoff ? <section className="platform-success" aria-live="polite"><strong>经理交接已建立</strong><p>酒店域名：{handoff.hostname}；首位经理：{handoff.managerDisplayName}。经理需完成首次密码更新后，才能进入其酒店管理空间。</p>{notice ? <p className="platform-notice">{notice}</p> : null}</section> : null}</article></section></main>;
}

function TextField<K extends keyof PropertyProvisioningDraft>({ label, name, value, onChange, type = "text", hint }: { label: string; name: K; value: PropertyProvisioningDraft[K]; onChange: (name: K, value: PropertyProvisioningDraft[K]) => void; type?: string; hint?: string }) {
  const id = `platform-${String(name)}`;
  return <div className="platform-field"><label htmlFor={id}>{label}</label><input id={id} type={type} value={value} onChange={(event) => onChange(name, event.target.value as PropertyProvisioningDraft[K])} required autoComplete={type === "password" ? "new-password" : "off"} />{hint ? <small>{hint}</small> : null}</div>;
}

function SelectField<K extends "timezone" | "defaultLanguage">({ label, name, value, onChange, values }: { label: string; name: K; value: PropertyProvisioningDraft[K]; onChange: (name: K, value: PropertyProvisioningDraft[K]) => void; values: string[] }) {
  const id = `platform-${name}`;
  return <div className="platform-field"><label htmlFor={id}>{label}</label><select id={id} value={value} onChange={(event) => onChange(name, event.target.value as PropertyProvisioningDraft[K])}>{values.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>;
}

function PreviewDetails({ value }: { value: NormalizedPropertyProvisioningDraft }) {
  return <dl><div><dt>Property</dt><dd>{value.preliminaryNameZh} · {value.propertyCode}</dd></div><div><dt>酒店域名</dt><dd>{value.hostname}</dd></div><div><dt>城市与时区</dt><dd>{value.city} · {value.timezone}</dd></div><div><dt>首位学习与发展经理</dt><dd>{value.managerDisplayName} · {value.managerLoginId}</dd></div></dl>;
}
