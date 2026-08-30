import type {
  ImportFieldMapping,
  ImportFieldMappingDecision,
} from "../../repositories/contracts/import-repository";

export type FieldDecisionState = Record<string, ImportFieldMappingDecision>;

const targetLabels: Record<string, string> = {
  employee_number: "员工编号",
  name_zh: "中文姓名",
  name_en: "英文姓名",
  department_source_label: "部门来源值",
  position_source_label: "职位来源值",
  grade_or_band: "职级 / Band",
  hire_date: "入职日期",
  probation_or_confirmation_date: "转正 / 试用期日期",
  employment_status: "在职状态",
  lms_employee_id: "LMS 外部标识",
  merlin_id: "Merlin 外部标识",
};

export function FieldRecognitionStep({
  mappings,
  decisions,
  saving,
  onDecision,
  onBack,
  onSave,
}: {
  mappings: readonly ImportFieldMapping[];
  decisions: FieldDecisionState;
  saving: boolean;
  onDecision: (decision: ImportFieldMappingDecision) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  return (
    <section className="employee-update-stage field-recognition-step" aria-labelledby="field-recognition-title">
      <header className="employee-stage-heading">
        <div><span>02 · FIELD RECOGNITION</span><h2 id="field-recognition-title">字段识别</h2><p>核对来源字段与员工主数据目标字段；识别结果必须由经理明确保存。</p></div>
        <em>{mappings.filter(item => item.mappingStatus === "suggested").length} 项待确认</em>
      </header>
      <div className="field-mapping-table" role="table" aria-label="字段识别结果">
        <div className="field-mapping-head" role="row">
          <span>来源字段</span><span>识别方向</span><span>目标字段</span><span>处理</span>
        </div>
        {mappings.map(mapping => {
          const decision = decisions[mapping.id] ?? {
            mappingId: mapping.id,
            mappingStatus: mapping.mappingStatus === "excluded" ? "excluded" : "confirmed",
            targetField: mapping.targetField,
            transformationRule: mapping.transformationRule,
          };
          return (
            <div className="field-mapping-row" role="row" key={mapping.id}>
              <span><strong>{mapping.sourceColumnName}</strong><small>{mapping.isRequired ? "必需字段" : "可选字段"}</small></span>
              <b aria-hidden="true">至</b>
              <label>
                <span className="visually-hidden">目标字段</span>
                <select
                  value={decision.targetField ?? mapping.targetField ?? ""}
                  disabled={decision.mappingStatus === "excluded"}
                  onChange={event => onDecision({ ...decision, targetField: event.target.value })}
                >
                  {Object.entries(targetLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                {Boolean(mapping.transformationRule.preserveLeadingZeros || mapping.transformationRule.preserveText) && <small>员工编号按文本保存，保留前导零</small>}
              </label>
              <label>
                <span className="visually-hidden">字段处理</span>
                <select
                  value={decision.mappingStatus}
                  onChange={event => onDecision({
                    ...decision,
                    mappingStatus: event.target.value as "confirmed" | "excluded",
                  })}
                >
                  <option value="confirmed">确认识别</option>
                  <option value="excluded">本次排除</option>
                </select>
              </label>
            </div>
          );
        })}
      </div>
      <footer className="employee-stage-actions split">
        <button type="button" className="quiet" onClick={onBack}>返回文件检查</button>
        <span>保存后会重新读取服务器中的权威识别结果</span>
        <button type="button" disabled={saving || mappings.length === 0} onClick={onSave}>{saving ? "保存中…" : "保存字段识别"}</button>
      </footer>
    </section>
  );
}
