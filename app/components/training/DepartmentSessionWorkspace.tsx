"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdministrationSaveState, type AdministrationSavePhase, useUnsavedChangesWarning } from "../administration/AdministrationSaveState";
import { DataStateBadge } from "../operations/DataStateBadge";
import { AppShell } from "../shell/AppShell";
import type {
  DepartmentTrainingSessionRevisionDraft,
  DepartmentTrainingOperationsFoundation,
  SessionParticipantPreview,
  TrainingSessionSummary,
} from "../../repositories/contracts/training-operations-repository.ts";
import { createRepositoryRegistry } from "../../repositories/registry.ts";
import {
  readinessForDepartmentSessionDraft,
  validateDepartmentTrainingSessionRevisionDraft,
} from "../../services/training-operations-service.ts";

type Form = {
  sessionId: string;
  sessionRevisionId: string;
  expectedVersion: number;
  code: string;
  nameZh: string;
  purposeType: "requirement_delivery" | "development_delivery";
  planItemId: string;
  requirementId: string;
  methodId: string;
  courseVersionId: string;
  departmentId: string;
  ownerId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  venueId: string;
  trainerId: string;
  trainerApprovalId: string;
  selectedEmployeeIds: string[];
  materialsReady: boolean;
  roomReady: boolean;
};

export function DepartmentSessionWorkspace() {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const [foundation, setFoundation] =
    useState<DepartmentTrainingOperationsFoundation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<Form>(() => emptyForm());
  const [phase, setPhase] = useState<AdministrationSavePhase>("pristine");
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<SessionParticipantPreview | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  useUnsavedChangesWarning(editorOpen && phase === "dirty");

  const reload = useCallback(async () => {
    if (!registry.trainingOperations) {
      throw new Error("当前环境未连接真实部门场次数据源。");
    }
    const value = await registry.trainingOperations
      .readDepartmentTrainingOperations();
    setFoundation(value);
    return value;
  }, [registry]);

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

  const referenceReady = Boolean(
    foundation?.referenceOptions.courseVersions.length
      && foundation.referenceOptions.departments.length
      && foundation.referenceOptions.owners.length
      && foundation.referenceOptions.venues.length
      && foundation.referenceOptions.trainers.length,
  );

  const update = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm(current => ({ ...current, [key]: value }));
    setPhase("dirty");
    setMessage(null);
  };

  const openEditor = (source?: TrainingSessionSummary) => {
    if (!foundation) return;
    if (source) {
      const lead = source.details.trainerAssignments.find(
        assignment => assignment.role === "lead",
      );
      setForm({
        ...emptyForm(),
        sessionId: source.id,
        sessionRevisionId: source.lifecycleState === "draft"
          ? source.revisionId
          : "",
        expectedVersion: source.lifecycleState === "draft"
          ? source.revisionVersion
          : source.version,
        code: source.code,
        nameZh: source.nameZh,
        purposeType: source.purposeType,
        planItemId: source.details.planItemId ?? "",
        requirementId: source.details.requirementVersionId ?? "",
        methodId: source.details.acceptedLearningMethodId ?? "",
        courseVersionId: source.details.courseVersionId,
        departmentId: source.owningDepartmentId,
        ownerId: source.details.operationalOwnerRoleAssignmentId,
        startsAt: isoToLocalDateTime(source.startsAt),
        endsAt: isoToLocalDateTime(source.endsAt),
        capacity: source.capacity,
        venueId: source.details.venue.type === "approved_venue"
          ? source.details.venue.venueId
          : foundation.referenceOptions.venues[0]?.id ?? "",
        trainerId: lead?.trainerProfileId ?? "",
        trainerApprovalId: lead?.trainerApprovalId ?? "",
        selectedEmployeeIds: source.details.selectedEmployeeIds,
        materialsReady: Boolean(
          source.details.ownerConfirmations.find(
            value => value.key === "materials_ready",
          )?.confirmed,
        ),
        roomReady: Boolean(
          source.details.ownerConfirmations.find(
            value => value.key === "room_setup_ready",
          )?.confirmed,
        ),
      });
      setPhase("pristine");
      setMessage(
        source.lifecycleState === "published"
          ? "正在建立新修订；已发布版本仍保持不可修改。"
          : null,
      );
      setPreview(null);
      setEditorOpen(true);
      return;
    }
    const requirement = foundation.referenceOptions.requirements[0];
    const method = requirement?.acceptedMethods.find(
      value => value.methodType === "course_version",
    );
    const courseVersionId =
      method?.courseVersionId
      ?? foundation.referenceOptions.courseVersions[0]?.id
      ?? "";
    const trainer = foundation.referenceOptions.trainers[0];
    const approval = foundation.referenceOptions.trainerApprovals.find(
      value => value.trainerProfileId === trainer?.id
        && value.courseVersionId === courseVersionId,
    );
    setForm({
      ...emptyForm(),
      purposeType: requirement && method
        ? "requirement_delivery"
        : "development_delivery",
      requirementId: requirement?.id ?? "",
      methodId: method?.id ?? "",
      courseVersionId,
      departmentId:
        foundation.scope[0]?.departmentId
        ?? foundation.referenceOptions.departments[0]?.id
        ?? "",
      ownerId: foundation.referenceOptions.owners[0]?.roleAssignmentId ?? "",
      venueId: foundation.referenceOptions.venues[0]?.id ?? "",
      trainerId: trainer?.id ?? "",
      trainerApprovalId: approval?.id ?? "",
    });
    setPhase("pristine");
    setMessage(null);
    setPreview(null);
    setEditorOpen(true);
  };

  const draft = (): DepartmentTrainingSessionRevisionDraft => ({
    sessionId: form.sessionId || undefined,
    sessionRevisionId: form.sessionRevisionId || undefined,
    expectedVersion: form.expectedVersion,
    code: form.code.trim().toUpperCase(),
    nameZh: form.nameZh.trim(),
    purposeType: form.purposeType,
    planItemId: form.planItemId || undefined,
    ...(form.purposeType === "requirement_delivery"
      ? {
          requirementVersionId: form.requirementId,
          acceptedLearningMethodId: form.methodId,
        }
      : {}),
    courseVersionId: form.courseVersionId,
    owningDepartmentId: form.departmentId,
    operationalOwnerRoleAssignmentId: form.ownerId,
    startsAt: localDateTimeToIso(form.startsAt),
    endsAt: localDateTimeToIso(form.endsAt),
    timezone: "Asia/Shanghai",
    capacity: form.capacity,
    venue: { type: "approved_venue", venueId: form.venueId },
    trainerAssignments: form.trainerId && form.trainerApprovalId
      ? [{
          trainerProfileId: form.trainerId,
          trainerApprovalId: form.trainerApprovalId,
          role: "lead",
        }]
      : [],
    targetDepartments: [{
      departmentId: form.departmentId,
      includeDescendants: true,
    }],
    selectedEmployeeIds: form.selectedEmployeeIds,
    ownerConfirmations: [
      { key: "materials_ready", confirmed: form.materialsReady },
      { key: "room_setup_ready", confirmed: form.roomReady },
    ],
    attendancePreparation: {
      mode: "manual_only",
      opensBeforeMinutes: 0,
      closesAfterMinutes: 30,
    },
  });

  const save = async () => {
    if (!registry.trainingOperations) return;
    const value = draft();
    const errors = validateDepartmentTrainingSessionRevisionDraft(value);
    const readiness = readinessForDepartmentSessionDraft(value);
    if (errors.length) {
      setPhase("failed");
      setMessage(errors.join(" "));
      return;
    }
    setPhase("saving");
    try {
      const saved = await registry.trainingOperations
        .saveDepartmentSessionRevisionDraft(value);
      const nextPreview = await registry.trainingOperations
        .previewDepartmentSessionParticipants(saved.id);
      setPreview(nextPreview);
      setPreviewVersion(saved.version);
      setPhase("saved");
      setMessage(
        readiness.state === "ready_to_publish"
          ? "部门场次草稿已保存并重新读取；可审核参与人后发布。"
          : readiness.blockers.join(" "),
      );
      await reload();
    } catch (reason) {
      setPhase(
        reason instanceof Error && reason.name === "ConflictError"
          ? "conflict"
          : "failed",
      );
      setMessage(messageOf(reason));
    }
  };

  const previewExisting = async (revisionId: string, version: number) => {
    if (!registry.trainingOperations) return;
    try {
      const value = await registry.trainingOperations
        .previewDepartmentSessionParticipants(revisionId);
      setPreview(value);
      setPreviewVersion(version);
    } catch (reason) {
      setError(messageOf(reason));
    }
  };

  const publish = async () => {
    if (!registry.trainingOperations || !preview?.sessionRevisionId) return;
    setPhase("saving");
    try {
      await registry.trainingOperations.publishSessionRevision(
        preview.sessionRevisionId,
        previewVersion,
      );
      setPreview(null);
      setEditorOpen(false);
      setPhase("saved");
      await reload();
    } catch (reason) {
      setPhase("failed");
      setMessage(messageOf(reason));
    }
  };

  const cancel = async (sessionId: string, version: number) => {
    if (!registry.trainingOperations) return;
    const reason = window.prompt("请说明取消本部门场次的运营原因：")?.trim();
    if (!reason) return;
    try {
      await registry.trainingOperations.cancelSession(
        sessionId,
        version,
        reason,
      );
      await reload();
    } catch (reasonValue) {
      setError(messageOf(reasonValue));
    }
  };

  if (loading) {
    return <AppShell><div className="page-wrap d2-loading">正在确认授权部门范围与真实场次…</div></AppShell>;
  }
  if (!foundation) {
    return (
      <AppShell><div className="page-wrap d2-workspace"><section className="d2-load-failure" role="alert"><DataStateBadge state="failed" /><h1>部门场次基础暂时无法读取</h1><p>{error ?? "读取失败不会被解释为本部门没有场次。"}</p><button type="button" onClick={() => void reload()}>重新读取</button><Link href="/department">返回部门工作台</Link></section></div></AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-wrap d2-workspace department-d2">
        <nav className="page-breadcrumb" aria-label="页面路径"><Link href="/department">部门工作台</Link><span>/</span><strong>培训场次</strong></nav>
        <header className="d2-hero department">
          <div><span>AUTHORIZED DEPARTMENT DELIVERY</span><h1>本部门培训场次</h1><p>只管理明确授权部门分支内的时间、资源、参与人和发布准备。</p></div>
          <aside><DataStateBadge state="real" /><strong>{foundation.sessions.length}</strong><span>个授权范围场次</span></aside>
        </header>
        <section className="department-scope-strip">
          <header><span>授权部门范围</span><strong>服务器已确认</strong></header>
          <div>{foundation.scope.map(scope => <article key={scope.departmentId}><span>{scope.breadcrumb?.join(" › ") || "授权范围"}</span><strong>{scope.departmentName}</strong><small>{scope.includeDescendants ? "包含下级部门" : "仅当前部门"}</small></article>)}</div>
        </section>
        <section className="d2-judgment">
          <div><span>当前部门运营边界</span><h2>{foundation.sessions.length ? "部门场次准备事实已接入" : "当前授权范围尚无场次事实"}</h2><p>这里显示计划交付与发布准备；尚未接入出勤记录、完成证据或反馈。</p></div>
          <div className="d2-boundary"><strong>当前场次准备边界</strong><span>场地、培训师授权、部门受众、员工事实快照和负责人确认。</span></div>
        </section>
        <section className="d2-register">
          <header><div><span>SCOPED SESSION WORK</span><h2>授权范围场次</h2><p>直接 URL 与可见操作使用同一服务器范围判断。</p></div><button className="primary-action" type="button" disabled={!referenceReady} onClick={() => openEditor()}>建立部门场次</button></header>
          {!referenceReady && <div className="d2-prerequisite"><strong>酒店级培训资源尚不完整</strong><span>请联系酒店学习与发展经理建立课程版本、培训师授权或场地。</span></div>}
          {error && <p className="d2-inline-error" role="alert">{error}</p>}
          {foundation.sessions.length === 0 ? (
            <div className="d2-empty">
              <strong>当前无授权范围场次</strong>
              <span>这不是零完成率；仅表示尚未建立真实场次。</span>
            </div>
          ) : (
            <div className="d2-session-list">
              {foundation.sessions.map(value => (
                <article key={value.revisionId}>
                  <div className="d2-session-date">
                    <strong>{new Date(value.startsAt).getDate()}</strong>
                    <span>日</span>
                  </div>
                  <div>
                    <span>{value.code} · {value.owningDepartmentName}</span>
                    <h3>{value.nameZh}</h3>
                    <p>{new Date(value.startsAt).toLocaleString("zh-CN")} · {value.venueName}</p>
                  </div>
                  <dl>
                    <div><dt>容量</dt><dd>{value.capacity}</dd></div>
                    <div><dt>已选</dt><dd>{value.selectedCount}</dd></div>
                  </dl>
                  <footer>
                    <em className={`d2-state ${value.lifecycleState === "draft" ? "draft" : value.currentState}`}>
                      {value.lifecycleState === "draft" ? "草稿" : value.currentState === "published" ? "已发布" : "已取消"}
                    </em>
                    {value.lifecycleState === "draft" && <>
                      <button type="button" onClick={() => openEditor(value)}>编辑草稿</button>
                      <button type="button" onClick={() => void previewExisting(value.revisionId, value.revisionVersion)}>预览并发布</button>
                    </>}
                    {value.lifecycleState === "published" && value.currentState === "published" && <>
                      {!foundation.sessions.some(candidate => candidate.id === value.id && candidate.lifecycleState === "draft") && <button type="button" onClick={() => openEditor(value)}>建立新修订</button>}
                      <button type="button" onClick={() => void cancel(value.id, value.version)}>取消场次</button>
                    </>}
                  </footer>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
      {editorOpen && (
        <div className="d2-editor-layer">
          <form className="d2-editor wide" onSubmit={event => { event.preventDefault(); void save(); }}>
            <header><div><span>DEPARTMENT SESSION DRAFT</span><h2>{form.sessionRevisionId ? "编辑授权范围场次草稿" : form.sessionId ? "建立部门场次新修订" : "建立授权范围场次"}</h2></div><button type="button" onClick={() => setEditorOpen(false)}>关闭</button></header>
            <AdministrationSaveState phase={phase} message={message} onRetry={() => void save()} onReload={() => void reload()} />
            <div className="d2-form-grid">
              <Field label="场次代码"><input required readOnly={Boolean(form.sessionId && !form.sessionRevisionId)} value={form.code} onChange={e => update("code", e.target.value)} /></Field>
              <Field label="场次名称"><input required value={form.nameZh} onChange={e => update("nameZh", e.target.value)} /></Field>
              <Field label="交付目的"><select value={form.purposeType} onChange={e => update("purposeType", e.target.value as Form["purposeType"])}><option value="requirement_delivery">培训要求交付</option><option value="development_delivery">发展性培训</option></select></Field>
              {form.purposeType === "requirement_delivery" ? <>
                <Field label="培训要求版本"><select value={form.requirementId} onChange={e => {
                  const requirement = foundation.referenceOptions.requirements.find(value => value.id === e.target.value);
                  const method = requirement?.acceptedMethods.find(value => value.methodType === "course_version");
                  update("requirementId", e.target.value); update("methodId", method?.id ?? ""); update("courseVersionId", method?.courseVersionId ?? "");
                }}>{foundation.referenceOptions.requirements.map(value => <option value={value.id} key={value.id}>{value.nameZh} · V{value.versionNumber}</option>)}</select></Field>
                <Field label="认可课程方式"><select value={form.methodId} onChange={e => {
                  const method = foundation.referenceOptions.requirements.find(value => value.id === form.requirementId)?.acceptedMethods.find(value => value.id === e.target.value);
                  update("methodId", e.target.value); update("courseVersionId", method?.courseVersionId ?? "");
                }}>{foundation.referenceOptions.requirements.find(value => value.id === form.requirementId)?.acceptedMethods.filter(value => value.methodType === "course_version").map(value => <option value={value.id} key={value.id}>{value.labelZh}</option>)}</select></Field>
              </> : <Field label="课程版本"><select value={form.courseVersionId} onChange={e => update("courseVersionId", e.target.value)}>{foundation.referenceOptions.courseVersions.map(value => <option value={value.id} key={value.id}>{value.nameZh} · V{value.versionNumber}</option>)}</select></Field>}
              <Field label="责任与受众部门"><select value={form.departmentId} onChange={e => update("departmentId", e.target.value)}>{foundation.referenceOptions.departments.map(value => <option value={value.id} key={value.id}>{value.nameZh}</option>)}</select></Field>
              <Field label="运营负责人"><select value={form.ownerId} onChange={e => update("ownerId", e.target.value)}>{foundation.referenceOptions.owners.map(value => <option value={value.roleAssignmentId} key={value.roleAssignmentId}>{value.displayName}</option>)}</select></Field>
              <Field label="开始时间"><input required type="datetime-local" value={form.startsAt} onChange={e => update("startsAt", e.target.value)} /></Field>
              <Field label="结束时间"><input required type="datetime-local" value={form.endsAt} onChange={e => update("endsAt", e.target.value)} /></Field>
              <Field label="场次容量"><input min="1" type="number" value={form.capacity} onChange={e => update("capacity", Number(e.target.value))} /></Field>
              <Field label="酒店培训场地"><select value={form.venueId} onChange={e => update("venueId", e.target.value)}>{foundation.referenceOptions.venues.map(value => <option value={value.id} key={value.id}>{value.nameZh} · {value.capacity} 人</option>)}</select></Field>
              <Field label="已授权主培训师"><select value={form.trainerId} onChange={e => {
                const trainerId = e.target.value;
                const approval = foundation.referenceOptions.trainerApprovals.find(value => value.trainerProfileId === trainerId && value.courseVersionId === form.courseVersionId);
                update("trainerId", trainerId); update("trainerApprovalId", approval?.id ?? "");
              }}>{foundation.referenceOptions.trainers.map(value => <option value={value.id} key={value.id}>{value.displayName}</option>)}</select></Field>
            </div>
            <fieldset><legend>授权员工参与人</legend><p className="field-guidance">系统只返回服务器授权部门范围内的必要身份字段；选择上级部门时包含其授权下级部门。</p><div className="d2-employee-picker">{foundation.participantCandidates.filter(value => isDepartmentInTarget(value.departmentId, form.departmentId, foundation.referenceOptions.departments)).map(value => <label key={value.employeeId}><input type="checkbox" checked={form.selectedEmployeeIds.includes(value.employeeId)} onChange={() => update("selectedEmployeeIds", toggle(form.selectedEmployeeIds, value.employeeId))} /><span><strong>{value.employeeName}</strong><small>{value.employeeNumber} · {value.departmentName}</small></span></label>)}</div></fieldset>
            <fieldset><legend>当前场次准备边界</legend><label className="d2-check"><input type="checkbox" checked={form.materialsReady} onChange={e => update("materialsReady", e.target.checked)} />教材已准备</label><label className="d2-check"><input type="checkbox" checked={form.roomReady} onChange={e => update("roomReady", e.target.checked)} />场地布置已准备</label><p className="field-guidance">本阶段尚未接入出勤记录；配置仅保留未来出勤准备窗口。</p></fieldset>
            <footer><button type="button" onClick={() => setEditorOpen(false)}>取消</button><button className="primary-action" type="submit">保存并零写入预览</button></footer>
          </form>
        </div>
      )}
      {preview && <div className="d2-editor-layer"><section className="d2-editor wide d2-preview"><header><div><span>AUTHORIZED ZERO-WRITE REVIEW</span><h2>部门参与人适用性预览</h2></div><button type="button" onClick={() => setPreview(null)}>关闭</button></header><div className="d2-preview-summary"><div><strong>{preview.selectedCount}</strong><span>明确选择</span></div><div><strong>{preview.eligibleCount ?? "—"}</strong><span>适用</span></div><div><strong>{preview.unableToDetermineCount}</strong><span>无法判断</span></div></div><div className="d2-preview-list">{preview.rows.map(row => <article key={row.employeeId}><div><strong>{"employeeName" in row ? row.employeeName : row.employeeId}</strong><small>{"employeeNumber" in row ? row.employeeNumber : ""}</small></div><span>{"eligibilityState" in row ? (row.eligibilityState === "eligible" ? "适用" : row.eligibilityState === "not_applicable" ? "不适用" : "无法判断") : "发展性选择"}</span><em>{row.selected ? "已选择" : "未选择"}</em></article>)}</div>{message && <p className="d2-inline-note">{message}</p>}<footer><span>发布后冻结员工事实版本；仍不会创建出勤或完成事实。</span><button className="primary-action" type="button" onClick={() => void publish()} disabled={phase === "saving" || preview.selectedCount === 0}>发布部门场次</button></footer></section></div>}
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span>{label}</span>{children}</label>; }
function toggle(values: string[], id: string) { return values.includes(id) ? values.filter(value => value !== id) : [...values, id]; }
function messageOf(value: unknown) { return value instanceof Error ? value.message : "操作未完成，请重试。"; }
function localDateTimeToIso(value: string) { return value ? `${value}:00+08:00` : ""; }
function isoToLocalDateTime(value: string) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
function isDepartmentInTarget(
  departmentId: string,
  targetId: string,
  departments: DepartmentTrainingOperationsFoundation["referenceOptions"]["departments"],
) {
  if (departmentId === targetId) return true;
  const byId = new Map(departments.map(value => [value.id, value]));
  let current = byId.get(departmentId);
  while (current?.parentId) {
    if (current.parentId === targetId) return true;
    current = byId.get(current.parentId);
  }
  return false;
}
function emptyForm(): Form {
  const start = new Date(Date.now() + 7 * 86400000); start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 3600000);
  const local = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  return { sessionId: "", sessionRevisionId: "", expectedVersion: 0, code: "", nameZh: "", purposeType: "development_delivery", planItemId: "", requirementId: "", methodId: "", courseVersionId: "", departmentId: "", ownerId: "", startsAt: local(start), endsAt: local(end), capacity: 20, venueId: "", trainerId: "", trainerApprovalId: "", selectedEmployeeIds: [], materialsReady: false, roomReady: false };
}
