"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdministrationSaveState, type AdministrationSavePhase, useUnsavedChangesWarning } from "../administration/AdministrationSaveState";
import { DataStateBadge } from "../operations/DataStateBadge";
import { AppShell } from "../shell/AppShell";
import type { EmployeeRecord } from "../../repositories/contracts/employee-repository.ts";
import type {
  SessionParticipantPreview,
  TrainingOperationsFoundation,
  TrainingSessionSummary,
  TrainingSessionRevisionDraft,
} from "../../repositories/contracts/training-operations-repository.ts";
import { createRepositoryRegistry } from "../../repositories/registry.ts";
import {
  readinessForSessionDraft,
  validateTrainingSessionRevisionDraft,
} from "../../services/training-operations-service.ts";
import { useAuthSession } from "../../state/auth-session";

type SessionForm = {
  sessionId: string;
  sessionRevisionId: string;
  expectedVersion: number;
  code: string;
  nameZh: string;
  purposeType: "requirement_delivery" | "development_delivery";
  planItemId: string;
  requirementVersionId: string;
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
  includeDescendants: boolean;
  selectedEmployeeIds: string[];
  materialsReady: boolean;
  roomReady: boolean;
  preparationMode: "qr_or_manual" | "manual_only";
};

type TrainerForm = {
  type: "internal_employee" | "external_facilitator";
  employeeId: string;
  displayName: string;
  courseVersionId: string;
  effectiveFrom: string;
  evidenceNote: string;
};

export function SessionWorkspace() {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const { session } = useAuthSession();
  const [foundation, setFoundation] =
    useState<TrainingOperationsFoundation | null>(null);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"sessions" | "resources">("sessions");
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<SessionForm>(() => emptySessionForm());
  const [phase, setPhase] = useState<AdministrationSavePhase>("pristine");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<SessionParticipantPreview | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [previewSessionId, setPreviewSessionId] = useState("");
  const [resourceEditor, setResourceEditor] =
    useState<"venue" | "trainer" | null>(null);
  const [venueForm, setVenueForm] = useState({
    nameZh: "",
    locationDescription: "",
    capacity: 20,
  });
  const [trainerForm, setTrainerForm] = useState<TrainerForm>({
    type: "external_facilitator",
    employeeId: "",
    displayName: "",
    courseVersionId: "",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    evidenceNote: "",
  });
  useUnsavedChangesWarning(editorOpen && phase === "dirty");

  const reload = useCallback(async () => {
    if (!registry.trainingOperations) {
      throw new Error("当前环境未连接真实场次数据源。");
    }
    if (!session.propertyId) throw new Error("当前账号尚未取得酒店上下文。");
    const [next, directory] = await Promise.all([
      registry.trainingOperations
        .readManagerTrainingOperations(session.propertyId),
      registry.employee.listEmployees(session.propertyId, { active: true }),
    ]);
    setFoundation(next);
    setEmployees([...directory]);
    return next;
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

  const referenceReady = Boolean(
    foundation?.referenceOptions.courseVersions.length
      && foundation.referenceOptions.departments.length
      && foundation.referenceOptions.owners.length
      && foundation.venues.some(value => value.active)
      && foundation.trainers.some(value => value.active),
  );

  const openEditor = (source?: TrainingSessionSummary) => {
    if (!foundation) return;
    if (source) {
      const lead = source.details.trainerAssignments.find(
        assignment => assignment.role === "lead",
      );
      const target = source.details.targetDepartments[0];
      setForm({
        ...emptySessionForm(),
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
        requirementVersionId:
          source.details.requirementVersionId ?? "",
        methodId: source.details.acceptedLearningMethodId ?? "",
        courseVersionId: source.details.courseVersionId,
        departmentId: source.owningDepartmentId,
        ownerId: source.details.operationalOwnerRoleAssignmentId,
        startsAt: isoToLocalDateTime(source.startsAt),
        endsAt: isoToLocalDateTime(source.endsAt),
        capacity: source.capacity,
        venueId: source.details.venue.type === "approved_venue"
          ? source.details.venue.venueId
          : foundation.venues.find(value => value.active)?.id ?? "",
        trainerId: lead?.trainerProfileId ?? "",
        trainerApprovalId: lead?.trainerApprovalId ?? "",
        includeDescendants: target?.includeDescendants ?? true,
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
        preparationMode: source.details.attendancePreparation.mode,
      });
      setPreview(null);
      setPhase("pristine");
      setSaveMessage(
        source.lifecycleState === "published"
          ? "正在建立新修订；已发布版本仍保持不可修改。"
          : null,
      );
      setEditorOpen(true);
      return;
    }
    const requirement = foundation.referenceOptions.requirementVersions[0];
    const method = requirement?.acceptedMethods.find(
      item => item.methodType === "course_version",
    );
    const courseVersionId =
      method?.courseVersionId
      ?? foundation.referenceOptions.courseVersions[0]?.id
      ?? "";
    const trainer = foundation.trainers.find(value => value.active);
    const approval = foundation.trainerApprovals.find(value =>
      value.trainerProfileId === trainer?.id
      && value.courseVersionId === courseVersionId
    );
    setForm({
      ...emptySessionForm(),
      purposeType: requirement && method
        ? "requirement_delivery"
        : "development_delivery",
      requirementVersionId: requirement?.id ?? "",
      methodId: method?.id ?? "",
      courseVersionId,
      departmentId: foundation.referenceOptions.departments[0]?.id ?? "",
      ownerId: foundation.referenceOptions.owners[0]?.roleAssignmentId ?? "",
      venueId: foundation.venues.find(value => value.active)?.id ?? "",
      trainerId: trainer?.id ?? "",
      trainerApprovalId: approval?.id ?? "",
    });
    setPreview(null);
    setPhase("pristine");
    setSaveMessage(null);
    setEditorOpen(true);
  };

  const updateForm = <K extends keyof SessionForm>(
    key: K,
    value: SessionForm[K],
  ) => {
    setForm(current => ({ ...current, [key]: value }));
    setPhase("dirty");
    setSaveMessage(null);
  };

  const draftFromForm = (): TrainingSessionRevisionDraft => ({
    propertyId: session.propertyId ?? "",
    sessionId: form.sessionId || undefined,
    sessionRevisionId: form.sessionRevisionId || undefined,
    expectedVersion: form.expectedVersion,
    code: form.code.trim().toUpperCase(),
    nameZh: form.nameZh.trim(),
    purposeType: form.purposeType,
    planItemId: form.planItemId || undefined,
    ...(form.purposeType === "requirement_delivery"
      ? {
          requirementVersionId: form.requirementVersionId,
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
      includeDescendants: form.includeDescendants,
    }],
    selectedEmployeeIds: form.selectedEmployeeIds,
    ownerConfirmations: [
      { key: "materials_ready", confirmed: form.materialsReady },
      { key: "room_setup_ready", confirmed: form.roomReady },
    ],
    attendancePreparation: {
      mode: form.preparationMode,
      opensBeforeMinutes: form.preparationMode === "qr_or_manual" ? 30 : 0,
      closesAfterMinutes: 30,
    },
  });

  const saveDraft = async () => {
    if (!registry.trainingOperations) return;
    const draft = draftFromForm();
    const errors = validateTrainingSessionRevisionDraft(draft);
    const readiness = readinessForSessionDraft(draft);
    if (errors.length) {
      setPhase("failed");
      setSaveMessage(errors.join(" "));
      return;
    }
    setPhase("saving");
    try {
      const saved = await registry.trainingOperations
        .saveSessionRevisionDraft(draft);
      const nextPreview = await registry.trainingOperations
        .previewSessionParticipants({
          propertyId: draft.propertyId,
          sessionRevisionId: saved.id,
        });
      setPreview(nextPreview);
      setPreviewVersion(saved.version);
      setPreviewSessionId(saved.sessionId ?? "");
      setPhase("saved");
      setSaveMessage(
        readiness.state === "ready_to_publish"
          ? "场次草稿已保存并重新读取；参与人预览为零写入，可继续发布。"
          : `草稿已保存；仍需处理：${readiness.blockers.join(" ")}`,
      );
      await reload();
    } catch (reason) {
      setPhase(
        reason instanceof Error && reason.name === "ConflictError"
          ? "conflict"
          : "failed",
      );
      setSaveMessage(messageOf(reason));
    }
  };

  const previewExisting = async (
    revisionId: string,
    revisionVersion: number,
    sessionId: string,
  ) => {
    if (!registry.trainingOperations || !session.propertyId) return;
    setError(null);
    try {
      const value = await registry.trainingOperations
        .previewSessionParticipants({
          propertyId: session.propertyId,
          sessionRevisionId: revisionId,
        });
      setPreview(value);
      setPreviewVersion(revisionVersion);
      setPreviewSessionId(sessionId);
      setEditorOpen(false);
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
      setSaveMessage(messageOf(reason));
      setPhase(
        reason instanceof Error && reason.name === "ConflictError"
          ? "conflict"
          : "failed",
      );
    }
  };

  const cancel = async (id: string, version: number) => {
    if (!registry.trainingOperations) return;
    const reason = window.prompt("请说明取消场次的酒店运营原因：")?.trim();
    if (!reason) return;
    try {
      await registry.trainingOperations.cancelSession(id, version, reason);
      await reload();
    } catch (reasonValue) {
      setError(messageOf(reasonValue));
    }
  };

  const saveVenue = async () => {
    if (!registry.trainingOperations || !session.propertyId) return;
    setPhase("saving");
    try {
      await registry.trainingOperations.saveVenue(
        session.propertyId,
        { ...venueForm, active: true },
        0,
      );
      setResourceEditor(null);
      setVenueForm({ nameZh: "", locationDescription: "", capacity: 20 });
      setPhase("saved");
      await reload();
    } catch (reason) {
      setPhase("failed");
      setSaveMessage(messageOf(reason));
    }
  };

  const saveTrainer = async () => {
    if (!registry.trainingOperations || !session.propertyId) return;
    setPhase("saving");
    try {
      await registry.trainingOperations.saveTrainer(
        session.propertyId,
        {
          type: trainerForm.type,
          employeeId: trainerForm.type === "internal_employee"
            ? trainerForm.employeeId
            : undefined,
          displayName: trainerForm.type === "internal_employee"
            ? employees.find(value => value.id === trainerForm.employeeId)
                ?.nameZh
              ?? employees.find(value => value.id === trainerForm.employeeId)
                ?.nameEn
              ?? trainerForm.displayName
            : trainerForm.displayName,
          active: true,
          approvals: trainerForm.courseVersionId
            ? [{
                courseVersionId: trainerForm.courseVersionId,
                effectiveFrom: trainerForm.effectiveFrom,
                evidenceNote: trainerForm.evidenceNote,
              }]
            : [],
        },
        0,
      );
      setResourceEditor(null);
      setTrainerForm(current => ({
        ...current,
        employeeId: "",
        displayName: "",
        evidenceNote: "",
      }));
      setPhase("saved");
      await reload();
    } catch (reason) {
      setPhase("failed");
      setSaveMessage(messageOf(reason));
    }
  };

  if (loading) {
    return <AppShell><div className="page-wrap d2-loading">正在读取真实场次与准备事实…</div></AppShell>;
  }
  if (!foundation) {
    return (
      <AppShell>
        <div className="page-wrap d2-workspace">
          <section className="d2-load-failure" role="alert">
            <DataStateBadge state="failed" />
            <h1>培训场次基础暂时无法读取</h1>
            <p>{error ?? "读取失败不会被解释为当前没有场次。"}</p>
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
          <Link href="/">运营工作台</Link><span>/</span><strong>培训场次</strong>
        </nav>
        <header className="d2-hero session">
          <div>
            <span>SESSION READINESS CONTROL</span>
            <h1>培训场次与交付准备</h1>
            <p>把已确认课程方法转化为有时间、责任、资源与参与人证据的可发布场次。</p>
          </div>
          <aside>
            <DataStateBadge state="real" />
            <strong>{foundation.sessions.length}</strong>
            <span>个场次业务身份</span>
          </aside>
        </header>
        <section className="d2-judgment">
          <div>
            <span>当前事实边界</span>
            <h2>{foundation.sessions.length ? "场次计划与准备事实已接入" : "尚未建立真实培训场次"}</h2>
            <p>已发布场次只证明计划交付条件已冻结；尚未产生出勤记录、完成证据或反馈事实。</p>
          </div>
          <div className="d2-boundary">
            <strong>发布前证据</strong>
            <span>培训师授权、场地容量、部门范围、参与人快照、准备确认。</span>
          </div>
        </section>
        <nav className="d2-tabs" aria-label="场次工作视图">
          <button type="button" className={view === "sessions" ? "active" : ""} onClick={() => setView("sessions")}>培训场次</button>
          <button type="button" className={view === "resources" ? "active" : ""} onClick={() => setView("resources")}>培训资源基础</button>
        </nav>
        {error && <p className="d2-inline-error" role="alert">{error}</p>}
        {view === "sessions" ? (
          <section className="d2-register">
            <header>
              <div><span>SCHEDULED DELIVERY</span><h2>场次版本</h2><p>参与人预览为零写入；只有发布动作才冻结快照。</p></div>
              <button className="primary-action" type="button" disabled={!referenceReady} onClick={() => openEditor()} title={referenceReady ? "建立场次" : "请先完善课程、培训师、场地和组织基础"}>建立培训场次</button>
            </header>
            {!referenceReady && <div className="d2-prerequisite"><strong>场次发布基础尚不完整</strong><span>请在“培训资源基础”中建立场地与培训师授权，并确认已发布课程版本。</span><button type="button" onClick={() => setView("resources")}>检查培训资源</button></div>}
            {foundation.sessions.length === 0 ? (
              <div className="d2-empty"><strong>当前没有场次事实</strong><span>系统不会用演示场次代替真实酒店安排。</span></div>
            ) : (
              <div className="d2-session-list">
                {foundation.sessions.map(value => (
                  <article key={value.revisionId}>
                    <div className="d2-session-date"><strong>{dateDay(value.startsAt)}</strong><span>{dateMonth(value.startsAt)}</span></div>
                    <div>
                      <span>{value.code} · {value.owningDepartmentName}</span>
                      <h3>{value.nameZh}</h3>
                      <p>{formatDateTime(value.startsAt)} — {formatTime(value.endsAt)} · {value.venueName}</p>
                    </div>
                    <dl>
                      <div><dt>容量</dt><dd>{value.capacity}</dd></div>
                      <div><dt>已选参与人</dt><dd>{value.selectedCount}</dd></div>
                    </dl>
                    <footer>
                      <em className={`d2-state ${value.lifecycleState === "draft" ? "draft" : value.currentState}`}>{sessionState(value.lifecycleState === "draft" ? "draft" : value.currentState)}</em>
                      {value.lifecycleState === "draft" && <>
                        <button type="button" onClick={() => openEditor(value)}>编辑草稿</button>
                        <button type="button" onClick={() => void previewExisting(value.revisionId, value.revisionVersion, value.id)}>预览并发布</button>
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
        ) : (
          <section className="d2-resource-grid">
            <article>
              <header><div><span>CONTROLLED VENUES</span><h2>培训场地</h2></div><button type="button" onClick={() => setResourceEditor("venue")}>新增场地</button></header>
              {foundation.venues.length ? foundation.venues.map(value => <div className="d2-resource-row" key={value.id}><strong>{value.nameZh}</strong><span>{value.locationDescription}</span><em>{value.capacity} 人</em></div>) : <p>尚未建立受控培训场地。</p>}
            </article>
            <article>
              <header><div><span>AUTHORIZED TRAINERS</span><h2>培训师与课程授权</h2></div><button type="button" onClick={() => setResourceEditor("trainer")}>新增培训师</button></header>
              {foundation.trainers.length ? foundation.trainers.map(value => <div className="d2-resource-row" key={value.id}><strong>{value.displayName}</strong><span>{value.type === "internal_employee" ? "酒店员工培训师" : "外聘培训师"}</span><em>{value.approvalCount ?? 0} 项课程授权</em></div>) : <p>尚未建立可交付培训师。</p>}
            </article>
          </section>
        )}
      </div>
      {editorOpen && (
        <div className="d2-editor-layer">
          <form className="d2-editor wide" onSubmit={event => { event.preventDefault(); void saveDraft(); }}>
            <header><div><span>SESSION REVISION DRAFT</span><h2>{form.sessionRevisionId ? "编辑培训场次草稿" : form.sessionId ? "建立场次新修订" : "建立培训场次草稿"}</h2></div><button type="button" onClick={() => setEditorOpen(false)}>关闭</button></header>
            <AdministrationSaveState phase={phase} message={saveMessage} onRetry={() => void saveDraft()} onReload={() => void reload()} />
            <div className="d2-form-grid">
              <Field label="场次代码"><input required readOnly={Boolean(form.sessionId && !form.sessionRevisionId)} value={form.code} onChange={e => updateForm("code", e.target.value)} placeholder="SESSION-2026-001" /></Field>
              <Field label="场次名称"><input required value={form.nameZh} onChange={e => updateForm("nameZh", e.target.value)} /></Field>
              <Field label="交付目的"><select value={form.purposeType} onChange={e => updateForm("purposeType", e.target.value as SessionForm["purposeType"])}><option value="requirement_delivery">培训要求交付</option><option value="development_delivery">发展性培训</option></select></Field>
              {form.purposeType === "requirement_delivery" ? <>
                <Field label="培训要求版本"><select value={form.requirementVersionId} onChange={e => selectRequirement(e.target.value, foundation, updateForm)}>{foundation.referenceOptions.requirementVersions.map(value => <option value={value.id} key={value.id}>{value.nameZh} · V{value.versionNumber}</option>)}</select></Field>
                <Field label="认可课程方式"><select value={form.methodId} onChange={e => selectMethod(e.target.value, form.requirementVersionId, foundation, updateForm)}>{foundation.referenceOptions.requirementVersions.find(value => value.id === form.requirementVersionId)?.acceptedMethods.filter(value => value.methodType === "course_version").map(value => <option value={value.id} key={value.id}>{value.labelZh}</option>)}</select></Field>
              </> : <Field label="课程版本"><select value={form.courseVersionId} onChange={e => updateForm("courseVersionId", e.target.value)}>{foundation.referenceOptions.courseVersions.map(value => <option value={value.id} key={value.id}>{value.nameZh} · V{value.versionNumber}</option>)}</select></Field>}
              <Field label="责任与受众部门"><select value={form.departmentId} onChange={e => updateForm("departmentId", e.target.value)}>{foundation.referenceOptions.departments.map(value => <option value={value.id} key={value.id}>{value.nameZh}</option>)}</select></Field>
              <Field label="运营负责人"><select value={form.ownerId} onChange={e => updateForm("ownerId", e.target.value)}>{foundation.referenceOptions.owners.map(value => <option value={value.roleAssignmentId} key={value.roleAssignmentId}>{value.displayName} · {value.roleNameZh}</option>)}</select></Field>
              <Field label="开始时间"><input required type="datetime-local" value={form.startsAt} onChange={e => updateForm("startsAt", e.target.value)} /></Field>
              <Field label="结束时间"><input required type="datetime-local" value={form.endsAt} onChange={e => updateForm("endsAt", e.target.value)} /></Field>
              <Field label="容量"><input type="number" min="1" value={form.capacity} onChange={e => updateForm("capacity", Number(e.target.value))} /></Field>
              <Field label="培训场地"><select value={form.venueId} onChange={e => updateForm("venueId", e.target.value)}>{foundation.venues.filter(value => value.active).map(value => <option value={value.id} key={value.id}>{value.nameZh} · {value.capacity} 人</option>)}</select></Field>
              <Field label="主培训师"><select value={form.trainerId} onChange={e => {
                const trainerId = e.target.value;
                const approval = foundation.trainerApprovals.find(value => value.trainerProfileId === trainerId && value.courseVersionId === form.courseVersionId);
                updateForm("trainerId", trainerId);
                updateForm("trainerApprovalId", approval?.id ?? "");
              }}>{foundation.trainers.filter(value => value.active).map(value => <option value={value.id} key={value.id}>{value.displayName}</option>)}</select></Field>
            </div>
            <label className="d2-check"><input type="checkbox" checked={form.includeDescendants} onChange={e => updateForm("includeDescendants", e.target.checked)} />受众范围包含下级正式部门</label>
            <fieldset><legend>选择计划参与人</legend><p className="field-guidance">要求交付场次仍须通过 D1 三态适用性评估；无法判断不会被选中。</p><div className="d2-employee-picker">{employees.filter(value => isDepartmentInTarget(value.departmentId, form.departmentId, form.includeDescendants, foundation.referenceOptions.departments)).slice(0, 100).map(value => <label key={value.id}><input type="checkbox" checked={form.selectedEmployeeIds.includes(value.id)} onChange={() => updateForm("selectedEmployeeIds", toggleId(form.selectedEmployeeIds, value.id))} /><span><strong>{value.nameZh ?? value.nameEn ?? "姓名未提供"}</strong><small>{value.employeeNumber} · {value.departmentName}</small></span></label>)}</div></fieldset>
            <fieldset><legend>当前场次准备边界</legend><label className="d2-check"><input type="checkbox" checked={form.materialsReady} onChange={e => updateForm("materialsReady", e.target.checked)} />负责人确认教材已准备</label><label className="d2-check"><input type="checkbox" checked={form.roomReady} onChange={e => updateForm("roomReady", e.target.checked)} />负责人确认场地布置已准备</label><Field label="出勤准备方式（尚未接入出勤记录）"><select value={form.preparationMode} onChange={e => updateForm("preparationMode", e.target.value as SessionForm["preparationMode"])}><option value="manual_only">仅人工准备</option><option value="qr_or_manual">预留 QR 或人工方式</option></select></Field></fieldset>
            <footer><button type="button" onClick={() => setEditorOpen(false)}>取消</button><button className="primary-action" type="submit" disabled={phase === "saving"}>保存并预览参与人</button></footer>
          </form>
        </div>
      )}
      {preview && (
        <ParticipantPreview
          preview={preview}
          onClose={() => setPreview(null)}
          onPublish={() => void publish()}
          publishing={phase === "saving"}
          message={saveMessage}
          sessionId={previewSessionId}
        />
      )}
      {resourceEditor && (
        <div className="d2-editor-layer">
          <form className="d2-editor compact" onSubmit={event => { event.preventDefault(); void (resourceEditor === "venue" ? saveVenue() : saveTrainer()); }}>
            <header><div><span>RESOURCE FOUNDATION</span><h2>{resourceEditor === "venue" ? "新增受控培训场地" : "新增培训师授权"}</h2></div><button type="button" onClick={() => setResourceEditor(null)}>关闭</button></header>
            {resourceEditor === "venue" ? <>
              <Field label="场地名称"><input required value={venueForm.nameZh} onChange={e => setVenueForm(current => ({ ...current, nameZh: e.target.value }))} /></Field>
              <Field label="位置说明"><input required value={venueForm.locationDescription} onChange={e => setVenueForm(current => ({ ...current, locationDescription: e.target.value }))} /></Field>
              <Field label="确认容量"><input required type="number" min="1" value={venueForm.capacity} onChange={e => setVenueForm(current => ({ ...current, capacity: Number(e.target.value) }))} /></Field>
            </> : <>
              <Field label="培训师类型"><select value={trainerForm.type} onChange={e => setTrainerForm(current => ({ ...current, type: e.target.value as TrainerForm["type"], employeeId: "", displayName: "" }))}><option value="internal_employee">酒店员工培训师</option><option value="external_facilitator">外聘培训师</option></select></Field>
              {trainerForm.type === "internal_employee" ? <Field label="酒店员工"><select required value={trainerForm.employeeId} onChange={e => setTrainerForm(current => ({ ...current, employeeId: e.target.value }))}><option value="">请选择员工</option>{employees.map(value => <option value={value.id} key={value.id}>{value.nameZh ?? value.nameEn ?? "姓名未提供"} · {value.employeeNumber}</option>)}</select></Field> : <Field label="培训师姓名"><input required value={trainerForm.displayName} onChange={e => setTrainerForm(current => ({ ...current, displayName: e.target.value }))} /></Field>}
              <Field label="授权课程版本"><select required value={trainerForm.courseVersionId} onChange={e => setTrainerForm(current => ({ ...current, courseVersionId: e.target.value }))}><option value="">请选择</option>{foundation.referenceOptions.courseVersions.map(value => <option value={value.id} key={value.id}>{value.nameZh} · V{value.versionNumber}</option>)}</select></Field>
              <Field label="授权生效日"><input required type="date" value={trainerForm.effectiveFrom} onChange={e => setTrainerForm(current => ({ ...current, effectiveFrom: e.target.value }))} /></Field>
              <Field label="经理确认依据"><textarea required value={trainerForm.evidenceNote} onChange={e => setTrainerForm(current => ({ ...current, evidenceNote: e.target.value }))} /></Field>
            </>}
            <footer><button type="button" onClick={() => setResourceEditor(null)}>取消</button><button className="primary-action" type="submit">保存真实资源</button></footer>
          </form>
        </div>
      )}
    </AppShell>
  );
}

function ParticipantPreview({ preview, onClose, onPublish, publishing, message, sessionId }: { preview: SessionParticipantPreview; onClose: () => void; onPublish: () => void; publishing: boolean; message: string | null; sessionId: string }) {
  return <div className="d2-editor-layer"><section className="d2-editor wide d2-preview"><header><div><span>ZERO-WRITE REVIEW</span><h2>参与人适用性与快照预览</h2><p>参与人预览为零写入；发布后才保存候选证据。</p></div><button type="button" onClick={onClose}>关闭</button></header><div className="d2-preview-summary"><div><strong>{preview.selectedCount}</strong><span>明确选择</span></div><div><strong>{preview.eligibleCount ?? "—"}</strong><span>适用</span></div><div><strong>{preview.unableToDetermineCount}</strong><span>无法判断</span></div></div>{message && <p className="d2-inline-note">{message}</p>}<div className="d2-preview-list">{preview.rows.map(row => <article key={row.employeeId}><div><strong>{"employeeName" in row ? row.employeeName : row.employeeId}</strong><small>{"employeeNumber" in row ? row.employeeNumber : ""}</small></div><span>{"eligibilityState" in row ? eligibilityLabel(row.eligibilityState) : "发展性选择"}</span><em>{row.selected ? "已选择" : "未选择"}</em></article>)}</div><footer><span>场次 {sessionId || "新建草稿"} · 尚未产生出勤记录</span><button className="primary-action" type="button" onClick={onPublish} disabled={publishing || preview.selectedCount === 0}>发布并冻结证据</button></footer></section></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span>{label}</span>{children}</label>; }
function toggleId(values: string[], id: string) { return values.includes(id) ? values.filter(value => value !== id) : [...values, id]; }
function isDepartmentInTarget(departmentId: string, targetId: string, includeDescendants: boolean, departments: TrainingOperationsFoundation["referenceOptions"]["departments"]) {
  if (departmentId === targetId) return true;
  if (!includeDescendants) return false;
  const byId = new Map(departments.map(value => [value.id, value]));
  let current = byId.get(departmentId);
  while (current?.parentId) {
    if (current.parentId === targetId) return true;
    current = byId.get(current.parentId);
  }
  return false;
}
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
function dateDay(value: string) { return new Intl.DateTimeFormat("zh-CN", { day: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(value)); }
function dateMonth(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(value)); }
function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(value)); }
function sessionState(value: string) { return value === "draft" ? "草稿" : value === "published" ? "已发布" : "已取消"; }
function eligibilityLabel(value: string) { return value === "eligible" ? "适用" : value === "not_applicable" ? "不适用" : "无法判断 / Unable to Determine"; }
function emptySessionForm(): SessionForm {
  const start = new Date(Date.now() + 7 * 86400000);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 3600000);
  const local = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  return { sessionId: "", sessionRevisionId: "", expectedVersion: 0, code: "", nameZh: "", purposeType: "development_delivery", planItemId: "", requirementVersionId: "", methodId: "", courseVersionId: "", departmentId: "", ownerId: "", startsAt: local(start), endsAt: local(end), capacity: 20, venueId: "", trainerId: "", trainerApprovalId: "", includeDescendants: true, selectedEmployeeIds: [], materialsReady: false, roomReady: false, preparationMode: "manual_only" };
}
function selectRequirement(id: string, foundation: TrainingOperationsFoundation, update: <K extends keyof SessionForm>(key: K, value: SessionForm[K]) => void) {
  const requirement = foundation.referenceOptions.requirementVersions.find(value => value.id === id);
  const method = requirement?.acceptedMethods.find(value => value.methodType === "course_version");
  update("requirementVersionId", id); update("methodId", method?.id ?? ""); update("courseVersionId", method?.courseVersionId ?? "");
}
function selectMethod(id: string, requirementId: string, foundation: TrainingOperationsFoundation, update: <K extends keyof SessionForm>(key: K, value: SessionForm[K]) => void) {
  const method = foundation.referenceOptions.requirementVersions.find(value => value.id === requirementId)?.acceptedMethods.find(value => value.id === id);
  update("methodId", id); update("courseVersionId", method?.courseVersionId ?? "");
}
