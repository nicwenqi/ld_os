import type { ImportSourceLabelResolution } from "../../repositories/contracts/import-repository";

export type AttributionTarget = { id: string; name: string; detail?: string };
export type AttributionDecision = {
  decision: "mapped" | "excluded" | "deferred";
  targetId: string;
};
export type AttributionDecisionState = Record<string, AttributionDecision>;

export function AttributionStep({
  type,
  items,
  targets,
  decisions,
  saving,
  onDecision,
  onBack,
  onSave,
}: {
  type: "department" | "position";
  items: readonly ImportSourceLabelResolution[];
  targets: readonly AttributionTarget[];
  decisions: AttributionDecisionState;
  saving: boolean;
  onDecision: (sourceValue: string, decision: AttributionDecision) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  const isDepartment = type === "department";
  const businessName = isDepartment ? "部门" : "职位";
  const officialLanguage = isDepartment ? "正式部门" : "正式职位";
  const step = isDepartment ? "03" : "04";
  const unresolved = items.filter(item => item.decision === "pending" || item.decision === "deferred").length;
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

      {items.length === 0 ? (
        <div className="employee-stage-empty"><strong>没有需要确认的{businessName}来源值</strong><p>这表示当前批次没有可用来源值，不代表组织资料为零。</p></div>
      ) : (
        <div className="attribution-list">
          {items.map(item => {
            const pending = decisions[item.sourceValue];
            const decision = pending?.decision ?? (item.decision === "pending" ? "deferred" : item.decision);
            const targetId = pending?.targetId ?? item.targetId ?? "";
            return (
              <article key={item.sourceValue} className={item.decision === "mapped" && !pending ? "resolved" : ""}>
                <div><span>来源值</span><strong>{item.sourceValue}</strong><small>{item.sourceRowCount} 个影响员工行</small></div>
                <label>
                  <span>处理决定</span>
                  <select value={decision} onChange={event => onDecision(item.sourceValue, {
                    decision: event.target.value as AttributionDecision["decision"],
                    targetId,
                  })}>
                    <option value="mapped">关联{officialLanguage}</option>
                    <option value="excluded">排除相关行</option>
                    <option value="deferred">延后处理</option>
                  </select>
                </label>
                <label>
                  <span>{officialLanguage}</span>
                  <select
                    value={targetId}
                    disabled={decision !== "mapped"}
                    onChange={event => onDecision(item.sourceValue, { decision: "mapped", targetId: event.target.value })}
                  >
                    <option value="">请选择{officialLanguage}</option>
                    {targets.map(target => <option key={target.id} value={target.id}>{target.name}{target.detail ? ` · ${target.detail}` : ""}</option>)}
                  </select>
                </label>
                <em>{pending ? "有未保存决定" : item.decision === "mapped" ? "已确认" : item.decision === "excluded" ? "已排除" : "待处理"}</em>
              </article>
            );
          })}
        </div>
      )}

      <div className="attribution-guidance">
        <strong>判断边界</strong>
        <p>无法确认时请选择“延后处理”，或明确排除相关行；不要为了通过检查而猜测归属。</p>
      </div>
      <footer className="employee-stage-actions split">
        <button type="button" className="quiet" onClick={onBack}>返回上一步</button>
        <span>保存会逐项写入决定，并在每次写入后校验批次版本</span>
        <button type="button" disabled={saving || Object.keys(decisions).length === 0} onClick={onSave}>{saving ? "保存中…" : `保存${businessName}归属`}</button>
      </footer>
    </section>
  );
}
