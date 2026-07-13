import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, readonly string[]> = {
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  csv: ["text/csv", "application/csv", "text/plain"],
};
const targetAliases: Record<string, readonly string[]> = {
  employee_number: ["employee number", "employee no", "employee id", "emp id", "empid", "员工编号", "工号"],
  name_zh: ["chinese name", "cname", "中文名", "姓名"],
  name_en: ["english name", "ename", "英文名"],
  department_source_label: ["department", "部门"],
  position_source_label: ["position", "job title", "职位", "岗位"],
  grade_or_band: ["grade", "band", "级别"],
  hire_date: ["hire date", "date of hire", "join date", "joindate", "入职日期"],
  probation_or_confirmation_date: ["probation", "confirmation date", "转正日期", "试用期"],
};
const excludedPattern = /(gender|性别|ctc|gtc|course|training|培训|completion|完成|orientation|入职引导|onboarding|checklist|清单|journey|旅程|first\s*aid|急救|problem\s*handling|问题处理)/i;

export type WorkbookFile = { fileName: string; mimeType: string; bytes: Uint8Array };
export type SheetInspection = {
  name: string; index: number; hidden: boolean; rowCount: number; columnCount: number;
  likelyHeaderRow: number | null; mergedCellCount: number; hiddenRowCount: number; hiddenColumnCount: number;
  formulaColumns: readonly string[]; suggestedMappings: readonly { sourceColumn: string; targetField: string | null; excluded: boolean; reason: string }[];
};
export type WorkbookInspection = { sanitizedFilename: string; extension: string; mimeType: string; checksum: string; sizeBytes: number; sheets: readonly SheetInspection[] };

export function sanitizeWorkbookFilename(value: string) {
  const base = value.replace(/\\/g, "/").split("/").at(-1) ?? "workbook";
  return base.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/-+/g, "-").slice(0, 160) || "workbook";
}

function validateSignature(extension: string, bytes: Uint8Array) {
  const prefix = [...bytes.slice(0, 8)].map(value => value.toString(16).padStart(2, "0")).join("");
  if (extension === "xls" && prefix !== "d0cf11e0a1b11ae1") throw new Error("文件签名与 .xls 扩展名不一致");
  if (extension === "xlsx" && !prefix.startsWith("504b0304")) throw new Error("文件签名与 .xlsx 扩展名不一致");
  if (extension === "csv" && bytes.slice(0, 512).includes(0)) throw new Error("CSV 文件包含不支持的二进制内容");
}

function normalizeHeader(value: unknown) { return String(value ?? "").trim().toLocaleLowerCase(); }
function inferTarget(header: string) {
  const normalized = normalizeHeader(header);
  for (const [target, aliases] of Object.entries(targetAliases)) if (aliases.some(alias => normalized === alias || normalized.includes(alias))) return target;
  return null;
}
function headerScore(row: readonly unknown[]) { return row.filter(value => inferTarget(String(value ?? "")) || excludedPattern.test(String(value ?? ""))).length; }

export function inspectWorkbook(input: WorkbookFile): WorkbookInspection {
  if (!input.bytes.byteLength || input.bytes.byteLength > MAX_IMPORT_BYTES) throw new Error("文件必须介于 1 字节与 25 MB 之间");
  const sanitizedFilename = sanitizeWorkbookFilename(input.fileName);
  const extension = sanitizedFilename.split(".").at(-1)?.toLowerCase() ?? "";
  if (!MIME_BY_EXTENSION[extension]) throw new Error("仅支持 XLS、XLSX 与 CSV");
  if (!MIME_BY_EXTENSION[extension].includes(input.mimeType.toLowerCase())) throw new Error("文件扩展名与 MIME 类型不一致");
  validateSignature(extension, input.bytes);
  const workbook = XLSX.read(input.bytes, { type: "array", cellDates: true, cellFormula: true, cellStyles: true, sheetStubs: true, raw: true });
  const sheets = workbook.SheetNames.map((name, index): SheetInspection => {
    const sheet = workbook.Sheets[name];
    const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]!) : null;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: null, blankrows: true });
    let likelyHeaderIndex = -1; let bestScore = 0;
    rows.slice(0, 30).forEach((row, rowIndex) => { const score = headerScore(row); if (score > bestScore) { bestScore = score; likelyHeaderIndex = rowIndex; } });
    const header = likelyHeaderIndex >= 0 ? rows[likelyHeaderIndex] : [];
    const formulaColumns = new Set<string>();
    if (range) for (let column = range.s.c; column <= range.e.c; column += 1) for (let row = range.s.r; row <= range.e.r; row += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined;
      if (cell?.f) formulaColumns.add(String(header[column] ?? XLSX.utils.encode_col(column)));
    }
    const suggestedMappings = header.map(value => {
      const sourceColumn = String(value ?? "").trim(); const formula = formulaColumns.has(sourceColumn); const excluded = formula || excludedPattern.test(sourceColumn);
      return { sourceColumn, targetField: excluded ? null : inferTarget(sourceColumn), excluded, reason: formula ? "公式列不作为业务事实" : excluded ? "培训历史、CTC/GTC 或可选敏感字段不在本检查点" : inferTarget(sourceColumn) ? "已识别员工主数据字段" : "需要管理员确认" };
    }).filter(item => item.sourceColumn);
    const metadata = workbook.Workbook?.Sheets?.[index];
    return { name, index, hidden: Boolean(metadata?.Hidden), rowCount: range ? range.e.r - range.s.r + 1 : 0, columnCount: range ? range.e.c - range.s.c + 1 : 0, likelyHeaderRow: likelyHeaderIndex >= 0 ? likelyHeaderIndex + 1 : null, mergedCellCount: sheet["!merges"]?.length ?? 0, hiddenRowCount: sheet["!rows"]?.filter(row => row?.hidden).length ?? 0, hiddenColumnCount: sheet["!cols"]?.filter(column => column?.hidden).length ?? 0, formulaColumns: [...formulaColumns], suggestedMappings };
  });
  return { sanitizedFilename, extension, mimeType: input.mimeType, checksum: createHash("sha256").update(input.bytes).digest("hex"), sizeBytes: input.bytes.byteLength, sheets };
}

export function stableRowFingerprint(values: Record<string, unknown>) {
  const ordered = Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}
