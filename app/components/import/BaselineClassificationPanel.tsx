import type { EmployeeBaselineClassification, EmployeeBaselineState } from "../../services/pilot-employee-baseline.ts";
import { validateEmployeeBaselineClassification } from "../../services/pilot-employee-baseline.ts";
import type { AttributionTarget } from "./AttributionStep.tsx";

const descriptions: Record<EmployeeBaselineState, { label: string; detail: string }> = {
  full: {
    label: "Full · 酒店完整基线",
    detail: "当前酒店预计员工范围已作为本次基线提交，不声明部门限制。",
  },
  restricted: {
    label: "Restricted · 有声明限制",
    detail: "基线可用，但必须清楚说明未覆盖或尚待确认的范围。",
  },
  pilot_limited: {
    label: "Pilot Limited · 仅限试运行范围",
    detail: "只确认一个正式部门分支或明确边界；不得据此宣称酒店全量覆盖。",
  },
};

export function BaselineClassificationPanel({
  baseline,
  departments,
  disabled,
  onChange,
}: {
  baseline: EmployeeBaselineClassification | null;
  departments: readonly AttributionTarget[];
  disabled: boolean;
  onChange: (next: EmployeeBaselineClassification) => void;
}) {
  const validationMessage = validationMessageFor(baseline);
  const state = baseline?.state ?? null;
  return (
    <section className="employee-baseline-classification" aria-labelledby="employee-baseline-classification-title">
      <header>
        <div>
          <span>EMPLOYEE BASELINE · MANAGER APPROVAL</span>
          <h3 id="employee-baseline-classification-title">员工基线适用范围</h3>
          <p>这是一项提交审批证据，不会改变员工、部门或职位事实；经理必须明确选择，系统不会把缺失资料当作完整覆盖。</p>
        </div>
        <em>{validationMessage ?? "分类已准备，仍由服务器在事务提交时校验"}</em>
      </header>

      <div className="baseline-state-options" role="radiogroup" aria-label="员工基线分类">
        {(Object.keys(descriptions) as EmployeeBaselineState[]).map(option => (
          <label className={state === option ? "selected" : ""} key={option}>
            <input
              type="radio"
              name="employee-baseline-state"
              checked={state === option}
              disabled={disabled}
              onChange={() => onChange(emptyClassification(option))}
            />
            <strong>{descriptions[option].label}</strong>
            <small>{descriptions[option].detail}</small>
          </label>
        ))}
      </div>

      {baseline && baseline.state !== "full" && (
        <div className="baseline-scope-fields">
          <label>
            <span>{baseline.state === "pilot_limited" ? "试运行正式部门" : "可选部门边界"}</span>
            <select
              value={baseline.departmentId ?? ""}
              disabled={disabled}
              onChange={event => onChange({
                ...baseline,
                departmentId: event.target.value || null,
                includeDescendants: event.target.value ? baseline.includeDescendants : false,
              })}
            >
              <option value="">{baseline.state === "pilot_limited" ? "请选择正式部门" : "不限定单一部门"}</option>
              {departments.map(department => <option value={department.id} key={department.id}>{department.name}</option>)}
            </select>
          </label>
          <label className="baseline-descendant-toggle">
            <input
              type="checkbox"
              checked={baseline.includeDescendants}
              disabled={disabled || !baseline.departmentId}
              onChange={event => onChange({ ...baseline, includeDescendants: event.target.checked })}
            />
            <span><strong>包含下级部门</strong><small>仅作为本次基线已确认范围的声明；不授予任何人员新的部门权限。</small></span>
          </label>
          <label className="baseline-limitations">
            <span>限制说明</span>
            <textarea
              rows={3}
              value={baseline.limitations}
              disabled={disabled}
              placeholder="说明未覆盖的员工、来源或范围；不要用推测替代证据"
              onChange={event => onChange({ ...baseline, limitations: event.target.value })}
            />
          </label>
        </div>
      )}
    </section>
  );
}

function emptyClassification(state: EmployeeBaselineState): EmployeeBaselineClassification {
  return { state, departmentId: null, includeDescendants: false, limitations: "" };
}

function validationMessageFor(baseline: EmployeeBaselineClassification | null) {
  if (!baseline) return "尚未选择员工基线分类";
  try {
    validateEmployeeBaselineClassification(baseline);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "员工基线分类无效";
  }
}
