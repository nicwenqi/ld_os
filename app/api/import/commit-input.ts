import { parseMappingBatchId, ImportMappingInputError } from "./mapping-input.ts";

export class ImportCommitInputError extends Error {}

export function parseCommitBatchId(value: string) {
  try { return parseMappingBatchId(value); } catch { throw new ImportCommitInputError("导入批次标识无效"); }
}

export function parseCommitInput(value: unknown, batchId: string) {
  const row = exact(value, ["expectedBatchVersion", "expectedDecisionVersion", "previewHash", "confirmed"]);
  if (row.confirmed !== true) throw new ImportCommitInputError("提交必须明确确认");
  if (!positive(row.expectedBatchVersion) || !positive(row.expectedDecisionVersion)) throw new ImportCommitInputError("提交版本无效");
  if (typeof row.previewHash !== "string" || !/^[0-9a-f]{64}$/.test(row.previewHash)) throw new ImportCommitInputError("预览证据无效");
  return { batchId, expectedBatchVersion: row.expectedBatchVersion, expectedDecisionVersion: row.expectedDecisionVersion, previewHash: row.previewHash, confirmed: true as const };
}

export function parseRevertInput(value: unknown, batchId: string) {
  const row = exact(value, ["expectedCommitVersion", "confirmed"]);
  if (row.confirmed !== true || !positive(row.expectedCommitVersion)) throw new ImportCommitInputError("撤销必须明确确认并提供版本");
  return { batchId, expectedCommitVersion: row.expectedCommitVersion, confirmed: true as const };
}

function exact(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ImportCommitInputError("请求体无效");
  const row = value as Record<string, any>;
  if (Object.keys(row).some(key => !keys.includes(key))) throw new ImportCommitInputError("请求体包含未批准字段");
  return row;
}
function positive(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0; }
