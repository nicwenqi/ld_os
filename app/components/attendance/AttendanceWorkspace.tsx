"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createRepositoryRegistry } from "../../repositories/registry.ts";
import type {
  AttendanceDetermination,
  AttendanceParticipant,
  AttendanceRegisterSummary,
  AttendanceWorkspace as AttendanceWorkspaceModel,
} from "../../repositories/contracts/attendance-repository.ts";
import {
  canCloseAttendanceRegister,
  validateAttendanceDeterminationDraft,
} from "../../services/attendance-service.ts";
import { useAuthSession } from "../../state/auth-session.tsx";

type Mode = "manager" | "department";
type Phase = "idle" | "loading" | "saving" | "error";

const determinations: {
  value: AttendanceDetermination;
  label: string;
  guidance: string;
}[] = [
  { value: "present", label: "出席", guidance: "现场证据确认参加" },
  { value: "absent", label: "缺席", guidance: "现场核对确认未参加" },
  {
    value: "excused_absence",
    label: "获准缺席",
    guidance: "有明确获准原因",
  },
  {
    value: "unable_to_determine",
    label: "无法判断",
    guidance: "现有证据不足",
  },
];

export function AttendanceWorkspace({ mode }: { mode: Mode }) {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const { session } = useAuthSession();
  const [workspace, setWorkspace] =
    useState<AttendanceWorkspaceModel | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [activeRegisterId, setActiveRegisterId] = useState<string | null>(
    null,
  );
  const [determinationTarget, setDeterminationTarget] = useState<{
    register: AttendanceRegisterSummary;
    participant: AttendanceParticipant;
  } | null>(null);
  const [determination, setDetermination] =
    useState<AttendanceDetermination>("present");
  const [reason, setReason] = useState("");
  const [closure, setClosure] = useState<{
    register: AttendanceRegisterSummary;
    mode: "close" | "reopen";
  } | null>(null);
  const [closureReason, setClosureReason] = useState("");
  const [checkIn, setCheckIn] = useState<{
    link: string;
    qrDataUrl: string;
    expiresAt: string;
  } | null>(null);

  const load = useCallback(async () => {
    if (!registry.attendance) {
      setPhase("error");
      setMessage("当前环境尚未接入真实出勤事实。");
      return;
    }
    if (mode === "manager" && !session.propertyId) return;
    setPhase("loading");
    try {
      const next = mode === "manager"
        ? await registry.attendance.readManagerWorkspace(
          session.propertyId!,
        )
        : await registry.attendance.readDepartmentWorkspace();
      setWorkspace(next);
      setActiveRegisterId(current => (
        current &&
          next.registers.some(register => register.sessionRevisionId === current)
          ? current
          : next.registers[0]?.sessionRevisionId ?? null
      ));
      setPhase("idle");
    } catch (error) {
      setPhase("error");
      setMessage(errorMessage(error));
    }
  }, [mode, registry, session.propertyId]);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  const mutate = async (
    action: () => Promise<unknown>,
    successMessage: string,
  ) => {
    setPhase("saving");
    setMessage(null);
    try {
      await action();
      await load();
      setMessage(successMessage);
      setPhase("idle");
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === "ConflictError") {
        await load();
        setPhase("error");
        setMessage("登记册已被其他用户更新，已重新读取最新状态。");
        return false;
      }
      setPhase("error");
      setMessage(errorMessage(error));
      return false;
    }
  };

  const openRegister = (register: AttendanceRegisterSummary) => {
    if (!registry.attendance) return;
    void mutate(
      () => registry.attendance!.openRegister(
        register.sessionRevisionId,
        register.version,
      ),
      "出勤登记已开放，可以开始人工登记或生成受限签到二维码。",
    );
  };

  const issueCheckInGrant = async (
    register: AttendanceRegisterSummary,
  ) => {
    if (!registry.attendance || !register.id) return;
    setPhase("saving");
    setMessage(null);
    try {
      const grant = await registry.attendance.issueCheckInGrant(
        register.id,
        register.version,
      );
      const link = `${window.location.origin}/check-in#${encodeURIComponent(
        grant.token,
      )}`;
      const qrDataUrl = await QRCode.toDataURL(link, {
        errorCorrectionLevel: "M",
        width: 320,
        margin: 2,
        color: { dark: "#173747", light: "#fffdf8" },
      });
      setCheckIn({ link, qrDataUrl, expiresAt: grant.expiresAt });
      await load();
      setPhase("idle");
    } catch (error) {
      setPhase("error");
      setMessage(errorMessage(error));
    }
  };

  const recordDetermination = async () => {
    if (!registry.attendance || !determinationTarget) return;
    const evidenceObservationIds =
      determinationTarget.participant.observations.map(
        observation => observation.id,
      );
    const draft = { determination, reason, evidenceObservationIds };
    const errors = validateAttendanceDeterminationDraft(draft);
    if (errors.length) {
      setMessage(errors.join(" "));
      return;
    }
    const saved = await mutate(
      () => registry.attendance!.recordDetermination({
        registerId: determinationTarget.register.id!,
        participantSnapshotId:
          determinationTarget.participant.participantSnapshotId,
        draft,
        expectedVersion: determinationTarget.register.version,
      }),
      "出勤判定已保存，并重新读取最新登记册。",
    );
    if (saved) {
      setDeterminationTarget(null);
      setReason("");
    }
  };

  const transition = (
    register: AttendanceRegisterSummary,
    target: "reconcile" | "close" | "reopen",
    transitionReason = "",
  ) => {
    if (!registry.attendance || !register.id) return;
    if (target === "reconcile") {
      void mutate(
        () => registry.attendance!.beginReconciliation(
          register.id!,
          register.version,
        ),
        "登记册已进入核对状态。",
      );
      return;
    }
    void mutate(
      () => target === "close"
        ? registry.attendance!.closeRegister(
          register.id!,
          register.version,
          transitionReason,
        )
        : registry.attendance!.reopenRegister(
          register.id!,
          register.version,
          transitionReason,
        ),
      target === "close"
        ? "登记册已关闭；未形成判定的参与人仍保持为空，不会被推断为缺席。"
        : "登记册已重新开启，可以追加更正证据。",
    ).then(saved => {
      if (saved) {
        setClosure(null);
        setClosureReason("");
      }
    });
  };

  if (phase === "loading" && !workspace) {
    return (
      <div className="page-wrap d3-loading" role="status">
        正在读取真实出勤登记…
      </div>
    );
  }
  if (!workspace) {
    return (
      <section className="page-wrap d3-failure">
        <span>ATTENDANCE SOURCE</span>
        <h1>暂时无法读取出勤事实</h1>
        <p>{message ?? "请稍后重试。"}</p>
        <button type="button" onClick={() => void load()}>重新读取</button>
      </section>
    );
  }

  const activeRegister = workspace.registers.find(
    register => register.sessionRevisionId === activeRegisterId,
  ) ?? workspace.registers[0] ?? null;

  return (
    <div className="page-wrap d3-workspace">
      <header className="d3-hero">
        <div>
          <span>TRUSTED ATTENDANCE FACT</span>
          <h1>{mode === "manager" ? "酒店出勤登记" : "部门出勤登记"}</h1>
          <p>
            出勤只回答员工是否参加了某次培训交付。QR 签到只形成现场 Observation，
            授权人员核对后才形成 Attendance Determination。
          </p>
        </div>
        <aside>
          <strong>{workspace.registers.length}</strong>
          <span>个真实场次登记边界</span>
          <em>完成证据尚未接入</em>
        </aside>
      </header>

      {mode === "department" && (
        <section className="d3-scope" aria-label="授权部门范围">
          <header>
            <span>授权部门范围</span>
            <strong>服务端约束</strong>
          </header>
          <div>
            {(workspace.scope ?? []).map(scope => (
              <article key={scope.departmentId}>
                <small>{scope.breadcrumb.join(" › ")}</small>
                <strong>{scope.departmentName}</strong>
                <span>
                  {scope.includeDescendants ? "含明确授权后代部门" : "仅当前部门"}
                </span>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="d3-judgment">
        <div>
          <span>当前事实判断</span>
          <h2>
            {workspace.registers.length
              ? "出勤事实已接入；完成、反馈与 KPI 仍保持不可用"
              : "尚无已发布场次可开放出勤登记"}
          </h2>
          <p>
            {workspace.registers.length
              ? "系统只展示已发布场次、冻结参与人快照、现场观察与授权判定。"
              : "请先在培训场次中完成真实场次发布，再回到此处登记。"}
          </p>
        </div>
        <Link href={mode === "manager" ? "/sessions" : "/department/sessions"}>
          返回培训场次
        </Link>
      </section>

      {message && (
        <p
          className={`d3-message ${phase === "error" ? "error" : ""}`}
          role="status"
        >
          {message}
        </p>
      )}

      {workspace.registers.length === 0 ? (
        <section className="d3-empty">
          <span>NO PUBLISHED DELIVERY</span>
          <h2>当前没有可登记的真实培训交付</h2>
          <p>这里不会用模拟场次、零出勤或虚构完成率填充页面。</p>
          <Link href={mode === "manager" ? "/sessions" : "/department/sessions"}>
            查看培训场次
          </Link>
        </section>
      ) : (
        <>
          <nav className="d3-register-tabs" aria-label="培训场次登记册">
            {workspace.registers.map(register => (
              <button
                type="button"
                className={
                  activeRegister?.sessionRevisionId ===
                    register.sessionRevisionId
                    ? "active"
                    : ""
                }
                onClick={() =>
                  setActiveRegisterId(register.sessionRevisionId)}
                key={register.sessionRevisionId}
              >
                <strong>{register.sessionName}</strong>
                <span>{formatDateTime(register.startsAt)}</span>
              </button>
            ))}
          </nav>
          {activeRegister && (
            <RegisterPanel
              register={activeRegister}
              mode={mode}
              busy={phase === "saving"}
              onOpen={() => openRegister(activeRegister)}
              onIssueQr={() => void issueCheckInGrant(activeRegister)}
              onReconcile={() =>
                transition(activeRegister, "reconcile")}
              onClose={() => {
                setClosure({ register: activeRegister, mode: "close" });
                setClosureReason("");
              }}
              onReopen={() => {
                setClosure({ register: activeRegister, mode: "reopen" });
                setClosureReason("");
              }}
              onDetermine={participant => {
                setDeterminationTarget({
                  register: activeRegister,
                  participant,
                });
                setDetermination(
                  participant.currentDetermination?.determination ?? "present",
                );
                setReason("");
              }}
            />
          )}
        </>
      )}

      <section className="d3-unavailable">
        <div>
          <span>FEEDBACK BOUNDARY</span>
          <h2>反馈尚未接入真实数据</h2>
          <p>
            D3 不创建反馈、完成记录、要求履行、出勤率、KPI、风险或预测。
          </p>
        </div>
        <em>不可用不是零</em>
      </section>

      {determinationTarget && (
        <div className="d3-modal-layer" role="presentation">
          <section
            className="d3-modal"
            role="dialog"
            aria-modal="true"
            aria-label="现场快速登记"
          >
            <header>
              <div>
                <span>MANUAL WITNESS OR REVIEW</span>
                <h2>现场快速登记</h2>
                <p>
                  {determinationTarget.participant.employeeName} ·{" "}
                  {determinationTarget.participant.employeeNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeterminationTarget(null)}
              >
                关闭
              </button>
            </header>
            <div className="d3-status-picker">
              {determinations.map(option => (
                <button
                  type="button"
                  className={determination === option.value ? "active" : ""}
                  onClick={() => setDetermination(option.value)}
                  key={option.value}
                >
                  <strong>{option.label}</strong>
                  <span>{option.guidance}</span>
                </button>
              ))}
            </div>
            <label>
              核对依据
              <textarea
                value={reason}
                onChange={event => setReason(event.target.value)}
                placeholder="例如：现场点名确认；已核对二维码签到回执"
                autoFocus
              />
            </label>
            <div className="d3-evidence-list">
              <strong>当前引用的现场证据</strong>
              {determinationTarget.participant.observations.length ? (
                determinationTarget.participant.observations.map(
                  observation => (
                    <span key={observation.id}>
                      {observation.source === "qr_self_check_in"
                        ? "QR 自助签到回执"
                        : "人工见证"}{" "}
                      · {formatDateTime(observation.observedAt)}
                    </span>
                  ),
                )
              ) : (
                <span>
                  保存时将原子化创建一条人工见证 Observation，再形成判定。
                </span>
              )}
            </div>
            <footer>
              <button
                type="button"
                onClick={() => setDeterminationTarget(null)}
              >
                取消
              </button>
              <button
                className="primary"
                type="button"
                disabled={phase === "saving" || reason.trim() === ""}
                onClick={() => void recordDetermination()}
              >
                {phase === "saving" ? "保存中…" : "保存判定"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {closure && (
        <div className="d3-modal-layer" role="presentation">
          <section
            className="d3-modal compact"
            role="dialog"
            aria-modal="true"
            aria-label={
              closure.mode === "close" ? "关闭登记册" : "重新开启登记册"
            }
          >
            <header>
              <div>
                <span>REGISTER CONTROL</span>
                <h2>
                  {closure.mode === "close" ? "关闭登记册" : "重新开启"}
                </h2>
              </div>
              <button type="button" onClick={() => setClosure(null)}>
                关闭
              </button>
            </header>
            <p>
              {closure.mode === "close"
                ? "允许未登记员工保持无判定；未处理 Observation 或断裂证据会阻止关闭。"
                : "重开不会恢复旧签到 token，后续更正仍保留完整历史。"}
            </p>
            <label>
              {closure.mode === "close" ? "核对结论" : "重新开启原因"}
              <textarea
                value={closureReason}
                onChange={event => setClosureReason(event.target.value)}
                autoFocus
              />
            </label>
            <footer>
              <button type="button" onClick={() => setClosure(null)}>
                取消
              </button>
              <button
                className="primary"
                type="button"
                disabled={
                  closureReason.trim() === "" || phase === "saving"
                }
                onClick={() =>
                  transition(
                    closure.register,
                    closure.mode,
                    closureReason,
                  )}
              >
                确认
              </button>
            </footer>
          </section>
        </div>
      )}

      {checkIn && (
        <div className="d3-modal-layer" role="presentation">
          <section
            className="d3-modal compact d3-qr"
            role="dialog"
            aria-modal="true"
            aria-label="受限签到二维码"
          >
            <header>
              <div>
                <span>EXPIRING SESSION GRANT</span>
                <h2>受限签到二维码</h2>
              </div>
              <button type="button" onClick={() => setCheckIn(null)}>
                关闭
              </button>
            </header>
            {/* QR is generated locally; the opaque token is never sent to a
                third-party image service. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={checkIn.qrDataUrl} alt="本场次受限签到二维码" />
            <p>有效至 {formatDateTime(checkIn.expiresAt)}</p>
            <p>
              扫码仅提交身份匹配 Observation，不会自动判定“出席”，也不会形成完成记录。
            </p>
            <button
              className="primary"
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(checkIn.link)
                  .then(() => setMessage("受限签到链接已复制。"))
                  .catch(() => {
                    setPhase("error");
                    setMessage("无法复制签到链接，请直接扫描二维码。");
                  });
              }}
            >
              复制签到链接
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function RegisterPanel({
  register,
  mode,
  busy,
  onOpen,
  onIssueQr,
  onReconcile,
  onClose,
  onReopen,
  onDetermine,
}: {
  register: AttendanceRegisterSummary;
  mode: Mode;
  busy: boolean;
  onOpen: () => void;
  onIssueQr: () => void;
  onReconcile: () => void;
  onClose: () => void;
  onReopen: () => void;
  onDetermine: (participant: AttendanceParticipant) => void;
}) {
  const closeState = canCloseAttendanceRegister({
    unresolvedObservationCount: register.counts.unresolvedObservationCount,
    brokenEvidenceCount: register.counts.brokenEvidenceCount,
    participantWithoutDeterminationCount: register.counts.unrecordedCount,
  });
  return (
    <section className="d3-register-panel">
      <header>
        <div>
          <span>{register.sessionCode}</span>
          <h2>{register.sessionName}</h2>
          <p>
            {formatDateTime(register.startsAt)} · {register.venueName} ·{" "}
            {register.owningDepartmentName}
          </p>
        </div>
        <em className={`state-${register.state}`}>
          {registerStateLabel(register.state)}
        </em>
      </header>
      <div className="d3-register-summary">
        <Summary value={register.counts.participantCount} label="冻结参与人" />
        <Summary value={register.counts.observedCount} label="已有现场观察" />
        <Summary value={register.counts.determinedCount} label="已有授权判定" />
        <Summary
          value={register.counts.unresolvedObservationCount}
          label="待核对观察"
          attention={register.counts.unresolvedObservationCount > 0}
        />
      </div>
      <div className="d3-toolbar">
        {register.state === "prepared" && register.canManage && (
          <button className="primary" type="button" onClick={onOpen}>
            开放出勤登记
          </button>
        )}
        {register.state === "open" &&
          register.preparationMode === "qr_or_manual" &&
          register.canCloseRegister && (
            <button type="button" onClick={onIssueQr}>
              生成签到二维码
            </button>
          )}
        {register.state === "open" && register.canCloseRegister && (
          <button type="button" onClick={onReconcile}>
            开始核对
          </button>
        )}
        {register.state === "reconciling" &&
          register.canCloseRegister && (
            <button
              className="primary"
              type="button"
              onClick={onClose}
              disabled={!closeState.allowed}
              title={closeState.blockers.join(" ")}
            >
              关闭登记册
            </button>
          )}
        {register.state === "closed" && mode === "manager" && (
          <button type="button" onClick={onReopen}>
            重新开启
          </button>
        )}
        <span>
          版本 {register.version} ·{" "}
          {register.preparationMode === "qr_or_manual"
            ? "QR + 人工见证"
            : "仅人工见证"}
        </span>
      </div>
      {!closeState.allowed && register.state === "reconciling" && (
        <p className="d3-blocker">{closeState.blockers.join(" ")}</p>
      )}
      <div className="d3-participant-list">
        <header>
          <span>参与人快照</span>
          <strong>现场快速登记</strong>
        </header>
        {register.participants.map(participant => (
          <article key={participant.participantSnapshotId}>
            <div className="d3-person">
              <span>{participant.employeeName.slice(0, 1)}</span>
              <div>
                <strong>{participant.employeeName}</strong>
                <small>
                  {participant.employeeNumber} ·{" "}
                  {participant.departmentName ?? "部门证据缺失"}
                </small>
              </div>
            </div>
            <div className="d3-observation">
              <strong>{participant.observations.length}</strong>
              <span>条 Observation</span>
            </div>
            <div className="d3-determination">
              <strong>
                {participant.currentDetermination
                  ? determinationLabel(
                    participant.currentDetermination.determination,
                  )
                  : "尚未形成判定"}
              </strong>
              <span>
                {participant.currentDetermination?.reason ??
                  "缺失不是零，也不会自动记为缺席"}
              </span>
            </div>
            <button
              type="button"
              disabled={
                busy || !register.id || register.state === "closed" ||
                !register.canManage
              }
              onClick={() => onDetermine(participant)}
            >
              {participant.currentDetermination ? "追加更正" : "登记"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function Summary({
  value,
  label,
  attention = false,
}: {
  value: number;
  label: string;
  attention?: boolean;
}) {
  return (
    <div className={attention ? "attention" : ""}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function determinationLabel(value: AttendanceDetermination) {
  return determinations.find(item => item.value === value)?.label ?? value;
}

function registerStateLabel(value: AttendanceRegisterSummary["state"]) {
  if (value === "prepared") return "待开放";
  if (value === "open") return "登记中";
  if (value === "reconciling") return "核对中";
  return "已关闭";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}
