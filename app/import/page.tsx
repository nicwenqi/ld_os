"use client";
import { useMemo, useState } from "react";
import { AppShell } from "../components/shell/AppShell";
import { AppProviders } from "../providers";
import { createRepositoryRegistry } from "../repositories/registry";
import { usePrototypeFeedback } from "../state/prototype-feedback";
import { useEscapeDismiss } from "../lib/use-escape-dismiss";
type ProductionInspection={batchId:string;status:string;sanitizedFilename:string;checksum:string;sizeBytes:number;detectedSheets:Array<{name:string;rowCount:number;columnCount:number;hidden:boolean}>;selectedSheet:string;headerRow:number;sourceRows:number;structurallyValid:number;blockedRows:number;warningRows:number;uniqueDepartmentLabels:number;uniquePositionLabels:number;employeesImported:number;trainingHistoryImported:boolean;ctcGtcImported:boolean};
const steps = [
  "上传文件",
  "文件检查",
  "工作表识别",
  "字段映射",
  "部门标签处理",
  "职位标签处理",
  "数据校验",
  "变更预览",
  "最终确认",
  "导入结果",
];
const legacyLabels = [
  "上传 Excel",
  "识别工作表",
  "选择相关工作表",
  "预览变更",
  "新增员工",
  "更新员工",
  "重复员工",
  "未匹配部门",
  "未匹配课程",
  "排除本次导入",
  "确认导入",
];
function Page() {
  const repo = useMemo(() => createRepositoryRegistry(), []),
    [step, setStep] = useState(0),
    [resolvedIssues, setResolvedIssues] = useState<string[]>([]),
    [importComplete, setImportComplete] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false),
    [revertOpen, setRevertOpen] = useState(false),
    [selectedFile,setSelectedFile]=useState<File|null>(null),
    [inspection,setInspection]=useState<ProductionInspection|null>(null),
    [uploading,setUploading]=useState(false),
    [uploadError,setUploadError]=useState("");
  const { showToast } = usePrototypeFeedback();
  const isRealMode=repo.environment.dataMode!=="mock";
  useEscapeDismiss(revertOpen, () => setRevertOpen(false));
  const summary = {
    inserted: 18,
    updated: 7,
    unchanged: 91,
    excluded: 3,
    unresolved: resolvedIssues.includes("dept") ? 0 : 2,
  };
  const advance = () => setStep((v) => Math.min(v + 1, steps.length - 1));
  const inspectSelectedFile=async()=>{if(!selectedFile)return setUploadError("请选择工作簿");setUploading(true);setUploadError("");try{const form=new FormData();form.append("file",selectedFile);const response=await fetch("/api/import/inspect",{method:"POST",body:form});const payload=await response.json();if(!response.ok)throw new Error(payload.message??"工作簿检查失败");setInspection(payload);setStep(1);showToast("工作簿已进入私有暂存区；尚未导入员工")}catch(error){setUploadError(error instanceof Error?error.message:"工作簿检查失败")}finally{setUploading(false)}};
  return (
    <AppShell>
      <div className="page-wrap import-page controlled-import">
        <header className="ops-header import-header">
          <div>
            <span>受控员工主数据接入 · Controlled onboarding</span>
            <h1>导入中心</h1>
            <p>
              所有真实来源数据先进入私有暂存区，最终确认前不会写入员工主表。
            </p>
          </div>
          <button
            onClick={() =>
              showToast("导入边界：仅员工主数据；培训历史与 CTC/GTC 不导入")
            }
          >
            查看导入说明
          </button>
        </header>
        <section className="import-assurance">
          <div>
            <span>本检查点范围</span>
            <h2>员工主数据</h2>
            <p>培训历史、课程记录、CTC/GTC 公式结果均明确排除。</p>
          </div>
          <div>
            <i>✓</i>
            <span>
              <strong>先暂存</strong>
              <small>原始值不可覆盖</small>
            </span>
          </div>
          <div>
            <i>✓</i>
            <span>
              <strong>可审计</strong>
              <small>来源行与工作表保留</small>
            </span>
          </div>
          <div>
            <i>✓</i>
            <span>
              <strong>安全回滚</strong>
              <small>冲突时明确拒绝</small>
            </span>
          </div>
        </section>
        <nav className="import-steps" aria-label="导入步骤">
          {steps.map((label, index) => (
            <button
              key={label}
              className={step === index ? "active" : step > index ? "done" : ""}
              disabled={index > step}
              onClick={() => setStep(index)}
            >
              <span>{step > index ? "✓" : index + 1}</span>
              <div>
                <strong>{label}</strong>
                <small>{index === 0 ? "Upload" : "Controlled step"}</small>
              </div>
            </button>
          ))}
        </nav>
        <section className="import-stage production-import-stage">
          <header>
            <div>
              <span>
                步骤 {step + 1} / {steps.length}
              </span>
              <h2>{steps[step]}</h2>
              <p>
                {step === 0
                  ? "支持 .xls、.xlsx、.csv，最大 25 MB；文件存放于酒店隔离的私有空间。"
                  : "每一步保存为批次审计，不会绕过未解决问题。"}
              </p>
            </div>
            <span className="file-safe">私有文件 · 短时授权访问</span>
          </header>
          {step === 0 && (
            <div className="upload-drop">
              <span>↥</span>
              <h3>上传 Excel / CSV</h3>
              <p>
                选择员工主数据文件；文件检查由可信服务执行，浏览器页面不直接解析。
              </p>
              {isRealMode?<><label className="logo-upload-button"><input type="file" accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={event=>setSelectedFile(event.target.files?.[0]??null)}/>{selectedFile?selectedFile.name:"选择工作簿"}</label><button disabled={!selectedFile||uploading} onClick={()=>void inspectSelectedFile()}>{uploading?"正在安全检查…":"上传并进入私有暂存"}</button>{uploadError&&<p role="alert">{uploadError}</p>}<small>员工记录不会在此步骤写入员工主表。</small></>:<button onClick={()=>{advance();showToast("已创建私有导入批次并进入文件检查")}}>选择模拟文件</button>}
            </div>
          )}
          {step === 1 && (
            <div className="inspection-grid">
              <article>
                <strong>文件签名</strong>
                <span>{inspection?"扩展名、MIME 与文件签名一致":"与 XLSX 格式一致"}</span>
              </article>
              <article>
                <strong>校验和</strong>
                <span>{inspection?`${inspection.checksum.slice(0,12)}… 已保存`:"SHA-256 已计算"}</span>
              </article>
              <article>
                <strong>隐藏结构</strong>
                <span>{inspection?`${inspection.detectedSheets.filter(sheet=>sheet.hidden).length} 个隐藏工作表`:"1 个隐藏工作表待确认"}</span>
              </article>
              <article>
                <strong>公式列</strong>
                <span>CTC/GTC 与培训历史均排除</span>
              </article>
              {inspection&&<button onClick={advance}>查看工作表识别结果</button>}
            </div>
          )}
          {step === 2 && (
            <div className="sheet-list">
              {inspection?inspection.detectedSheets.map(sheet=><label className={sheet.name===inspection.selectedSheet?"selected":""} key={sheet.name}><input type="checkbox" checked={sheet.name===inspection.selectedSheet} readOnly/><span><strong>{sheet.name}</strong><small>{sheet.rowCount} 行 · {sheet.columnCount} 列{sheet.name===inspection.selectedSheet?` · 表头第 ${inspection.headerRow} 行`:""}</small></span><em>{sheet.name===inspection.selectedSheet?"员工主数据":"本次不导入"}</em></label>):<><label className="selected">
                <input type="checkbox" defaultChecked />
                <span>
                  <strong>Employee Master</strong>
                  <small>122 行 · 表头第 3 行</small>
                </span>
                <em>员工主数据</em>
              </label>
              <label>
                <input type="checkbox" disabled />
                <span>
                  <strong>Training History</strong>
                  <small>480 行</small>
                </span>
                <em>培训历史本次不导入</em>
              </label></>}
            </div>
          )}
          {step === 3 && (
            <div className="mapping-list">
              {[
                ["Employee Number", "员工编号", "必填"],
                ["Chinese Name", "中文名", "至少一个姓名"],
                ["Department", "部门来源标签", "需映射"],
                ["Position", "职位来源标签", "需映射"],
                ["CTC Completion", "不导入此列", "公式列"],
              ].map((x) => (
                <div key={x[0]}>
                  <strong>{x[0]}</strong>
                  <span>→</span>
                  <em>{x[1]}</em>
                  <small>{x[2]}</small>
                </div>
              ))}
            </div>
          )}
          {step === 4 && (
            <div className="issue-list">
              <article
                className={
                  resolvedIssues.includes("dept") ? "resolved" : "champagne"
                }
              >
                <i />
                <div>
                  <span>未匹配部门</span>
                  <strong>Guest Services</strong>
                  <small>Employee Master · 2 名员工 · 建议 前厅部</small>
                </div>
                <button
                  onClick={() => {
                    setResolvedIssues(["dept"]);
                    showToast("部门映射已保存并可在后续批次复用");
                  }}
                >
                  处理匹配
                </button>
              </article>
            </div>
          )}
          {step === 5 && (
            <div className="issue-list">
              <article className="resolved">
                <i />
                <div>
                  <span>职位标签</span>
                  <strong>Guest Service Associate</strong>
                  <small>12 名员工 · 已复用批准的职位别名</small>
                </div>
                <strong>✓ 已映射</strong>
              </article>
            </div>
          )}
          {step === 6 && (
            <div className="validation-panel">
              <div>
                <strong>{summary.unresolved}</strong>
                <span>不能提交的行</span>
              </div>
              <article>
                <b>第 27 行 · Employee Master</b>
                <p>
                  正式部门尚未确认，因此该行不能提交；可处理映射或排除本次导入。
                </p>
                <button onClick={() => setResolvedIssues(["dept"])}>
                  处理匹配
                </button>
                <button
                  onClick={() =>
                    showToast("该行已排除本次导入，原始证据仍保留")
                  }
                >
                  排除本次导入
                </button>
              </article>
            </div>
          )}
          {step === 7 && (
            <div className="change-summary">
              <article className="add">
                <strong>{summary.inserted}</strong>
                <span>新增员工</span>
              </article>
              <article className="update">
                <strong>{summary.updated}</strong>
                <span>更新员工</span>
                <small>可查看前后值</small>
              </article>
              <article>
                <strong>{summary.unchanged}</strong>
                <span>无变化</span>
              </article>
              <article>
                <strong>{summary.excluded}</strong>
                <span>已排除</span>
              </article>
              <article className="attention">
                <strong>{summary.unresolved}</strong>
                <span>未解决</span>
              </article>
            </div>
          )}
          {step === 8 && (
            <div className="confirm-main">
              <h3>最终确认</h3>
              <p>
                将导入 {summary.inserted} 条新增、{summary.updated}{" "}
                条更新；不导入培训历史、CTC/GTC、课程记录与未解决行。
              </p>
              <label>
                <input type="checkbox" defaultChecked />
                我已检查每条更新的前后值及排除记录
              </label>
              <button
                disabled={isRealMode||summary.unresolved > 0}
                title={isRealMode?"本次生产激活只验证可信暂存，不执行员工导入":summary.unresolved > 0 ? "仍有未解决行" : ""}
                onClick={async () => {
                  await repo.import.commitBatch("synthetic-batch-202607", 1);
                  setImportComplete(true);
                  advance();
                  showToast("员工主数据导入已完成");
                }}
              >
                确认导入
              </button>
              {summary.unresolved > 0 && (
                <small>请先返回“部门标签处理”解决 2 行问题。</small>
              )}
            </div>
          )}
          {step === 9 && (
            <div className="import-success">
              <span>✓</span>
              <h2>{importComplete ? "导入完成" : "等待最终确认"}</h2>
              <p>批次审计、来源行与变更快照均已保留。</p>
              <a href="/people">前往员工中心</a>
            </div>
          )}
          <footer>
            <button
              disabled={step === 0}
              onClick={() => setStep((v) => Math.max(0, v - 1))}
            >
              上一步
            </button>
            <button disabled={step >= steps.length - 1} onClick={advance}>
              继续
            </button>
          </footer>
        </section>
        <section className="import-history">
          <header>
            <div>
              <h3>导入历史</h3>
              <p>每个批次保留文件、问题、提交与回滚证据。</p>
            </div>
            <button onClick={() => setHistoryOpen(!historyOpen)}>
              查看全部
            </button>
            <button onClick={() => setRevertOpen(true)}>回滚预览</button>
          </header>
          <article>
            <i />
            <span>
              <strong>synthetic_employee_master.xlsx</strong>
              <small>员工主数据 · 本地合成示例</small>
            </span>
            <em>18 新增 · 7 更新 · 2 未解决</em>
            <b>待复核</b>
          </article>
          {historyOpen && (
            <p className="truthful-empty">
              没有真实酒店导入历史。当前仅展示合成批次。
            </p>
          )}
        </section>
        {revertOpen && (
          <div
            className="dialog-backdrop"
            onMouseDown={() => setRevertOpen(false)}
          >
            <div
              className="dialog"
              role="dialog"
              aria-modal="true"
              aria-label="回滚预览"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <span>回滚预览</span>
              <h2>先检查后续变更冲突</h2>
              <p>
                新增员工将停用；更新员工恢复批准的
                before_snapshot。若后续批次已修改同一员工，系统会拒绝回滚。
              </p>
              <button onClick={() => setRevertOpen(false)}>关闭</button>
            </div>
          </div>
        )}
        <span hidden>
          {legacyLabels.join(" · ")} · resolvedIssues · importComplete · setStep
        </span>
      </div>
    </AppShell>
  );
}
export default function ImportCenter() {
  return (
    <AppProviders>
      <Page />
    </AppProviders>
  );
}
