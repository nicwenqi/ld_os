"use client";
import { useRef, useState } from "react";
import type { ImportRepository } from "../repositories/contracts/import-repository.ts";

type FileState="none"|"selected"|"staged";
type InspectionView={batchId?:string;status:string;sanitizedFilename:string;detectedSheets:Array<{name:string;rowCount:number;columnCount:number;hidden:boolean}>;selectedSheet:string;headerRow:number;sourceRows:number;structurallyValid:number;blockedRows:number;warningRows:number;uniqueDepartmentLabels:number;uniquePositionLabels:number;exclusions?:{totalColumns:number};warnings?:readonly string[];employeesImported:number;trainingHistoryImported:boolean;ctcGtcImported:boolean};
type Props={propertyId:string;repository:ImportRepository;realMode:boolean;complete:boolean;persistedInspected:boolean;onInspected:()=>Promise<void>;onConfirm:()=>Promise<void>;notify:(message:string)=>void};

export function WorkbookSetupStep({propertyId,repository,realMode,complete,persistedInspected,onInspected,onConfirm,notify}:Props){
  const input=useRef<HTMLInputElement>(null);const selectedFile=useRef<File|null>(null);const[fileState,setFileState]=useState<FileState>(persistedInspected?"staged":"none");const[fileName,setFileName]=useState(persistedInspected?"已保存的员工主数据批次":"");const[inspection,setInspection]=useState<InspectionView|null>(null);const[busy,setBusy]=useState(false);const[error,setError]=useState("");
  const choose=(file?:File)=>{if(!file)return;selectedFile.current=file;setFileName(file.name);setFileState("selected");setInspection(null);setError("")};
  const inspect=async()=>{if(!selectedFile.current&&!persistedInspected)return;setBusy(true);setError("");try{
    let result:InspectionView;
    if(realMode){
      if(!selectedFile.current)throw new Error("请选择要检查的工作簿");
      const form=new FormData();form.set("file",selectedFile.current);const response=await fetch("/api/import/inspect",{method:"POST",body:form});const payload=await response.json();if(!response.ok)throw new Error(payload.message??"工作簿检查失败");result=payload;
    }else{
      const batch=(await repository.listImportHistory(propertyId))[0];if(!batch)throw new Error("请先选择合成测试文件");const workbook=await repository.inspectWorkbook(batch.id);const first=workbook.sheets[0];result={status:"mapping_required",sanitizedFilename:workbook.sanitizedFilename,detectedSheets:workbook.sheets.map(sheet=>({name:sheet.name,rowCount:sheet.rowCount,columnCount:sheet.columnCount,hidden:sheet.hidden})),selectedSheet:first?.name??"Employee Master",headerRow:first?.likelyHeaderRow??1,sourceRows:Math.max(0,(first?.rowCount??0)-(first?.likelyHeaderRow??0)),structurallyValid:Math.max(0,(first?.rowCount??0)-(first?.likelyHeaderRow??0)),blockedRows:0,warningRows:0,uniqueDepartmentLabels:0,uniquePositionLabels:0,employeesImported:0,trainingHistoryImported:false,ctcGtcImported:false};
    }
    setInspection(result);setFileState("staged");await onInspected();notify("工作簿已进入私有暂存；员工尚未导入");
  }catch(reason){setError(reason instanceof Error?reason.message:"工作簿检查失败")}finally{setBusy(false)}};
  return <section className="wizard-card"><header className="wizard-intro"><h3>先安全暂存，再处理来源标签</h3><p>支持 XLS、XLSX、CSV，最大 25 MB。可信服务完成签名校验、校验和与解析；本步骤不会写入正式员工资料。</p></header>
    <div className={`wizard-inspection ${fileState}`}><div><span>员工主数据工作簿</span><strong>{fileState==="none"?"尚未选择文件":fileState==="selected"?"已选择，尚未检查":"已进入私有暂存，尚未提交"}</strong><small>{fileState==="none"?"请选择工作簿；培训历史与 CTC/GTC 数据会被排除。":`${fileName} · 页面不显示本机完整路径`}</small></div><div><input ref={input} type="file" accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden onChange={event=>choose(event.target.files?.[0])}/><button onClick={()=>input.current?.click()}>选择工作簿</button><button className="wizard-primary" disabled={fileState==="none"||busy||(!selectedFile.current&&realMode)} onClick={()=>void inspect()}>{busy?"正在安全检查…":"上传并检查"}</button></div></div>
    <div className="wizard-file-states"><article className={inspection||persistedInspected?"complete":"active"}><i>{inspection||persistedInspected?"✓":"1"}</i><span><strong>文件检查</strong><small>{inspection?`识别 ${inspection.detectedSheets.length} 个工作表`:persistedInspected?"已有持久化检查批次":"尚未检查"}</small></span></article><article className={inspection||persistedInspected?"active":""}><i>2</i><span><strong>私有暂存</strong><small>{inspection||persistedInspected?"来源行与标签已留存，等待认领":"尚未准备"}</small></span></article><article><i>3</i><span><strong>员工导入</strong><small>未执行；本修复不提交员工</small></span></article></div>
    {inspection&&<div className="wizard-inspection-results"><div><span>识别工作表</span><strong>{inspection.detectedSheets.length}</strong><small>{inspection.detectedSheets.map(sheet=>sheet.name).join(" · ")}</small></div><div><span>员工主表</span><strong>{inspection.selectedSheet}</strong><small>表头第 {inspection.headerRow} 行 · {inspection.sourceRows} 条候选行</small></div><div><span>来源标签</span><strong>{inspection.uniqueDepartmentLabels} 部门 / {inspection.uniquePositionLabels} 职位</strong><small>{inspection.blockedRows} 条阻塞 · {inspection.warningRows} 条警告</small></div><div><span>明确排除</span><strong>培训历史 / CTC / GTC</strong><small>{inspection.exclusions?.totalColumns??0} 个排除字段 · 员工导入 {inspection.employeesImported}</small></div></div>}
    {error&&<div className="wizard-error" role="alert">{error}</div>}
    <div className="wizard-privacy-note"><strong>当前边界</strong><p>工作簿存放于酒店隔离的私有空间；空白值不会解释为停用或未完成。检查成功不等于员工已导入。</p></div>
    <footer><span className={`wizard-validation ${complete?"good":""}`}>{complete?"✓ 工作簿检查事实与管理员确认已保存":"! 需要完成一次持久化工作簿检查"}</span><button className="wizard-primary" disabled={!inspection&&!persistedInspected} onClick={()=>void onConfirm()}>确认检查结果并继续</button></footer>
  </section>;
}
