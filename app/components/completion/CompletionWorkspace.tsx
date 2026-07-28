"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AttendanceCompletionCandidate,
  CompletionEvidenceFact,
  CompletionMethodOption,
  CompletionRecordFact,
  CompletionReviewDecision,
  CompletionWorkspace as CompletionWorkspaceModel,
} from "../../repositories/contracts/completion-repository.ts";
import { createRepositoryRegistry } from "../../repositories/registry.ts";
import {
  validateCompletionEvidenceDraft,
  validateCompletionReviewDraft,
  validateCompletionRevocationDraft,
} from "../../services/completion-service.ts";
import { useAuthSession } from "../../state/auth-session.tsx";
import { AppShell } from "../shell/AppShell.tsx";

type Mode = "manager" | "department";
type Phase = "loading" | "idle" | "saving" | "error";
type EvidenceSource = "attendance" | "external_evidence" | "manager_recognition";

type ExternalDraft = {
  employeeId: string;
  methodId: string;
  issuerName: string;
  credentialReference: string;
  issuedOn: string;
  expiresOn: string;
  sourceSummary: string;
};

type RecognitionDraft = {
  employeeId: string;
  methodId: string;
  recognitionDate: string;
  recognitionBasis: string;
};

const emptyExternal: ExternalDraft = {
  employeeId: "",
  methodId: "",
  issuerName: "",
  credentialReference: "",
  issuedOn: "",
  expiresOn: "",
  sourceSummary: "",
};

const emptyRecognition: RecognitionDraft = {
  employeeId: "",
  methodId: "",
  recognitionDate: "",
  recognitionBasis: "",
};

export function CompletionWorkspace({ mode }: { mode: Mode }) {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const { session } = useAuthSession();
  const [workspace, setWorkspace] =
    useState<CompletionWorkspaceModel | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [source, setSource] = useState<EvidenceSource>("attendance");
  const [external, setExternal] = useState<ExternalDraft>(emptyExternal);
  const [recognition, setRecognition] =
    useState<RecognitionDraft>(emptyRecognition);
  const [reviewTarget, setReviewTarget] =
    useState<CompletionEvidenceFact | null>(null);
  const [reviewDecision, setReviewDecision] =
    useState<CompletionReviewDecision>("accepted");
  const [reviewReason, setReviewReason] = useState("");
  const [supersedesId, setSupersedesId] = useState("");
  const [revocationTarget, setRevocationTarget] =
    useState<CompletionRecordFact | null>(null);
  const [revocationReason, setRevocationReason] = useState("");

  const load = useCallback(async () => {
    if (!registry.completion) {
      setPhase("error");
      setMessage("当前环境尚未接入真实完成证据。");
      return;
    }
    if (mode === "manager" && !session.propertyId) return;
    setPhase("loading");
    try {
      const next = mode === "manager"
        ? await registry.completion.readManagerWorkspace(session.propertyId!)
        : await registry.completion.readDepartmentWorkspace();
      setWorkspace(next);
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
      setPhase("idle");
      setMessage(successMessage);
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === "ConflictError") {
        await load();
        setPhase("error");
        setMessage("事实已被其他用户处理，系统已重新读取权威状态。");
        return false;
      }
      setPhase("error");
      setMessage(errorMessage(error));
      return false;
    }
  };

  if (phase === "loading" && !workspace) {
    return (
      <AppShell>
        <div className="page-wrap d4-loading" role="status">
          正在读取真实完成证据…
        </div>
      </AppShell>
    );
  }

  if (!workspace) {
    return (
      <AppShell>
        <section className="page-wrap d4-failure">
          <span>COMPLETION FACT SOURCE</span>
          <h1>暂时无法读取完成证据</h1>
          <p>{message ?? "请稍后重试。"}</p>
          <button type="button" onClick={() => void load()}>重新读取</button>
        </section>
      </AppShell>
    );
  }

  const pendingEvidence = workspace.evidence.filter(item => !item.review);
  const rejectedEvidence = workspace.evidence.filter(
    item => item.review?.decision === "rejected",
  );
  const externalMethods = workspace.methods.filter(
    item => item.methodType === "external_certificate",
  );
  const recognitionMethods = workspace.methods.filter(
    item => item.methodType === "manager_equivalency",
  );
  const assessmentMethods = workspace.methods.filter(
    item => item.methodType === "assessment",
  );

  const recordAttendance = async (
    candidate: AttendanceCompletionCandidate,
  ) => {
    if (!registry.completion) return;
    const draft = {
      sourceType: "attendance",
      attendanceDeterminationId: candidate.attendanceDeterminationId,
      attendanceDetermination: "present",
      sourceSummary:
        `已核对关闭登记册 ${candidate.sessionCode} 的当前出席判定。`,
    };
    const errors = validateCompletionEvidenceDraft(draft);
    if (errors.length) {
      setPhase("error");
      setMessage(errors.join(" "));
      return;
    }
    await mutate(
      () => registry.completion!.recordAttendanceEvidence({
        attendanceDeterminationId: draft.attendanceDeterminationId,
        sourceSummary: draft.sourceSummary,
      }),
      "Attendance Present 已登记为待核验证据；尚未形成完成事实。",
    );
  };

  const recordExternal = async () => {
    if (!registry.completion) return;
    const method = externalMethods.find(item => item.id === external.methodId);
    const draft = {
      sourceType: "external_evidence",
      employeeId: external.employeeId,
      requirementVersionId: method?.requirementVersionId ?? "",
      acceptedLearningMethodId: external.methodId,
      issuerName: external.issuerName,
      credentialReference: external.credentialReference,
      issuedOn: external.issuedOn,
      expiresOn: external.expiresOn,
      sourceSummary: external.sourceSummary,
    };
    const errors = validateCompletionEvidenceDraft(draft);
    if (errors.length) {
      setPhase("error");
      setMessage(errors.join(" "));
      return;
    }
    const saved = await mutate(
      () => registry.completion!.recordExternalEvidence({
        employeeId: draft.employeeId,
        requirementVersionId: draft.requirementVersionId,
        acceptedLearningMethodId: draft.acceptedLearningMethodId,
        issuerName: draft.issuerName,
        credentialReference: draft.credentialReference,
        issuedOn: draft.issuedOn,
        expiresOn: draft.expiresOn || undefined,
        sourceSummary: draft.sourceSummary,
      }),
      "外部来源已登记为待核验证据；尚未形成完成事实。",
    );
    if (saved) setExternal(emptyExternal);
  };

  const recordRecognition = async () => {
    if (!registry.completion || mode !== "manager") return;
    const method = recognitionMethods.find(
      item => item.id === recognition.methodId,
    );
    const draft = {
      sourceType: "manager_recognition",
      employeeId: recognition.employeeId,
      requirementVersionId: method?.requirementVersionId ?? "",
      acceptedLearningMethodId: recognition.methodId,
      recognitionDate: recognition.recognitionDate,
      recognitionBasis: recognition.recognitionBasis,
    };
    const errors = validateCompletionEvidenceDraft(draft);
    if (errors.length) {
      setPhase("error");
      setMessage(errors.join(" "));
      return;
    }
    const saved = await mutate(
      () => registry.completion!.recordManagerRecognition({
        employeeId: draft.employeeId,
        requirementVersionId: draft.requirementVersionId,
        acceptedLearningMethodId: draft.acceptedLearningMethodId,
        recognitionDate: draft.recognitionDate,
        recognitionBasis: draft.recognitionBasis,
      }),
      "经理等价认定已登记为待核验证据；仍需显式核验。",
    );
    if (saved) setRecognition(emptyRecognition);
  };

  const reviewEvidence = async () => {
    if (!registry.completion || !reviewTarget) return;
    const errors = validateCompletionReviewDraft({
      decision: reviewDecision,
      reason: reviewReason,
    });
    if (errors.length) {
      setPhase("error");
      setMessage(errors.join(" "));
      return;
    }
    const saved = await mutate(
      () => registry.completion!.reviewEvidence({
        evidenceId: reviewTarget.id,
        decision: reviewDecision,
        reason: reviewReason,
        supersedesCompletionRecordId:
          reviewDecision === "accepted" && supersedesId
            ? supersedesId
            : undefined,
      }),
      reviewDecision === "accepted"
        ? "证据已接受，并形成不可原地修改的完成记录。"
        : "证据已拒绝；未形成完成记录。",
    );
    if (saved) {
      setReviewTarget(null);
      setReviewReason("");
      setSupersedesId("");
    }
  };

  const revokeCompletionRecord = async () => {
    if (!registry.completion || !revocationTarget) return;
    const errors = validateCompletionRevocationDraft({
      reason: revocationReason,
    });
    if (errors.length) {
      setPhase("error");
      setMessage(errors.join(" "));
      return;
    }
    const saved = await mutate(
      () => registry.completion!.revokeCompletionRecord({
        completionRecordId: revocationTarget.id,
        reason: revocationReason,
      }),
      "完成记录已追加撤销事实；原记录、证据与核验历史全部保留。",
    );
    if (saved) {
      setRevocationTarget(null);
      setRevocationReason("");
    }
  };

  return (
    <AppShell>
      <div className="page-wrap d4-workspace">
      <header className="d4-hero">
        <div>
          <span>TRUSTED COMPLETION FACT</span>
          <h1>{mode === "manager" ? "酒店完成证据" : "部门完成证据"}</h1>
          <p>
            Completion 只回答员工是否通过某种认可方式完成了唯一培训要求版本。
            Attendance Present 只是可用来源证据，必须经过独立核验。
          </p>
        </div>
        <aside aria-label="真实完成事实摘要">
          <div>
            <strong>{pendingEvidence.length}</strong>
            <span>待核验证据</span>
          </div>
          <div>
            <strong>
              {workspace.records.filter(item => item.status === "active").length}
            </strong>
            <span>有效完成事实</span>
          </div>
          <em>不会生成任务、提醒或 KPI</em>
        </aside>
      </header>

      {mode === "department" && (
        <section className="d4-scope" aria-label="授权部门范围">
          <header>
            <span>授权部门范围</span>
            <strong>按事件发生时员工事实约束</strong>
          </header>
          <div>
            {workspace.scope.map(scope => (
              <article key={scope.departmentId}>
                <small>{scope.breadcrumb.join(" › ")}</small>
                <strong>{scope.departmentName}</strong>
                <span>
                  {scope.includeDescendants ? "包含明确授权后代部门" : "仅当前部门"}
                </span>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="d4-judgment">
        <div>
          <span>当前事实判断</span>
          <h2>{completionJudgment(workspace, pendingEvidence.length)}</h2>
          <p>
            完成事实引用 Requirement Version、Accepted Learning Method 与事件发生时
            Employee Fact Version；当前部门、职位或状态变化不会重写历史。
          </p>
        </div>
        <nav aria-label="完成事实返回路径">
          <Link
            href={
              mode === "manager"
                ? "/attendance-feedback"
                : "/department/attendance-feedback"
            }
          >
            查看出勤来源
          </Link>
          <Link
            href={mode === "manager" ? "/requirements" : "/department/requirements"}
          >
            查看培训要求
          </Link>
        </nav>
      </section>

      {message && (
        <p
          className={`d4-message ${phase === "error" ? "error" : ""}`}
          role="status"
        >
          {message}
        </p>
      )}

      <section className="d4-section">
        <header className="d4-section-heading">
          <div>
            <span>EVIDENCE REVIEW</span>
            <h2>待核验证据</h2>
            <p>记录来源不等于批准完成；接受或拒绝都需要明确理由。</p>
          </div>
          <strong>{pendingEvidence.length}</strong>
        </header>
        {pendingEvidence.length === 0 ? (
          <TruthfulEmpty
            title="当前无待核验证据"
            body="没有待处理证据并不自动证明所有员工已完成要求。"
          />
        ) : (
          <div className="d4-evidence-list">
            {pendingEvidence.map(evidence => (
              <EvidenceCard
                key={evidence.id}
                evidence={evidence}
                busy={phase === "saving"}
                onReview={(decision) => {
                  setReviewTarget(evidence);
                  setReviewDecision(decision);
                  setReviewReason("");
                  setSupersedesId("");
                }}
              />
            ))}
          </div>
        )}
        {rejectedEvidence.length > 0 && (
          <details className="d4-rejected">
            <summary>查看已拒绝证据（{rejectedEvidence.length}）</summary>
            <div className="d4-evidence-list">
              {rejectedEvidence.map(evidence => (
                <EvidenceCard
                  key={evidence.id}
                  evidence={evidence}
                  busy
                  onReview={() => undefined}
                />
              ))}
            </div>
          </details>
        )}
      </section>

      <section className="d4-section">
        <header className="d4-section-heading">
          <div>
            <span>VERIFIED COMPLETION</span>
            <h2>已核验完成事实</h2>
            <p>完成记录不可原地修改；更正采用撤销与新证据追加链。</p>
          </div>
          <strong>{workspace.records.length}</strong>
        </header>
        {workspace.records.length === 0 ? (
          <TruthfulEmpty
            title="尚无已核验完成事实"
            body="这里不会把出席、资格适用或缺失数据自动转换为 Completed。"
          />
        ) : (
          <div className="d4-record-list">
            {workspace.records.map(record => (
              <RecordCard
                key={record.id}
                record={record}
                busy={phase === "saving"}
                onRevoke={() => {
                  setRevocationTarget(record);
                  setRevocationReason("");
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section className="d4-section d4-record-source">
        <header className="d4-section-heading">
          <div>
            <span>RECORD SOURCE EVIDENCE</span>
            <h2>登记完成来源</h2>
            <p>每个入口只登记真实来源证据，随后进入独立核验。</p>
          </div>
        </header>
        <nav className="d4-source-tabs" aria-label="完成证据来源">
          <SourceTab
            active={source === "attendance"}
            label="出勤来源"
            onClick={() => setSource("attendance")}
          />
          <SourceTab
            active={source === "external_evidence"}
            label="外部证据"
            onClick={() => setSource("external_evidence")}
          />
          {mode === "manager" && (
            <SourceTab
              active={source === "manager_recognition"}
              label="经理等价认定"
              onClick={() => setSource("manager_recognition")}
            />
          )}
        </nav>

        {source === "attendance" && (
          <AttendanceSources
            candidates={workspace.attendanceCandidates}
            busy={phase === "saving"}
            onRecord={candidate => void recordAttendance(candidate)}
          />
        )}
        {source === "external_evidence" && (
          <ExternalEvidenceForm
            employees={workspace.employees}
            methods={externalMethods}
            draft={external}
            busy={phase === "saving"}
            onChange={setExternal}
            onSubmit={() => void recordExternal()}
          />
        )}
        {source === "manager_recognition" && mode === "manager" && (
          <RecognitionForm
            employees={workspace.employees}
            methods={recognitionMethods}
            draft={recognition}
            busy={phase === "saving"}
            onChange={setRecognition}
            onSubmit={() => void recordRecognition()}
          />
        )}

        {assessmentMethods.length > 0 && (
          <aside className="d4-assessment-boundary">
            <span>ASSESSMENT BOUNDARY</span>
            <strong>尚未接入受控考核证据</strong>
            <p>
              培训要求可定义考核完成方式，但 D4 不伪造考试、成绩或通过事实。
            </p>
          </aside>
        )}
      </section>

      <section className="d4-unavailable">
        <div>
          <span>OPERATING ANALYTICS BOUNDARY</span>
          <h2>任务、提醒、反馈与 KPI 尚未由完成事实生成</h2>
          <p>
            D4 只建立来源、核验、完成记录和撤销审计，不推导履行状态、
            Health、Forecast、Risk 或 AI 结论。
          </p>
        </div>
        <em>不可用不是零</em>
      </section>

      {reviewTarget && (
        <ReviewDialog
          evidence={reviewTarget}
          decision={reviewDecision}
          reason={reviewReason}
          supersedesId={supersedesId}
          revokedRecords={workspace.records.filter(
            record =>
              record.status === "revoked" &&
              record.employeeId === reviewTarget.employeeId &&
              record.requirementVersionId ===
                reviewTarget.requirementVersionId,
          )}
          busy={phase === "saving"}
          onDecision={setReviewDecision}
          onReason={setReviewReason}
          onSupersedes={setSupersedesId}
          onClose={() => setReviewTarget(null)}
          onSubmit={() => void reviewEvidence()}
        />
      )}

      {revocationTarget && (
        <RevocationDialog
          record={revocationTarget}
          reason={revocationReason}
          busy={phase === "saving"}
          onReason={setRevocationReason}
          onClose={() => setRevocationTarget(null)}
          onSubmit={() => void revokeCompletionRecord()}
        />
      )}
      </div>
    </AppShell>
  );
}

function EvidenceCard({
  evidence,
  busy,
  onReview,
}: {
  evidence: CompletionEvidenceFact;
  busy: boolean;
  onReview: (decision: CompletionReviewDecision) => void;
}) {
  return (
    <article className="d4-evidence-card">
      <header>
        <span className={`d4-source-tag ${evidence.sourceType}`}>
          {sourceLabel(evidence.sourceType)}
        </span>
        <time>{formatDate(evidence.evidenceDate)}</time>
      </header>
      <h3>{evidence.employeeName}</h3>
      <p>
        {evidence.employeeNumber} · {evidence.departmentName ?? "部门事实缺失"}
      </p>
      <dl>
        <div><dt>培训要求版本</dt><dd>{evidence.requirementName}</dd></div>
        <div>
          <dt>认可完成方式</dt>
          <dd>{evidence.acceptedLearningMethodLabel}</dd>
        </div>
        {evidence.courseVersionName && (
          <div><dt>课程版本</dt><dd>{evidence.courseVersionName}</dd></div>
        )}
        <div><dt>来源核对说明</dt><dd>{evidence.sourceSummary}</dd></div>
      </dl>
      {evidence.review ? (
        <aside className="d4-review-result">
          <strong>证据已拒绝</strong>
          <span>{evidence.review.reason}</span>
        </aside>
      ) : (
        <footer>
          <button
            type="button"
            disabled={busy}
            onClick={() => onReview("rejected")}
          >
            拒绝证据
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => onReview("accepted")}
          >
            接受证据
          </button>
        </footer>
      )}
    </article>
  );
}

function RecordCard({
  record,
  busy,
  onRevoke,
}: {
  record: CompletionRecordFact;
  busy: boolean;
  onRevoke: () => void;
}) {
  return (
    <article className={`d4-record-card ${record.status}`}>
      <header>
        <span>{record.status === "active" ? "有效完成事实" : "已撤销"}</span>
        <time>{formatDate(record.completedOn)}</time>
      </header>
      <h3>{record.employeeName}</h3>
      <p>
        {record.employeeNumber} · {record.departmentName ?? "部门事实缺失"}
      </p>
      <dl>
        <div><dt>培训要求版本</dt><dd>{record.requirementName}</dd></div>
        <div>
          <dt>认可完成方式</dt>
          <dd>{record.acceptedLearningMethodLabel}</dd>
        </div>
        <div><dt>来源</dt><dd>{sourceLabel(record.sourceType)}</dd></div>
        <div>
          <dt>有效至</dt>
          <dd>{record.validUntil ? formatDate(record.validUntil) : "未设有效期"}</dd>
        </div>
      </dl>
      {record.revocation ? (
        <aside className="d4-revocation">
          <strong>撤销原因</strong>
          <span>{record.revocation.reason}</span>
          <time>{formatDateTime(record.revocation.revokedAt)}</time>
        </aside>
      ) : (
        <footer>
          <span>核验于 {formatDateTime(record.verifiedAt)}</span>
          <button type="button" disabled={busy} onClick={onRevoke}>
            撤销完成记录
          </button>
        </footer>
      )}
    </article>
  );
}

function AttendanceSources({
  candidates,
  busy,
  onRecord,
}: {
  candidates: AttendanceCompletionCandidate[];
  busy: boolean;
  onRecord: (candidate: AttendanceCompletionCandidate) => void;
}) {
  if (candidates.length === 0) {
    return (
      <TruthfulEmpty
        title="当前没有可登记的出勤来源"
        body="只有已关闭登记册中的当前 Present 判定，且场次明确交付培训要求时，才可作为来源。"
      />
    );
  }
  return (
    <div className="d4-attendance-sources">
      {candidates.map(candidate => (
        <article key={candidate.attendanceDeterminationId}>
          <div>
            <span>{candidate.sessionCode} · {candidate.sessionName}</span>
            <strong>{candidate.employeeName}</strong>
            <small>
              {candidate.employeeNumber} ·{" "}
              {candidate.departmentName ?? "部门事实缺失"}
            </small>
          </div>
          <dl>
            <div><dt>要求</dt><dd>{candidate.requirementName}</dd></div>
            <div>
              <dt>完成方式</dt>
              <dd>{candidate.acceptedLearningMethodLabel}</dd>
            </div>
          </dl>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRecord(candidate)}
          >
            登记为待核验证据
          </button>
        </article>
      ))}
    </div>
  );
}

function ExternalEvidenceForm({
  employees,
  methods,
  draft,
  busy,
  onChange,
  onSubmit,
}: {
  employees: CompletionWorkspaceModel["employees"];
  methods: CompletionMethodOption[];
  draft: ExternalDraft;
  busy: boolean;
  onChange: (next: ExternalDraft) => void;
  onSubmit: () => void;
}) {
  if (methods.length === 0) {
    return (
      <TruthfulEmpty
        title="尚无已批准的外部证书完成方式"
        body="请先在培训要求版本中定义并生效外部证书方法。"
      />
    );
  }
  return (
    <form className="d4-form" onSubmit={event => {
      event.preventDefault();
      onSubmit();
    }}>
      <Field label="员工">
        <select
          value={draft.employeeId}
          onChange={event => onChange({ ...draft, employeeId: event.target.value })}
        >
          <option value="">请选择员工</option>
          {employees.map(employee => (
            <option value={employee.id} key={employee.id}>
              {employee.employeeNumber} · {employee.employeeName} ·{" "}
              {employee.departmentName ?? "部门待确认"}
            </option>
          ))}
        </select>
      </Field>
      <Field label="培训要求与认可方式">
        <select
          value={draft.methodId}
          onChange={event => onChange({ ...draft, methodId: event.target.value })}
        >
          <option value="">请选择认可完成方式</option>
          {methods.map(method => (
            <option value={method.id} key={method.id}>
              {method.requirementName} · {method.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="发证机构">
        <input
          value={draft.issuerName}
          onChange={event => onChange({ ...draft, issuerName: event.target.value })}
          placeholder="与原件一致"
        />
      </Field>
      <Field label="证书或凭证编号">
        <input
          value={draft.credentialReference}
          onChange={event =>
            onChange({ ...draft, credentialReference: event.target.value })}
          placeholder="仅授权角色可查看"
        />
      </Field>
      <Field label="发证日期">
        <input
          type="date"
          value={draft.issuedOn}
          onChange={event => onChange({ ...draft, issuedOn: event.target.value })}
        />
      </Field>
      <Field label="有效期（可选）">
        <input
          type="date"
          value={draft.expiresOn}
          onChange={event => onChange({ ...draft, expiresOn: event.target.value })}
        />
      </Field>
      <Field label="来源与核对说明" wide>
        <textarea
          value={draft.sourceSummary}
          onChange={event =>
            onChange({ ...draft, sourceSummary: event.target.value })}
          placeholder="说明证据来源，以及如何核对真实性和适用标准"
        />
      </Field>
      <footer>
        <p>保存后只形成待核验证据，不会自动形成 Completion。</p>
        <button type="submit" disabled={busy}>
          {busy ? "保存中…" : "登记外部证据"}
        </button>
      </footer>
    </form>
  );
}

function RecognitionForm({
  employees,
  methods,
  draft,
  busy,
  onChange,
  onSubmit,
}: {
  employees: CompletionWorkspaceModel["employees"];
  methods: CompletionMethodOption[];
  draft: RecognitionDraft;
  busy: boolean;
  onChange: (next: RecognitionDraft) => void;
  onSubmit: () => void;
}) {
  if (methods.length === 0) {
    return (
      <TruthfulEmpty
        title="尚无已批准的经理等价认定方式"
        body="只有培训要求版本明确允许等价认定时，酒店学习与发展经理才可登记证据。"
      />
    );
  }
  return (
    <form className="d4-form" onSubmit={event => {
      event.preventDefault();
      onSubmit();
    }}>
      <Field label="员工">
        <select
          value={draft.employeeId}
          onChange={event => onChange({ ...draft, employeeId: event.target.value })}
        >
          <option value="">请选择员工</option>
          {employees.map(employee => (
            <option value={employee.id} key={employee.id}>
              {employee.employeeNumber} · {employee.employeeName}
            </option>
          ))}
        </select>
      </Field>
      <Field label="培训要求与认可方式">
        <select
          value={draft.methodId}
          onChange={event => onChange({ ...draft, methodId: event.target.value })}
        >
          <option value="">请选择经理等价认定方式</option>
          {methods.map(method => (
            <option value={method.id} key={method.id}>
              {method.requirementName} · {method.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="认定日期">
        <input
          type="date"
          value={draft.recognitionDate}
          onChange={event =>
            onChange({ ...draft, recognitionDate: event.target.value })}
        />
      </Field>
      <Field label="认定依据" wide>
        <textarea
          value={draft.recognitionBasis}
          onChange={event =>
            onChange({ ...draft, recognitionBasis: event.target.value })}
          placeholder="引用已批准标准并说明核对依据；不得只写“经理同意”"
        />
      </Field>
      <footer>
        <p>经理认定仍是来源证据，随后必须完成显式核验。</p>
        <button type="submit" disabled={busy}>
          {busy ? "保存中…" : "登记经理等价认定"}
        </button>
      </footer>
    </form>
  );
}

function ReviewDialog({
  evidence,
  decision,
  reason,
  supersedesId,
  revokedRecords,
  busy,
  onDecision,
  onReason,
  onSupersedes,
  onClose,
  onSubmit,
}: {
  evidence: CompletionEvidenceFact;
  decision: CompletionReviewDecision;
  reason: string;
  supersedesId: string;
  revokedRecords: CompletionRecordFact[];
  busy: boolean;
  onDecision: (next: CompletionReviewDecision) => void;
  onReason: (next: string) => void;
  onSupersedes: (next: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="d4-modal-layer" role="presentation">
      <section
        className="d4-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="d4-review-title"
      >
        <header>
          <div>
            <span>AUTHORIZED EVIDENCE REVIEW</span>
            <h2 id="d4-review-title">
              {decision === "accepted" ? "接受证据" : "拒绝证据"}
            </h2>
            <p>{evidence.employeeName} · {evidence.requirementName}</p>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </header>
        <div className="d4-decision-picker">
          <button
            type="button"
            className={decision === "accepted" ? "active" : ""}
            onClick={() => onDecision("accepted")}
          >
            接受证据
            <small>形成新的不可变完成记录</small>
          </button>
          <button
            type="button"
            className={decision === "rejected" ? "active rejected" : ""}
            onClick={() => onDecision("rejected")}
          >
            拒绝证据
            <small>保留证据但不形成完成记录</small>
          </button>
        </div>
        <label>
          <span>核验理由</span>
          <textarea
            autoFocus
            value={reason}
            onChange={event => onReason(event.target.value)}
            placeholder="说明证据如何满足或不满足该培训要求版本的完成定义"
          />
        </label>
        {decision === "accepted" && revokedRecords.length > 0 && (
          <label>
            <span>更正链（可选）</span>
            <select
              value={supersedesId}
              onChange={event => onSupersedes(event.target.value)}
            >
              <option value="">不替代既有撤销记录</option>
              {revokedRecords.map(record => (
                <option value={record.id} key={record.id}>
                  替代 {formatDate(record.completedOn)} 的已撤销记录
                </option>
              ))}
            </select>
          </label>
        )}
        <footer>
          <button type="button" onClick={onClose}>取消</button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={onSubmit}
          >
            {busy ? "保存中…" : "确认核验决定"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function RevocationDialog({
  record,
  reason,
  busy,
  onReason,
  onClose,
  onSubmit,
}: {
  record: CompletionRecordFact;
  reason: string;
  busy: boolean;
  onReason: (next: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="d4-modal-layer" role="presentation">
      <section
        className="d4-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="d4-revoke-title"
      >
        <header>
          <div>
            <span>APPEND-ONLY CORRECTION</span>
            <h2 id="d4-revoke-title">撤销完成记录</h2>
            <p>{record.employeeName} · {record.requirementName}</p>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </header>
        <aside className="d4-warning">
          撤销不会删除或改写原记录。系统将保留原证据、核验人、时间与本次撤销原因。
        </aside>
        <label>
          <span>撤销原因</span>
          <textarea
            autoFocus
            value={reason}
            onChange={event => onReason(event.target.value)}
            placeholder="说明为什么原完成事实不再有效"
          />
        </label>
        <footer>
          <button type="button" onClick={onClose}>取消</button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={onSubmit}
          >
            {busy ? "保存中…" : "确认追加撤销事实"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function SourceTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "active" : ""}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={wide ? "wide" : ""}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function TruthfulEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="d4-empty">
      <span>TRUTHFUL EMPTY STATE</span>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function completionJudgment(
  workspace: CompletionWorkspaceModel,
  pendingCount: number,
) {
  if (pendingCount > 0) {
    return `有 ${pendingCount} 条来源证据等待授权核验，尚不能视为完成。`;
  }
  if (workspace.records.some(record => record.status === "active")) {
    return "当前完成事实均已核验；没有新的待处理证据。";
  }
  return "完成事实层已连接，但当前尚无经核验的完成记录。";
}

function sourceLabel(source: CompletionEvidenceFact["sourceType"]) {
  if (source === "attendance") return "Attendance";
  if (source === "external_evidence") return "外部证据";
  return "经理等价认定";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "无法完成当前操作。";
}
