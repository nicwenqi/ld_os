import { parseBatchId } from "./batches/input.ts";

const VERSION_KEYS = new Set(["decisionVersion"]);

export class ImportMappingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportMappingInputError";
  }
}

export function parseDecisionVersion(request: Request): number {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) if (!VERSION_KEYS.has(key)) throw new ImportMappingInputError("导入决策查询参数无效");
  const value = params.get("decisionVersion");
  if (value === null || !/^[1-9][0-9]*$/.test(value)) throw new ImportMappingInputError("导入决策版本无效");
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) throw new ImportMappingInputError("导入决策版本无效");
  return version;
}

export async function parseDecisionBody(request: Request) {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ImportMappingInputError("导入决策请求体无效");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ImportMappingInputError("导入决策请求体无效");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !["expectedDecisionVersion", "decisions"].includes(key))) throw new ImportMappingInputError("导入决策请求体字段无效");
  const version = row.expectedDecisionVersion;
  if (!Number.isSafeInteger(version) || Number(version) < 1) throw new ImportMappingInputError("导入决策版本无效");
  if (!Array.isArray(row.decisions) || row.decisions.length < 1 || row.decisions.length > 250) throw new ImportMappingInputError("导入决策数量无效");
  return { expectedDecisionVersion: Number(version), decisions: row.decisions };
}

export function parseMappingBatchId(value: string) {
  try {
    return parseBatchId(value);
  } catch {
    throw new ImportMappingInputError("导入批次标识无效");
  }
}
