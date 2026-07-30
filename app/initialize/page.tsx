"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProtectedAppProviders } from "../providers";
import type { InitializationAccessSummary } from "../repositories/contracts/initialization-repository.ts";
import type {
  DepartmentAlias,
  DepartmentNode,
  OfficialPosition,
  PositionSourceLabel,
} from "../repositories/contracts/organization-models.ts";
import type {
  HotelPropertyRecord,
  PropertySettings,
} from "../repositories/contracts/models.ts";
import { createRepositoryRegistry } from "../repositories/registry.ts";
import {
  deriveWizardState,
  type WizardProgress,
  type WizardStepKey,
} from "../services/initialization-wizard-service.ts";
import {
  deriveC2EmployeeBaselineReadiness,
  resolveC2InitializationState,
} from "../services/c2-activation-readiness.ts";
import {
  validateBusinessRules,
  validatePropertyIdentity,
} from "../services/property-settings-service.ts";
import {
  isSaveConflict,
  saveStateKind,
  saveStateLabel,
} from "../services/save-state.ts";
import { useUnsavedChangesGuard } from "../services/use-unsaved-changes-guard.ts";
import { useAuthSession } from "../state/auth-session";
import { AccessSetupStep } from "./AccessSetupStep.tsx";
import { OrganizationSetupStep } from "./OrganizationSetupStep.tsx";

type PersistedProgress = WizardProgress & {
  version: number;
  completedAt: string | null;
  state?: "not_started" | "in_progress" | "ready";
};

const initialProgress: PersistedProgress = {
  lastActiveStep: 1,
  steps: {},
  version: 1,
  completedAt: null,
  state: "not_started",
};

const inspectedStatuses = new Set([
  "mapping_required",
  "validating",
  "ready_for_review",
  "importing",
  "completed",
  "completed_with_warnings",
]);

function Wizard() {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const { session } = useAuthSession();
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [authoritative, setAuthoritative] = useState<HotelPropertyRecord | null>(null);
  const [draft, setDraft] = useState<HotelPropertyRecord | null>(null);
  const [tree, setTree] = useState<DepartmentNode[]>([]);
  const [positions, setPositions] = useState<OfficialPosition[]>([]);
  const [aliases, setAliases] = useState<DepartmentAlias[]>([]);
  const [positionLabels, setPositionLabels] = useState<PositionSourceLabel[]>([]);
  const [progress, setProgress] = useState<PersistedProgress>(initialProgress);
  const [accessSummary, setAccessSummary] = useState<InitializationAccessSummary | null>(null);
  const [inspectedEmployeeMaster, setInspectedEmployeeMaster] = useState(false);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [childDraftDirty, setChildDraftDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const retryRef = useRef<null | (() => Promise<void>)>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  const resolvePropertyId = useCallback(async () => {
    const context = registry.environment.dataMode === "mock"
      ? await registry.property.resolveContext("training-demo.example.test")
      : null;
    const resolved = context?.propertyId ?? session.propertyId;
    if (!resolved) throw new Error("酒店上下文尚未配置");
    return resolved;
  }, [registry, session.propertyId]);

  const fetchSnapshot = useCallback(async (knownPropertyId?: string) => {
    const resolved = knownPropertyId ?? propertyId ?? await resolvePropertyId();
    const [
      nextRecord,
      nodes,
      nextPositions,
      nextAliases,
      nextPositionLabels,
      nextProgress,
      batches,
      access,
    ] = await Promise.all([
      registry.property.getProperty(resolved),
      registry.department.listTree(resolved),
      registry.position.listPositions(resolved),
      registry.department.listAliases(resolved),
      registry.position.listSourceLabels(resolved),
      registry.initialization.getProgress(resolved),
      registry.import.listImportHistory(resolved),
      registry.initialization.getAccessSummary(resolved),
    ]);
    return {
      propertyId: resolved,
      record: nextRecord,
      tree: nodes,
      positions: nextPositions,
      aliases: nextAliases,
      positionLabels: nextPositionLabels,
      progress: nextProgress,
      inspectedEmployeeMaster: batches.some(batch => inspectedStatuses.has(batch.status)),
      access,
    };
  }, [propertyId, registry, resolvePropertyId]);

  const applySnapshot = useCallback((
    snapshot: Awaited<ReturnType<typeof fetchSnapshot>>,
    nextStep?: number,
  ) => {
    setPropertyId(snapshot.propertyId);
    setAuthoritative(snapshot.record);
    setDraft(snapshot.record);
    setTree([...snapshot.tree]);
    setPositions([...snapshot.positions]);
    setAliases([...snapshot.aliases]);
    setPositionLabels([...snapshot.positionLabels]);
    setProgress(snapshot.progress);
    setInspectedEmployeeMaster(snapshot.inspectedEmployeeMaster);
    setAccessSummary(snapshot.access);
    setAccessLoading(false);
    setChildDraftDirty(false);
    setStep(Math.min(5, Math.max(1, nextStep ?? snapshot.progress.lastActiveStep)));
  }, []);

  const reloadAuthoritative = useCallback(async (nextStep?: number) => {
    const snapshot = await fetchSnapshot();
    applySnapshot(snapshot, nextStep);
    setSaveError(null);
    retryRef.current = null;
    return snapshot;
  }, [applySnapshot, fetchSnapshot]);

  useEffect(() => {
    let active = true;
    void fetchSnapshot()
      .then(snapshot => {
        if (active) applySnapshot(snapshot);
      })
      .catch(reason => {
        if (active) setSaveError(errorMessage(reason, "无法读取酒店启用资料"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applySnapshot, fetchSnapshot]);

  const hotelDraftDirty = Boolean(
    authoritative
    && draft
    && hotelSettingsFingerprint(authoritative) !== hotelSettingsFingerprint(draft),
  );
  const hasUnsavedChanges = hotelDraftDirty || childDraftDirty;
  useUnsavedChangesGuard(hasUnsavedChanges, "酒店启用资料有未保存的更改，确定离开吗？");

  if (loading) return <div className="wizard-loading">正在准备酒店启用检查…</div>;
  if (session.role !== "property_ld_manager") {
    return (
      <div className="wizard-denied">
        <span>访问受限</span>
        <h1>当前账号无权编辑酒店启用检查</h1>
        <p>只有当前酒店的学习与发展经理可以维护酒店启用资料。</p>
      </div>
    );
  }
  if (!authoritative || !draft) {
    return (
      <div className="wizard-denied">
        <span>读取失败</span>
        <h1>酒店启用资料暂时不可用</h1>
        <p>{saveError ?? "请稍后重新读取。"}</p>
        <button onClick={() => window.location.reload()}>重新加载</button>
      </div>
    );
  }

  const state = deriveWizardState({
    identity: authoritative.identity,
    rules: authoritative.settings,
    activeDepartments: tree.filter(node => node.isActive).length,
    activePositions: positions.filter(position => position.isActive).length,
    inspectedEmployeeMaster,
    unresolvedDepartmentLabels: aliases.filter(alias => alias.resolutionType === "deferred").length,
    unresolvedPositionLabels: positionLabels.filter(label => label.resolutionStatus === "deferred").length,
    activePropertyAdministrator: Boolean(accessSummary?.activePropertyManagers),
    progress,
  });
  const c2Readiness = deriveC2EmployeeBaselineReadiness({
    initializationState: resolveC2InitializationState({
      progressState: progress.state,
      completedAt: progress.completedAt,
      propertySettingsState: authoritative.settings.initializationState,
    }),
    activeDepartments: tree.filter(node => node.isActive).length,
    activePropertyManagers: accessSummary?.activePropertyManagers ?? 0,
    activeDepartmentAdministrators: accessSummary?.activeDepartmentAdministrators ?? 0,
    activeDepartmentAdministratorsWithScope: accessSummary?.activeDepartmentAdministratorsWithScope ?? 0,
  });
  const current = state.steps[step - 1];
  const currentSaveState = {
    saving,
    dirty: hasUnsavedChanges,
    error: saveError,
    savedAt,
  };
  const saveKind = saveStateKind(currentSaveState);
  const identity = draft.identity;
  const settings = draft.settings;

  const markSaved = () => {
    setSaveError(null);
    setSavedAt(currentTime());
    retryRef.current = null;
  };

  const runAction = async (action: () => Promise<void>) => {
    retryRef.current = action;
    setSaving(true);
    setSaveError(null);
    try {
      await action();
      markSaved();
      return true;
    } catch (reason) {
      setSaveError(errorMessage(reason, "保存失败，请重试"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const discardDrafts = () => {
    setDraft(authoritative);
    setChildDraftDirty(false);
  };

  const changeStep = async (next: number) => {
    if (next === step || saving) return;
    if (
      hasUnsavedChanges
      && !window.confirm("当前部分有未保存的更改，确定放弃并切换吗？")
    ) return;
    if (hasUnsavedChanges) discardDrafts();
    const action = async () => {
      const saved = await registry.initialization.saveNavigation(
        authoritative.identity.id,
        next,
        progress.version,
      );
      setProgress(saved);
      setStep(next);
    };
    await runAction(action);
  };

  const saveHotelInformation = async () => {
    const action = async () => {
      validatePropertyIdentity(draft.identity);
      validateBusinessRules(draft.settings);
      let latest = authoritative;
      let activationProgress = progress;

      if (identityFingerprint(draft) !== identityFingerprint(authoritative)) {
        await registry.property.saveIdentity({
          propertyId: draft.identity.id,
          expectedUpdatedAt: authoritative.identity.updatedAt,
          code: draft.identity.code.trim(),
          nameZh: draft.identity.nameZh.trim(),
          nameEn: draft.identity.nameEn.trim(),
          shortName: draft.identity.shortName.trim(),
          brand: draft.identity.brand.trim(),
          city: draft.identity.city.trim(),
          countryRegion: draft.identity.countryRegion.trim(),
          timezone: draft.identity.timezone.trim(),
          defaultLanguage: draft.identity.defaultLanguage,
        });
        latest = await registry.property.getProperty(authoritative.identity.id);
      }

      if (rulesFingerprint(draft) !== rulesFingerprint(authoritative)) {
        await registry.property.saveBusinessRules({
          propertyId: latest.settings.propertyId,
          expectedVersion: authoritative.settings.version,
          newEmployeeDays: draft.settings.newEmployeeDays,
          probationFieldMeaning: draft.settings.probationFieldMeaning,
          employeeStatusSource: draft.settings.employeeStatusSource,
          ctcMandatory: draft.settings.ctcMandatory,
          gtcMandatory: draft.settings.gtcMandatory,
        });
        latest = await registry.property.getProperty(authoritative.identity.id);
        activationProgress = await registry.initialization.getProgress(
          authoritative.identity.id,
        );
      }

      let nextProgress = await registry.initialization.saveStep({
        propertyId: latest.identity.id,
        stepKey: "identity",
        lastActiveStep: 2,
        explicitlyConfirmed: true,
        expectedVersion: activationProgress.version,
      });
      nextProgress = await registry.initialization.saveStep({
        propertyId: latest.identity.id,
        stepKey: "rules",
        lastActiveStep: 2,
        explicitlyConfirmed: true,
        expectedVersion: nextProgress.version,
      });
      const [latestRecord, latestProgress] = await Promise.all([
        registry.property.getProperty(latest.identity.id),
        registry.initialization.getProgress(latest.identity.id),
      ]);
      setAuthoritative(latestRecord);
      setDraft(latestRecord);
      setProgress(latestProgress.version >= nextProgress.version ? latestProgress : nextProgress);
      setStep(2);
    };
    await runAction(action);
  };

  const confirmSection = async (
    key: WizardStepKey,
    next: number,
    warning?: string | null,
  ) => {
    const action = async () => {
      const saved = await registry.initialization.saveStep({
        propertyId: authoritative.identity.id,
        stepKey: key,
        lastActiveStep: next,
        explicitlyConfirmed: key === "upload" ? state.employeeReady : true,
        warning,
        expectedVersion: progress.version,
      });
      const latestProgress = await registry.initialization.getProgress(authoritative.identity.id);
      setProgress(latestProgress.version >= saved.version ? latestProgress : saved);
      setStep(next);
      setChildDraftDirty(false);
    };
    await runAction(action);
  };

  const refreshOrganizationAndContinue = async () => {
    const nodes = await registry.department.listTree(authoritative.identity.id);
    setTree([...nodes]);
    if (!nodes.some(node => node.isActive)) {
      setSaveError("酒店启用至少需要一个有效正式部门");
      return;
    }
    await confirmSection("organization", 3);
  };

  const refreshAccess = async () => {
    setAccessLoading(true);
    try {
      setAccessSummary(
        await registry.initialization.getAccessSummary(authoritative.identity.id),
      );
    } catch (reason) {
      setSaveError(errorMessage(reason, "管理员账号状态读取失败"));
    } finally {
      setAccessLoading(false);
    }
  };

  const uploadLogo = async (file?: File) => {
    if (!file || hotelDraftDirty) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setSaveError("仅支持 PNG、JPEG 或 WebP 酒店标识");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setSaveError("酒店标识文件不得超过 2 MB");
      return;
    }
    const action = async () => {
      await registry.property.uploadLogo({
        tenantId: authoritative.identity.tenantId,
        propertyId: authoritative.identity.id,
        file,
      });
      const latest = await registry.property.getProperty(authoritative.identity.id);
      setAuthoritative(latest);
      setDraft(latest);
    };
    await runAction(action);
  };

  const saveForLater = async () => {
    const action = async () => {
      const saved = await registry.initialization.saveNavigation(
        authoritative.identity.id,
        step,
        progress.version,
      );
      setProgress(saved);
      setSavedAt(currentTime());
    };
    await runAction(action);
  };

  const completeActivation = async () => {
    if (!state.minimumReady) {
      setSaveError("请先完成酒店信息与规则、正式部门和管理员账号");
      return;
    }
    const action = async () => {
      await registry.initialization.complete(
        authoritative.identity.id,
        progress.version,
      );
      await reloadAuthoritative(5);
    };
    await runAction(action);
  };

  const retrySave = () => {
    const retry = retryRef.current;
    if (retry) void runAction(retry);
  };

  const reloadLatest = async () => {
    if (
      hasUnsavedChanges
      && !window.confirm("重新读取会放弃当前未保存的更改，确定继续吗？")
    ) return;
    setSaving(true);
    try {
      await reloadAuthoritative(step);
      setSavedAt(null);
    } catch (reason) {
      setSaveError(errorMessage(reason, "无法重新读取酒店启用资料"));
    } finally {
      setSaving(false);
    }
  };

  const requiredChecks = [
    {
      number: 1,
      label: "酒店信息与规则",
      complete: state.steps[0].complete,
      detail: state.steps[0].detail,
    },
    {
      number: 2,
      label: "正式部门",
      complete: state.steps[1].complete,
      detail: state.steps[1].detail,
    },
    {
      number: 3,
      label: "管理员账号",
      complete: state.steps[2].complete,
      detail: state.steps[2].detail,
    },
  ];

  return (
    <div className="initialization-shell">
      <header className="wizard-top">
        <Link className="wizard-brand" href="/">
          <i>澜</i>
          <span>
            <strong>{authoritative.identity.shortName}</strong>
            <small>Hotel L&amp;D Operations</small>
          </span>
        </Link>
        <button
          className={`wizard-top-status ${saveKind}`}
          type="button"
          disabled={!saveError}
          onClick={isSaveConflict(saveError) ? () => void reloadLatest() : retrySave}
        >
          <span className="save-dot" />
          {saveStateLabel(currentSaveState)}
          <small>以服务器保存状态为准</small>
        </button>
        <div className="wizard-top-actions">
          <Link className="wizard-return" href="/">返回运营首页</Link>
          <button
            disabled={saving || hasUnsavedChanges}
            title={hasUnsavedChanges ? "请先保存或取消当前编辑" : "保存当前浏览位置"}
            onClick={() => void saveForLater()}
          >
            保存并稍后继续
          </button>
        </div>
      </header>

      {saveError && (
        <div className={`wizard-save-alert ${isSaveConflict(saveError) ? "conflict" : ""}`} role="alert">
          <strong>{saveError}</strong>
          <button onClick={isSaveConflict(saveError) ? () => void reloadLatest() : retrySave}>
            {isSaveConflict(saveError) ? "重新读取最新资料" : "点击重试"}
          </button>
        </div>
      )}

      <div className="wizard-frame activation-frame">
        <aside className="wizard-steps" aria-label="酒店启用部分">
          <div>
            <span>酒店启用</span>
            <h1>完成有限的启用检查</h1>
          </div>
          {state.steps.map(item => (
            <button
              key={item.key}
              className={`${item.number === step ? "active" : ""} ${item.complete ? "complete" : ""} ${item.blocked ? "blocked" : ""}`}
              onClick={() => void changeStep(item.number)}
            >
              <i>{item.complete ? "✓" : item.number}</i>
              <span><strong>{item.label}</strong><small>{item.english}</small></span>
              <em>{item.complete ? "已完成" : item.number === 4 ? "可稍后" : ""}</em>
            </button>
          ))}
        </aside>

        <main className="wizard-workspace">
          <header className="wizard-heading">
            <div>
              <span>第 {step} 个部分 / 共 5 个部分</span>
              <h2>{current.label}</h2>
              <p>{current.english} · 启用完成后仍可从管理设置复核</p>
            </div>
          </header>

          {step === 1 && (
            <section className="wizard-card">
              <Intro
                title="确认酒店身份与培训运营口径"
                detail="酒店信息和业务规则共同构成启用的第一部分；每次保存都会重新读取服务器状态。"
              />
              <div className="wizard-form">
                {([
                  ["nameZh", "酒店正式中文名"],
                  ["nameEn", "酒店正式英文名"],
                  ["shortName", "酒店简称"],
                  ["code", "酒店代码"],
                  ["brand", "品牌"],
                  ["city", "城市"],
                  ["countryRegion", "国家或地区"],
                  ["timezone", "时区"],
                ] as const).map(([key, label]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      value={identity[key]}
                      onChange={event => {
                        setDraft({
                          ...draft,
                          identity: { ...identity, [key]: event.target.value },
                        });
                        setSaveError(null);
                        setSavedAt(null);
                      }}
                    />
                  </label>
                ))}
                <label>
                  <span>默认语言</span>
                  <select
                    value={identity.defaultLanguage}
                    onChange={event => {
                      setDraft({
                        ...draft,
                        identity: { ...identity, defaultLanguage: event.target.value },
                      });
                      setSaveError(null);
                      setSavedAt(null);
                    }}
                  >
                    <option value="zh-CN">简体中文</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <div className="wizard-logo">
                  {draft.currentLogo
                    ? <img src={draft.currentLogo.publicUrl} alt={`${identity.nameZh} Logo`} />
                    : <span>{identity.nameZh.slice(0, 1)}</span>}
                  <div>
                    <strong>酒店 Logo</strong>
                    <small>支持 PNG、JPEG、WebP，最大 2 MB；Logo 可稍后补充，不阻塞酒店启用。</small>
                    <input
                      ref={logoInput}
                      type="file"
                      hidden
                      accept="image/png,image/jpeg,image/webp"
                      onChange={event => {
                        void uploadLogo(event.target.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                    <button
                      disabled={saving || hotelDraftDirty}
                      title={hotelDraftDirty ? "请先保存酒店信息与规则" : "上传酒店 Logo"}
                      onClick={() => logoInput.current?.click()}
                    >
                      {saving ? "正在处理…" : draft.currentLogo ? "更换 Logo" : "上传 Logo"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="wizard-rules compact-rules">
                <label>
                  <span><strong>新员工定义天数</strong><small>入职后多少天内属于新员工</small></span>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={settings.newEmployeeDays}
                    onChange={event => {
                      setDraft({
                        ...draft,
                        settings: { ...settings, newEmployeeDays: Number(event.target.value) },
                      });
                      setSaveError(null);
                      setSavedAt(null);
                    }}
                  />
                </label>
                <Choice
                  label="试用期字段含义"
                  value={settings.probationFieldMeaning}
                  options={[
                    ["confirmation_date", "转正日期"],
                    ["probation_end_date", "试用期结束日期"],
                    ["unused", "暂不使用"],
                  ]}
                  onChange={value => {
                    setDraft({
                      ...draft,
                      settings: {
                        ...settings,
                        probationFieldMeaning: value as PropertySettings["probationFieldMeaning"],
                      },
                    });
                    setSaveError(null);
                    setSavedAt(null);
                  }}
                />
                <Choice
                  label="员工状态来源"
                  value={settings.employeeStatusSource}
                  options={[
                    ["manual", "人工维护"],
                    ["excel_import", "员工资料更新"],
                    ["future_hris", "未来 HRIS"],
                  ]}
                  onChange={value => {
                    setDraft({
                      ...draft,
                      settings: {
                        ...settings,
                        employeeStatusSource: value as PropertySettings["employeeStatusSource"],
                      },
                    });
                    setSaveError(null);
                    setSavedAt(null);
                  }}
                />
                {([
                  ["ctcMandatory", "CTC 必修"],
                  ["gtcMandatory", "GTC 必修"],
                ] as const).map(([key, label]) => (
                  <label className="wizard-toggle" key={key}>
                    <span><strong>{label}</strong><small>启用后可在酒店设置中继续调整</small></span>
                    <input
                      type="checkbox"
                      checked={settings[key]}
                      onChange={event => {
                        setDraft({
                          ...draft,
                          settings: { ...settings, [key]: event.target.checked },
                        });
                        setSaveError(null);
                        setSavedAt(null);
                      }}
                    />
                    <i />
                  </label>
                ))}
              </div>
              <footer>
                <Validation
                  complete={state.steps[0].complete && !hotelDraftDirty}
                  label={hotelDraftDirty ? "酒店信息或业务规则有未保存更改" : state.steps[0].detail}
                />
                <button
                  className="wizard-primary"
                  disabled={saving}
                  onClick={() => void saveHotelInformation()}
                >
                  {saving ? "正在保存…" : "保存并继续"}
                </button>
              </footer>
            </section>
          )}

          {step === 2 && (
            <OrganizationSetupStep
              tenantId={identity.tenantId}
              propertyId={identity.id}
              tree={tree}
              repository={registry.department}
              complete={state.steps[1].complete}
              onTreeChange={setTree}
              onDraftChange={setChildDraftDirty}
              onConfirm={refreshOrganizationAndContinue}
              runOperation={runAction}
              saving={saving}
              notify={() => undefined}
            />
          )}

          {step === 3 && (
            <AccessSetupStep
              summary={accessSummary}
              loading={accessLoading}
              complete={state.steps[2].complete}
              onReload={refreshAccess}
              onConfirm={() => confirmSection("access", 4)}
            />
          )}

          {step === 4 && (
            <section className="wizard-card employee-readiness-card">
              <Intro
                title="确认员工资料准备情况"
                detail="员工资料准备不会阻塞酒店启用。此处只呈现真实已连接的准备事实，不会在启用流程中提交员工导入。"
              />
              <div className="employee-readiness-grid">
                <ReadinessFact
                  label="员工文件检查"
                  value={inspectedEmployeeMaster ? "已检查" : "尚未检查"}
                  detail="只检查文件与来源标签，不在 Recovery B 提交员工导入。"
                  complete={inspectedEmployeeMaster}
                />
                <ReadinessFact
                  label="有效正式职位"
                  value={`${positions.filter(position => position.isActive).length} 个`}
                  detail="职位与职位族可在独立管理页面继续维护。"
                  complete={positions.some(position => position.isActive)}
                />
                <ReadinessFact
                  label="待确认部门归属"
                  value={`${aliases.filter(alias => alias.resolutionType === "deferred").length} 项`}
                  detail="在员工资料更新流程中处理，不作为酒店启用门槛。"
                  complete={!aliases.some(alias => alias.resolutionType === "deferred")}
                />
                <ReadinessFact
                  label="待确认职位归属"
                  value={`${positionLabels.filter(label => label.resolutionStatus === "deferred").length} 项`}
                  detail="在员工资料更新流程中处理，不作为酒店启用门槛。"
                  complete={!positionLabels.some(label => label.resolutionStatus === "deferred")}
                />
              </div>
              <div className="wizard-operational-note">
                <strong>可在启用后继续</strong>
                <p>启用酒店不会自动创建员工账号，也不会提交员工资料。普通员工仍然只是业务记录。</p>
                <Link href="/import">前往员工资料更新</Link>
                <Link href="/positions">维护职位</Link>
              </div>
              <footer>
                <Validation
                  complete={state.employeeReady}
                  label={state.employeeReady ? "员工资料基础已准备" : "可稍后继续，不阻塞酒店启用"}
                />
                <button
                  className="wizard-primary"
                  disabled={saving}
                  onClick={() => void confirmSection(
                    "upload",
                    5,
                    state.employeeReady ? null : "员工资料准备将在启用后继续",
                  )}
                >
                  继续启用复核
                </button>
              </footer>
            </section>
          )}

          {step === 5 && (
            <section className="wizard-card readiness-card activation-review-card">
              <Intro
                title={state.activationCompleted ? "酒店启用资料复核" : "确认酒店可以开始使用"}
                detail={state.activationCompleted
                  ? "酒店已经启用；后续资料维护不会让系统重新回到永久启用状态。"
                  : "酒店启用只要求酒店信息与规则、至少一个有效正式部门，以及至少一个活动酒店学习与发展经理账号。"}
              />
              <div className={`activation-conclusion ${state.requiresMaintenance ? "warning" : state.activationCompleted ? "complete" : ""}`}>
                <span>{state.activationCompleted ? "当前结论" : "启用判断"}</span>
                <strong>{state.activationConclusion}</strong>
                <small>
                  {state.activationCompleted
                    ? "已启用状态保持可复核；发现基础资料缺口时转为具体维护提醒。"
                    : "员工资料、职位和归属准备是后续运营就绪事项，不阻塞本次启用。"}
                </small>
              </div>
              <div className={`c2-baseline-gate ${c2Readiness.ready ? "complete" : "pending"}`}>
                <span>员工基线准入状态</span>
                <strong>{c2Readiness.label}</strong>
                <small>{c2Readiness.nextAction}</small>
                <div>
                  {c2Readiness.checks.map(check => <p className={check.state} key={check.label}><i>{check.state === "ready" ? "✓" : "!"}</i><b>{check.label}</b><em>{check.detail}</em></p>)}
                </div>
              </div>
              <div className="readiness-list">
                {requiredChecks.map(item => (
                  <div className={item.complete ? "complete" : "pending"} key={item.number}>
                    <i>{item.complete ? "✓" : "!"}</i>
                    <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                    <button onClick={()=>void changeStep(item.number)}>查看</button>
                  </div>
                ))}
                <div className={state.employeeReady ? "complete" : "optional"}>
                  <i>{state.employeeReady ? "✓" : "·"}</i>
                  <span>
                    <strong>员工资料准备</strong>
                    <small>{state.steps[3].detail}</small>
                  </span>
                  <button onClick={() => void changeStep(4)}>查看</button>
                </div>
              </div>
              <footer>
                <Validation
                  complete={state.activationCompleted || state.minimumReady}
                  label={state.activationCompleted
                    ? "酒店已启用，可返回运营首页"
                    : state.minimumReady
                      ? "必需条件已满足"
                      : "仍有必需条件待完成"}
                />
                {state.activationCompleted
                  ? <Link className="wizard-primary wizard-link-button" href="/">返回运营工作台</Link>
                  : (
                    <button
                      className="wizard-primary"
                      disabled={!state.minimumReady || saving}
                      onClick={() => void completeActivation()}
                    >
                      {saving ? "正在启用…" : "启用酒店"}
                    </button>
                  )}
              </footer>
            </section>
          )}
        </main>

        <aside className="wizard-summary activation-summary">
          <span>当前状态</span>
          <strong>{state.activationCompleted ? "已启用" : state.minimumReady ? "可启用" : "待准备"}</strong>
          <p>{state.activationConclusion}</p>
          <dl>
            <div><dt>酒店信息与规则</dt><dd className={state.steps[0].complete ? "good" : "risk"}>{state.steps[0].complete ? "已完成" : "待完成"}</dd></div>
            <div><dt>有效正式部门</dt><dd className={state.steps[1].complete ? "good" : "risk"}>{tree.filter(node => node.isActive).length}</dd></div>
            <div><dt>活动酒店经理</dt><dd className={state.steps[2].complete ? "good" : "risk"}>{accessSummary?.activePropertyManagers ?? "—"}</dd></div>
            <div><dt>员工资料准备</dt><dd>{state.employeeReady ? "已准备" : "可稍后"}</dd></div>
          </dl>
          <div className="wizard-note">
            <strong>有限启用</strong>
            <p>启用完成后，此处保留为复核工具；日常维护回到酒店设置、组织、职位、账号和员工资料页面。</p>
          </div>
          <div className="wizard-note secondary">
            <strong>下一建议</strong>
            <p>{state.nextRecommendedAction}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Intro({ title, detail }: { title: string; detail: string }) {
  return <header className="wizard-intro"><h3>{title}</h3><p>{detail}</p></header>;
}

function Validation({ complete, label }: { complete: boolean; label: string }) {
  return (
    <span className={`wizard-validation ${complete ? "good" : ""}`}>
      {complete ? "✓" : "!"} {label}
    </span>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="wizard-choice">
      <span><strong>{label}</strong></span>
      <select value={value} onChange={event => onChange(event.target.value)}>
        {options.map(([optionValue, name]) => (
          <option value={optionValue} key={optionValue}>{name}</option>
        ))}
      </select>
    </label>
  );
}

function ReadinessFact({
  label,
  value,
  detail,
  complete,
}: {
  label: string;
  value: string;
  detail: string;
  complete: boolean;
}) {
  return (
    <article className={complete ? "complete" : ""}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function identityFingerprint(record: HotelPropertyRecord) {
  const identity = record.identity;
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

function rulesFingerprint(record: HotelPropertyRecord) {
  const settings = record.settings;
  return JSON.stringify({
    newEmployeeDays: settings.newEmployeeDays,
    probationFieldMeaning: settings.probationFieldMeaning,
    employeeStatusSource: settings.employeeStatusSource,
    ctcMandatory: settings.ctcMandatory,
    gtcMandatory: settings.gtcMandatory,
  });
}

function hotelSettingsFingerprint(record: HotelPropertyRecord) {
  return `${identityFingerprint(record)}:${rulesFingerprint(record)}`;
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

export default function InitializationPage() {
  return (
    <ProtectedAppProviders>
      <Wizard />
    </ProtectedAppProviders>
  );
}
