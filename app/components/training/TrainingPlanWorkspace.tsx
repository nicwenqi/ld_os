"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdministrationSaveState, type AdministrationSavePhase, useUnsavedChangesWarning } from "../administration/AdministrationSaveState";
import { DataStateBadge } from "../operations/DataStateBadge";
import { AppShell } from "../shell/AppShell";
import type {
  TrainingOperationsFoundation,
  TrainingPlanSummary,
  TrainingPlanVersionDraft,
} from "../../repositories/contracts/training-operations-repository.ts";
import { createRepositoryRegistry } from "../../repositories/registry.ts";
import { validateTrainingPlanVersionDraft } from "../../services/training-operations-service.ts";
import { useAuthSession } from "../../state/auth-session";

type PlanForm = {
  planId: string;
  planVersionId: string;
  expectedVersion: number;
  code: string;
  nameZh: string;
  periodStart: string;
  periodEnd: string;
  purpose: string;
  ownerId: string;
  changeReason: string;
  itemName: string;
  itemPurpose: "requirement_delivery" | "development_delivery";
  requirementVersionId: string;
  methodId: string;
  courseVersionId: string;
  departmentId: string;
  includeDescendants: boolean;
  plannedSessionCount: number;
  plannedSeatCapacity: number;
};

export function TrainingPlanWorkspace() {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const { session } = useAuthSession();
  const [foundation, setFoundation] =
    useState<TrainingOperationsFoundation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<PlanForm>(() => emptyPlanForm());
  const [phase, setPhase] = useState<AdministrationSavePhase>("pristine");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  useUnsavedChangesWarning(formOpen && phase === "dirty");

  const reload = useCallback(async () => {
    if (!registry.trainingOperations) {
      throw new Error("当前环境未连接真实培训计划数据源。");
    }
    if (!session.propertyId) {
      throw new Error("当前账号尚未取得酒店上下文。");
    }
    const value = await registry.trainingOperations
      .readManagerTrainingOperations(session.propertyId);
    setFoundation(value);
    return value;
  }, [registry, session.propertyId]);

  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => reload())
      .catch(reason => {
        if (active) setError(messageOf(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);

  const latestPlans = useMemo(() => {
    const values = foundation?.plans ?? [];
    const latest = new Map<string, (typeof values)[number]>();
    for (const value of values) {
      const current = latest.get(value.planId);
      if (!current || value.versionNumber > current.versionNumber) {
        latest.set(value.planId, value);
      }
    }
    return [...latest.values()];
  }, [foundation]);
  const referenceReady = Boolean(
    foundation?.referenceOptions.courseVersions.length
      && foundation.referenceOptions.departments.length
      && foundation.referenceOptions.owners.length,
  );

  const openForm = (source?: TrainingPlanSummary) => {
    const option = foundation?.referenceOptions;
    const sourceItem = source?.items[0];
    const requirement = option?.requirementVersions.find(
      value => value.id === sourceItem?.requirementVersionId,
    ) ?? option?.requirementVersions[0];
    const method = requirement?.acceptedMethods.find(
      value => value.id === sourceItem?.acceptedLearningMethodId,
    ) ?? requirement?.acceptedMethods.find(
      value => value.methodType === "course_version",
    );
    const editingDraft = source?.lifecycleState === "draft";
    setForm({
      ...emptyPlanForm(),
      planId: source?.planId ?? "",
      planVersionId: editingDraft ? source.id : "",
      expectedVersion: editingDraft
        ? source.version
        : source?.identityVersion ?? 0,
      code: source?.code ?? "",
      nameZh: source?.nameZh ?? "",
      periodStart: source?.periodStart ?? emptyPlanForm().periodStart,
      periodEnd: source?.periodEnd ?? emptyPlanForm().periodEnd,
      purpose: source?.purpose ?? "",
      changeReason: source
        ? editingDraft
          ? "维护计划草稿"
          : `建立 ${source.nameZh} 的新计划版本`
        : "",
      ownerId:
        source?.operationalOwnerRoleAssignmentId
        ?? option?.owners[0]?.roleAssignmentId
        ?? "",
      itemName: sourceItem?.nameZh ?? "",
      departmentId:
        sourceItem?.ownerDepartmentId
        ?? option?.departments[0]?.id
        ?? "",
      includeDescendants:
        sourceItem?.targetDepartments[0]?.includeDescendants ?? true,
      requirementVersionId: requirement?.id ?? "",
      methodId: method?.id ?? "",
      courseVersionId:
        sourceItem?.courseVersionId
        ?? method?.courseVersionId
        ?? option?.courseVersions[0]?.id
        ?? "",
      itemPurpose:
        sourceItem?.purposeType
        ?? (requirement && method
          ? "requirement_delivery"
          : "development_delivery"),
      plannedSessionCount: sourceItem?.plannedSessionCount ?? 1,
      plannedSeatCapacity: sourceItem?.plannedSeatCapacity ?? 20,
    });
    setPhase("pristine");
    setSaveMessage(null);
    setFormOpen(true);
  };

  const updateForm = <K extends keyof PlanForm>(
    key: K,
    value: PlanForm[K],
  ) => {
    setForm(current => ({ ...current, [key]: value }));
    setPhase("dirty");
    setSaveMessage(null);
  };

  const save = async () => {
    if (!registry.trainingOperations || !session.propertyId) return;
    const selectedRequirement =
      foundation?.referenceOptions.requirementVersions.find(
        value => value.id === form.requirementVersionId,
      );
    const selectedMethod = selectedRequirement?.acceptedMethods.find(
      value => value.id === form.methodId,
    );
    const courseVersionId = form.itemPurpose === "requirement_delivery"
      ? selectedMethod?.courseVersionId ?? form.courseVersionId
      : form.courseVersionId;
    const draft: TrainingPlanVersionDraft = {
      propertyId: session.propertyId,
      planId: form.planId || undefined,
      planVersionId: form.planVersionId || undefined,
      expectedVersion: form.expectedVersion,
      code: form.code.trim().toUpperCase(),
      nameZh: form.nameZh.trim(),
      periodStart: form.periodStart,
      periodEnd: form.periodEnd,
      purpose: form.purpose.trim(),
      operationalOwnerRoleAssignmentId: form.ownerId,
      changeReason: form.changeReason.trim(),
      continuityRationale: "此版本延续同一酒店培训计划业务身份。",
      items: [{
        nameZh: form.itemName.trim(),
        purposeType: form.itemPurpose,
        businessPurpose: form.purpose.trim(),
        deliveryWindowStart: form.periodStart,
        deliveryWindowEnd: form.periodEnd,
        plannedSessionCount: form.plannedSessionCount,
        plannedSeatCapacity: form.plannedSeatCapacity,
        ownerDepartmentId: form.departmentId,
        targetDepartments: [{
          departmentId: form.departmentId,
          includeDescendants: form.includeDescendants,
        }],
        courseVersionId,
        ...(form.itemPurpose === "requirement_delivery"
          ? {
              requirementVersionId: form.requirementVersionId,
              acceptedLearningMethodId: form.methodId,
            }
          : {}),
      } as TrainingPlanVersionDraft["items"][number]],
    };
    const errors = validateTrainingPlanVersionDraft(draft);
    if (errors.length) {
      setPhase("failed");
      setSaveMessage(errors.join(" "));
      return;
    }
    setPhase("saving");
    try {
      await registry.trainingOperations.savePlanVersionDraft(draft);
      await reload();
      setPhase("saved");
      setSavedAt(nowTime());
      setSaveMessage("计划草稿已写入并重新读取权威状态。");
      setFormOpen(false);
    } catch (reason) {
      const value = messageOf(reason);
      setPhase(
        reason instanceof Error && reason.name === "ConflictError"
          ? "conflict"
          : "failed",
      );
      setSaveMessage(value);
    }
  };

  const transition = async (
    id: string,
    state: "review" | "approved" | "withdrawn",
    version: number,
  ) => {
    if (!registry.trainingOperations) return;
    const reason = state === "review"
      ? "提交经理复核"
      : state === "approved"
        ? "确认计划业务目的、容量、范围与负责人"
        : window.prompt("请说明撤回已批准计划的业务原因：")?.trim();
    if (!reason) return;
    setError(null);
    try {
      await registry.trainingOperations.transitionPlanVersion(
        id,
        state,
        version,
        reason,
      );
      await reload();
    } catch (reasonValue) {
      setError(messageOf(reasonValue));
    }
  };

  if (loading) {
    return <AppShell><div className="page-wrap d2-loading">正在读取真实培训计划基础…</div></AppShell>;
  }

  if (!foundation || error && !foundation) {
    return (
      <AppShell>
        <div className="page-wrap d2-workspace">
          <section className="d2-load-failure" role="alert">
            <DataStateBadge state="failed" />
            <h1>培训计划基础暂时无法读取</h1>
            <p>{error ?? "缺失数据不会被解释为酒店没有培训计划。"}</p>
            <button type="button" onClick={() => void reload()}>重新读取</button>
            <Link href="/">返回运营工作台</Link>
          </section>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-wrap d2-workspace">
        <nav className="page-breadcrumb" aria-label="页面路径">
          <Link href="/">运营工作台</Link><span>/</span><strong>培训计划</strong>
        </nav>
        <header className="d2-hero">
          <div>
            <span>TRAINING PLAN GOVERNANCE</span>
            <h1>酒店培训计划</h1>
            <p>把已确认培训义务或发展目的转化为可审核的周期、容量、部门范围和负责人。</p>
          </div>
          <aside>
            <DataStateBadge state="real" />
            <strong>{latestPlans.length}</strong>
            <span>个计划业务身份</span>
          </aside>
        </header>
        <section className="d2-judgment">
          <div>
            <span>当前判断</span>
            <h2>{latestPlans.length ? "培训计划基础已可追溯管理" : "尚未建立正式培训计划"}</h2>
            <p>培训计划不是培训场次。已批准计划不会自动创建场次，也不会形成出勤、完成或 KPI 事实。</p>
          </div>
          <div className="d2-boundary">
            <strong>事实边界</strong>
            <span>计划 = 管理意图与容量；场次 = 后续独立发布的运营事实。</span>
          </div>
        </section>
        <section className="d2-register">
          <header>
            <div>
              <span>APPROVED CAPACITY INTENT</span>
              <h2>计划版本</h2>
              <p>草稿可编辑；复核后定义冻结；批准版本不可改写。</p>
            </div>
            <button
              type="button"
              className="primary-action"
              onClick={() => openForm()}
              disabled={!referenceReady}
              title={referenceReady ? "建立培训计划" : "请先建立课程版本、组织和负责人"}
            >
              建立培训计划
            </button>
          </header>
          {!referenceReady && (
            <div className="d2-prerequisite">
              <strong>计划前置基础尚不完整</strong>
              <span>请先确认已发布课程版本、正式部门和有效后台负责人。</span>
              <Link href="/requirements">检查培训要求与课程版本</Link>
            </div>
          )}
          {error && <p className="d2-inline-error" role="alert">{error}</p>}
          {latestPlans.length === 0 ? (
            <div className="d2-empty">
              <strong>当前没有培训计划版本</strong>
              <span>这不是零计划完成率；仅表示尚未建立可追溯计划事实。</span>
            </div>
          ) : (
            <div className="d2-card-grid">
              {latestPlans.map(plan => (
                <article key={plan.id}>
                  <span>{plan.code} · V{plan.versionNumber}</span>
                  <h3>{plan.nameZh}</h3>
                  <p>{plan.purpose}</p>
                  <dl>
                    <div><dt>周期</dt><dd>{plan.periodStart} — {plan.periodEnd}</dd></div>
                    <div><dt>计划项目</dt><dd>{plan.itemCount}</dd></div>
                  </dl>
                  <footer>
                    <PlanState state={plan.lifecycleState} />
                    <div>
                      {plan.lifecycleState === "draft" && (
                        <>
                          {plan.itemCount === 1 && <button type="button" onClick={() => openForm(plan)}>编辑草稿</button>}
                          <button type="button" onClick={() => void transition(plan.id, "review", plan.version)}>提交复核</button>
                        </>
                      )}
                      {plan.lifecycleState === "review" && (
                        <button type="button" onClick={() => void transition(plan.id, "approved", plan.version)}>批准计划</button>
                      )}
                      {plan.lifecycleState === "approved" && (
                        <>
                          <button type="button" onClick={() => openForm(plan)}>建立新版本</button>
                          <button type="button" onClick={() => void transition(plan.id, "withdrawn", plan.version)}>撤回计划</button>
                        </>
                      )}
                      {plan.lifecycleState === "withdrawn" && (
                        <button type="button" onClick={() => openForm(plan)}>建立新版本</button>
                      )}
                    </div>
                  </footer>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
      {formOpen && (
        <div className="d2-editor-layer">
          <form className="d2-editor" onSubmit={event => {
            event.preventDefault();
            void save();
          }}>
            <header>
              <div><span>PLAN VERSION DRAFT</span><h2>{form.planVersionId ? "编辑培训计划草稿" : form.planId ? "建立计划新版本" : "建立培训计划草稿"}</h2></div>
              <button type="button" onClick={() => setFormOpen(false)} aria-label="关闭">关闭</button>
            </header>
            <AdministrationSaveState
              phase={phase}
              savedAt={savedAt}
              message={saveMessage}
              onRetry={() => void save()}
              onReload={() => void reload()}
            />
            <div className="d2-form-grid">
              <Field label="计划代码"><input required value={form.code} readOnly={Boolean(form.planId)} onChange={e => updateForm("code", e.target.value)} placeholder="PLAN-2026-Q3" /></Field>
              <Field label="计划名称"><input required value={form.nameZh} onChange={e => updateForm("nameZh", e.target.value)} /></Field>
              <Field label="开始日期"><input required type="date" value={form.periodStart} onChange={e => updateForm("periodStart", e.target.value)} /></Field>
              <Field label="结束日期"><input required type="date" value={form.periodEnd} onChange={e => updateForm("periodEnd", e.target.value)} /></Field>
              <Field label="运营负责人"><select required value={form.ownerId} onChange={e => updateForm("ownerId", e.target.value)}>{foundation.referenceOptions.owners.map(value => <option value={value.roleAssignmentId} key={value.roleAssignmentId}>{value.displayName} · {value.roleNameZh}</option>)}</select></Field>
              <Field label="变更原因"><input required value={form.changeReason} onChange={e => updateForm("changeReason", e.target.value)} placeholder="建立首个计划版本" /></Field>
            </div>
            <Field label="计划业务目的"><textarea required value={form.purpose} onChange={e => updateForm("purpose", e.target.value)} /></Field>
            <fieldset>
              <legend>首个计划项目</legend>
              <div className="d2-form-grid">
                <Field label="项目名称"><input required value={form.itemName} onChange={e => updateForm("itemName", e.target.value)} /></Field>
                <Field label="交付目的"><select value={form.itemPurpose} onChange={e => updateForm("itemPurpose", e.target.value as PlanForm["itemPurpose"])}><option value="requirement_delivery">培训要求交付</option><option value="development_delivery">发展性培训</option></select></Field>
                {form.itemPurpose === "requirement_delivery" && <>
                  <Field label="培训要求版本"><select value={form.requirementVersionId} onChange={e => {
                    const requirement = foundation.referenceOptions.requirementVersions.find(value => value.id === e.target.value);
                    const method = requirement?.acceptedMethods.find(value => value.methodType === "course_version");
                    updateForm("requirementVersionId", e.target.value);
                    updateForm("methodId", method?.id ?? "");
                    updateForm("courseVersionId", method?.courseVersionId ?? "");
                  }}>{foundation.referenceOptions.requirementVersions.map(value => <option value={value.id} key={value.id}>{value.nameZh} · V{value.versionNumber}</option>)}</select></Field>
                  <Field label="认可课程方式"><select value={form.methodId} onChange={e => {
                    const requirement = foundation.referenceOptions.requirementVersions.find(value => value.id === form.requirementVersionId);
                    const method = requirement?.acceptedMethods.find(value => value.id === e.target.value);
                    updateForm("methodId", e.target.value);
                    updateForm("courseVersionId", method?.courseVersionId ?? "");
                  }}>{foundation.referenceOptions.requirementVersions.find(value => value.id === form.requirementVersionId)?.acceptedMethods.filter(value => value.methodType === "course_version").map(value => <option value={value.id} key={value.id}>{value.labelZh}</option>)}</select></Field>
                </>}
                {form.itemPurpose === "development_delivery" && <Field label="课程版本"><select value={form.courseVersionId} onChange={e => updateForm("courseVersionId", e.target.value)}>{foundation.referenceOptions.courseVersions.map(value => <option value={value.id} key={value.id}>{value.nameZh} · V{value.versionNumber}</option>)}</select></Field>}
                <Field label="责任及目标部门"><select value={form.departmentId} onChange={e => updateForm("departmentId", e.target.value)}>{foundation.referenceOptions.departments.map(value => <option value={value.id} key={value.id}>{value.nameZh}</option>)}</select></Field>
                <Field label="计划场次数"><input min="1" type="number" value={form.plannedSessionCount} onChange={e => updateForm("plannedSessionCount", Number(e.target.value))} /></Field>
                <Field label="计划席位容量"><input min="1" type="number" value={form.plannedSeatCapacity} onChange={e => updateForm("plannedSeatCapacity", Number(e.target.value))} /></Field>
              </div>
              <label className="d2-check"><input type="checkbox" checked={form.includeDescendants} onChange={e => updateForm("includeDescendants", e.target.checked)} />包含所选部门的下级正式部门</label>
            </fieldset>
            <footer>
              <button type="button" onClick={() => setFormOpen(false)}>取消</button>
              <button className="primary-action" type="submit" disabled={phase === "saving"}>保存真实计划草稿</button>
            </footer>
          </form>
        </div>
      )}
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label><span>{label}</span>{children}</label>;
}

function PlanState({ state }: { state: string }) {
  const labels: Record<string, string> = {
    draft: "草稿",
    review: "复核中",
    approved: "已批准",
    superseded: "已取代",
    withdrawn: "已撤回",
  };
  return <em className={`d2-state ${state}`}>{labels[state] ?? state}</em>;
}

function emptyPlanForm(): PlanForm {
  const year = new Date().getFullYear();
  return {
    planId: "",
    planVersionId: "",
    expectedVersion: 0,
    code: "",
    nameZh: "",
    periodStart: `${year}-01-01`,
    periodEnd: `${year}-12-31`,
    purpose: "",
    ownerId: "",
    changeReason: "",
    itemName: "",
    itemPurpose: "development_delivery",
    requirementVersionId: "",
    methodId: "",
    courseVersionId: "",
    departmentId: "",
    includeDescendants: true,
    plannedSessionCount: 1,
    plannedSeatCapacity: 20,
  };
}

function messageOf(value: unknown) {
  return value instanceof Error ? value.message : "操作未完成，请重试。";
}

function nowTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}
