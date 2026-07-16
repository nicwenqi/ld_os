"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "../components/shell/AppShell";
import { DataStateBadge } from "../components/operations/DataStateBadge";
import { ProtectedAppProviders } from "../providers";
import type { ImportBatch } from "../repositories/contracts/import-repository";
import { createRepositoryRegistry } from "../repositories/registry";
import { useAuthSession } from "../state/auth-session";

type ProductionInspection = {
  batchId: string;
  status: string;
  sanitizedFilename: string;
  checksum: string;
  sizeBytes: number;
  detectedSheets: Array<{ name: string; rowCount: number; columnCount: number; hidden: boolean }>;
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
};

function EmployeeDataUpdateContent() {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const { session } = useAuthSession();
  const [history, setHistory] = useState<readonly ImportBatch[]>([]);
  const [historyState, setHistoryState] = useState<"loading" | "ready" | "failed">("loading");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<ProductionInspection | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const isRealMode = registry.environment.dataMode !== "mock";

  const resolvePropertyId = useCallback(async () => {
    if (registry.environment.dataMode !== "mock") return session.propertyId;
    return (await registry.property.resolveContext("training-demo.example.test"))?.propertyId ?? null;
  }, [registry, session.propertyId]);

  const readHistory = useCallback(async () => {
    const propertyId = await resolvePropertyId();
    if (!propertyId) throw new Error("当前账号尚未取得酒店上下文");
    return registry.import.listImportHistory(propertyId);
  }, [registry.import, resolvePropertyId]);

  const loadHistory = useCallback(async () => {
    setHistoryState("loading");
    try {
      setHistory(await readHistory());
      setHistoryState("ready");
    } catch {
      setHistory([]);
      setHistoryState("failed");
    }
  }, [readHistory]);

  useEffect(() => {
    let active = true;
    void readHistory()
      .then(next => {
        if (!active) return;
        setHistory(next);
        setHistoryState("ready");
      })
      .catch(() => {
        if (!active) return;
        setHistory([]);
        setHistoryState("failed");
      });
    return () => {
      active = false;
    };
  }, [readHistory]);

  const inspectSelectedFile = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      const response = await fetch("/api/import/inspect", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "工作簿检查失败");
      setInspection(payload as ProductionInspection);
      await loadHistory();
    } catch (reason) {
      setUploadError(reason instanceof Error ? reason.message : "工作簿检查失败");
    } finally {
      setUploading(false);
    }
  };

  return <AppShell><div className="page-wrap controlled-import recovery-data-update">
    <header className="ops-header import-header">
      <div><span>员工主数据 · EMPLOYEE MASTER</span><h1>员工资料更新</h1><p>先检查文件与数据边界，再进入后续归属确认；本页不会导入培训历史。</p></div>
      <DataStateBadge state={isRealMode ? "real" : "demo"}/>
    </header>

    <section className="import-assurance">
      <div><span>允许更新</span><h2>员工主数据</h2><p>员工编号、姓名、正式部门、职位、入职日期与在职状态。</p></div>
      <div><span><strong>明确排除</strong><small>培训历史、签到、反馈与 CTC/GTC 公式结果</small></span></div>
      <div><span><strong>证据边界</strong><small>文件检查不等于员工更新已提交</small></span></div>
      <div><span><strong>当前阶段</strong><small>Recovery A 仅保留可信入口与检查事实</small></span></div>
    </section>

    {isRealMode ? <section className="import-stage production-import-stage">
      <header><div><span>01 · 文件检查</span><h2>选择员工主数据文件</h2><p>文件进入酒店隔离的私有暂存区；检查完成前不会写入员工主表。</p></div><span className="file-safe">私有文件 · 受控检查</span></header>
      <div className="upload-drop">
        <h3>Excel / CSV</h3><p>支持 .xls、.xlsx、.csv，最大 25 MB。</p>
        <label className="logo-upload-button"><input type="file" accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={event => { setSelectedFile(event.target.files?.[0] ?? null); setInspection(null); setUploadError(null); }}/>{selectedFile?.name ?? "选择工作簿"}</label>
        <button disabled={!selectedFile || uploading} onClick={() => void inspectSelectedFile()}>{uploading ? "正在安全检查…" : "上传并检查文件"}</button>
        {uploadError && <p role="alert">{uploadError}</p>}
      </div>
      {inspection && <div className="inspection-grid" aria-live="polite">
        <article><strong>{inspection.sourceRows}</strong><span>来源行</span></article>
        <article><strong>{inspection.structurallyValid}</strong><span>结构有效</span></article>
        <article><strong>{inspection.blockedRows}</strong><span>阻塞行</span></article>
        <article><strong>{inspection.warningRows}</strong><span>警告行</span></article>
        <div className="truthful-empty"><h3>文件检查已完成，员工更新尚未提交</h3><p>{inspection.selectedSheet} · 表头第 {inspection.headerRow} 行。部门归属、职位归属、问题处理、更新预览与提交将在 Recovery C 连接；当前没有员工被导入。</p></div>
      </div>}
    </section> : <section className="import-stage production-import-stage truthful-empty">
      <DataStateBadge state="demo"/><h2>本地环境不接受真实工作簿</h2><p>这里仅验证员工资料更新的产品入口。请勿把下方示例批次理解为当前酒店的真实更新记录。</p>
    </section>}

    <section className="import-history">
      <header><div><h2>更新记录</h2><p>{isRealMode ? "来自当前酒店的员工资料批次。" : "本地验证数据，明确与真实酒店记录隔离。"}</p></div>{historyState === "failed" && <button onClick={() => void loadHistory()}>重新读取</button>}</header>
      {historyState === "loading" && <div className="truthful-empty">正在读取更新记录…</div>}
      {historyState === "failed" && <div className="truthful-empty" role="alert"><strong>更新记录读取失败</strong><p>这不代表当前酒店没有历史记录。</p></div>}
      {historyState === "ready" && history.length === 0 && <div className="truthful-empty"><strong>当前没有员工资料更新记录</strong><p>没有记录不等于员工主数据为空。</p></div>}
      {historyState === "ready" && history.map(batch => <article key={batch.id}>
        <span><strong>{batch.fileName}</strong><small>{formatDate(batch.createdAt)} · {isRealMode ? "当前酒店记录" : "本地验证批次"}</small></span>
        <em>{statusLabel(batch.status)}</em><b>{batch.summary.unresolved} 个未解决问题</b>
      </article>)}
    </section>

    <footer className="foundation-work-links"><Link href="/people">返回员工</Link><Link href="/data-quality">查看数据质量</Link></footer>
  </div></AppShell>;
}

function statusLabel(status: string) {
  return ({ mapping_required: "待确认归属", validating: "正在校验", ready_for_review: "待复核", completed: "已完成", completed_with_warnings: "完成但有警告", failed: "失败" } as Record<string, string>)[status] ?? status;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export default function ImportCenter() {
  return <ProtectedAppProviders><EmployeeDataUpdateContent/></ProtectedAppProviders>;
}
