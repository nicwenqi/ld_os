"use client";

import { useMemo, useState } from "react";
import type {
  ImportSourceLabelResolution,
  PositionAttributionBatchDecision,
  PositionAttributionBatchPreview,
} from "../../repositories/contracts/import-repository";

export type AttributionTarget = { id: string; name: string; detail?: string };
export type AttributionDecision = {
  decision: "mapped" | "excluded" | "deferred";
  targetId: string;
};
export type AttributionDecisionState = Record<string, AttributionDecision>;

export function AttributionStep({
  type, items, targets, decisions, saving, onDecision, onBack, onSave,
  onBatchPreview, onBatchConfirm,
}: {
  type: "department" | "position";
  items: readonly ImportSourceLabelResolution[];
  targets: readonly AttributionTarget[];
  decisions: AttributionDecisionState;
  saving: boolean;
  onDecision: (sourceValue: string, decision: AttributionDecision) => void;
  onBack: () => void;
  onSave: () => void;
  onBatchPreview?: (decisions: readonly PositionAttributionBatchDecision[]) => Promise<PositionAttributionBatchPreview>;
  onBatchConfirm?: (previewHash: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [batchTargetId, setBatchTargetId] = useState("");
  const [batchPreview, setBatchPreview] = useState<PositionAttributionBatchPreview | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const isDepartment = type === "department";
  const businessName = isDepartment ? "部门" : "职位";
  const officialLanguage = isDepartment ? "正式部门" : "正式职位";
  const step = isDepartment ? "03" : "04";
  const unresolved = items.filter(item => item.decision === "pending" || item.decision === "deferred").length;
  const selectedItems = useMemo(
    () => items.filter(item => selected[item.sourceValue] && (item.decision === "pending" || item.decision === "deferred")),
    [items, selected],
  );
  const previewBatch = async (action: PositionAttributionBatchDecision["action"], overrides: Record<string, Partial<PositionAttributionBatchDecision>> = {}) => {
    if (!onBatchPreview || selectedItems.length === 0) return;
    if (action === "map" && !batchTargetId) return;
    setBatchBusy(true);
    try {
      const prior = new Map(batchPreview?.decisions.map(item => [item.sourceValue, item]));
      const preview = await onBatchPreview(selectedItems.map(item => {
        const previous = prior.get(item.sourceValue);
        const override = overrides[item.sourceValue];
        return {
          sourceValue: item.sourceValue,
          action: override?.action ?? (override?.targetPositionId ? "map" : override ? previous?.action ?? action : action),
          targetPositionId: override?.targetPositionId ?? (override ? previous?.targetPositionId ?? null : action === "map" ? batchTargetId : null),
          createDistinct: override?.createDistinct ?? false,
        };
      }));
      setBatchPreview(preview);
    } finally {
      setBatchBusy(false);
    }
  };
  const hasChoiceRequired = Boolean(batchPreview?.decisions.some(item => item.status === "same_name_requires_choice"));
  return (
    <section className="employee-update-stage attribution-step" aria-labelledby={`${type}-attribution-title`}>
      <header className="employee-stage-heading">
        <div>
          <span>{step} · {isDepartment ? "DEPARTMENT" : "POSITION"} ATTRIBUTION</span>
          <h2 id={`${type}-attribution-title`}>{businessName}归属确认</h2>
          <p>把工作簿来源值连接到酒店{officialLanguage}。系统不自动猜测缺失或不明确的归属。</p>
        </div>
        <em>{unresolved} 个来源值待决定</em>
      </header>

      {!isDepartment && onBatchPreview && (
        <section className="attribution-batch" aria-label="批量职位归属初始化">
          <div><strong>批量职位归属初始化</strong><p>已选 {selectedItems.length} 个来源职位，影响 {selectedItems.reduce((sum, item) => sum + item.sourceRowCount, 0)} 名员工行。先预览，后确认；不会写入员工主数据。</p></div>
          <div className="attribution-batch-actions">
            <button type="button" className="quiet" disabled={batchBusy || selectedItems.length === 0} onClick={() => void previewBatch("create")}>预览创建正式职位</button>
            <label><span>批量关联至已有职位</span><select value={batchTargetId} onChange={event => setBatchTargetId(event.target.value)}><option value="">选择正式职位</option>{targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>
            <button type="button" className="quiet" disabled={batchBusy || selectedItems.length === 0 || !batchTargetId} onClick={() => void previewBatch("map")}>预览批量关联</button>
          </div>
          {batchPreview && <div className="attribution-batch-preview" role="status">
            <strong>批量预览 · {batchPreview.summary.sourceLabels} 个来源职位 / {batchPreview.summary.affectedRows} 名员工行</strong>
            {batchPreview.decisions.map(item => <p key={item.sourceValue}><b>{item.sourceValue}</b>：{item.action === "create" ? "创建正式职位" : "关联已有职位"} · {item.affectedRows} 行{item.reason ? ` · ${item.reason}` : ""}</p>)}
            {hasChoiceRequired ? <div className="attribution-choice"><p>同名职位不会自动合并。请逐项明确选择。</p>{batchPreview.decisions.filter(item => item.status === "same_name_requires_choice").map(item => <div key={item.sourceValue}><span>{item.sourceValue}</span>{item.matchingPositions?.map(target => <button type="button" className="quiet" key={target.id} disabled={batchBusy} onClick={() => void previewBatch("map", { [item.sourceValue]: { action: "map", targetPositionId: target.id } })}>关联“{target.name}”</button>)}<button type="button" className="quiet" disabled={batchBusy} onClick={() => void previewBatch("create", { [item.sourceValue]: { createDistinct: true } })}>明确新建独立职位</button></div>)}</div> : <button type="button" disabled={batchBusy || !onBatchConfirm} onClick={() => void (async () => { setBatchBusy(true); try { await onBatchConfirm?.(batchPreview.previewHash); setBatchPreview(null); setSelected({}); } finally { setBatchBusy(false); } })()}>确认批量决定</button>}
          </div>}
        </section>
      )}

      {items.length === 0 ? <div className="employee-stage-empty"><strong>没有需要确认的{businessName}来源值</strong><p>这表示当前批次没有可用来源值，不代表组织资料为零。</p></div> : <div className="attribution-list">
        {items.map(item => {
          const pending = decisions[item.sourceValue];
          const decision = pending?.decision ?? (item.decision === "pending" ? "deferred" : item.decision);
          const targetId = pending?.targetId ?? item.targetId ?? "";
          return <article key={item.sourceValue} className={`${!isDepartment ? "position-attribution-row " : ""}${item.decision === "mapped" && !pending ? "resolved" : ""}`}>
            {!isDepartment && <label className="attribution-select"><input type="checkbox" checked={Boolean(selected[item.sourceValue])} disabled={item.decision === "mapped"} onChange={event => setSelected(current => ({ ...current, [item.sourceValue]: event.target.checked }))} /><span className="sr-only">选择 {item.sourceValue} 进行批量处理</span></label>}
            <div><span>来源值</span><strong>{item.sourceValue}</strong><small>{item.sourceRowCount} 个影响员工行</small></div>
            <label><span>处理决定</span><select value={decision} onChange={event => onDecision(item.sourceValue, { decision: event.target.value as AttributionDecision["decision"], targetId })}><option value="mapped">关联{officialLanguage}</option><option value="excluded">排除相关行</option><option value="deferred">延后处理</option></select></label>
            <label><span>{officialLanguage}</span><select value={targetId} disabled={decision !== "mapped"} onChange={event => onDecision(item.sourceValue, { decision: "mapped", targetId: event.target.value })}><option value="">请选择{officialLanguage}</option>{targets.map(target => <option key={target.id} value={target.id}>{target.name}{target.detail ? ` · ${target.detail}` : ""}</option>)}</select></label>
            <em>{pending ? "有未保存决定" : item.decision === "mapped" ? `已确认 · ${item.decisionMode === "create" ? "批量创建" : "关联"}` : item.decision === "excluded" ? "已排除" : "待处理"}</em>
          </article>;
        })}
      </div>}
      <div className="attribution-guidance"><strong>判断边界</strong><p>无法确认时请选择“延后处理”，或明确排除相关行；不要为了通过检查而猜测归属。</p></div>
      <footer className="employee-stage-actions split"><button type="button" className="quiet" onClick={onBack}>返回上一步</button><span>单项特殊处理会逐项写入决定，并在每次写入后校验批次版本</span><button type="button" disabled={saving || Object.keys(decisions).length === 0} onClick={onSave}>{saving ? "保存中…" : `保存${businessName}归属`}</button></footer>
    </section>
  );
}
