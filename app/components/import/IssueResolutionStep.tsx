import type { ImportIssue } from "../../repositories/contracts/import-repository";
import type { AttributionTarget } from "./AttributionStep";

export type IssueDecision = {
  action: "corrected" | "excluded" | "deferred" | "accepted";
  targetId: string;
};
export type IssueDecisionState = Record<string, IssueDecision>;

export function IssueResolutionStep({
  issues,
  departments,
  positions,
  decisions,
  saving,
  onDecision,
  onBack,
  onSave,
}: {
  issues: readonly ImportIssue[];
  departments: readonly AttributionTarget[];
  positions: readonly AttributionTarget[];
  decisions: IssueDecisionState;
  saving: boolean;
  onDecision: (issueId: string, decision: IssueDecision) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  const unresolved = issues.filter(issue => issue.resolutionStatus === "unresolved" || issue.resolutionStatus === "deferred");
  return (
    <section className="employee-update-stage issue-resolution-step" aria-labelledby="issue-resolution-title">
      <header className="employee-stage-heading">
        <div><span>05 · DATA ISSUE REVIEW</span><h2 id="issue-resolution-title">数据问题处理</h2><p>逐行处理阻塞与警告；缺失部门或职位必须明确更正、排除本次更新或延后处理。</p></div>
        <em>{unresolved.length} 个问题待处理</em>
      </header>

      {issues.length === 0 ? (
        <div className="employee-stage-empty"><strong>当前批次没有数据问题</strong><p>仍需进入更新预览核对实际变更分类。</p></div>
      ) : (
        <div className="employee-issue-list">
          {issues.map(issue => {
            const decision = decisions[issue.id];
            const correctionType = issue.type === "unresolved_department" ? "department" : issue.type === "unresolved_position" ? "position" : null;
            const targets = correctionType === "department" ? departments : positions;
            const activeAction = decision?.action ?? (issue.severity === "warning" ? "accepted" : "deferred");
            return (
              <article key={issue.id} className={issue.severity}>
                <div className="issue-evidence">
                  <span>{issue.severity === "error" ? "阻塞" : "警告"} · 来源行 {issue.rowNumber}</span>
                  <strong>{issue.message}</strong>
                  <small>{issue.sheetName || "员工主数据"} · {issue.field ?? "字段未识别"} · {issue.value || "未提供来源值"}</small>
                </div>
                {issue.resolutionStatus !== "unresolved" && issue.resolutionStatus !== "deferred" && !decision ? (
                  <em>已处理 · {resolutionLabel(issue.resolutionStatus)}</em>
                ) : (
                  <>
                    <label>
                      <span>经理决定</span>
                      <select value={activeAction} onChange={event => onDecision(issue.id, {
                        action: event.target.value as IssueDecision["action"],
                        targetId: decision?.targetId ?? "",
                      })}>
                        {correctionType && <option value="corrected">明确更正{correctionType === "department" ? "部门" : "职位"}</option>}
                        <option value="excluded">排除本次更新</option>
                        <option value="deferred">延后处理</option>
                        {issue.severity === "warning" && <option value="accepted">接受警告</option>}
                      </select>
                    </label>
                    {correctionType && activeAction === "corrected" && (
                      <label>
                        <span>更正为正式{correctionType === "department" ? "部门" : "职位"}</span>
                        <select value={decision?.targetId ?? ""} onChange={event => onDecision(issue.id, { action: "corrected", targetId: event.target.value })}>
                          <option value="">请选择</option>
                          {targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
                        </select>
                      </label>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
      <footer className="employee-stage-actions split">
        <button type="button" className="quiet" onClick={onBack}>返回职位归属</button>
        <span>没有决定的阻塞行不会进入员工主表</span>
        <button type="button" disabled={saving || Object.keys(decisions).length === 0} onClick={onSave}>{saving ? "保存中…" : "保存问题处理"}</button>
      </footer>
    </section>
  );
}

function resolutionLabel(status: string) {
  return ({ accepted: "已接受", corrected: "已更正", excluded: "已排除", ignored: "已忽略" } as Record<string, string>)[status] ?? status;
}
