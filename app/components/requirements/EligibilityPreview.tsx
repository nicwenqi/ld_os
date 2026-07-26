"use client";

import { useState } from "react";
import type {
  EligibilityEvaluationPage,
  LearningRequirementRepository,
  RequirementVersion,
} from "../../repositories/contracts/learning-requirement-repository.ts";

export function EligibilityPreview({
  propertyId,
  requirement,
  repository,
}: {
  propertyId: string;
  requirement: RequirementVersion;
  repository: LearningRequirementRepository;
}) {
  const [evaluationDate, setEvaluationDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [result, setResult] = useState<EligibilityEvaluationPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const evaluate = async () => {
    try {
      setLoading(true);
      setError(null);
      setResult(await repository.evaluateEligibility({
        propertyId,
        requirementVersionId: requirement.id,
        evaluationDate,
        page: 1,
        pageSize: 100,
      }));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "适用性评估暂时无法完成。",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="eligibility-preview" aria-labelledby="eligibility-title">
      <header>
        <div>
          <span>POINT-IN-TIME EVALUATION</span>
          <h3 id="eligibility-title">适用性评估</h3>
          <p>
            只回答评估日期是否适用；不创建员工任务、逾期、提醒或完成事实。
          </p>
        </div>
        <label>
          <span>评估日期</span>
          <input
            type="date"
            value={evaluationDate}
            onChange={event => setEvaluationDate(event.target.value)}
          />
        </label>
        <button type="button" disabled={loading} onClick={() => void evaluate()}>
          {loading ? "评估中…" : "运行只读评估"}
        </button>
      </header>

      {error && <div className="requirement-error" role="alert">{error}</div>}
      {!result && !error && (
        <div className="eligibility-empty">
          <strong>尚未运行评估</strong>
          <span>结果将引用评估日期有效的员工事实版本。</span>
        </div>
      )}
      {result && result.rows.length === 0 && (
        <div className="eligibility-empty">
          <strong>当前没有可评估的员工事实</strong>
          <span>缺失数据不会被解释为不适用或零。</span>
        </div>
      )}
      {result && result.rows.length > 0 && (
        <div className="eligibility-table-wrap">
          <table>
            <thead>
              <tr>
                <th>员工</th>
                <th>部门</th>
                <th>评估结果</th>
                <th>员工事实版本</th>
                <th>证据说明</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map(row => (
                <tr key={row.employeeId}>
                  <td>
                    <strong>{row.employeeName}</strong>
                    <small>{row.employeeNumber}</small>
                  </td>
                  <td>{row.departmentName ?? "部门证据缺失"}</td>
                  <td>
                    <span className={`eligibility-state ${row.result}`}>
                      {row.result === "eligible"
                        ? "适用"
                        : row.result === "not_applicable"
                          ? "不适用"
                          : "无法判断"}
                    </span>
                  </td>
                  <td>{row.evidence.employeeFactVersionId ?? "—"}</td>
                  <td>
                    {row.evidence.explanationZh}
                    {row.evidence.missingEvidence.length > 0 && (
                      <small>{row.evidence.missingEvidence.join(" · ")}</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
