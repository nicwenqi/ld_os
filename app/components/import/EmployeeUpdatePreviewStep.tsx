import Link from "next/link";
import type {
  EmployeeImportPreviewOptions,
  EmployeeUpdatePreview,
} from "../../repositories/contracts/import-repository";

export function EmployeeUpdatePreviewStep({
  mode,
  preview,
  committed,
  auditCount,
  statusTreatment,
  acknowledged,
  saving,
  onStatusTreatment,
  onAcknowledged,
  onBack,
  onPrepare,
  onConfirm,
}: {
  mode: "preview" | "confirmation";
  preview: EmployeeUpdatePreview | null;
  committed: boolean;
  auditCount: number | null;
  statusTreatment: EmployeeImportPreviewOptions["statusTreatment"];
  acknowledged: boolean;
  saving: boolean;
  onStatusTreatment: (value: EmployeeImportPreviewOptions["statusTreatment"]) => void;
  onAcknowledged: (value: boolean) => void;
  onBack: () => void;
  onPrepare: () => void;
  onConfirm: () => void;
}) {
  if (committed) {
    return (
      <section className="employee-update-stage employee-update-complete" aria-labelledby="employee-update-complete-title">
        <span>更新完成</span>
        <h2 id="employee-update-complete-title">员工主数据已提交并重新读取</h2>
        <p>本次提交保留完整批次、行级变更与审计证据{auditCount === null ? "。" : `，已读取 ${auditCount} 条提交证据。`}</p>
        <div><Link href="/people">前往员工中心核对</Link><a href="#update-history">查看更新记录</a></div>
      </section>
    );
  }

  return (
    <section className="employee-update-stage employee-update-preview" aria-labelledby="employee-update-preview-title">
      <header className="employee-stage-heading">
        <div>
          <span>{mode === "preview" ? "06 · ZERO-WRITE PREVIEW" : "07 · EXPLICIT CONFIRMATION"}</span>
          <h2 id="employee-update-preview-title">{mode === "preview" ? "更新预览" : "确认更新"}</h2>
          <p>{preview ? "以下分类来自服务器预览；仍未写入员工主表。" : "先生成零写入预览，再确认确切的新增、更新与排除范围。"}</p>
        </div>
        <em>{preview ? "零写入预览" : "尚未计算"}</em>
      </header>

      <div className="status-treatment-card">
        <div><strong>员工状态处理</strong><p>缺席于单次工作簿不等于离职，系统不会静默停用员工。</p></div>
        <label><input type="radio" name="status-treatment" checked={statusTreatment === "retain_existing_set_additions_active"} onChange={() => onStatusTreatment("retain_existing_set_additions_active")} />保留现有状态，新增员工设为在职</label>
        <label><input type="radio" name="status-treatment" checked={statusTreatment === "use_recognized_status"} onChange={() => onStatusTreatment("use_recognized_status")} />仅采用文件中明确识别的状态</label>
      </div>

      {preview ? (
        <div className="employee-preview-counts" aria-live="polite">
          <article><strong>{preview.additions}</strong><span>新增</span><small>新建员工记录</small></article>
          <article><strong>{preview.updates}</strong><span>更新</span><small>变更现有主数据</small></article>
          <article><strong>{preview.unchanged}</strong><span>不变</span><small>无需写入</small></article>
          <article><strong>{preview.exclusions}</strong><span>排除</span><small>经理明确排除</small></article>
          <article className={preview.blocked ? "attention" : ""}><strong>{preview.blocked}</strong><span>阻塞</span><small>不能提交</small></article>
          <article className={preview.unresolved ? "attention" : ""}><strong>{preview.unresolved}</strong><span>未解决</span><small>仍需决定</small></article>
        </div>
      ) : (
        <div className="employee-stage-empty"><strong>尚未生成更新预览</strong><p>不会用零替代尚未计算的新增、更新或阻塞数量。</p></div>
      )}

      {mode === "confirmation" && preview && (
        <label className="employee-update-acknowledgement">
          <input type="checkbox" checked={acknowledged} onChange={event => onAcknowledged(event.target.checked)} />
          <span><strong>我已核对更新范围与状态处理方式</strong><small>只有此处明确确认后，员工记录才会在一个事务中写入；不会创建 Auth 用户或后台账号。</small></span>
        </label>
      )}

      <footer className="employee-stage-actions split">
        <button type="button" className="quiet" onClick={onBack}>返回问题处理</button>
        <span>{preview ? "预览版本与批次版本已绑定" : "准备预览不会写入员工主表"}</span>
        {mode === "preview" ? (
          <button type="button" disabled={saving} onClick={onPrepare}>{saving ? "正在计算…" : preview ? "重新生成预览" : "生成零写入预览"}</button>
        ) : (
          <button type="button" disabled={saving || !preview || !acknowledged || preview.blocked > 0 || preview.unresolved > 0} onClick={onConfirm}>{saving ? "正在确认更新…" : "确认更新员工主数据"}</button>
        )}
      </footer>
    </section>
  );
}
