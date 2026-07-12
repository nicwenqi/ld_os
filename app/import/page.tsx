"use client";

import { useState } from "react";
import { AppShell } from "../components/shell/AppShell";
import { AppProviders } from "../providers";
import { usePrototypeFeedback } from "../state/prototype-feedback";

const steps = [[1, "上传 Excel", "Upload"], [2, "识别工作表", "Sheets"], [3, "字段映射", "Mapping"], [4, "预览与处理", "Review"], [5, "确认导入", "Confirm"]] as const;
const sheets = [{ name: "Employee Master", rows: 128, selected: true }, { name: "Training Records", rows: 462, selected: true }, { name: "Course Catalog", rows: 36, selected: true }, { name: "Notes", rows: 8, selected: false }];
const issues = [
  { id: "duplicate", type: "重复员工", title: "陈雅婷 Amy Chen", detail: "员工编号 FO-1801 与现有员工一致", count: "2 条记录", tone: "coral" },
  { id: "department", type: "未匹配部门", title: "Guest Service Desk", detail: "建议匹配至 房务部 › 前厅部 › 前台", count: "3 名员工", tone: "champagne" },
  { id: "course", type: "未匹配课程", title: "Luxury Service Basics", detail: "课程目录中暂未找到对应课程", count: "1 门课程", tone: "champagne" },
];

function Page() {
  const [step, setStep] = useState(1);
  const [selectedSheets, setSelectedSheets] = useState(sheets.filter(s => s.selected).map(s => s.name));
  const [resolvedIssues, setResolvedIssues] = useState<string[]>([]);
  const [importComplete, setImportComplete] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { showToast } = usePrototypeFeedback();
  const resolve = (id: string, message: string) => { setResolvedIssues(v => [...new Set([...v, id])]); showToast(message); };

  return <AppShell><div className="page-wrap import-page">
    <header className="ops-header import-header"><div><span>GUIDED DATA ONBOARDING</span><h1>导入中心</h1><p>Import Center · 安全、清晰地接入人员与培训数据</p></div><button onClick={() => showToast("导入说明已打开：本版本使用预设模拟数据")}>查看导入说明</button></header>

    <section className="import-assurance"><div><span>本次导入</span><h2>人员主数据与培训记录</h2><p>每一步都会先预览再确认，不会直接覆盖现有资料。</p></div><div><i>✓</i><span><strong>可追溯</strong><small>保留模拟导入历史</small></span></div><div><i>✓</i><span><strong>先预览</strong><small>新增与更新清晰分开</small></span></div><div><i>✓</i><span><strong>可排除</strong><small>有疑问的记录暂不导入</small></span></div></section>

    <nav className="import-steps" aria-label="导入步骤">{steps.map(([number, zh, en]) => <button key={number} className={`${step === number ? "active" : ""} ${step > number ? "done" : ""}`} onClick={() => number <= step && setStep(number)}><span>{step > number ? "✓" : number}</span><div><strong>{zh}</strong><small>{en}</small></div></button>)}</nav>

    {step === 1 && <section className="import-stage upload-stage"><div className="upload-drop"><span>↥</span><h2>上传 Excel</h2><p>拖放酒店培训主表，或从电脑中选择文件</p><small>支持 .xlsx · 此原型使用预设模拟文件，不会读取真实数据</small><button onClick={() => { setStep(2); showToast("已载入模拟文件：Lanting_LD_Master_July.xlsx"); }}>选择模拟 Excel 文件</button></div><aside><h3>导入前准备</h3><p>✓ 员工编号保持唯一</p><p>✓ 中文名与英文名分列</p><p>✓ 部门名称使用酒店当前层级</p><p>✓ 课程名称与课程目录一致</p><button onClick={() => showToast("模板下载已模拟完成")}>下载推荐模板</button></aside></section>}

    {step === 2 && <section className="import-stage sheet-stage"><header><div><span>已识别文件</span><h2>Lanting_LD_Master_July.xlsx</h2><p>检测到 4 个工作表，请选择相关工作表。</p></div><span className="file-safe">✓ 文件检查完成</span></header><div className="sheet-list">{sheets.map(sheet => <label key={sheet.name} className={selectedSheets.includes(sheet.name) ? "selected" : ""}><input type="checkbox" checked={selectedSheets.includes(sheet.name)} onChange={() => setSelectedSheets(v => v.includes(sheet.name) ? v.filter(x => x !== sheet.name) : [...v, sheet.name])} /><i>▦</i><span><strong>{sheet.name}</strong><small>{sheet.rows} 行数据</small></span><em>{selectedSheets.includes(sheet.name) ? "将导入" : "已跳过"}</em></label>)}</div><footer><button onClick={() => setStep(1)}>返回</button><button onClick={() => { setStep(3); showToast(`已选择 ${selectedSheets.length} 个工作表`); }}>继续字段映射</button></footer></section>}

    {step === 3 && <section className="import-stage mapping-stage"><header><div><span>字段映射</span><h2>确认 Excel 列与系统资料的对应关系</h2><p>我们已自动识别大部分字段，请检查高亮项目。</p></div><strong>11 / 12 已匹配</strong></header><div className="mapping-list"><div className="mapping-head"><span>Excel 列</span><span>系统资料</span><span>示例值</span><span>状态</span></div>{[["Employee ID", "员工编号", "FO-1801", "已匹配"], ["Chinese Name", "中文名", "陈雅婷", "已匹配"], ["English Name", "英文名", "Amy Chen", "已匹配"], ["Department", "部门层级", "Front Office / Concierge", "需确认"], ["Position", "岗位", "Concierge Agent", "已匹配"]].map(row => <div className={row[3] === "需确认" ? "needs-review" : ""} key={row[0]}><strong>{row[0]}</strong><span>→</span><select defaultValue={row[1]}><option>{row[1]}</option><option>不导入此列</option></select><small>{row[2]}</small><em>{row[3]}</em></div>)}</div><footer><button onClick={() => setStep(2)}>返回工作表</button><button onClick={() => { setStep(4); showToast("字段映射已确认，正在生成变更预览"); }}>确认映射并预览</button></footer></section>}

    {step === 4 && <section className="import-stage review-stage"><header><div><span>预览变更</span><h2>确认将要新增、更新与需要关注的内容</h2><p>解决或排除问题后，才会进入最终确认。</p></div><button onClick={() => showToast("变更明细预览已打开")}>查看全部变更</button></header><div className="change-summary"><article className="add"><span>＋</span><div><strong>18</strong><small>新增员工</small></div><p>将创建新的员工档案</p></article><article className="update"><span>↻</span><div><strong>7</strong><small>更新员工</small></div><p>将更新部门或岗位资料</p></article><article className="attention"><span>!</span><div><strong>{6 - resolvedIssues.length}</strong><small>需要关注</small></div><p>可匹配、合并或排除</p></article></div><div className="issue-heading"><div><h3>问题处理</h3><p>Issue resolution · {resolvedIssues.length} / {issues.length} 类问题已处理</p></div><span>{resolvedIssues.length === issues.length ? "全部问题已处理" : "仍可先排除后继续"}</span></div><div className="issue-list">{issues.map(issue => <article key={issue.id} className={`${issue.tone} ${resolvedIssues.includes(issue.id) ? "resolved" : ""}`}><i /><div className="issue-type"><span>{issue.type}</span><strong>{issue.title}</strong><small>{issue.detail}</small></div><em>{issue.count}</em>{resolvedIssues.includes(issue.id) ? <strong className="resolved-label">✓ 已处理</strong> : <div><button onClick={() => resolve(issue.id, `${issue.title}匹配方案已保存`)}>处理匹配</button><button onClick={() => resolve(issue.id, `${issue.title}已排除本次导入`)}>排除本次导入</button></div>}</article>)}</div><footer><button onClick={() => setStep(3)}>返回字段映射</button><button onClick={() => { setStep(5); showToast("变更预览已确认"); }}>继续最终确认</button></footer></section>}

    {step === 5 && !importComplete && <section className="import-stage confirm-stage"><div className="confirm-main"><span>最终确认</span><h2>准备导入 25 条人员变更</h2><p>以下内容仅用于高保真原型演示，不会写入数据库或外部系统。</p><div className="confirm-numbers"><article><strong>18</strong><span>新增员工</span></article><article><strong>7</strong><span>更新员工</span></article><article><strong>{resolvedIssues.length}</strong><span>已处理问题</span></article></div><label><input type="checkbox" defaultChecked /> 我已检查新增、更新与排除记录</label><div className="final-actions"><button onClick={() => setStep(4)}>返回检查</button><button onClick={() => setConfirmOpen(true)}>确认导入</button></div></div><aside><h3>导入后将会</h3><p><i />创建 18 份员工档案</p><p><i />更新 7 名员工的部门或岗位</p><p><i />保留本次导入历史与问题处理结果</p><small>导入后仍可从员工中心继续检查和调整。</small></aside></section>}

    {importComplete && <section className="import-stage import-success"><span>✓</span><h2>模拟导入已完成</h2><p>18 名员工已新增，7 名员工资料已更新。</p><div><button onClick={() => showToast("已打开本次模拟导入报告")}>查看导入报告</button><a href="/people">前往员工中心</a><button onClick={() => { setImportComplete(false); setStep(1); }}>开始新的导入</button></div></section>}

    <section className="import-history"><header><div><h3>导入历史</h3><p>Import history · 每次操作都保留清晰记录</p></div><button onClick={() => showToast("完整导入历史已打开")}>查看全部</button></header>{[["2026.07.08", "员工主数据 · 7 月", "+12 新增 · 5 更新", "已完成", "林静"], ["2026.06.26", "第二季度培训记录", "+186 条记录", "已完成", "林静"], ["2026.06.02", "课程目录更新", "+4 课程 · 2 更新", "已撤回", "徐婉宁"]].map(row => <article key={row[0]}><i /><span><strong>{row[1]}</strong><small>{row[0]} · 操作人 {row[4]}</small></span><em>{row[2]}</em><b>{row[3]}</b><button onClick={() => showToast(`${row[1]}详情已打开`)}>查看详情 →</button></article>)}</section>

    {confirmOpen && <div className="dialog-backdrop"><div className="dialog import-confirm-dialog"><span>FINAL CHECK</span><h2>确认执行模拟导入？</h2><p>系统将展示完成状态，但不会解析文件、写入数据库或调用后端接口。</p><div><strong>18 新增</strong><strong>7 更新</strong><strong>{6 - resolvedIssues.length} 排除 / 待处理</strong></div><footer><button onClick={() => setConfirmOpen(false)}>再检查一次</button><button onClick={() => { setConfirmOpen(false); setImportComplete(true); showToast("模拟导入已成功完成"); }}>确认并开始导入</button></footer></div></div>}
  </div></AppShell>;
}

export default function ImportCenter() { return <AppProviders><Page /></AppProviders>; }
