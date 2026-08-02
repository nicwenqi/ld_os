"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type PropertySummary = {
  propertyId: string;
  propertyCode: string;
  nameZh: string;
  nameEn: string | null;
  status: string;
  hostname: string | null;
  initializationState: string | null;
  managerCount: number;
  activeManagerCount: number;
  latestManagerLoginAt: string | null;
};

export default function PlatformPropertiesPage() {
  const router = useRouter();
  const [properties, setProperties] = useState<PropertySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/platform/auth/session", { cache: "no-store" })
      .then(async sessionResponse => {
        const session = await sessionResponse.json() as { authenticated?: boolean };
        if (!session.authenticated) { router.replace("/platform/login"); return null; }
        return fetch("/api/platform/properties", { cache: "no-store" });
      })
      .then(async response => {
        if (!response) return;
        const payload = await response.json() as { properties?: PropertySummary[]; message?: string };
        if (!response.ok) throw new Error(payload.message ?? "Property 概览暂时不可用");
        setProperties(payload.properties ?? []);
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : "Property 概览暂时不可用"));
  }, [router]);

  async function logout() {
    await fetch("/api/platform/auth/logout", { method: "POST" });
    router.replace("/platform/login");
  }

  if (!properties && !error) return <main className="platform-shell" aria-live="polite"><section className="platform-frame"><p className="platform-loading">正在读取 Property 运维概览…</p></section></main>;
  return <main className="platform-shell"><section className="platform-frame">
    <div className="platform-topline"><div className="platform-brand"><span className="platform-mark">L&D</span><span><strong>Property 运维控制台</strong><small>仅管理 Property 容器与酒店学习与发展经理账号</small></span></div><button className="platform-link" type="button" onClick={logout}>退出平台</button></div>
    <article className="platform-card platform-overview-card"><header className="platform-page-heading"><div><p className="platform-kicker">PLATFORM OPERATIONS</p><h1>已有 Property</h1><p>查看酒店接入状态与经理账号健康。平台控制台不进入任何酒店业务工作区。</p></div><Link className="platform-primary platform-button-link" href="/platform/properties/new">创建新 Property</Link></header>
      {error ? <p className="platform-error" role="alert">{error}</p> : null}
      {!error && properties?.length === 0 ? <div className="platform-empty"><strong>尚未有可管理的 Property</strong><p>新酒店接入请从受控开通流程开始。</p><Link className="platform-secondary platform-button-link" href="/platform/properties/new">进入新酒店开通</Link></div> : null}
      <div className="platform-property-grid">{properties?.map(property => <Link className="platform-property-card" href={`/platform/properties/${property.propertyId}`} key={property.propertyId}><div className="platform-property-card-top"><span className="platform-status-chip">{property.status === "active" ? "已启用" : property.status}</span><span className="platform-muted">{property.propertyCode}</span></div><h2>{property.nameZh}</h2><p>{property.nameEn || "尚未填写英文名称"}</p><dl><div><dt>域名</dt><dd>{property.hostname || "未绑定"}</dd></div><div><dt>经理账号</dt><dd>{property.activeManagerCount}/{property.managerCount} active</dd></div><div><dt>最近登录</dt><dd>{formatDate(property.latestManagerLoginAt)}</dd></div></dl><span className="platform-card-arrow">管理账号 <span aria-hidden="true">→</span></span></Link>)}</div>
    </article>
  </section></main>;
}

function formatDate(value: string | null) { return value ? new Date(value).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" }) : "尚无登录记录"; }
