export type ProductionInspection = {
  batchId: string;
  status: string;
  version?: number;
  sanitizedFilename: string;
  checksumPrefix?: string;
  sizeBytes: number;
  detectedSheets: Array<{
    name: string;
    rowCount: number;
    columnCount: number;
    hidden: boolean;
  }>;
  selectedSheet: string;
  headerRow: number;
  sourceRows: number;
  structurallyValid: number;
  blockedRows: number;
  warningRows: number;
  uniqueDepartmentLabels: number;
  uniquePositionLabels: number;
  employeesImported: number;
  trainingHistoryImported: boolean;
  ctcGtcImported: boolean;
  organizationCandidates?: {
    employees: number;
    departments: number;
    positions: number;
    bands: number;
    trainees: number;
    unresolvedEmployees: number;
  };
  exclusions?: {
    totalColumns?: number;
    formulaDerivedColumns?: number;
    trainingHistoryAndSensitiveColumns?: number;
  };
};

export function FileInspectionStep({
  isReviewData,
  selectedFile,
  inspection,
  batchFileName,
  uploading,
  error,
  onFileChange,
  onInspect,
  onContinue,
}: {
  isReviewData: boolean;
  selectedFile: File | null;
  inspection: ProductionInspection | null;
  batchFileName?: string | null;
  uploading: boolean;
  error: string | null;
  onFileChange: (file: File | null) => void;
  onInspect: () => void;
  onContinue: () => void;
}) {
  const canContinue = Boolean(inspection || batchFileName);
  return (
    <section className="employee-update-stage file-inspection-step" aria-labelledby="file-inspection-title">
      <header className="employee-stage-heading">
        <div>
          <span>01 · FILE CHECK</span>
          <h2 id="file-inspection-title">文件检查</h2>
          <p>只识别员工主数据。文件检查不等于更新，确认更新前员工主表保持零写入。</p>
        </div>
        <em>{isReviewData ? "受保护评审数据" : "酒店私有文件"}</em>
      </header>

      <div className="file-inspection-layout">
        <div className="employee-upload-panel">
          <span>员工主数据工作簿</span>
          <h3>{isReviewData ? "评审批次已就绪" : selectedFile?.name ?? batchFileName ?? "选择 Excel 或 CSV 文件"}</h3>
          <p>
            {isReviewData
              ? "仅含合成聚合事实，用于验证完整流程；不会接受真实酒店工作簿。"
              : "支持 .xls、.xlsx、.csv，最大 25 MB。原始文件保存在当前酒店的私有暂存区。"}
          </p>
          {!isReviewData && (
            <div className="employee-upload-actions">
              <label className="employee-file-picker">
                <input
                  type="file"
                  accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  onChange={event => onFileChange(event.target.files?.[0] ?? null)}
                />
                {selectedFile ? "重新选择文件" : "选择工作簿"}
              </label>
              <button type="button" disabled={!selectedFile || uploading} onClick={onInspect}>
                {uploading ? "正在安全检查…" : "上传并检查"}
              </button>
            </div>
          )}
          {error && <p className="employee-update-error" role="alert">{error}</p>}
        </div>

        <aside className="employee-import-boundary">
          <h3>本次允许更新</h3>
          <p>员工编号、姓名、正式部门、职位、入职日期、转正日期与有效在职状态。</p>
          <h3>明确排除</h3>
          <p>培训历史、签到、反馈、课程记录，以及 CTC/GTC 与公式派生结果。</p>
          <small>普通员工不会因此获得 Auth 用户、后台账号、角色或工作区。</small>
        </aside>
      </div>

      {inspection && (
        <div className="inspection-evidence" aria-live="polite">
          <div className="inspection-metrics">
            <article><strong>{inspection.sourceRows}</strong><span>候选员工行</span></article>
            <article><strong>{inspection.structurallyValid}</strong><span>结构有效</span></article>
            <article><strong>{inspection.blockedRows}</strong><span>阻塞行</span></article>
            <article><strong>{inspection.warningRows}</strong><span>警告行</span></article>
            {inspection.organizationCandidates && <article><strong>{inspection.organizationCandidates.departments} / {inspection.organizationCandidates.positions}</strong><span>部门 / 岗位候选</span></article>}
            {inspection.organizationCandidates && <article><strong>{inspection.organizationCandidates.bands} / {inspection.organizationCandidates.trainees}</strong><span>Band / Trainee</span></article>}
          </div>
          <div className="inspection-source-note">
            <strong>文件检查完成，员工更新尚未提交</strong>
            <p>{inspection.selectedSheet} · 表头第 {inspection.headerRow} 行 · {inspection.uniqueDepartmentLabels} 个部门来源值 · {inspection.uniquePositionLabels} 个职位来源值。</p>
            {inspection.organizationCandidates && <small>已生成批量组织候选：{inspection.organizationCandidates.departments} 个部门、{inspection.organizationCandidates.positions} 个部门范围岗位、{inspection.organizationCandidates.bands} 个正式 Band、{inspection.organizationCandidates.trainees} 名 Trainee。{inspection.organizationCandidates.unresolvedEmployees > 0 ? ` ${inspection.organizationCandidates.unresolvedEmployees} 行仍需人工处理。` : "普通候选可批量确认。"}</small>}
          </div>
        </div>
      )}

      <footer className="employee-stage-actions">
        <span>{canContinue ? "可以继续确认系统识别结果" : "先完成受控文件检查"}</span>
        <button type="button" disabled={!canContinue || uploading} onClick={onContinue}>继续字段识别</button>
      </footer>
    </section>
  );
}
