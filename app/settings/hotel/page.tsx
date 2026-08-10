"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../../components/shell/AppShell";
import { ProtectedAppProviders } from "../../providers";
import type {
  HotelPropertyRecord,
  PropertyIdentity,
  PropertySettings,
} from "../../repositories/contracts/models.ts";
import { RuntimeDomainRegistryBoundary } from "../../repositories/runtime/RuntimeDomainRegistryBoundary.tsx";
import type { RuntimeDomainRegistry } from "../../repositories/runtime/neon-domain-registry.ts";
import {
  getInitializationSteps,
  validateBusinessRules,
  validatePropertyIdentity,
} from "../../services/property-settings-service.ts";
import {
  isSaveConflict,
  saveStateKind,
  saveStateLabel,
  type SaveState,
} from "../../services/save-state.ts";
import { useUnsavedChangesGuard } from "../../services/use-unsaved-changes-guard.ts";
import { useAuthSession } from "../../state/auth-session.tsx";

type EditableSection = "identity" | "rules" | "logo";
type SectionMessages = Record<EditableSection, string | null>;
type SectionTimes = Record<EditableSection, string | null>;

const emptyMessages: SectionMessages = { identity: null, rules: null, logo: null };
const emptyTimes: SectionTimes = { identity: null, rules: null, logo: null };

function HotelSettingsContent({ registry }: { registry: RuntimeDomainRegistry }) {
  const repository = registry.property;
  const { session } = useAuthSession();
  const [contextLabel, setContextLabel] = useState("正在识别酒店上下文");
  const [record, setRecord] = useState<HotelPropertyRecord | null>(null);
  const [identity, setIdentity] = useState<PropertyIdentity | null>(null);
  const [rules, setRules] = useState<PropertySettings | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<EditableSection | null>(null);
  const [errors, setErrors] = useState<SectionMessages>(emptyMessages);
  const [savedAt, setSavedAt] = useState<SectionTimes>(emptyTimes);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const logoRetryRef = useRef<(() => Promise<void>) | null>(null);

  const applyAuthoritative = useCallback((next: HotelPropertyRecord) => {
    setRecord(next);
    setIdentity(next.identity);
    setRules(next.settings);
    setContextLabel(`${next.identity.shortName} · 当前登录酒店`);
  }, []);

  const resolvePropertyId = useCallback(async () => {
    const context = registry.environment.dataMode === "mock"
      ? await repository.resolveContext("training-demo.example.test")
      : null;
    const resolved = context?.propertyId ?? session.propertyId;
    if (!resolved) throw new Error("当前账号尚未取得酒店上下文");
    return resolved;
  }, [registry.environment.dataMode, repository, session.propertyId]);

  const loadAuthoritative = useCallback(async (knownPropertyId?: string) => {
    const resolved = knownPropertyId ?? propertyId ?? await resolvePropertyId();
    const next = await repository.getProperty(resolved);
    setPropertyId(resolved);
    applyAuthoritative(next);
    return next;
  }, [applyAuthoritative, propertyId, repository, resolvePropertyId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const resolved = await resolvePropertyId();
        const next = await repository.getProperty(resolved);
        if (!active) return;
        setPropertyId(resolved);
        applyAuthoritative(next);
      } catch (reason) {
        if (active) setFatalError(errorMessage(reason, "无法读取酒店设置"));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [applyAuthoritative, repository, resolvePropertyId]);

  const identityDirty = Boolean(
    record
    && identity
    && identityFingerprint(identity) !== identityFingerprint(record.identity),
  );
  const rulesDirty = Boolean(
    record
    && rules
    && rulesFingerprint(rules) !== rulesFingerprint(record.settings),
  );
  const dirty = identityDirty || rulesDirty;
  useUnsavedChangesGuard(dirty, "酒店设置有未保存的更改，确定离开吗？");

  const updateIdentity = (key: keyof PropertyIdentity, value: string) => {
    setIdentity(current => current ? { ...current, [key]: value } : current);
    clearSectionMessage("identity");
  };
  const updateRules = <K extends keyof PropertySettings>(key: K, value: PropertySettings[K]) => {
    setRules(current => current ? { ...current, [key]: value } : current);
    clearSectionMessage("rules");
  };

  const clearSectionMessage = (section: EditableSection) => {
    setErrors(current => ({ ...current, [section]: null }));
    setSavedAt(current => ({ ...current, [section]: null }));
  };

  const markSaved = (section: EditableSection) => {
    setErrors(current => ({ ...current, [section]: null }));
    setSavedAt(current => ({ ...current, [section]: currentTime() }));
  };

  const saveIdentity = async () => {
    if (!record || !identity) return;
    setSaving("identity");
    setErrors(current => ({ ...current, identity: null }));
    try {
      validatePropertyIdentity(identity);
      await repository.saveIdentity({
        propertyId: identity.id,
        expectedUpdatedAt: record.identity.updatedAt,
        code: identity.code.trim(),
        nameZh: identity.nameZh.trim(),
        nameEn: identity.nameEn.trim(),
        shortName: identity.shortName.trim(),
        brand: identity.brand.trim(),
        city: identity.city.trim(),
        countryRegion: identity.countryRegion.trim(),
        timezone: identity.timezone.trim(),
        defaultLanguage: identity.defaultLanguage,
      });
      await loadAuthoritative(record.identity.id);
      markSaved("identity");
    } catch (reason) {
      setErrors(current => ({
        ...current,
        identity: errorMessage(reason, "酒店信息保存失败，请重试"),
      }));
    } finally {
      setSaving(null);
    }
  };

  const saveRules = async () => {
    if (!record || !rules) return;
    setSaving("rules");
    setErrors(current => ({ ...current, rules: null }));
    try {
      validateBusinessRules(rules);
      await repository.saveBusinessRules({
        propertyId: rules.propertyId,
        expectedVersion: record.settings.version,
        newEmployeeDays: rules.newEmployeeDays,
        probationFieldMeaning: rules.probationFieldMeaning,
        employeeStatusSource: rules.employeeStatusSource,
        ctcMandatory: rules.ctcMandatory,
        gtcMandatory: rules.gtcMandatory,
      });
      await loadAuthoritative(record.identity.id);
      markSaved("rules");
    } catch (reason) {
      setErrors(current => ({
        ...current,
        rules: errorMessage(reason, "业务规则保存失败，请重试"),
      }));
    } finally {
      setSaving(null);
    }
  };

  const uploadLogo = async (file: File) => {
    if (!record) return;
    logoRetryRef.current = null;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setErrors(current => ({ ...current, logo: "仅支持 PNG、JPEG 或 WebP 酒店标识" }));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setErrors(current => ({ ...current, logo: "酒店标识文件不得超过 2 MB" }));
      return;
    }
    logoRetryRef.current = () => uploadLogo(file);
    setSaving("logo");
    setErrors(current => ({ ...current, logo: null }));
    try {
      await repository.uploadLogo({
        tenantId: record.identity.tenantId,
        propertyId: record.identity.id,
        file,
      });
      await loadAuthoritative(record.identity.id);
      logoRetryRef.current = null;
      markSaved("logo");
    } catch (reason) {
      setErrors(current => ({
        ...current,
        logo: errorMessage(reason, "酒店标识上传失败，请重试"),
      }));
    } finally {
      setSaving(null);
    }
  };

  const cleanupExpiredLogos = async () => {
    if (!record) return;
    logoRetryRef.current = cleanupExpiredLogos;
    setSaving("logo");
    setErrors(current => ({ ...current, logo: null }));
    try {
      const count = await repository.cleanupExpiredLogos(record.identity.id);
      await loadAuthoritative(record.identity.id);
      setErrors(current => ({
        ...current,
        logo: count ? `已清理 ${count} 个到期标识版本` : null,
      }));
      logoRetryRef.current = null;
      markSaved("logo");
    } catch (reason) {
      setErrors(current => ({
        ...current,
        logo: errorMessage(reason, "到期版本清理失败，请重试"),
      }));
    } finally {
      setSaving(null);
    }
  };

  const reloadLatest = async (section?: EditableSection) => {
    if (dirty && !window.confirm("重新读取会放弃当前未保存的更改，确定继续吗？")) return;
    if (!record) return;
    setSaving(section ?? "identity");
    setErrors(emptyMessages);
    try {
      await loadAuthoritative(record.identity.id);
      if (section === "logo") logoRetryRef.current = null;
      setSavedAt(emptyTimes);
    } catch (reason) {
      const message = errorMessage(reason, "无法重新读取酒店设置");
      if (section) setErrors(current => ({ ...current, [section]: message }));
      else setFatalError(message);
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="page-wrap settings-loading" role="status">
          <span className="settings-spinner" />
          <strong>正在准备酒店设置中心</strong>
          <small>Loading property settings</small>
        </div>
      </AppShell>
    );
  }
  if (fatalError && !record) {
    return (
      <AppShell>
        <div className="page-wrap settings-fatal" role="alert">
          <span>!</span>
          <h1>酒店上下文尚未就绪</h1>
          <p>{fatalError}</p>
          <button onClick={() => window.location.reload()}>重新加载</button>
        </div>
      </AppShell>
    );
  }
  if (!record || !identity || !rules) return null;

  const settingChecks = getInitializationSteps(record);
  const activationComplete = record.settings.initializationState === "ready";
  const logoUrl = record.currentLogo?.publicUrl;
  const anyError = Object.values(errors).find(Boolean);

  return (
    <AppShell>
      <div className="page-wrap hotel-settings-page">
        <header className="settings-hero">
          <div>
            <span className="settings-kicker">当前酒店设置 · {contextLabel}</span>
            <h1>酒店设置中心</h1>
            <p>Hotel Settings Center · 维护酒店身份、品牌与运营规则</p>
          </div>
          <div className="synthetic-data-note">
            <i />
            <span>
              <strong>
                {registry.environment.dataMode === "mock" ? "本地测试资料" : "当前酒店真实设置"}
              </strong>
              <small>
                {registry.environment.dataMode === "mock"
                  ? "Synthetic local fixture"
                  : "Server-persisted property settings"}
              </small>
            </span>
          </div>
        </header>

        {anyError && (
          <div className="settings-alert" role="alert">
            <span>{Object.values(errors).some(isSaveConflict) ? "保存冲突" : "请检查"}</span>
            <strong>{anyError}</strong>
            {Object.values(errors).some(isSaveConflict) && (
              <button onClick={() => void reloadLatest()}>重新读取最新资料</button>
            )}
          </div>
        )}

        <section className="settings-overview">
          <div className="settings-property-signature">
            <div className="settings-logo-mini">{identity.nameZh.slice(0, 1)}</div>
            <div>
              <span>PROPERTY PROFILE</span>
              <h2>{identity.nameZh}</h2>
              <p>{identity.nameEn} · {identity.code}</p>
            </div>
          </div>
          <div className="settings-completeness">
            <span>酒店设置完整性</span>
            <strong>{settingChecks.filter(item => item.complete).length} / {settingChecks.length}</strong>
            <p>仅反映当前设置资料，不作为永久启用进度。</p>
          </div>
          <div className={`settings-status ${activationComplete ? "verified" : "pending"}`}>
            <span className="status-dot" />
            {activationComplete ? "酒店已启用" : "酒店启用待复核"}
            <small>{activationComplete ? "Activation complete" : "Activation review required"}</small>
          </div>
        </section>

        <div className="settings-grid">
          <main className="settings-main">
            <section className="settings-card">
              <header>
                <div>
                  <span>01 · PROPERTY IDENTITY</span>
                  <h2>基本信息</h2>
                  <p>正式酒店资料将用于导航、报表和对外品牌展示。</p>
                </div>
                <em>必填</em>
              </header>
              <div className="settings-form-grid">
                <Field label="正式中文名称" value={identity.nameZh} onChange={value => updateIdentity("nameZh", value)} />
                <Field label="正式英文名称" value={identity.nameEn} onChange={value => updateIdentity("nameEn", value)} />
                <Field label="显示简称" value={identity.shortName} onChange={value => updateIdentity("shortName", value)} />
                <Field label="酒店代码" value={identity.code} onChange={value => updateIdentity("code", value)} />
                <Field label="品牌" value={identity.brand} onChange={value => updateIdentity("brand", value)} />
                <Field label="城市" value={identity.city} onChange={value => updateIdentity("city", value)} />
                <Field label="国家 / 地区" value={identity.countryRegion} onChange={value => updateIdentity("countryRegion", value)} />
                <Field label="时区" value={identity.timezone} onChange={value => updateIdentity("timezone", value)} />
                <label className="settings-field">
                  <span>默认语言</span>
                  <select
                    value={identity.defaultLanguage}
                    onChange={event => updateIdentity("defaultLanguage", event.target.value)}
                  >
                    <option value="zh-CN">简体中文 · Chinese</option>
                    <option value="en">English</option>
                  </select>
                </label>
              </div>
              <footer>
                <SaveStatus
                  state={{
                    saving: saving === "identity",
                    dirty: identityDirty,
                    error: errors.identity,
                    savedAt: savedAt.identity,
                  }}
                  onRetry={saveIdentity}
                  onReload={() => reloadLatest("identity")}
                />
                <button
                  onClick={() => void saveIdentity()}
                  disabled={Boolean(saving) || !identityDirty}
                >
                  {saving === "identity" ? "正在保存…" : "保存酒店信息"}
                </button>
              </footer>
            </section>

            <section className="settings-card">
              <header>
                <div>
                  <span>02 · BUSINESS RULES</span>
                  <h2>业务规则</h2>
                  <p>这些口径只作用于当前酒店，并为后续员工资料更新提供校验依据。</p>
                </div>
                <em>酒店级</em>
              </header>
              <div className="rule-list">
                <label>
                  <div><strong>新员工定义</strong><small>入职后多少天内视为新员工</small></div>
                  <span className="number-input">
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={rules.newEmployeeDays}
                      onChange={event => updateRules("newEmployeeDays", Number(event.target.value))}
                    />
                    <b>天</b>
                  </span>
                </label>
                <label>
                  <div><strong>试用期字段含义</strong><small>决定员工资料中的日期如何解释</small></div>
                  <select
                    value={rules.probationFieldMeaning}
                    onChange={event => updateRules(
                      "probationFieldMeaning",
                      event.target.value as PropertySettings["probationFieldMeaning"],
                    )}
                  >
                    <option value="probation_end_date">试用期结束日期</option>
                    <option value="confirmation_date">转正日期</option>
                    <option value="unused">暂不使用</option>
                  </select>
                </label>
                <label>
                  <div><strong>员工状态来源</strong><small>不会因员工未出现在文件中而自动停用</small></div>
                  <select
                    value={rules.employeeStatusSource}
                    onChange={event => updateRules(
                      "employeeStatusSource",
                      event.target.value as PropertySettings["employeeStatusSource"],
                    )}
                  >
                    <option value="manual">人工维护</option>
                    <option value="excel_import">员工资料更新</option>
                    <option value="future_hris">未来 HRIS</option>
                  </select>
                </label>
                <Toggle
                  label="CTC 必修"
                  detail="Corporate Training Curriculum"
                  checked={rules.ctcMandatory}
                  onChange={checked => updateRules("ctcMandatory", checked)}
                />
                <Toggle
                  label="GTC 必修"
                  detail="Global Training Curriculum"
                  checked={rules.gtcMandatory}
                  onChange={checked => updateRules("gtcMandatory", checked)}
                />
              </div>
              <footer>
                <SaveStatus
                  state={{
                    saving: saving === "rules",
                    dirty: rulesDirty,
                    error: errors.rules,
                    savedAt: savedAt.rules,
                  }}
                  onRetry={saveRules}
                  onReload={() => reloadLatest("rules")}
                />
                <button
                  onClick={() => void saveRules()}
                  disabled={Boolean(saving) || !rulesDirty}
                >
                  {saving === "rules" ? "正在保存…" : "保存业务规则"}
                </button>
              </footer>
            </section>
          </main>

          <aside className="settings-side">
            <section className="settings-card branding-card">
              <header>
                <div>
                  <span>03 · BRANDING</span>
                  <h2>酒店标识</h2>
                  <p>公开品牌资产</p>
                </div>
              </header>
              <div className="logo-stage">
                {logoUrl
                  ? <img src={logoUrl} alt={`${identity.nameZh}酒店标识`} />
                  : <span>{identity.nameZh.slice(0, 1)}</span>}
              </div>
              <div className="logo-guidance">
                <strong>仅支持 PNG、JPEG 或 WebP</strong>
                <small>最大 2 MB · 使用不可猜测的版本化文件名</small>
                <small>替换版本保留 30 天，仅存放公开酒店品牌资产</small>
              </div>
              <label className={`logo-upload-button ${saving === "logo" ? "disabled" : ""}`}>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={Boolean(saving)}
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) void uploadLogo(file);
                    event.currentTarget.value = "";
                  }}
                />
                {saving === "logo" ? "正在处理…" : "上传新的酒店标识"}
              </label>
              <SaveStatus
                state={{
                  saving: saving === "logo",
                  dirty: false,
                  error: errors.logo,
                  savedAt: savedAt.logo,
                }}
                onRetry={() => logoRetryRef.current ? logoRetryRef.current() : reloadLatest("logo")}
                onReload={() => reloadLatest("logo")}
              />
              <button
                className="cleanup-button"
                disabled={Boolean(saving)}
                onClick={() => void cleanupExpiredLogos()}
              >
                清理到期版本
              </button>
            </section>

            <section className="settings-card activation-card">
              <header>
                <div>
                  <span>04 · HOTEL ACTIVATION</span>
                  <h2>酒店启用</h2>
                  <p>有限启用流程与后续复核</p>
                </div>
              </header>
              <div className={`activation-state ${activationComplete ? "complete" : "pending"}`}>
                <i>{activationComplete ? "✓" : "!"}</i>
                <div>
                  <strong>{activationComplete ? "酒店已启用" : "等待启用复核"}</strong>
                  <small>
                    {activationComplete
                      ? "日常维护继续在酒店设置、组织、职位和账号页面完成。"
                      : "完成酒店信息与规则、正式部门和管理员账号后即可启用。"}
                  </small>
                </div>
              </div>
              <div className="initialization-list">
                {settingChecks.map(item => (
                  <div className={item.complete ? "complete" : "pending"} key={item.key}>
                    <span>{item.complete ? "✓" : "·"}</span>
                    <div><strong>{item.label}</strong><small>{item.detail}</small></div>
                  </div>
                ))}
              </div>
              <Link className="activation-link" href="/initialize">
                {activationComplete ? "查看启用资料" : "进入启用复核"}
              </Link>
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function SaveStatus({
  state,
  onRetry,
  onReload,
}: {
  state: SaveState;
  onRetry: () => void | Promise<void>;
  onReload: () => void | Promise<void>;
}) {
  const kind = saveStateKind(state);
  const action = kind === "conflict" ? onReload : kind === "failed" ? onRetry : null;
  if (action) {
    return (
      <button
        className={`settings-save-state ${kind}`}
        type="button"
        onClick={() => void action()}
      >
        {saveStateLabel(state)}
      </button>
    );
  }
  return <span className={`settings-save-state ${kind}`}>{saveStateLabel(state)}</span>;
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input value={value} onChange={event => onChange(event.target.value)} />
    </label>
  );
}

function Toggle({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="rule-toggle">
      <div><strong>{label}</strong><small>{detail}</small></div>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span />
    </label>
  );
}

function identityFingerprint(identity: PropertyIdentity) {
  return JSON.stringify({
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
}

function rulesFingerprint(rules: PropertySettings) {
  return JSON.stringify({
    newEmployeeDays: rules.newEmployeeDays,
    probationFieldMeaning: rules.probationFieldMeaning,
    employeeStatusSource: rules.employeeStatusSource,
    ctcMandatory: rules.ctcMandatory,
    gtcMandatory: rules.gtcMandatory,
  });
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

function currentTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

export default function HotelSettingsPage() {
  return (
    <ProtectedAppProviders>
      <RuntimeDomainRegistryBoundary>
        {registry => <HotelSettingsContent registry={registry} />}
      </RuntimeDomainRegistryBoundary>
    </ProtectedAppProviders>
  );
}
