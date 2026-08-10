"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ImportBatch,
  ImportRevertPreview,
} from "../../repositories/contracts/import-repository";

export function EmployeeUpdateHistory({
  history,
  state,
  isReviewData,
  onReload,
  onResume,
  onPreviewRevert,
  onRevert,
}: {
  history: readonly ImportBatch[];
  state: "loading" | "ready" | "failed";
  isReviewData: boolean;
  onReload: () => void;
  onResume: (batchId: string) => void;
  onPreviewRevert: (batchId: string) => Promise<ImportRevertPreview>;
  onRevert: (batchId: string, token: string) => Promise<void>;
}) {
  const [dialogBatch, setDialogBatch] = useState<ImportBatch | null>(null);
  const [preview, setPreview] = useState<ImportRevertPreview | null>(null);
  const [dialogState, setDialogState] = useState<"loading" | "ready" | "saving" | "failed">("loading");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  const closeDialog = () => {
    setDialogBatch(null);
    setPreview(null);
    setDialogError(null);
    queueMicrotask(() => returnFocus.current?.focus());
  };

  useEffect(() => {
    if (!dialogBatch) return;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDialog();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialogBatch]);

  const openRevert = async (batch: ImportBatch, trigger: HTMLElement) => {
    returnFocus.current = trigger;
    setDialogBatch(batch);
    setDialogState("loading");
    setDialogError(null);
    try {
      setPreview(await onPreviewRevert(batch.id));
      setDialogState("ready");
    } catch (reason) {
      setDialogError(message(reason));
      setDialogState("failed");
    }
  };

  const confirmRevert = async () => {
    if (!dialogBatch || !preview?.safe || !preview.token) return;
    setDialogState("saving");
    setDialogError(null);
    try {
      await onRevert(dialogBatch.id, preview.token);
      closeDialog();
    } catch (reason) {
      setDialogError(message(reason));
      setDialogState("failed");
    }
  };

  return (
    <>
      <section className="employee-update-history" id="update-history" aria-labelledby="employee-update-history-title">
        <header>
          <div><span>UPDATE EVIDENCE</span><h2 id="employee-update-history-title">更新记录</h2><p>{isReviewData ? "受保护评审数据，与真实酒店员工记录隔离。" : "当前酒店的文件、决定、预览、提交与撤销证据。"}</p></div>
          {state === "failed" && <button type="button" onClick={onReload}>重新读取</button>}
        </header>
        {state === "loading" && <div className="employee-stage-empty">正在读取更新记录…</div>}
        {state === "failed" && <div className="employee-stage-empty" role="alert"><strong>更新记录读取失败</strong><p>读取失败不代表当前酒店没有更新记录。</p></div>}
        {state === "ready" && history.length === 0 && <div className="employee-stage-empty"><strong>当前没有员工资料更新记录</strong><p>没有记录不等于员工主数据为空。</p></div>}
        {state === "ready" && history.length > 0 && (
          <div className="employee-history-list">
            {history.map(batch => (
              <article key={batch.id}>
                <div><strong>{batch.fileName}</strong><small>{formatDate(batch.createdAt)} · {isReviewData ? "评审批次" : "当前酒店"}</small></div>
                <span>{statusLabel(batch.status)}</span>
                {hasAuthoritativePreview(batch.status) ? (
                  <p><b>{displayCount(batch.summary.inserted)}</b> 新增 · <b>{displayCount(batch.summary.updated)}</b> 更新 · <b>{displayCount(batch.summary.unresolved)}</b> 未解决</p>
                ) : (
                  <p>处理中 · 更新预览尚未计算</p>
                )}
                {batch.status === "completed" || batch.status === "completed_with_warnings" ? (
                  <button type="button" onClick={event => void openRevert(batch, event.currentTarget)}>撤销预览</button>
                ) : batch.status === "reverted" ? (
                  <button type="button" onClick={() => onResume(batch.id)}>查看记录</button>
                ) : (
                  <button type="button" onClick={() => onResume(batch.id)}>继续处理</button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {dialogBatch && (
        <div className="dialog-backdrop employee-revert-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeDialog(); }}>
          <section className="dialog employee-revert-dialog" role="dialog" aria-modal="true" aria-labelledby="revert-dialog-title">
            <header><div><span>REVERSAL EVIDENCE</span><h2 id="revert-dialog-title">撤销预览</h2></div><button ref={closeButton} type="button" onClick={closeDialog} aria-label="关闭撤销预览">关闭</button></header>
            <p>撤销不会删除审计证据，也不会自动修改后来发生变化的员工记录。</p>
            {dialogState === "loading" && <div className="employee-stage-empty">正在校验撤销条件…</div>}
            {dialogError && <div className="employee-update-error" role="alert">{dialogError}</div>}
            {preview && (
              <div className="revert-evidence-card">
                <strong>{preview.safe ? "当前可安全撤销" : "当前不能直接撤销"}</strong>
                <p>{preview.strategy}</p>
                <span>{preview.conflicts} 个冲突</span>
                {preview.expiresAt && <small>预览有效至 {formatDate(preview.expiresAt)}</small>}
              </div>
            )}
            <footer><button type="button" className="quiet" onClick={closeDialog}>返回记录</button><button type="button" disabled={!preview?.safe || !preview.token || dialogState === "saving"} onClick={() => void confirmRevert()}>{dialogState === "saving" ? "正在撤销…" : "按预览执行撤销"}</button></footer>
          </section>
        </div>
      )}
    </>
  );
}

function statusLabel(status: string) {
  return ({
    mapping_required: "待确认",
    validating: "正在校验",
    ready_for_review: "待确认更新",
    completed: "已完成",
    completed_with_warnings: "完成但有警告",
    reverted: "已撤销",
    failed: "失败",
  } as Record<string, string>)[status] ?? status;
}

function hasAuthoritativePreview(status: string) {
  return status === "ready_for_review"
    || status === "completed"
    || status === "completed_with_warnings"
    || status === "reverted";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : "撤销预览读取失败";
}

function displayCount(value: number | null) {
  return value === null ? "—" : value;
}
