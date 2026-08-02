"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AdministrationSaveState,
  savedTime,
  type AdministrationSavePhase,
  useUnsavedChangesWarning,
} from "../components/administration/AdministrationSaveState";
import {
  AttributionStep,
  type AttributionDecisionState,
  type AttributionTarget,
} from "../components/import/AttributionStep";
import {
  EmployeeUpdateHistory,
} from "../components/import/EmployeeUpdateHistory";
import {
  EmployeeUpdatePreviewStep,
} from "../components/import/EmployeeUpdatePreviewStep";
import {
  EmployeeUpdateProgress,
  type EmployeeUpdateStep,
} from "../components/import/EmployeeUpdateProgress";
import {
  FieldRecognitionStep,
  type FieldDecisionState,
} from "../components/import/FieldRecognitionStep";
import {
  FileInspectionStep,
  type ProductionInspection,
} from "../components/import/FileInspectionStep";
import {
  IssueResolutionStep,
  type IssueDecision,
  type IssueDecisionState,
} from "../components/import/IssueResolutionStep";
import { DataStateBadge } from "../components/operations/DataStateBadge";
import { AppShell } from "../components/shell/AppShell";
import { ProtectedAppProviders } from "../providers";
import type {
  EmployeeImportPreviewOptions,
  EmployeeUpdatePreview,
  ImportBatch,
  ImportFieldMappingDecision,
  ImportIssueResolution,
  ImportRevertPreview,
} from "../repositories/contracts/import-repository";
import { ImportRepositoryError } from "../repositories/contracts/import-repository";
import type { DepartmentNode } from "../repositories/contracts/organization-models";
import { createRepositoryRegistry } from "../repositories/registry";
import {
  createEmployeeUpdateDecisionDraft,
  createImportService,
  type EmployeeUpdateWorkflow,
} from "../services/import-service";
import type { EmployeeBaselineClassification } from "../services/pilot-employee-baseline";
import { useAuthSession } from "../state/auth-session";

const approvedStepLabels = "文件检查 · 字段识别 · 部门归属确认 · 职位归属确认 · 数据问题处理 · 更新预览 · 确认更新";

const REVIEW_INSPECTION: ProductionInspection = {
  batchId: "review-batch",
  status: "mapping_required",
  sanitizedFilename: "review_employee_master.xlsx",
  checksumPrefix: "review-only",
  sizeBytes: 24_576,
  detectedSheets: [{ name: "Employee Master", rowCount: 122, columnCount: 9, hidden: false }],
  selectedSheet: "Employee Master",
  headerRow: 3,
  sourceRows: 118,
  structurallyValid: 116,
  blockedRows: 2,
  warningRows: 0,
  uniqueDepartmentLabels: 2,
  uniquePositionLabels: 2,
  employeesImported: 0,
  trainingHistoryImported: false,
  ctcGtcImported: false,
  organizationCandidates: {
    employees: 118,
    departments: 2,
    positions: 2,
    bands: 2,
    trainees: 0,
    unresolvedEmployees: 2,
  },
  exclusions: {
    totalColumns: 4,
    formulaDerivedColumns: 2,
    trainingHistoryAndSensitiveColumns: 4,
  },
};

function EmployeeDataUpdateContent() {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const importService = useMemo(() => createImportService(registry.import), [registry.import]);
  const { session } = useAuthSession();
  const isReviewData = registry.environment.dataMode === "mock";
  const isRealMode = !isReviewData;

  const [history, setHistory] = useState<readonly ImportBatch[]>([]);
  const [historyState, setHistoryState] = useState<"loading" | "ready" | "failed">("loading");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<ProductionInspection | null>(isReviewData ? REVIEW_INSPECTION : null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<EmployeeUpdateWorkflow | null>(null);
  const [workflowState, setWorkflowState] = useState<"loading" | "ready" | "failed">("loading");
  const [activeStep, setActiveStep] = useState<EmployeeUpdateStep>(1);
  const [fieldDecisions, setFieldDecisions] = useState<FieldDecisionState>({});
  const [departmentDecisions, setDepartmentDecisions] = useState<AttributionDecisionState>({});
  const [positionDecisions, setPositionDecisions] = useState<AttributionDecisionState>({});
  const [issueDecisions, setIssueDecisions] = useState<IssueDecisionState>({});
  const [departments, setDepartments] = useState<AttributionTarget[]>([]);
  const [positions, setPositions] = useState<AttributionTarget[]>([]);
  const [preview, setPreview] = useState<EmployeeUpdatePreview | null>(null);
  const [statusTreatment, setStatusTreatment] = useState<EmployeeImportPreviewOptions["statusTreatment"]>("retain_existing_set_additions_active");
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [acknowledged, setAcknowledged] = useState(false);
  const [baseline, setBaseline] = useState<EmployeeBaselineClassification | null>(null);
  const [auditCount, setAuditCount] = useState<number | null>(null);
  const [phase, setPhase] = useState<AdministrationSavePhase>("pristine");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);

  const dirty = phase === "dirty" || acknowledged;
  useUnsavedChangesWarning(dirty, "员工资料更新有尚未保存或确认的决定");

  const resolvePropertyId = useCallback(async () => {
    if (isRealMode) return session.propertyId;
    return (await registry.property.resolveContext("training-demo.example.test"))?.propertyId ?? null;
  }, [isRealMode, registry.property, session.propertyId]);

  const readHistory = useCallback(async () => {
    const propertyId = await resolvePropertyId();
    if (!propertyId) throw new Error("当前账号尚未取得酒店上下文");
    return registry.import.listImportHistory(propertyId);
  }, [registry.import, resolvePropertyId]);

  const initializeWorkflow = useCallback((next: EmployeeUpdateWorkflow) => {
    setWorkflow(next);
    setHistory(current => current.map(batch => (
      batch.id === next.batch.id ? next.batch : batch
    )));
    setFieldDecisions(fieldDecisionsFrom(next));
    setDepartmentDecisions({});
    setPositionDecisions({});
    setIssueDecisions({});
    setAcknowledged(false);
    setBaseline(next.batch.baseline ? {
      state: next.batch.baseline.state,
      departmentId: next.batch.baseline.departmentId,
      includeDescendants: next.batch.baseline.includeDescendants,
      limitations: next.batch.baseline.limitations,
    } : null);
    setAuditCount(null);
    if (next.batch.status === "ready_for_review" && next.preview) {
      setPreview(next.preview);
      setEffectiveDate(next.preview.effectiveDate);
    } else if (next.batch.status !== "completed" && next.batch.status !== "completed_with_warnings") {
      setPreview(null);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryState("loading");
    try {
      const next = await readHistory();
      setHistory(next);
      setHistoryState("ready");
      return next;
    } catch {
      setHistory([]);
      setHistoryState("failed");
      return [];
    }
  }, [readHistory]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      try {
        const propertyId = await resolvePropertyId();
        if (!propertyId) throw new Error("当前账号尚未取得酒店员工资料上下文");
        const [nextHistory, tree, nextPositions] = await Promise.all([
          readHistory(),
          registry.department.listTree(propertyId),
          registry.position.listPositions(propertyId),
        ]);
        if (!active) return;
        setHistory(nextHistory);
        setHistoryState("ready");
        setDepartments(departmentTargets(tree));
        setPositions(nextPositions.filter(item => item.isActive).map(item => ({
          id: item.id,
          name: item.nameZh,
          detail: item.nameEn ?? item.code,
        })));
        if (isReviewData && nextHistory[0]) {
          const nextWorkflow = await importService.resume(nextHistory[0].id);
          if (!active) return;
          initializeWorkflow(nextWorkflow);
        }
        setWorkflowState("ready");
      } catch (reason) {
        if (!active) return;
        setWorkflowState("failed");
        setHistoryState("failed");
        setStatusMessage(message(reason));
        setPhase("failed");
      }
    })();
    return () => { active = false; };
  }, [importService, initializeWorkflow, isReviewData, readHistory, registry.department, registry.position, resolvePropertyId]);

  const markDirty = (note: string) => {
    setPhase("dirty");
    setSavedAt(null);
    setStatusMessage(note);
    setRetryAction(null);
  };

  const markSaved = (note: string) => {
    setPhase("saved");
    setSavedAt(savedTime());
    setStatusMessage(note);
    setRetryAction(null);
  };

  const handleFailure = (reason: unknown, retry: () => void) => {
    const conflict = reason instanceof ImportRepositoryError && reason.conflict !== null;
    setPhase(conflict ? "conflict" : "failed");
    setStatusMessage(message(reason));
    setRetryAction(conflict ? null : () => retry);
  };

  const reloadLatest = async () => {
    if (!workflow) return;
    try {
      setPhase("saving");
      const next = await importService.resume(workflow.batch.id);
      initializeWorkflow(next);
      setActiveStep(stepForWorkflow(next));
      setPhase("pristine");
      setSavedAt(null);
      setStatusMessage("已读取服务器中的最新员工资料更新状态");
    } catch (reason) {
      handleFailure(reason, () => void reloadLatest());
    }
  };

  const inspectSelectedFile = async () => {
    if (!selectedFile || isReviewData) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      const response = await fetch("/api/import/inspect", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "工作簿检查失败");
      const nextInspection = payload as ProductionInspection;
      const nextWorkflow = await importService.resume(nextInspection.batchId);
      setInspection(nextInspection);
      initializeWorkflow(nextWorkflow);
      setWorkflowState("ready");
      markSaved("文件已检查并从服务器重新读取；员工主表仍为零写入");
      await loadHistory();
    } catch (reason) {
      setUploadError(message(reason));
    } finally {
      setUploading(false);
    }
  };

  const saveFieldMappings = async () => {
    if (!workflow) return;
    try {
      setPhase("saving");
      setStatusMessage("正在保存字段识别并重新读取服务器状态");
      const decisions = workflow.fieldMappings.map(mapping => fieldDecisions[mapping.id] ?? ({
        mappingId: mapping.id,
        mappingStatus: mapping.mappingStatus === "excluded" ? "excluded" : "confirmed",
        targetField: mapping.targetField,
        transformationRule: mapping.transformationRule,
      } satisfies ImportFieldMappingDecision));
      const next = await importService.confirmFieldMappings(workflow.batch.id, workflow.batch.version, decisions);
      initializeWorkflow(next);
      setActiveStep(3);
      markSaved("字段识别已保存并重新读取");
    } catch (reason) {
      handleFailure(reason, () => void saveFieldMappings());
    }
  };

  const saveAttributions = async (type: "department" | "position") => {
    if (!workflow) return;
    const decisions = type === "department" ? departmentDecisions : positionDecisions;
    const invalid = Object.values(decisions).some(item => item.decision === "mapped" && !item.targetId);
    if (invalid) {
      setPhase("failed");
      setStatusMessage(`请选择要关联的正式${type === "department" ? "部门" : "职位"}`);
      return;
    }
    let savedDecisions = 0;
    try {
      setPhase("saving");
      setStatusMessage(`正在保存${type === "department" ? "部门" : "职位"}归属并逐项校验版本`);
      let next = workflow;
      for (const [sourceValue, decision] of Object.entries(decisions)) {
        next = await importService.resolveSourceLabel(
          next.batch.id,
          next.batch.version,
          type,
          sourceValue,
          decision.decision === "mapped" ? decision.targetId : null,
          decision.decision,
        );
        savedDecisions += 1;
      }
      initializeWorkflow(next);
      setActiveStep(type === "department" ? 4 : 5);
      markSaved(`${type === "department" ? "部门" : "职位"}归属已保存并重新读取`);
    } catch (reason) {
      if (savedDecisions > 0) {
        setPhase("conflict");
        setStatusMessage(`已有 ${savedDecisions} 项决定保存成功，后续保存中断；请读取最新批次后继续`);
        setRetryAction(null);
      } else {
        handleFailure(reason, () => void saveAttributions(type));
      }
    }
  };

  const previewPositionAttributionBatch = async (decisions: Parameters<typeof importService.previewPositionAttributionBatch>[2]) => {
    if (!workflow) throw new Error("请先读取员工资料更新批次");
    try {
      setPhase("saving");
      setStatusMessage("正在生成批量职位归属预览；员工主数据仍保持零写入");
      const result = await importService.previewPositionAttributionBatch(workflow.batch.id, workflow.batch.version, decisions);
      setPhase("pristine");
      setStatusMessage("批量职位归属预览已生成，请确认后再写入归属决定");
      return result.preview;
    } catch (reason) {
      setPhase("failed");
      setStatusMessage(message(reason));
      throw reason;
    }
  };

  const confirmPositionAttributionBatch = async (previewHash: string) => {
    if (!workflow) throw new Error("请先读取员工资料更新批次");
    try {
      setPhase("saving");
      setStatusMessage("正在确认批量职位归属并重新读取服务器状态");
      const next = await importService.confirmPositionAttributionBatch(workflow.batch.id, workflow.batch.version, previewHash);
      initializeWorkflow(next);
      setPhase("saved");
      setSavedAt(savedTime());
      setStatusMessage("批量职位归属已确认；员工主数据尚未写入");
    } catch (reason) {
      handleFailure(reason, () => void confirmPositionAttributionBatch(previewHash));
      throw reason;
    }
  };

  const saveIssueResolutions = async () => {
    if (!workflow) return;
    const invalid = Object.entries(issueDecisions).some(([issueId, decision]) => {
      const issue = workflow.issues.find(item => item.id === issueId);
      return decision.action === "corrected"
        && (issue?.type === "unresolved_department" || issue?.type === "unresolved_position")
        && !decision.targetId;
    });
    if (invalid) {
      setPhase("failed");
      setStatusMessage("明确更正时必须选择正式部门或职位");
      return;
    }
    let savedDecisions = 0;
    try {
      setPhase("saving");
      setStatusMessage("正在保存逐行问题处理并重新读取服务器状态");
      let next = workflow;
      for (const [issueId, decision] of Object.entries(issueDecisions)) {
        const issue = next.issues.find(item => item.id === issueId);
        const resolution = issueResolution(issue?.type ?? "", decision);
        next = await importService.resolveIssue(next.batch.id, next.batch.version, issueId, resolution);
        savedDecisions += 1;
      }
      initializeWorkflow(next);
      setActiveStep(6);
      markSaved("数据问题处理已保存并重新读取");
    } catch (reason) {
      if (savedDecisions > 0) {
        setPhase("conflict");
        setStatusMessage(`已有 ${savedDecisions} 个问题处理决定保存成功，后续保存中断；请读取最新批次后继续`);
        setRetryAction(null);
      } else {
        handleFailure(reason, () => void saveIssueResolutions());
      }
    }
  };

  const preparePreview = async () => {
    if (!workflow) return;
    try {
      setPhase("saving");
      setStatusMessage("正在计算零写入预览并绑定批次版本");
      const prepared = await importService.preparePreview(
        workflow.batch.id,
        workflow.batch.version,
        { statusTreatment, effectiveDate },
        createEmployeeUpdateDecisionDraft(workflow),
      );
      initializeWorkflow(prepared.workflow);
      setPreview(prepared.preview);
      setActiveStep(7);
      markSaved("零写入预览已保存并重新读取；员工主表尚未更新");
    } catch (reason) {
      handleFailure(reason, () => void preparePreview());
    }
  };

  const confirmUpdate = async () => {
    if (!workflow || !preview) return;
    if (!baseline) {
      setPhase("failed");
      setStatusMessage("请先选择员工基线分类与适用范围");
      return;
    }
    try {
      setPhase("saving");
      setStatusMessage("正在事务提交员工主数据并读取审计证据");
      const result = await importService.confirmUpdate(
        workflow.batch.id,
        workflow.batch.version,
        { acknowledged, previewHash: preview.previewHash, baseline },
        createEmployeeUpdateDecisionDraft(workflow),
      );
      const authoritative = await importService.resume(workflow.batch.id);
      initializeWorkflow(authoritative);
      setPreview(preview);
      setAuditCount(result.audit.length);
      setAcknowledged(false);
      await loadHistory();
      markSaved("员工主数据已事务提交，并重新读取批次与审计证据");
    } catch (reason) {
      handleFailure(reason, () => void confirmUpdate());
    }
  };

  const resumeBatch = async (batchId: string) => {
    if (dirty && !window.confirm("当前有未保存决定，是否放弃并读取所选批次？")) return;
    try {
      setWorkflowState("loading");
      const next = await importService.resume(batchId);
      initializeWorkflow(next);
      setInspection(isReviewData ? REVIEW_INSPECTION : null);
      setActiveStep(stepForWorkflow(next));
      setWorkflowState("ready");
      setPhase("pristine");
      setSavedAt(null);
      setStatusMessage("已从更新记录读取所选批次");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (reason) {
      setWorkflowState("failed");
      handleFailure(reason, () => void resumeBatch(batchId));
    }
  };

  const previewRevert = (batchId: string): Promise<ImportRevertPreview> => importService.previewRevert(batchId);
  const revertBatch = async (batchId: string, token: string) => {
    await importService.revert(batchId, token);
    await loadHistory();
    if (workflow?.batch.id === batchId) {
      const next = await importService.resume(batchId);
      initializeWorkflow(next);
      setActiveStep(7);
      markSaved("批次已按受保护预览撤销，并重新读取审计状态");
    }
  };

  const availableStep = availableStepFor(workflow);
  const committed = workflow?.batch.status === "completed" || workflow?.batch.status === "completed_with_warnings";
  const reverted = workflow?.batch.status === "reverted";

  return (
    <AppShell>
      <div className="page-wrap recovery-c-employee-update">
        <header className="ops-header employee-update-hero">
          <div><span>员工主数据 · EMPLOYEE MASTER</span><h1>员工资料更新</h1><p>{session.propertyNameZh ?? "当前酒店"} · 从文件证据到明确确认的受控员工主数据更新；培训历史与 CTC/GTC 始终排除。</p></div>
          <div><DataStateBadge state={isReviewData ? "demo" : "real"} /><Link href="/people">返回员工中心</Link></div>
        </header>

        <section className="employee-update-assurance">
          <div><span>当前判断</span><h2>{workflow ? "批次已受控暂存，员工主数据仅在最终确认后更新" : "先建立可信文件证据，再决定是否更新员工主数据"}</h2><p>检查、经理决定、零写入预览与提交结果相互分离。</p></div>
          <article><strong>0</strong><span>自动创建账号</span><small>普通员工不是后台用户</small></article>
          <article><strong>{workflow?.batch.version ?? "—"}</strong><span>批次版本</span><small>每次决定均检查并发</small></article>
          <article><strong>{isReviewData ? "评审" : "真实"}</strong><span>数据边界</span><small>{isReviewData ? "受保护评审数据" : "当前酒店私有数据"}</small></article>
        </section>

        <p className="employee-update-sequence">{approvedStepLabels}</p>
        <EmployeeUpdateProgress activeStep={activeStep} availableStep={availableStep} onSelect={step => { if (step <= availableStep) setActiveStep(step); }} />

        <div className="employee-update-statebar">
          <AdministrationSaveState
            phase={phase}
            savedAt={savedAt}
            message={statusMessage}
            onRetry={retryAction ?? undefined}
            onReload={() => void reloadLatest()}
          />
          <span>{isReviewData ? "受保护评审数据 · 绝不会在 Production 静默启用" : "真实酒店数据 · 权威服务器状态"}</span>
        </div>

        {workflowState === "failed" && !workflow && (
          <section className="employee-update-stage employee-stage-empty" role="alert"><strong>员工资料更新基础读取失败</strong><p>{statusMessage}</p><button type="button" onClick={() => window.location.reload()}>重新加载页面</button></section>
        )}

        {activeStep === 1 && (
          <FileInspectionStep
            isReviewData={isReviewData}
            selectedFile={selectedFile}
            inspection={inspection}
            batchFileName={workflow?.batch.fileName}
            uploading={uploading}
            error={uploadError}
            onFileChange={file => { setSelectedFile(file); setInspection(null); setUploadError(null); }}
            onInspect={() => void inspectSelectedFile()}
            onContinue={() => setActiveStep(2)}
          />
        )}

        {activeStep === 2 && workflow && (
          <FieldRecognitionStep
            mappings={workflow.fieldMappings}
            decisions={fieldDecisions}
            saving={phase === "saving"}
            onDecision={decision => { setFieldDecisions(current => ({ ...current, [decision.mappingId]: decision })); markDirty("字段识别有未保存更改"); }}
            onBack={() => setActiveStep(1)}
            onSave={() => void saveFieldMappings()}
          />
        )}

        {activeStep === 3 && workflow && (
          <AttributionStep
            type="department"
            items={workflow.departmentLabels}
            targets={departments}
            decisions={departmentDecisions}
            saving={phase === "saving"}
            onDecision={(sourceValue, decision) => { setDepartmentDecisions(current => ({ ...current, [sourceValue]: decision })); markDirty("部门归属有未保存决定"); }}
            onBack={() => setActiveStep(2)}
            onSave={() => void saveAttributions("department")}
          />
        )}

        {activeStep === 4 && workflow && (
          <AttributionStep
            type="position"
            items={workflow.positionLabels}
            targets={positions}
            decisions={positionDecisions}
            saving={phase === "saving"}
            onDecision={(sourceValue, decision) => { setPositionDecisions(current => ({ ...current, [sourceValue]: decision })); markDirty("职位归属有未保存决定"); }}
            onBack={() => setActiveStep(3)}
            onSave={() => void saveAttributions("position")}
            onBatchPreview={previewPositionAttributionBatch}
            onBatchConfirm={confirmPositionAttributionBatch}
          />
        )}

        {activeStep === 5 && workflow && (
          <IssueResolutionStep
            issues={workflow.issues}
            departments={departments}
            positions={positions}
            decisions={issueDecisions}
            saving={phase === "saving"}
            onDecision={(issueId, decision) => { setIssueDecisions(current => ({ ...current, [issueId]: decision })); markDirty("数据问题处理有未保存决定"); }}
            onBack={() => setActiveStep(4)}
            onSave={() => void saveIssueResolutions()}
          />
        )}

        {(activeStep === 6 || activeStep === 7) && workflow && !reverted && (
          <EmployeeUpdatePreviewStep
            mode={activeStep === 6 ? "preview" : "confirmation"}
            preview={preview}
            committed={committed}
            auditCount={auditCount}
            statusTreatment={statusTreatment}
            effectiveDate={effectiveDate}
            acknowledged={acknowledged}
            baseline={baseline}
            departments={departments}
            saving={phase === "saving"}
            onStatusTreatment={value => { setStatusTreatment(value); setPreview(null); setActiveStep(6); markDirty("员工状态处理方式尚未写入预览"); }}
            onEffectiveDate={value => { setEffectiveDate(value); setPreview(null); setActiveStep(6); markDirty("资料生效日尚未写入预览"); }}
            onAcknowledged={value => { setAcknowledged(value); if (value) markDirty("已准备确认本次员工主数据更新"); else setPhase("saved"); }}
            onBaselineChange={value => { setBaseline(value); setAcknowledged(false); markDirty("员工基线分类有未保存更改"); }}
            onBack={() => setActiveStep(5)}
            onPrepare={() => void preparePreview()}
            onConfirm={() => void confirmUpdate()}
          />
        )}

        {activeStep === 7 && reverted && (
          <section className="employee-update-stage employee-update-complete"><span>已撤销</span><h2>本批次已按受保护预览撤销</h2><p>审计证据仍然保留；员工中心展示撤销后的当前权威状态。</p><div><Link href="/people">前往员工中心核对</Link><a href="#update-history">查看更新记录</a></div></section>
        )}

        {activeStep > 1 && !workflow && workflowState !== "failed" && (
          <section className="employee-update-stage employee-stage-empty"><strong>尚未建立员工资料更新批次</strong><p>请先完成文件检查，或从更新记录继续已有批次。</p><button type="button" onClick={() => setActiveStep(1)}>返回文件检查</button></section>
        )}

        <EmployeeUpdateHistory
          history={history}
          state={historyState}
          isReviewData={isReviewData}
          onReload={() => void loadHistory()}
          onResume={batchId => void resumeBatch(batchId)}
          onPreviewRevert={previewRevert}
          onRevert={revertBatch}
        />

        <footer className="foundation-work-links"><Link href="/people">返回员工中心</Link><Link href="/data-quality">查看数据质量</Link></footer>
      </div>
    </AppShell>
  );
}

function fieldDecisionsFrom(workflow: EmployeeUpdateWorkflow): FieldDecisionState {
  return Object.fromEntries(workflow.fieldMappings.map(mapping => [mapping.id, {
    mappingId: mapping.id,
    mappingStatus: mapping.mappingStatus === "excluded" ? "excluded" : "confirmed",
    targetField: mapping.targetField,
    transformationRule: mapping.transformationRule,
  }]));
}

function departmentTargets(tree: readonly DepartmentNode[]): AttributionTarget[] {
  return [...tree]
    .filter(item => item.isActive)
    .sort((left, right) => left.pathIds.join("/").localeCompare(right.pathIds.join("/"), "zh-CN"))
    .map(item => ({
      id: item.id,
      name: `${"　".repeat(Math.max(0, item.depth - 1))}${item.nameZh}`,
      detail: item.nameEn ?? item.code ?? undefined,
    }));
}

function issueResolution(type: string, decision: IssueDecision): ImportIssueResolution {
  if (decision.action !== "corrected") return { status: decision.action };
  const field = type === "unresolved_department" ? "department_id" : "position_id";
  return { status: "corrected", payload: { normalizedValues: { [field]: decision.targetId } } };
}

function stepForWorkflow(workflow: EmployeeUpdateWorkflow): EmployeeUpdateStep {
  if (workflow.batch.status === "completed" || workflow.batch.status === "completed_with_warnings" || workflow.batch.status === "reverted") return 7;
  if (workflow.fieldMappings.length === 0 || workflow.fieldMappings.some(item => item.mappingStatus === "suggested")) return 2;
  if (workflow.departmentLabels.some(item => item.decision === "pending" || item.decision === "deferred")) return 3;
  if (workflow.positionLabels.some(item => item.decision === "pending" || item.decision === "deferred")) return 4;
  if (workflow.issues.some(item => item.severity === "error" && (item.resolutionStatus === "unresolved" || item.resolutionStatus === "deferred"))) return 5;
  if (workflow.batch.status === "ready_for_review") return 7;
  return 6;
}

function availableStepFor(workflow: EmployeeUpdateWorkflow | null): EmployeeUpdateStep {
  if (!workflow) return 1;
  return stepForWorkflow(workflow);
}

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : "员工资料更新失败";
}

export default function ImportCenter() {
  return <ProtectedAppProviders><EmployeeDataUpdateContent /></ProtectedAppProviders>;
}
