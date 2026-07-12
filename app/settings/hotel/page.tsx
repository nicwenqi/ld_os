"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../../components/shell/AppShell";
import { AppProviders } from "../../providers";
import { createRepositoryRegistry } from "../../repositories/registry.ts";
import type { HotelPropertyRecord, PropertyIdentity, PropertySettings } from "../../repositories/contracts/models.ts";
import { getInitializationSteps } from "../../services/property-settings-service.ts";
import { usePrototypeFeedback } from "../../state/prototype-feedback";

function HotelSettingsContent() {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const repository = registry.property;
  const { showToast } = usePrototypeFeedback();
  const [contextLabel, setContextLabel] = useState("正在识别酒店上下文");
  const [record, setRecord] = useState<HotelPropertyRecord | null>(null);
  const [identity, setIdentity] = useState<PropertyIdentity | null>(null);
  const [rules, setRules] = useState<PropertySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"identity" | "rules" | "logo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const hostname = registry.environment.dataMode === "mock"
          ? "training-demo.example.test"
          : registry.environment.devPropertyHostname ?? registry.environment.previewPropertyHostname ?? window.location.hostname;
        const context = await repository.resolveContext(hostname);
        if (!context) throw new Error("当前域名尚未配置酒店上下文");
        const next = await repository.getProperty(context.propertyId);
        if (!active) return;
        setContextLabel(`${context.shortName} · ${context.hostname}`);
        setRecord(next);
        setIdentity(next.identity);
        setRules(next.settings);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "无法读取酒店设置");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [registry, repository]);

  const updateIdentity = (key: keyof PropertyIdentity, value: string) =>
    setIdentity(current => current ? { ...current, [key]: value } : current);
  const updateRules = <K extends keyof PropertySettings>(key: K, value: PropertySettings[K]) =>
    setRules(current => current ? { ...current, [key]: value } : current);

  const saveIdentity = async () => {
    if (!record || !identity) return;
    setSaving("identity"); setError(null);
    try {
      const next = await repository.saveIdentity({
        propertyId: identity.id,
        expectedUpdatedAt: record.identity.updatedAt,
        code: identity.code,
        nameZh: identity.nameZh,
        nameEn: identity.nameEn,
        shortName: identity.shortName,
        brand: identity.brand,
        city: identity.city,
        countryRegion: identity.countryRegion,
        timezone: identity.timezone,
        defaultLanguage: identity.defaultLanguage,
      });
      setRecord(next); setIdentity(next.identity); setRules(next.settings);
      showToast("酒店基本信息已保存");
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setSaving(null); }
  };

  const saveRules = async () => {
    if (!record || !rules) return;
    setSaving("rules"); setError(null);
    try {
      const next = await repository.saveBusinessRules({
        propertyId: rules.propertyId,
        expectedVersion: record.settings.version,
        newEmployeeDays: rules.newEmployeeDays,
        probationFieldMeaning: rules.probationFieldMeaning,
        employeeStatusSource: rules.employeeStatusSource,
        ctcMandatory: rules.ctcMandatory,
        gtcMandatory: rules.gtcMandatory,
      });
      setRecord(next); setIdentity(next.identity); setRules(next.settings);
      showToast("酒店业务规则已保存");
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setSaving(null); }
  };

  const uploadLogo = async (file: File) => {
    if (!record) return;
    if (!(["image/png", "image/jpeg", "image/webp"].includes(file.type))) {
      setError("仅支持 PNG、JPEG 或 WebP 酒店标识"); return;
    }
    setSaving("logo"); setError(null);
    try {
      const asset = await repository.uploadLogo({ tenantId: record.identity.tenantId, propertyId: record.identity.id, file });
      setLogoPreview(URL.createObjectURL(file));
      setRecord(current => current ? { ...current, currentLogo: asset } : current);
      showToast("酒店标识已更新，旧版本将保留 30 天");
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setSaving(null); }
  };

  if (loading) return <AppShell><div className="page-wrap settings-loading"><span className="settings-spinner"/><strong>正在准备酒店设置中心</strong><small>Loading property settings</small></div></AppShell>;
  if (error && !record) return <AppShell><div className="page-wrap settings-fatal"><span>!</span><h1>酒店上下文尚未就绪</h1><p>{error}</p><button onClick={() => location.reload()}>重新加载</button></div></AppShell>;
  if (!record || !identity || !rules) return null;

  const steps = getInitializationSteps(record);
  const completed = steps.filter(step => step.complete).length;
  const logoUrl = logoPreview ?? record.currentLogo?.publicUrl;

  return <AppShell><div className="page-wrap hotel-settings-page">
    <header className="settings-hero">
      <div><span className="settings-kicker">当前酒店设置 · {contextLabel}</span><h1>酒店设置中心</h1><p>Hotel Settings Center · 以酒店为单位维护身份、品牌与运营规则</p></div>
      <div className="synthetic-data-note"><i/><span><strong>本地示范资料</strong><small>Synthetic local fixture · 不含真实酒店数据</small></span></div>
    </header>
    {error && <div className="settings-alert" role="alert"><span>请检查</span><strong>{error}</strong><button onClick={() => setError(null)}>关闭</button></div>}

    <section className="settings-overview">
      <div className="settings-property-signature"><div className="settings-logo-mini">{identity.nameZh.slice(0,1)}</div><div><span>PROPERTY PROFILE</span><h2>{identity.nameZh}</h2><p>{identity.nameEn} · {identity.code}</p></div></div>
      <div className="settings-progress"><div><span>初始化进度</span><strong>{completed}<small> / {steps.length}</small></strong></div><div className="settings-progress-track"><i style={{ width: `${completed / steps.length * 100}%` }}/></div><p>完成品牌标识后，酒店基础资料即可进入下一阶段。</p></div>
      <div className="settings-status"><span className="status-dot"/>基础设置进行中<small>Initialization in progress</small></div>
    </section>

    <div className="settings-grid">
      <main className="settings-main">
        <section className="settings-card">
          <header><div><span>01 · PROPERTY IDENTITY</span><h2>基本信息</h2><p>正式酒店资料将用于导航、报表和对外品牌展示。</p></div><em>必填</em></header>
          <div className="settings-form-grid">
            <Field label="正式中文名称" value={identity.nameZh} onChange={value => updateIdentity("nameZh", value)}/>
            <Field label="正式英文名称" value={identity.nameEn} onChange={value => updateIdentity("nameEn", value)}/>
            <Field label="显示简称" value={identity.shortName} onChange={value => updateIdentity("shortName", value)}/>
            <Field label="酒店代码" value={identity.code} onChange={value => updateIdentity("code", value)}/>
            <Field label="品牌" value={identity.brand} onChange={value => updateIdentity("brand", value)}/>
            <Field label="城市" value={identity.city} onChange={value => updateIdentity("city", value)}/>
            <Field label="国家 / 地区" value={identity.countryRegion} onChange={value => updateIdentity("countryRegion", value)}/>
            <Field label="时区" value={identity.timezone} onChange={value => updateIdentity("timezone", value)}/>
            <label className="settings-field"><span>默认语言</span><select value={identity.defaultLanguage} onChange={event => updateIdentity("defaultLanguage", event.target.value)}><option value="zh-CN">简体中文 · Chinese</option><option value="en">English</option></select></label>
          </div>
          <footer><span>最后更新 {formatUpdatedAt(record.identity.updatedAt)}</span><button onClick={saveIdentity} disabled={Boolean(saving)}>{saving === "identity" ? "正在保存…" : "保存基本信息"}</button></footer>
        </section>

        <section className="settings-card">
          <header><div><span>02 · BUSINESS RULES</span><h2>业务规则</h2><p>这些口径只作用于当前酒店，并为后续员工导入提供校验依据。</p></div><em>酒店级</em></header>
          <div className="rule-list">
            <label><div><strong>新员工定义</strong><small>入职后多少天内视为新员工</small></div><span className="number-input"><input type="number" min="1" max="365" value={rules.newEmployeeDays} onChange={event => updateRules("newEmployeeDays", Number(event.target.value))}/><b>天</b></span></label>
            <label><div><strong>试用期字段含义</strong><small>决定导入表中的日期如何解释</small></div><select value={rules.probationFieldMeaning} onChange={event => updateRules("probationFieldMeaning", event.target.value as PropertySettings["probationFieldMeaning"])}><option value="probation_end_date">试用期结束日期</option><option value="confirmation_date">转正日期</option><option value="unused">暂不使用</option></select></label>
            <label><div><strong>员工状态来源</strong><small>当前阶段不会因员工未出现在表格中而自动停用</small></div><select value={rules.employeeStatusSource} onChange={event => updateRules("employeeStatusSource", event.target.value as PropertySettings["employeeStatusSource"])}><option value="manual">人工维护</option><option value="excel_import">Excel 导入</option><option value="future_hris">未来 HRIS</option></select></label>
            <Toggle label="CTC 必修" detail="Corporate Training Curriculum" checked={rules.ctcMandatory} onChange={checked => updateRules("ctcMandatory", checked)}/>
            <Toggle label="GTC 必修" detail="Global Training Curriculum" checked={rules.gtcMandatory} onChange={checked => updateRules("gtcMandatory", checked)}/>
          </div>
          <footer><span>版本 {record.settings.version} · 保存时进行并发校验</span><button onClick={saveRules} disabled={Boolean(saving)}>{saving === "rules" ? "正在保存…" : "保存业务规则"}</button></footer>
        </section>
      </main>

      <aside className="settings-side">
        <section className="settings-card branding-card">
          <header><div><span>03 · BRANDING</span><h2>酒店标识</h2><p>公开品牌资产</p></div></header>
          <div className="logo-stage">{logoUrl ? <img src={logoUrl} alt={`${identity.nameZh}酒店标识`}/> : <span>{identity.nameZh.slice(0,1)}</span>}</div>
          <div className="logo-guidance"><strong>PNG、JPEG 或 WebP</strong><small>最大 2 MB · 使用不可猜测的版本化文件名</small><small>替换版本保留 30 天，仅存放公开酒店品牌资产</small></div>
          <label className="logo-upload-button"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadLogo(file); }}/>{saving === "logo" ? "正在上传…" : "上传新的酒店标识"}</label>
          <button className="cleanup-button" onClick={async () => { const count = await repository.cleanupExpiredLogos(identity.id); showToast(`已清理 ${count} 个到期标识版本`); }}>清理到期版本</button>
        </section>

        <section className="settings-card initialization-card">
          <header><div><span>04 · INITIALIZATION</span><h2>初始化进度</h2><p>当前酒店基础准备状态</p></div></header>
          <div className="initialization-list">{steps.map((step, index) => <div className={step.complete ? "complete" : "pending"} key={step.key}><span>{step.complete ? "✓" : index + 1}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div></div>)}</div>
          <p className="initialization-note">部门树、职位与员工导入属于后续 Review Stop，本阶段不会提前创建。</p>
        </section>
      </aside>
    </div>
  </div></AppShell>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="settings-field"><span>{label}</span><input value={value} onChange={event => onChange(event.target.value)}/></label>;
}

function Toggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="rule-toggle"><div><strong>{label}</strong><small>{detail}</small></div><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)}/><span/></label>;
}

function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : "操作未完成，请重试"; }
function formatUpdatedAt(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }

export default function HotelSettingsPage() { return <AppProviders><HotelSettingsContent/></AppProviders>; }
